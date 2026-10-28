import type {
  CommandResult,
  ConfigResponse,
  DevicesResponse,
  EventsResponse,
  HistoryResponse,
  Mode,
  TelemetrySnapshot,
  Thresholds,
} from '../types/telemetry'

// The operator key authorizes state-changing requests to *this* backend. It is
// not the Blynk token (which never leaves the server) and is kept only for the
// browser session.
const OPERATOR_KEY_STORAGE = 'lightsync.operatorKey'

export function getOperatorKey(): string {
  return sessionStorage.getItem(OPERATOR_KEY_STORAGE) ?? ''
}

export function setOperatorKey(key: string): void {
  if (key) sessionStorage.setItem(OPERATOR_KEY_STORAGE, key)
  else sessionStorage.removeItem(OPERATOR_KEY_STORAGE)
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (init.method && init.method !== 'GET') {
    const key = getOperatorKey()
    if (key) headers.set('X-API-Key', key)
  }
  try {
    const res = await fetch(path, { ...init, headers, signal: controller.signal })
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`
      try {
        const body = await res.json()
        if (typeof body.detail === 'string') message = body.detail
        else if (Array.isArray(body.detail)) {
          message = body.detail.map((d: unknown) => (typeof d === 'string' ? d : (d as { msg?: string }).msg ?? '')).join('; ')
        }
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, message)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'Request timed out')
    }
    if (err instanceof ApiError) throw err
    throw new ApiError(0, 'Backend unreachable')
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  latest: () => request<TelemetrySnapshot>('/api/telemetry/latest'),
  history: (windowSeconds: number) =>
    request<HistoryResponse>(`/api/telemetry/history?window_seconds=${windowSeconds}`),
  events: (limit = 500) => request<EventsResponse>(`/api/events?limit=${limit}`),
  devices: () => request<DevicesResponse>('/api/devices/status'),
  config: () => request<ConfigResponse>('/api/config'),
  commandHistory: () => request<CommandResult[]>('/api/commands/history'),
  setThresholds: (t: Thresholds) =>
    request<ConfigResponse>('/api/config/thresholds', { method: 'PUT', body: JSON.stringify(t) }),
  setMode: (mode: Mode) =>
    request<ConfigResponse>('/api/config/mode', { method: 'PUT', body: JSON.stringify({ mode }) }),
  // Commands wait for hardware acknowledgement, so allow longer than the ack timeout.
  setAutonomous: (enabled: boolean) =>
    request<CommandResult>('/api/commands/autonomous-mode', { method: 'POST', body: JSON.stringify({ enabled }) }, 70000),
  setEmergencyStop: (active: boolean) =>
    request<CommandResult>('/api/commands/emergency-stop', { method: 'POST', body: JSON.stringify({ active }) }, 70000),
}
