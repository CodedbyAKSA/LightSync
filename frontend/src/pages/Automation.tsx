import { Octagon, Play, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RobotArmIcon } from '../components/ui/icons'
import { Card, cx, PageHeader, Pill, SourceBadge } from '../components/ui/primitives'
import { useCommand } from '../hooks/useCommand'
import { bool, formatDateTime } from '../lib/format'
import { fresh } from '../lib/status'
import { api } from '../services/api'
import { useTelemetry } from '../state/TelemetryProvider'
import type { CommandResult } from '../types/telemetry'

const statusTone = { acknowledged: 'ok', unconfirmed: 'warn', rejected: 'bad', failed: 'bad' } as const

export default function Automation() {
  const { snapshot, connection, config } = useTelemetry()
  const { ask, dialog, availability, result, error, busy } = useCommand()
  const [history, setHistory] = useState<CommandResult[]>([])
  const live = fresh(connection.state)
  const r = snapshot?.readings
  const auto = bool(r?.autonomous_mode)
  const estop = bool(r?.emergency_stop)

  useEffect(() => {
    api.commandHistory().then(setHistory).catch(() => undefined)
  }, [result, snapshot?.mode])

  const controls = [
    {
      key: 'cmd_autonomous_mode' as const,
      icon: <Play size={22} className="fill-ok text-ok" />,
      title: 'Autonomous mode',
      state: auto === null ? 'Unavailable' : auto ? 'Enabled' : 'Disabled',
      tone: auto === null ? 'neutral' : auto ? 'ok' : 'neutral',
      action: auto === null ? null : auto ? 'Disable' : 'Enable',
      next: !auto,
    },
    {
      key: 'cmd_emergency_stop' as const,
      icon: <Octagon size={22} className="text-bad" />,
      title: 'Emergency stop',
      state: estop === null ? 'Unavailable' : estop ? 'ACTIVE' : 'Standby',
      tone: estop === null ? 'neutral' : estop ? 'bad' : 'warn',
      action: estop === null ? null : estop ? 'Release' : 'Request stop',
      next: !estop,
    },
  ] as const

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader icon={<RobotArmIcon size={36} />} title="Automation" subtitle="Hardware-acknowledged control requests" />
      <div className="flex gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <p>
          Dashboard controls are <b>requests</b> sent to the hardware through Blynk. The emergency stop shown here does not replace the vehicle's
          physical emergency-stop circuit, which must cut motor power locally and independently of Wi-Fi, Blynk and this dashboard.
          A command only counts as done when the hardware reports the new state on its state datastream.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {controls.map((c) => {
          const avail = availability(c.key)
          const disabled = !live || !avail?.available || c.action === null || busy
          const reason = !live ? 'Telemetry is not live' : c.action === null ? `${c.title} state is not published by the hardware` : avail?.reason
          return (
            <Card key={c.key} className="p-5">
              <div className="flex items-center gap-3">
                {c.icon}
                <h2 className="text-lg font-semibold text-fg">{c.title}</h2>
                <Pill tone={live ? c.tone : 'neutral'} className="ml-auto">{c.state}</Pill>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-dim">Request pin</dt><dd className="text-fg">{avail?.pin?.toUpperCase() ?? 'not configured'}</dd>
                <dt className="text-dim">State datastream</dt><dd className="text-fg">{config?.datastreams.find((d) => d.key === avail?.state_field)?.pin?.toUpperCase() ?? 'not mapped'} ({avail?.state_field})</dd>
              </dl>
              {reason && <p className="mt-3 text-xs text-dim">{reason}</p>}
              <button
                type="button"
                disabled={disabled}
                onClick={() => ask(c.key, c.next)}
                className={cx(
                  'mt-4 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45',
                  c.key === 'cmd_emergency_stop' ? 'bg-bad text-white hover:brightness-110' : 'bg-accent text-[#04202a] hover:brightness-110',
                )}
              >
                {c.action ?? 'Unavailable'}
              </button>
            </Card>
          )
        })}
      </div>
      {error && <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-2.5 text-sm text-warn">{error}</div>}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-3 text-base font-semibold text-fg">Command history</div>
        {history.length === 0 ? (
          <p className="px-5 py-4 text-sm text-dim">No commands sent in this session.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-dim">
                <tr><th className="px-5 py-2">Time</th><th className="py-2">Command</th><th className="py-2">Value</th><th className="py-2">Result</th><th className="py-2">Source</th><th className="py-2 pr-5">Detail</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-5 py-2 tabular-nums text-muted">{formatDateTime(h.requested_at)}</td>
                    <td className="py-2 text-fg">{h.command.replace('cmd_', '').replace('_', ' ')}</td>
                    <td className="py-2 text-fg">{h.requested_value ? 'ON' : 'OFF'}</td>
                    <td className="py-2"><Pill tone={statusTone[h.status]} className="!py-0.5 !text-xs">{h.status}</Pill></td>
                    <td className="py-2"><SourceBadge source={h.source} /></td>
                    <td className="py-2 pr-5 text-muted">{h.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {dialog}
    </div>
  )
}
