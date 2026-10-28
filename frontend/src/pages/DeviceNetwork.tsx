import { ArrowRight, Cloud, Cpu, Monitor, Network, Radio, Server } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card, PageHeader, Pill, StatusDot, type Tone } from '../components/ui/primitives'
import { formatAgo, formatDateTime } from '../lib/format'
import { api } from '../services/api'
import { useTelemetry } from '../state/TelemetryProvider'
import type { DevicesResponse } from '../types/telemetry'

const stateTone: Record<string, Tone> = { online: 'ok', offline: 'bad', unknown: 'neutral', demo: 'demo' }

function Hop({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex min-w-[120px] flex-col items-center gap-1.5 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-line-strong bg-inset text-accent">{icon}</span>
      <span className="text-sm font-semibold text-fg">{label}</span>
      <span className="text-[11px] text-dim">{sub}</span>
    </div>
  )
}

export default function DeviceNetwork() {
  const { snapshot, transport } = useTelemetry()
  const [data, setData] = useState<DevicesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => api.devices().then((d) => { if (alive) { setData(d); setError(null) } }).catch((e) => alive && setError(e.message))
    load()
    const id = window.setInterval(load, 3000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  const b = data?.blynk
  const e = data?.espnow

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader icon={<Network size={36} />} title="Device Network" subtitle="ESP32 gateway, ESP8266 node, ESP-NOW and Blynk connectivity" />
      {error && <div className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-2.5 text-sm text-bad">{error}</div>}
      <Card className="overflow-x-auto p-5">
        <div className="flex min-w-[760px] items-start justify-between gap-2">
          <Hop icon={<Cpu size={22} />} label="ESP8266 node" sub="sensors / actuators" />
          <div className="mt-4 flex flex-col items-center text-[11px] text-dim"><ArrowRight size={18} />ESP-NOW</div>
          <Hop icon={<Radio size={22} />} label="ESP32 gateway" sub="Blynk firmware" />
          <div className="mt-4 flex flex-col items-center text-[11px] text-dim"><ArrowRight size={18} />Wi-Fi / HTTPS</div>
          <Hop icon={<Cloud size={22} />} label="Blynk Cloud" sub={b?.server ?? '—'} />
          <div className="mt-4 flex flex-col items-center text-[11px] text-dim"><ArrowRight size={18} />REST poll</div>
          <Hop icon={<Server size={22} />} label="LightSync API" sub="token stays here" />
          <div className="mt-4 flex flex-col items-center text-[11px] text-dim"><ArrowRight size={18} />SSE</div>
          <Hop icon={<Monitor size={22} />} label="Dashboard" sub={transport} />
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        {(data?.devices ?? []).map((d) => (
          <Card key={d.id} className="p-5">
            <div className="flex items-center gap-3">
              <StatusDot tone={stateTone[d.state]} pulse={d.state === 'online'} />
              <h2 className="text-lg font-semibold text-fg">{d.name}</h2>
              <Pill tone={stateTone[d.state]} className="ml-auto !text-xs uppercase">{d.state}</Pill>
            </div>
            <dl className="mt-4 grid grid-cols-[130px_1fr] gap-y-2 text-sm">
              <dt className="text-dim">Chip</dt><dd className="text-fg">{d.chip}</dd>
              <dt className="text-dim">Identifier</dt><dd className="font-mono text-xs text-fg">{d.id}</dd>
              <dt className="text-dim">Role</dt><dd className="text-fg">{d.role}</dd>
              <dt className="text-dim">Last seen</dt><dd className="text-fg">{d.last_seen ? `${formatDateTime(d.last_seen)} (${formatAgo(d.last_seen)})` : 'never'}</dd>
              {Object.entries(d.details).map(([k, v]) => (
                <div key={k} className="contents"><dt className="capitalize text-dim">{k.replace('_', ' ')}</dt><dd className="text-fg">{String(v)}</dd></div>
              ))}
            </dl>
          </Card>
        ))}
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-fg">ESP-NOW link</h2>
          <dl className="mt-4 grid grid-cols-[130px_1fr] gap-y-2 text-sm">
            <dt className="text-dim">State</dt>
            <dd><Pill tone={e?.state === 'connected' ? 'ok' : e?.state === 'disconnected' ? 'bad' : 'neutral'} className="!py-0.5 !text-xs">{e?.state ?? '—'}</Pill></dd>
            <dt className="text-dim">RSSI</dt><dd className="text-fg">{e?.rssi_dbm != null ? `${e.rssi_dbm} dBm` : <span className="text-dim">Not published by firmware</span>}</dd>
            <dt className="text-dim">Packet loss</dt><dd className="text-fg">{e?.packet_loss_pct != null ? `${e.packet_loss_pct}%` : <span className="text-dim">Not published by firmware</span>}</dd>
            <dt className="text-dim">Reported via</dt><dd className="text-fg">{e?.source === 'demo' ? 'Demo simulator' : 'espnow_link datastream'}</dd>
          </dl>
          <p className="mt-3 text-xs text-dim">ESP-NOW is local device-to-device radio; only the ESP32 gateway connects to the internet and Blynk.</p>
        </Card>
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-fg">Blynk connectivity</h2>
          {data?.mode === 'demo' ? (
            <p className="mt-3 text-sm text-muted">Demo mode — Blynk is not being polled. Token configured on server: <b className="text-fg">{b?.configured ? 'yes' : 'no'}</b>.</p>
          ) : (
            <dl className="mt-4 grid grid-cols-[150px_1fr] gap-y-2 text-sm">
              <dt className="text-dim">Token configured</dt><dd className="text-fg">{b?.configured ? 'Yes (server-side only)' : 'No — set BLYNK_TOKEN'}</dd>
              <dt className="text-dim">Server</dt><dd className="text-fg">{b?.server}</dd>
              <dt className="text-dim">API reachable</dt><dd className="text-fg">{b?.reachable == null ? '—' : b.reachable ? 'Yes' : 'No'}</dd>
              <dt className="text-dim">Hardware connected</dt><dd className="text-fg">{b?.hardware_connected == null ? '—' : b.hardware_connected ? 'Yes' : 'No'}</dd>
              <dt className="text-dim">Last poll</dt><dd className="text-fg">{formatAgo(b?.last_poll ?? null)}</dd>
              <dt className="text-dim">Last success</dt><dd className="text-fg">{formatAgo(b?.last_success ?? null)}</dd>
              <dt className="text-dim">Failures in a row</dt><dd className="text-fg">{b?.consecutive_failures ?? 0}</dd>
              {b?.last_error && (<><dt className="text-dim">Last error</dt><dd className="text-bad">{b.last_error}</dd></>)}
            </dl>
          )}
          {snapshot?.connection.reason && <p className="mt-3 text-xs text-dim">Telemetry: {snapshot.connection.reason}</p>}
        </Card>
      </div>
    </div>
  )
}
