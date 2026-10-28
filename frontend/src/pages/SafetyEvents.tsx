import { Search, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { severityTone } from '../components/dashboard/SafetyCard'
import { Card, cx, PageHeader, Pill, SourceBadge, StatusDot } from '../components/ui/primitives'
import { formatDateTime } from '../lib/format'
import { useTelemetry } from '../state/TelemetryProvider'
import type { SafetyEvent, Severity, Source } from '../types/telemetry'

const SEVERITIES: (Severity | 'all')[] = ['all', 'critical', 'warning', 'info']
const SOURCES: { value: Source | 'all'; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'blynk', label: 'Hardware' },
  { value: 'demo', label: 'Demo' },
  { value: 'system', label: 'System' },
]

export default function SafetyEvents() {
  const { events, snapshot } = useTelemetry()
  const [q, setQ] = useState('')
  const [severity, setSeverity] = useState<Severity | 'all'>('all')
  const [source, setSource] = useState<Source | 'all'>('all')
  const [selected, setSelected] = useState<SafetyEvent | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return events.filter(
      (e) =>
        (severity === 'all' || e.severity === severity) &&
        (source === 'all' || e.source === source) &&
        (!needle || e.message.toLowerCase().includes(needle) || e.type.toLowerCase().includes(needle)),
    )
  }, [events, q, severity, source])

  const risk = snapshot?.derived.risk

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader icon={<ShieldCheck size={36} />} title="Safety Events" subtitle="Detected incidents, warnings and connectivity changes" />
      {snapshot?.mode === 'demo' && (
        <div className="rounded-lg border border-demo/30 bg-demo-soft px-4 py-2.5 text-sm text-demo">Demo mode: every event below is simulated and labelled “Demo”.</div>
      )}
      {risk?.available && (
        <Card className="p-4">
          <div className="text-sm font-semibold text-fg">Accident risk: {risk.level} {risk.score !== null && <span className="font-normal text-muted">({risk.score.toFixed(0)}/100)</span>}</div>
          <div className="mt-1 text-xs text-dim">{risk.method}</div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {risk.factors.map((f) => <li key={f} className="rounded-md bg-inset px-2 py-1 text-xs text-muted">{f}</li>)}
          </ul>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search events</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search events…"
            className="h-10 w-full rounded-lg border border-line-strong bg-card pl-9 pr-3 text-sm text-fg placeholder:text-dim"
          />
        </label>
        <div className="flex gap-1 rounded-lg border border-line-strong bg-card p-1" role="group" aria-label="Severity filter">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              aria-pressed={severity === s}
              className={cx('rounded-md px-3 py-1.5 text-sm capitalize', severity === s ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:text-fg')}
            >
              {s}
            </button>
          ))}
        </div>
        <select value={source} onChange={(e) => setSource(e.target.value as Source | 'all')} className="h-10 rounded-lg border border-line-strong bg-card px-3 text-sm text-fg" aria-label="Source filter">
          {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-2.5 text-xs text-dim">{filtered.length} of {events.length} events (newest first, last {500} kept)</div>
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-dim">No events match these filters.</p>
          ) : (
            <ul className="scrollbar-thin max-h-[62vh] divide-y divide-line overflow-y-auto">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(e)}
                    className={cx('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-inset', selected?.id === e.id && 'bg-inset')}
                  >
                    <StatusDot tone={severityTone[e.severity]} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{e.message}</span>
                      <span className="block text-xs text-dim">{e.type}</span>
                    </span>
                    <SourceBadge source={e.source} />
                    <span className="w-[110px] shrink-0 text-right text-xs tabular-nums text-muted">{formatDateTime(e.timestamp)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit p-5">
          <h2 className="text-base font-semibold text-fg">Event details</h2>
          {!selected ? (
            <p className="mt-2 text-sm text-dim">Select an event to see its details.</p>
          ) : (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex gap-2"><dt className="w-20 text-dim">Message</dt><dd className="text-fg">{selected.message}</dd></div>
              <div className="flex gap-2"><dt className="w-20 text-dim">Severity</dt><dd><Pill tone={severityTone[selected.severity]} className="!py-0.5 !text-xs capitalize">{selected.severity}</Pill></dd></div>
              <div className="flex gap-2"><dt className="w-20 text-dim">Type</dt><dd className="font-mono text-xs text-fg">{selected.type}</dd></div>
              <div className="flex gap-2"><dt className="w-20 text-dim">Source</dt><dd><SourceBadge source={selected.source} /></dd></div>
              <div className="flex gap-2"><dt className="w-20 text-dim">Time</dt><dd className="text-fg">{new Date(selected.timestamp).toLocaleString()}</dd></div>
              <div>
                <dt className="text-dim">Data</dt>
                <dd><pre className="mt-1 overflow-auto rounded-md bg-inset p-2 font-mono text-xs text-muted">{JSON.stringify(selected.details, null, 2)}</pre></dd>
              </div>
            </dl>
          )}
        </Card>
      </div>
    </div>
  )
}
