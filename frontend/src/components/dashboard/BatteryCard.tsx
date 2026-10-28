import { Activity, BatteryMedium, Zap } from 'lucide-react'
import { bool, fmt, num } from '../../lib/format'
import { batteryDisplay, fresh } from '../../lib/status'
import { useTelemetry } from '../../state/TelemetryProvider'
import { useThemeColors } from '../../theme/ThemeProvider'
import { Card, CardTitle, cx, StatusDot, toneText, type Tone } from '../ui/primitives'

export function BatteryGauge({ percent, label, tone, size = 160 }: { percent: number | null; label: string; tone: Tone; size?: number }) {
  const colors = useThemeColors()
  const stroke = size * 0.085
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const value = percent === null ? 0 : Math.max(0, Math.min(100, percent))
  const color = { ok: colors.green, warn: colors.amber, bad: colors.red, neutral: colors.dim }[tone as 'ok'] ?? colors.green
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={percent === null ? 'Battery unavailable' : `${label} ${Math.round(value)} percent`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.inset} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 700ms ease, stroke 300ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[clamp(28px,2.4vw,38px)] font-bold leading-none tracking-tight text-fg">
          {percent === null ? '—' : `${Math.round(value)}%`}
        </span>
        <span className="mt-1.5 text-[15px] text-muted">{label}</span>
      </div>
    </div>
  )
}

function Metric({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-muted">{icon}</span>
      <div>
        <div className="text-[15px] text-muted">{label}</div>
        <div className="text-[21px] font-bold leading-tight text-fg tabular-nums">
          {value === '—' ? <span className="text-[15px] font-medium text-dim">Unavailable</span> : <>{value} {unit}</>}
        </div>
      </div>
    </div>
  )
}

export function BatteryCard() {
  const { snapshot, connection, config } = useTelemetry()
  const live = fresh(connection.state)
  const display = batteryDisplay(snapshot, config?.thresholds)
  const r = snapshot?.readings
  const voltage = num(r?.battery_voltage)
  const current = num(r?.battery_current)
  const lcd = bool(r?.lcd_status)
  const lcdTone: Tone = lcd === null ? 'neutral' : !live ? 'neutral' : lcd ? 'ok' : 'warn'
  const gaugeLabel = display.metric === 'soh' ? display.badge : display.metric === 'soc' ? 'Charge' : 'Unavailable'

  return (
    <Card className="flex h-full min-h-[280px] flex-col px-5 pb-4 pt-5 xl:min-h-0">
      <CardTitle icon={<BatteryMedium size={26} strokeWidth={1.8} className="-rotate-90 text-ok" />}>Battery &amp; Power</CardTitle>
      <div className="flex min-h-0 flex-1 items-center gap-4 py-2">
        <div className="flex flex-1 justify-center">
          <BatteryGauge percent={display.percent} label={gaugeLabel} tone={live ? display.tone : 'neutral'} size={150} />
        </div>
        <div className="h-[70%] w-px bg-line" />
        <div className="flex flex-1 flex-col justify-center gap-7 pl-2">
          <Metric icon={<Zap size={28} strokeWidth={1.8} />} label="Voltage" value={fmt(voltage, 1)} unit="V" />
          <Metric icon={<Activity size={28} strokeWidth={1.8} />} label="Current" value={fmt(current, 1)} unit="A" />
        </div>
      </div>
      <div className={cx('flex h-[38px] items-center justify-center gap-2.5 rounded-lg text-[15px] font-semibold', lcdTone === 'ok' ? 'bg-ok-soft' : 'bg-inset', toneText[lcdTone])}>
        <StatusDot tone={lcdTone} />
        LCD Status: {lcd === null ? 'Unavailable' : lcd ? 'Active' : 'Inactive'}
      </div>
    </Card>
  )
}
