import { Activity } from 'lucide-react'
import { useState } from 'react'
import { TimeSeriesChart, WindowSelect, type SeriesDef } from '../components/dashboard/SensorChart'
import { Card, CardTitle, PageHeader, SourceBadge } from '../components/ui/primitives'
import { ReadingTile } from '../components/ui/ReadingTile'
import { formatAgo } from '../lib/format'
import { useTelemetry } from '../state/TelemetryProvider'
import { useThemeColors } from '../theme/ThemeProvider'
import type { FieldKey, Reading } from '../types/telemetry'

const boolText = (on: string, off: string) => (r: Reading) => (r.value ? on : off)

function ChartCard({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <Card className="flex h-[280px] flex-col p-5">
      <CardTitle>{title}</CardTitle>
      {note && <p className="mt-1 text-xs text-dim">{note}</p>}
      <div className="mt-2 min-h-0 flex-1">{children}</div>
    </Card>
  )
}

export default function LiveSensors() {
  const { snapshot, config } = useTelemetry()
  const colors = useThemeColors()
  const [win, setWin] = useState(60)
  const r = snapshot?.readings
  const gap = (config?.poll_interval ?? 1) * 3000 + 2000

  const axes = (prefix: 'a' | 'g', unit: string): SeriesDef[] => [
    { key: `${prefix}x` as SeriesDef['key'], label: 'X', unit, color: colors.blue, axis: 'left' },
    { key: `${prefix}y` as SeriesDef['key'], label: 'Y', unit, color: colors.teal, axis: 'left' },
    { key: `${prefix}z` as SeriesDef['key'], label: 'Z', unit, color: colors.amber, axis: 'left' },
  ]

  const freshness: FieldKey[] = ['accel_x', 'accel_y', 'accel_z', 'gyro_x', 'gyro_y', 'gyro_z', 'obstacle_distance', 'ir_obstacle', 'vibration', 'drowsiness']

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        icon={<Activity size={36} />}
        title="Live Sensors"
        subtitle="Per-axis IMU readings, obstacle sensing and telemetry freshness"
        right={<WindowSelect value={win} onChange={setWin} />}
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <ReadingTile label="Accel X" reading={r?.accel_x} />
        <ReadingTile label="Accel Y" reading={r?.accel_y} />
        <ReadingTile label="Accel Z" reading={r?.accel_z} />
        <ReadingTile label="Gyro X" reading={r?.gyro_x} digits={1} />
        <ReadingTile label="Gyro Y" reading={r?.gyro_y} digits={1} />
        <ReadingTile label="Gyro Z" reading={r?.gyro_z} digits={1} />
        <ReadingTile label="Obstacle distance" reading={r?.obstacle_distance} digits={0} />
        <ReadingTile label="IR sensor" reading={r?.ir_obstacle} format={boolText('Detected', 'Clear')} />
        <ReadingTile label="Vibration" reading={r?.vibration} format={(x) => String(x.value).replace(/^./, (c) => c.toUpperCase())} />
        <ReadingTile label="Drowsiness" reading={r?.drowsiness} format={boolText('Detected', 'Not detected')} />
        <ReadingTile label="|a| magnitude" reading={snapshot?.derived.accel_magnitude} />
        <ReadingTile label="|ω| magnitude" reading={snapshot?.derived.gyro_magnitude} digits={1} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard title="Accelerometer axes" note="Calibrated m/s² as published by the firmware; Z includes gravity (~9.81 at rest).">
          <TimeSeriesChart series={axes('a', 'm/s²')} windowSeconds={win} gapMs={gap} leftLabel="m/s²" showDots={false} />
        </ChartCard>
        <ChartCard title="Gyroscope axes" note="Angular rate in °/s.">
          <TimeSeriesChart series={axes('g', '°/s')} windowSeconds={win} gapMs={gap} leftLabel="°/s" showDots={false} />
        </ChartCard>
        <ChartCard title="Obstacle distance" note={config ? `Warning ≤ ${config.thresholds.obstacle_warning_cm} cm · critical ≤ ${config.thresholds.obstacle_critical_cm} cm` : undefined}>
          <TimeSeriesChart series={[{ key: 'distance', label: 'Distance', unit: 'cm', color: colors.teal, axis: 'left' }]} windowSeconds={win} gapMs={gap} leftLabel="cm" showDots={false} />
        </ChartCard>
        <Card className="flex h-[280px] flex-col p-5">
          <CardTitle>Telemetry freshness</CardTitle>
          <div className="scrollbar-thin mt-3 min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-dim">
                <tr><th className="pb-2">Field</th><th className="pb-2">Pin</th><th className="pb-2">Status</th><th className="pb-2">Last change</th><th className="pb-2">Source</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {freshness.map((key) => {
                  const rd = r?.[key]
                  return (
                    <tr key={key}>
                      <td className="py-1.5 text-fg">{key}</td>
                      <td className="py-1.5 text-muted">{rd?.pin?.toUpperCase() ?? '—'}</td>
                      <td className="py-1.5">
                        {!rd || !rd.available ? <span className="text-dim">Unavailable</span> : !rd.valid ? <span className="text-warn">Invalid</span> : <span className="text-ok">OK</span>}
                      </td>
                      <td className="py-1.5 text-muted">{formatAgo(rd?.changed_at ?? null)}</td>
                      <td className="py-1.5">{rd && <SourceBadge source={rd.source} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
