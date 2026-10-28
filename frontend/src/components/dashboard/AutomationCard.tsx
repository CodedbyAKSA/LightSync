import { Play, Square, Wifi, WifiOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCommand } from '../../hooks/useCommand'
import { bool } from '../../lib/format'
import { fresh } from '../../lib/status'
import { useTelemetry } from '../../state/TelemetryProvider'
import { RobotArmIcon } from '../ui/icons'
import { Card, CardTitle, cx, Pill, type Tone } from '../ui/primitives'

function Row({ icon, label, status, tone, onClick, disabledReason }: {
  icon: ReactNode
  label: string
  status: string
  tone: Tone
  onClick?: () => void
  disabledReason?: string | null
}) {
  const interactive = !!onClick && !disabledReason
  const content = (
    <>
      <span className="flex w-7 justify-center">{icon}</span>
      <span className="text-[16px] font-medium text-fg">{label}</span>
      <Pill tone={tone} className="ml-auto">{status}</Pill>
    </>
  )
  const cls = 'flex h-[50px] w-full items-center gap-4 rounded-lg bg-inset px-4 text-left'
  if (!onClick) return <div className={cls}>{content}</div>
  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      aria-disabled={!interactive}
      title={disabledReason ?? `Change ${label.toLowerCase()}`}
      className={cx(cls, interactive ? 'cursor-pointer hover:ring-1 hover:ring-line-strong' : 'cursor-not-allowed')}
    >
      {content}
    </button>
  )
}

export function AutomationCard() {
  const { snapshot, connection } = useTelemetry()
  const live = fresh(connection.state)
  const { ask, dialog, availability, error } = useCommand()
  const r = snapshot?.readings

  const auto = bool(r?.autonomous_mode)
  const link = bool(r?.espnow_link)
  const estop = bool(r?.emergency_stop)
  const autoCmd = availability('cmd_autonomous_mode')
  const stopCmd = availability('cmd_emergency_stop')
  const staleReason = live ? null : 'Controls are disabled while telemetry is not live'

  return (
    <Card className="flex h-full min-h-[280px] flex-col px-4 pb-4 pt-5 xl:min-h-0">
      <CardTitle icon={<RobotArmIcon size={28} />} className="px-1">Dark Factory Automation</CardTitle>
      <div className="mt-5 flex flex-col gap-3">
        <Row
          icon={<Play size={22} className="fill-ok text-ok" />}
          label="Autonomous Mode"
          status={auto === null ? 'Unavailable' : auto ? 'Enabled' : 'Disabled'}
          tone={auto === null || !live ? 'neutral' : auto ? 'ok' : 'neutral'}
          onClick={auto === null ? undefined : () => ask('cmd_autonomous_mode', !auto)}
          disabledReason={staleReason ?? (autoCmd?.available ? null : autoCmd?.reason ?? 'Unavailable')}
        />
        <Row
          icon={link === false ? <WifiOff size={22} className="text-bad" /> : <Wifi size={22} className={link ? 'text-ok' : 'text-dim'} />}
          label="ESP-NOW Link"
          status={link === null ? 'Unavailable' : link ? 'Connected' : 'Disconnected'}
          tone={link === null || !live ? 'neutral' : link ? 'ok' : 'bad'}
        />
        <Row
          icon={<Square size={20} className={estop ? 'fill-bad text-bad' : 'fill-fg text-fg'} />}
          label="Emergency Stop"
          status={estop === null ? 'Unavailable' : estop ? 'ACTIVE' : 'Standby'}
          tone={estop === null || !live ? 'neutral' : estop ? 'bad' : 'warn'}
          onClick={estop === null ? undefined : () => ask('cmd_emergency_stop', !estop)}
          disabledReason={staleReason ?? (stopCmd?.available ? null : stopCmd?.reason ?? 'Unavailable')}
        />
      </div>
      {error && <p className="mt-2 truncate px-1 text-xs text-warn" title={error}>{error}</p>}
      {dialog}
    </Card>
  )
}
