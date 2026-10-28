import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatClock } from '../../lib/format'
import { safetyState } from '../../lib/status'
import { useTelemetry } from '../../state/TelemetryProvider'
import type { Severity } from '../../types/telemetry'
import { Card, CardTitle, cx, StatusDot, toneText, type Tone } from '../ui/primitives'

export const severityTone: Record<Severity, Tone> = { info: 'ok', warning: 'warn', critical: 'bad' }

export function SafetyCard() {
  const { snapshot, connection, events } = useTelemetry()
  const state = safetyState(snapshot, connection.state)
  const Icon = state.tone === 'ok' ? ShieldCheck : state.tone === 'bad' ? ShieldAlert : ShieldQuestion
  const recent = events.slice(0, 2)

  return (
    <Card className="flex h-full min-h-[280px] flex-col px-5 pb-4 pt-5 xl:min-h-0">
      <CardTitle icon={<ShieldCheck size={26} strokeWidth={1.8} />}>Safety &amp; Accident Detection</CardTitle>
      <div className="flex items-center gap-6 px-3 py-4 xl:py-5">
        <Icon size={76} strokeWidth={1.5} className={cx('shrink-0', toneText[state.tone])} fill="currentColor" fillOpacity={0.12} />
        <div className="min-w-0">
          <div className={cx('text-[clamp(20px,1.65vw,26px)] font-bold leading-tight tracking-[-0.01em]', toneText[state.tone])}>{state.title}</div>
          <div className="mt-1.5 text-[16px] text-fg/85">{state.description}</div>
        </div>
      </div>
      <div className="mx-1 h-px bg-line" />
      <Link to="/events" className="relative mt-3 flex min-h-0 flex-1 flex-col gap-4 px-2" aria-label="Recent safety events">
        {recent.length > 1 && <span className="absolute bottom-3 left-[13px] top-3 w-px bg-line-strong" aria-hidden="true" />}
        {recent.length === 0 && <p className="py-2 text-sm text-dim">No safety events recorded yet.</p>}
        {recent.map((e) => (
          <div key={e.id} className="relative flex items-center gap-4">
            <StatusDot tone={severityTone[e.severity]} className="!size-[13px]" />
            <span className="min-w-0 truncate text-[16px] font-medium text-fg">{e.message}</span>
            {e.source === 'demo' && <span className="text-[10px] font-semibold uppercase tracking-wide text-demo">demo</span>}
            <span className="ml-auto shrink-0 text-[14px] tabular-nums text-muted">{formatClock(e.timestamp)}</span>
          </div>
        ))}
      </Link>
    </Card>
  )
}
