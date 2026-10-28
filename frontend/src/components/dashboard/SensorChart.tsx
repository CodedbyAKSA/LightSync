import { ChevronDown, ChartSpline } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import { downsample, insertGaps, relativeTick, windowed, WINDOWS } from '../../lib/series'
import { useTelemetry } from '../../state/TelemetryProvider'
import { useThemeColors } from '../../theme/ThemeProvider'
import type { Sample } from '../../types/telemetry'
import { Card, CardTitle } from '../ui/primitives'

export interface SeriesDef {
  key: Exclude<keyof Sample, 't'>
  label: string
  unit: string
  color: string
  axis: 'left' | 'right'
}

const MAX_POINTS = 240

function ChartTooltip({ active, payload, label, series }: TooltipContentProps<number, string> & { series: SeriesDef[] }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line-strong bg-card px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-muted">{new Date(Number(label)).toLocaleTimeString('en-GB')}</div>
      {payload.map((p) => {
        const def = series.find((s) => s.key === p.dataKey)
        if (!def) return null
        return (
          <div key={def.key} className="flex items-center gap-2 text-fg">
            <span className="size-2 rounded-full" style={{ background: def.color }} />
            <span>{def.label}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">
              {typeof p.value === 'number' ? p.value.toFixed(2) : '—'} {def.unit}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Generic rolling time-series chart over the shared sample buffer. */
export function TimeSeriesChart({ series, windowSeconds, gapMs, leftLabel, rightLabel, showDots = true }: {
  series: SeriesDef[]
  windowSeconds: number
  gapMs: number
  leftLabel?: string
  rightLabel?: string
  showDots?: boolean
}) {
  const { samples, snapshot } = useTelemetry()
  const colors = useThemeColors()
  const now = snapshot ? new Date(snapshot.generated_at).getTime() : (samples.at(-1)?.t ?? 0)
  const windowMs = windowSeconds * 1000

  const data = useMemo(() => {
    const inWindow = windowed(samples, windowMs, now)
    return insertGaps(downsample(inWindow, MAX_POINTS), Math.max(gapMs, (windowMs / MAX_POINTS) * 3))
  }, [samples, windowMs, now, gapMs])

  const ticks = useMemo(() => [0, 0.25, 0.5, 0.75, 1].map((f) => now - windowMs + f * windowMs), [now, windowMs])
  const dotEvery = Math.max(1, Math.round(data.length / 13))
  const hasRight = series.some((s) => s.axis === 'right')
  const hasData = data.some((d) => series.some((s) => d[s.key] !== null))

  return (
    <div className="relative h-full w-full">
      {!hasData && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-dim">
          No valid samples in this window
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%" minHeight={120}>
        <LineChart data={data} margin={{ top: 6, right: hasRight ? 4 : 14, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="0" vertical horizontal />
          <XAxis
            dataKey="t"
            type="number"
            domain={[now - windowMs, now]}
            ticks={ticks}
            allowDataOverflow
            tickFormatter={(t: number) => relativeTick(t, now, windowSeconds)}
            stroke={colors.line}
            tick={{ fill: colors.muted, fontSize: 13 }}
            tickLine={false}
          />
          <YAxis
            yAxisId="left"
            stroke={colors.line}
            tick={{ fill: colors.muted, fontSize: 13 }}
            tickLine={false}
            width={52}
            label={leftLabel ? { value: leftLabel, angle: -90, position: 'insideLeft', offset: 18, fill: colors.dim, fontSize: 11 } : undefined}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke={colors.line}
              tick={{ fill: colors.muted, fontSize: 13 }}
              tickLine={false}
              width={52}
              label={rightLabel ? { value: rightLabel, angle: 90, position: 'insideRight', offset: 18, fill: colors.dim, fontSize: 11 } : undefined}
            />
          )}
          <Tooltip content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} series={series} />} />
          {series.map((s) => (
            <Line
              key={s.key}
              yAxisId={s.axis}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2.2}
              connectNulls={false}
              isAnimationActive={false}
              activeDot={{ r: 4 }}
              dot={
                showDots
                  ? (p: { cx?: number; cy?: number; index?: number; value?: unknown }) =>
                      p.index !== undefined && p.index % dotEvery === dotEvery - 1 && p.value !== null && p.cx !== undefined && p.cy !== undefined ? (
                        <circle key={`${s.key}-${p.index}`} cx={p.cx} cy={p.cy} r={3.2} fill={s.color} />
                      ) : (
                        <g key={`${s.key}-${p.index}`} />
                      )
                  : false
              }
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function WindowSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Time window</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-[34px] cursor-pointer appearance-none rounded-lg border border-line-strong bg-card py-0 pl-3.5 pr-9 text-[14px] font-medium text-fg hover:bg-inset"
      >
        {WINDOWS.map((w) => (
          <option key={w.seconds} value={w.seconds}>{w.label}</option>
        ))}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 text-muted" />
    </label>
  )
}

/** Overview card: accelerometer and gyroscope vector magnitudes. */
export function SensorChartCard() {
  const [windowSeconds, setWindowSeconds] = useState(60)
  const colors = useThemeColors()
  const { config } = useTelemetry()
  const series: SeriesDef[] = [
    { key: 'accel', label: 'Accelerometer', unit: 'm/s²', color: colors.blue, axis: 'left' },
    { key: 'gyro', label: 'Gyroscope', unit: '°/s', color: colors.teal, axis: 'right' },
  ]
  return (
    <Card className="flex h-full min-h-[300px] flex-col px-5 pb-3 pt-5 xl:min-h-0">
      <CardTitle icon={<ChartSpline size={28} strokeWidth={1.8} />} right={<WindowSelect value={windowSeconds} onChange={setWindowSeconds} />}>
        Live Sensor Monitoring
      </CardTitle>
      <div className="mt-2 flex items-center justify-center gap-6 text-[15px] text-fg" title="Lines show the vector magnitude of each sensor: |a| = √(ax²+ay²+az²) including gravity, |ω| = √(gx²+gy²+gz²).">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ background: s.color }} />
            {s.label} <span className="text-[12px] text-dim">|{s.key === 'accel' ? 'a' : 'ω'}| {s.unit}</span>
          </span>
        ))}
      </div>
      <div className="mt-1 min-h-0 flex-1">
        <TimeSeriesChart series={series} windowSeconds={windowSeconds} gapMs={(config?.poll_interval ?? 1) * 3000 + 2000} />
      </div>
    </Card>
  )
}
