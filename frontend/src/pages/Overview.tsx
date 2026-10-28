import { ChartNoAxesColumnIncreasing } from 'lucide-react'
import { AutomationCard } from '../components/dashboard/AutomationCard'
import { BatteryCard } from '../components/dashboard/BatteryCard'
import { KpiRow } from '../components/dashboard/KpiRow'
import { ObstacleCard } from '../components/dashboard/ObstacleCard'
import { SafetyCard } from '../components/dashboard/SafetyCard'
import { SensorChartCard } from '../components/dashboard/SensorChart'
import { PageHeader } from '../components/ui/primitives'

/** Screenshot-matched overview. At >=1280px it fits the viewport without scrolling. */
export default function Overview() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6 xl:grid xl:h-full xl:min-h-[740px] xl:grid-rows-[auto_112px_minmax(0,1fr)_minmax(0,1.04fr)] xl:gap-5 xl:px-[22px] xl:pb-4 xl:pt-[22px]">
      <PageHeader
        icon={<ChartNoAxesColumnIncreasing size={40} strokeWidth={2.2} />}
        title="System Overview"
        subtitle="Live safety telemetry and device health at a glance"
      />
      <KpiRow />
      <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr] xl:gap-5">
        <SensorChartCard />
        <ObstacleCard />
      </div>
      <div className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[0.95fr_1.04fr_0.98fr] xl:gap-5">
        <BatteryCard />
        <SafetyCard />
        <div className="md:col-span-2 xl:col-span-1">
          <AutomationCard />
        </div>
      </div>
    </div>
  )
}
