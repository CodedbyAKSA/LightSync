import { Activity, Ruler, TrafficCone } from 'lucide-react'
import { bool, num, str } from '../../lib/format'
import { fresh } from '../../lib/status'
import { useTelemetry } from '../../state/TelemetryProvider'
import type { ProximityLevel, Reading, Side } from '../../types/telemetry'
import type { SensorView } from '../vehicle/sensors'
import { VehicleViewport } from '../vehicle/VehicleViewport'
import { Card, CardTitle, cx, StatusDot, toneText, type Tone } from '../ui/primitives'

const SIDE_FIELD = {
  front: 'obstacle_distance',
  rear: 'obstacle_distance_rear',
  left: 'obstacle_distance_left',
  right: 'obstacle_distance_right',
} as const

const SIDE_NAME: Record<Side, string> = { front: 'Front', rear: 'Rear', left: 'Left', right: 'Right' }

function proximityTone(live: boolean, distance: number | null, p: ProximityLevel | undefined): Tone {
  if (!live || distance === null || !p) return 'neutral'
  return p === 'critical' ? 'bad' : p === 'warning' ? 'warn' : 'ok'
}

function SideDistance({ side, distance, tone }: { side: Side; distance: number | null; tone: Tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">{SIDE_NAME[side]}</div>
      <div className={cx('mt-0.5 whitespace-nowrap text-[17px] font-bold leading-tight tabular-nums', tone === 'bad' || tone === 'warn' ? toneText[tone] : 'text-fg')}>
        {distance === null ? <span className="text-dim" title="Unavailable" aria-label="Unavailable">—</span> : <>{Math.round(distance)} cm</>}
      </div>
    </div>
  )
}

function IrStatus({ label, reading, live }: { label: string; reading: Reading | undefined; live: boolean }) {
  const ir = bool(reading)
  const tone: Tone = ir === null || !live ? 'neutral' : ir ? 'warn' : 'ok'
  return (
    <div className="flex items-center gap-2 whitespace-nowrap text-[14px] text-fg">
      <StatusDot tone={tone} />
      <span>{label}: <b className="font-semibold">{ir === null ? 'Unavailable' : ir ? 'Detected' : 'Clear'}</b></span>
    </div>
  )
}

export function ObstacleCard() {
  const { snapshot, connection, config } = useTelemetry()
  const live = fresh(connection.state)
  const r = snapshot?.readings
  const sidesProx = snapshot?.derived.proximity_sides ?? {}
  const distance = num(r?.obstacle_distance)
  const proximity = snapshot?.derived.proximity ?? 'unknown'
  const vib = str(r?.vibration)
  const estop = bool(r?.emergency_stop)

  const sides = (Object.keys(SIDE_FIELD) as Side[]).map((side) => {
    const d = num(r?.[SIDE_FIELD[side]])
    const p = side === 'front' ? proximity : sidesProx[side] ?? 'unknown'
    return { side, distanceCm: d, proximity: p, available: !!r?.[SIDE_FIELD[side]]?.available, tone: proximityTone(live, d, p) }
  })
  // The 3D view draws the front always, and other sides only when the hardware sends them.
  const sensors: SensorView[] = sides
    .filter((s) => s.side === 'front' || s.available)
    .map(({ side, distanceCm, proximity: p }) => ({ side, distanceCm, proximity: p }))
  const anyCritical = sides.some((s) => s.distanceCm !== null && s.proximity === 'critical')
  const front = sides[0]
  const others = sides.slice(1)

  const splitIr = !!(r?.ir_left?.available || r?.ir_right?.available)
  const vibTone: Tone = vib === null || !live ? 'neutral' : vib === 'active' ? 'bad' : vib === 'warning' ? 'warn' : 'ok'
  const vibLabel = vib === 'active' ? 'Active' : vib === 'warning' ? 'Warning' : 'Normal'

  return (
    <Card className="flex h-full min-h-[300px] flex-col px-5 pb-3 pt-5 xl:min-h-0">
      <CardTitle icon={<TrafficCone size={28} strokeWidth={1.8} />}>Obstacle &amp; Collision Avoidance</CardTitle>
      <div className="flex min-h-0 flex-1 flex-col gap-3 pt-2 sm:flex-row sm:items-stretch">
        <div className="relative h-[190px] min-w-0 flex-[1.55] sm:h-auto">
          <VehicleViewport sensors={sensors} active={live} hazard={live && (!!estop || anyCritical)} pulseKey={snapshot?.generated_at ?? null} />
        </div>
        <div className="hidden w-px self-stretch bg-line sm:block" />
        <div className="flex flex-1 flex-col justify-center gap-3.5 px-2 sm:pl-6">
          <div>
            <div className="flex items-center gap-3 text-[16px] text-muted">
              <Ruler size={22} className="-rotate-45" strokeWidth={1.8} /> Front distance
            </div>
            <div className={cx('mt-2 text-[30px] font-bold leading-none tracking-tight tabular-nums', front.tone === 'bad' || front.tone === 'warn' ? toneText[front.tone] : 'text-fg')}>
              {distance === null ? <span className="text-[18px] font-semibold text-dim">Unavailable</span> : <>{Math.round(distance)} cm</>}
            </div>
            {config && distance !== null && proximity !== 'clear' && live && (
              <div className={cx('mt-1.5 text-xs font-medium', toneText[front.tone])}>
                {proximity === 'critical' ? `Inside ${config.thresholds.obstacle_critical_cm} cm critical zone` : `Within ${config.thresholds.obstacle_warning_cm} cm warning zone`}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-x-3">
            {others.map((s) => <SideDistance key={s.side} side={s.side} distance={s.distanceCm} tone={s.tone} />)}
          </div>
          {splitIr ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              <IrStatus label="IR Left" reading={r?.ir_left} live={live} />
              <IrStatus label="IR Right" reading={r?.ir_right} live={live} />
            </div>
          ) : (
            <IrStatus label="IR Sensor" reading={r?.ir_obstacle} live={live} />
          )}
          {vib !== null && (
            <div className="flex items-center gap-3 text-[15px] text-fg">
              <Activity size={20} className={toneText[vibTone === 'ok' ? 'neutral' : vibTone]} />
              <span>Vibration: <b className={cx('font-semibold', vibTone !== 'ok' && toneText[vibTone])}>{vibLabel}</b></span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
