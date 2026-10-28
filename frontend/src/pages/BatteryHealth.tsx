import { BatteryMedium } from 'lucide-react'
import { useState } from 'react'
import { BatteryGauge } from '../components/dashboard/BatteryCard'
import { TimeSeriesChart, WindowSelect } from '../components/dashboard/SensorChart'
import { Card, CardTitle, PageHeader } from '../components/ui/primitives'
import { ReadingTile } from '../components/ui/ReadingTile'
import { batteryDisplay, fresh } from '../lib/status'
import { useTelemetry } from '../state/TelemetryProvider'
import { useThemeColors } from '../theme/ThemeProvider'

export default function BatteryHealth() {
  const { snapshot, config, connection } = useTelemetry()
  const colors = useThemeColors()
  const [win, setWin] = useState(900)
  const r = snapshot?.readings
  const display = batteryDisplay(snapshot, config?.thresholds)
  const t = config?.thresholds
  const gap = (config?.poll_interval ?? 1) * 3000 + 2000

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader icon={<BatteryMedium size={36} className="-rotate-90" />} title="Battery Health" subtitle="Measured pack telemetry and firmware-reported charge and health" right={<WindowSelect value={win} onChange={setWin} />} />
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Card className="flex flex-col items-center justify-center gap-3 p-6">
          <BatteryGauge percent={display.percent} label={display.metric === 'soh' ? 'Health' : display.metric === 'soc' ? 'Charge' : 'Unavailable'} tone={fresh(connection.state) ? display.tone : 'neutral'} size={180} />
          <p className="text-center text-xs text-dim">
            {display.metric === 'soh' ? 'State of health (capacity vs. new), from the battery_soh datastream.'
              : display.metric === 'soc' ? 'State of health is not published; showing state of charge instead.'
                : 'No battery charge or health datastream is publishing.'}
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <ReadingTile label="Voltage" reading={r?.battery_voltage} digits={2} />
          <ReadingTile label="Current" reading={r?.battery_current} digits={2} />
          <ReadingTile label="State of charge" reading={r?.battery_soc} digits={0} />
          <ReadingTile label="State of health" reading={r?.battery_soh} digits={0} />
          <Card className="col-span-2 p-4 xl:col-span-4">
            <h3 className="text-sm font-semibold text-fg">Methodology</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              <li><b className="text-fg">Voltage</b> and <b className="text-fg">current</b> are measured values published by the gateway firmware.</li>
              <li><b className="text-fg">State of charge</b> and <b className="text-fg">state of health</b> must be computed on the hardware (e.g. coulomb counting / capacity tracking) and published on their own datastreams. The dashboard never derives them from voltage or from each other.</li>
              <li>Missing datastreams are shown as unavailable rather than estimated.</li>
            </ul>
            {t && (
              <p className="mt-3 text-xs text-dim">
                Alert thresholds: charge warning ≤ {t.battery_warning_pct}% · critical ≤ {t.battery_critical_pct}% · low voltage &lt; {t.battery_min_voltage} V · health warning &lt; {t.soh_warning_pct}%
              </p>
            )}
          </Card>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="flex h-[300px] flex-col p-5">
          <CardTitle>Voltage &amp; current</CardTitle>
          <div className="mt-2 min-h-0 flex-1">
            <TimeSeriesChart
              series={[
                { key: 'voltage', label: 'Voltage', unit: 'V', color: colors.green, axis: 'left' },
                { key: 'current', label: 'Current', unit: 'A', color: colors.blue, axis: 'right' },
              ]}
              windowSeconds={win} gapMs={gap} leftLabel="V" rightLabel="A" showDots={false}
            />
          </div>
        </Card>
        <Card className="flex h-[300px] flex-col p-5">
          <CardTitle>Charge &amp; health</CardTitle>
          <div className="mt-2 min-h-0 flex-1">
            <TimeSeriesChart
              series={[
                { key: 'soc', label: 'State of charge', unit: '%', color: colors.teal, axis: 'left' },
                { key: 'soh', label: 'State of health', unit: '%', color: colors.amber, axis: 'left' },
              ]}
              windowSeconds={win} gapMs={gap} leftLabel="%" showDots={false}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
