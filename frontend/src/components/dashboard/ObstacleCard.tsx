import { Activity, Ruler, TrafficCone } from 'lucide-react'
import { bool, num, str } from '../../lib/format'
import { fresh } from '../../lib/status'
import { useTelemetry } from '../../state/TelemetryProvider'
import { VehicleViewport } from '../vehicle/VehicleViewport'
import { Card, CardTitle, cx, StatusDot, toneText, type Tone } from '../ui/primitives'

export function ObstacleCard() {
  const { snapshot, connection, config } = useTelemetry()
  const live = fresh(connection.state)
  const r = snapshot?.readings
  const distance = num(r?.obstacle_distance)
  const ir = bool(r?.ir_obstacle)
  const vib = str(r?.vibration)
  const proximity = snapshot?.derived.proximity ?? 'unknown'
  const estop = bool(r?.emergency_stop)

  const distTone: Tone = !live || distance === null ? 'neutral' : proximity === 'critical' ? 'bad' : proximity === 'warning' ? 'warn' : 'ok'
  const irTone: Tone = ir === null || !live ? 'neutral' : ir ? 'warn' : 'ok'
  const vibTone: Tone = vib === null || !live ? 'neutral' : vib === 'active' ? 'bad' : vib === 'warning' ? 'warn' : 'ok'
  const vibLabel = vib === null ? 'Unavailable' : vib === 'active' ? 'Active' : vib === 'warning' ? 'Warning' : 'Normal'

  return (
    <Card className="flex h-full min-h-[300px] flex-col px-5 pb-3 pt-5 xl:min-h-0">
      <CardTitle icon={<TrafficCone size={28} strokeWidth={1.8} />}>Obstacle &amp; Collision Avoidance</CardTitle>
      <div className="flex min-h-0 flex-1 flex-col gap-3 pt-2 sm:flex-row sm:items-stretch">
        <div className="relative h-[190px] min-w-0 flex-[1.55] sm:h-auto">
          <VehicleViewport distanceCm={distance} proximity={proximity} active={live} hazard={live && (!!estop || proximity === 'critical')} pulseKey={snapshot?.generated_at ?? null} />
        </div>
        <div className="hidden w-px self-stretch bg-line sm:block" />
        <div className="flex flex-1 flex-col justify-center gap-5 px-2 sm:pl-6">
          <div>
            <div className="flex items-center gap-3 text-[16px] text-muted">
              <Ruler size={22} className="-rotate-45" strokeWidth={1.8} /> Distance
            </div>
            <div className={cx('mt-2 text-[30px] font-bold leading-none tracking-tight tabular-nums', distTone === 'neutral' ? 'text-fg' : distTone === 'ok' ? 'text-fg' : toneText[distTone])}>
              {distance === null ? <span className="text-[18px] font-semibold text-dim">Unavailable</span> : <>{Math.round(distance)} cm</>}
            </div>
            {config && distance !== null && proximity !== 'clear' && live && (
              <div className={cx('mt-1.5 text-xs font-medium', toneText[distTone])}>
                {proximity === 'critical' ? `Inside ${config.thresholds.obstacle_critical_cm} cm critical zone` : `Within ${config.thresholds.obstacle_warning_cm} cm warning zone`}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-[16px] text-fg">
            <StatusDot tone={irTone} />
            <span>IR Sensor: <b className="font-semibold">{ir === null ? 'Unavailable' : ir ? 'Detected' : 'Clear'}</b></span>
          </div>
          <div className="flex items-center gap-3 text-[16px] text-fg">
            <Activity size={20} className={toneText[vibTone === 'ok' ? 'neutral' : vibTone]} />
            <span>Vibration: <b className={cx('font-semibold', vibTone !== 'ok' && toneText[vibTone])}>{vibLabel}</b></span>
          </div>
        </div>
      </div>
    </Card>
  )
}
