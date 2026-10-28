import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../services/api'
import { appendBounded, mergeSamples } from '../lib/series'
import type { ConfigResponse, ConnectionStateName, SafetyEvent, Sample, TelemetrySnapshot } from '../types/telemetry'

/** How the browser is currently receiving data from the backend. */
export type Transport = 'connecting' | 'stream' | 'polling' | 'down'

const DEFAULT_MAX_SAMPLES = 3600
const MAX_EVENTS = 500
const POLL_MS = 3000
const SSE_RETRY_MS = 30000
const SSE_FAILURES_BEFORE_POLLING = 3

export interface EffectiveConnection {
  state: ConnectionStateName
  reason: string | null
  lastUpdate: string | null
}

interface TelemetryContextValue {
  snapshot: TelemetrySnapshot | null
  samples: Sample[]
  events: SafetyEvent[]
  config: ConfigResponse | null
  transport: Transport
  connection: EffectiveConnection
  refreshConfig: () => Promise<void>
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null)

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [events, setEvents] = useState<SafetyEvent[]>([])
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [transport, setTransport] = useState<Transport>('connecting')
  const [lastMessageAt, setLastMessageAt] = useState<number>(0)
  const [now, setNow] = useState(() => Date.now())

  const maxSamplesRef = useRef(DEFAULT_MAX_SAMPLES)
  const modeRef = useRef<string | null>(null)

  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await api.config()
      maxSamplesRef.current = cfg.history_max_samples
      setConfig(cfg)
    } catch {
      /* surfaced through transport state */
    }
  }, [])

  // Load buffered history and events (initial load and after a mode switch).
  const seed = useCallback(async () => {
    const [hist, evts] = await Promise.allSettled([api.history(3600), api.events(MAX_EVENTS)])
    if (hist.status === 'fulfilled') {
      modeRef.current = hist.value.mode
      setSamples(hist.value.samples.slice(-maxSamplesRef.current))
    }
    if (evts.status === 'fulfilled') setEvents(evts.value.events)
  }, [])

  const reset = useCallback(async () => {
    setSamples([])
    setEvents([])
    setSnapshot(null)
    await refreshConfig()
    await seed()
  }, [refreshConfig, seed])

  const acceptSnapshot = useCallback((snap: TelemetrySnapshot) => {
    // Never mix data from different modes in one buffer.
    if (modeRef.current && modeRef.current !== snap.mode) {
      modeRef.current = snap.mode
      setSamples([])
      setEvents([])
      void refreshConfig()
    }
    modeRef.current = snap.mode
    setSnapshot(snap)
    setLastMessageAt(Date.now())
  }, [refreshConfig])

  useEffect(() => {
    void refreshConfig().then(seed)
  }, [refreshConfig, seed])

  // Stream with automatic fallback to polling.
  useEffect(() => {
    let source: EventSource | null = null
    let failures = 0
    let pollTimer: number | undefined
    let retryTimer: number | undefined
    let disposed = false

    const poll = async () => {
      try {
        const [snap, hist, evts] = await Promise.all([api.latest(), api.history(60), api.events(MAX_EVENTS)])
        if (disposed) return
        acceptSnapshot(snap)
        setSamples((prev) => mergeSamples(prev, hist.samples, maxSamplesRef.current))
        setEvents(evts.events)
        setTransport('polling')
      } catch {
        if (!disposed) setTransport('down')
      }
    }

    const startPolling = () => {
      if (pollTimer !== undefined) return
      void poll()
      pollTimer = window.setInterval(poll, POLL_MS)
      retryTimer = window.setTimeout(() => {
        stopPolling()
        openStream()
      }, SSE_RETRY_MS)
    }

    const stopPolling = () => {
      if (pollTimer !== undefined) window.clearInterval(pollTimer)
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      pollTimer = undefined
      retryTimer = undefined
    }

    const openStream = () => {
      if (disposed) return
      if (typeof EventSource === 'undefined') {
        startPolling()
        return
      }
      source = new EventSource('/api/telemetry/stream')
      source.onopen = () => {
        failures = 0
        setTransport('stream')
      }
      source.addEventListener('snapshot', (e) => acceptSnapshot(JSON.parse((e as MessageEvent).data)))
      source.addEventListener('sample', (e) => {
        const sample = JSON.parse((e as MessageEvent).data) as Sample
        setSamples((prev) => mergeSamples(prev, [sample], maxSamplesRef.current))
      })
      source.addEventListener('event', (e) => {
        const event = JSON.parse((e as MessageEvent).data) as SafetyEvent
        setEvents((prev) => appendBounded([event], prev, MAX_EVENTS))
      })
      source.addEventListener('reset', () => void reset())
      source.onerror = () => {
        failures += 1
        if (failures >= SSE_FAILURES_BEFORE_POLLING) {
          source?.close()
          source = null
          startPolling()
        } else {
          setTransport('connecting')
        }
      }
    }

    openStream()
    return () => {
      disposed = true
      source?.close()
      stopPolling()
    }
  }, [acceptSnapshot, reset])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const connection = useMemo<EffectiveConnection>(() => {
    if (transport === 'down') {
      return { state: 'offline', reason: 'Dashboard backend is unreachable', lastUpdate: snapshot?.connection.last_update ?? null }
    }
    if (!snapshot) return { state: 'connecting', reason: null, lastUpdate: null }
    const pollSeconds = config?.poll_interval ?? 2
    const silentFor = (now - lastMessageAt) / 1000
    if (silentFor > Math.max(15, pollSeconds * 5)) {
      return { state: 'stale', reason: `No update from the backend for ${Math.round(silentFor)} s`, lastUpdate: snapshot.connection.last_update }
    }
    return { state: snapshot.connection.state, reason: snapshot.connection.reason, lastUpdate: snapshot.connection.last_update }
  }, [transport, snapshot, config, now, lastMessageAt])

  const value = useMemo(
    () => ({ snapshot, samples, events, config, transport, connection, refreshConfig }),
    [snapshot, samples, events, config, transport, connection, refreshConfig],
  )
  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>
}

export function useTelemetry(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext)
  if (!ctx) throw new Error('useTelemetry must be used inside TelemetryProvider')
  return ctx
}

/** True while the data on screen is current (live hardware or demo). */
export function isFresh(state: ConnectionStateName): boolean {
  return state === 'live' || state === 'demo'
}
