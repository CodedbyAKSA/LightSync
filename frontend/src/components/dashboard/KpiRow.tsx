import { Bluetooth, RadioTower, ShieldCheck, ShieldAlert, BatteryFull, BatteryLow, BatteryWarning } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { bool } from '../../lib/format'
import { batteryDisplay, fresh, riskTone } from '../../lib/status'
import { useTelemetry } from '../../state/TelemetryProvider'
import { DrowsyIcon } from '../ui/icons'
import { Card, cx, Pill, StatusDot, toneText, type Tone } from '../ui/primitives'

interface KpiProps {
  to: string
  icon: ReactNode
  label: string
  note?: string
  value: string
  tone: Tone | 'plain'
  trailing?: ReactNode
  compact?: boolean
  title?: string
}

function KpiCard({ to, icon, label, note, value, tone, trailing, compact, title }: KpiProps) {
  return (
    <Link to={to} className="group block h-full rounded-[10px] focus-visible:outline-offset-4" title={title}>
      <Card className="flex h-full min-h-[104px] items-center gap-4 px-5 transition-colors group-hover:border-line-strong xl:gap-5 xl:pl-7 xl:pr-3">
        <div className="flex size-[58px] shrink-0 items-center justify-center">{icon}</div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[17px] font-medium text-fg/90">{label}</span>
            {note && <span className="shrink-0 rounded bg-inset px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-dim">{note}</span>}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span
              className={cx(
                'truncate font-bold leading-[1.1] tracking-[-0.02em]',
                value.length > 14 ? 'text-[clamp(17px,1.3vw,22px)]' : compact ? 'text-[clamp(20px,1.6vw,27px)]' : 'text-[clamp(26px,2.3vw,36px)]',
                tone === 'plain' ? 'text-fg' : toneText[tone],
              )}
            >
              {value}
            </span>
            {trailing}
          </div>
        </div>
      </Card>
    </Link>
  )
}

export function KpiRow() {
  const { snapshot, connection, config } = useTelemetry()
  const live = fresh(connection.state)
  const stale = (t: Tone): Tone => (live ? t : 'neutral')
  // Only badge a value as "last known" when there is actually a value on screen.
  const lastKnown = (hasValue: boolean) => (!live && connection.state !== 'connecting' && hasValue ? 'last known' : undefined)

  // Accident risk
  const risk = snapshot?.derived.risk
  const riskValue = risk?.available && risk.level ? risk.level : snapshot ? 'N/A' : '—'
  const riskT: Tone = risk?.available && risk.level ? stale(riskTone[risk.level]) : 'neutral'
  const riskNote = risk?.available ? (risk.source === 'computed' ? 'rule-based' : 'hardware') : undefined

  // Battery
  const battery = batteryDisplay(snapshot, config?.thresholds)
  const BatteryIcon = battery.tone === 'bad' ? BatteryLow : battery.tone === 'warn' ? BatteryWarning : BatteryFull

  // Link: Bluetooth only if the hardware really publishes it, otherwise ESP-NOW.
  const bt = snapshot?.readings.bluetooth_link
  const useBluetooth = !!bt?.available
  const linkReading = useBluetooth ? bt : snapshot?.readings.espnow_link
  const linked = bool(linkReading)
  const linkValue = linked === null ? (snapshot ? 'Unavailable' : '—') : linked ? 'Connected' : 'Disconnected'
  const linkTone: Tone = linked === null ? 'neutral' : stale(linked ? 'accent' : 'bad')

  // Drowsiness
  const drowsy = bool(snapshot?.readings.drowsiness)
  const drowsyValue = drowsy === null ? (snapshot ? 'Sensor Unavailable' : '—') : drowsy ? 'Detected' : 'Not Detected'
  const drowsyTone: Tone = drowsy === null ? 'neutral' : stale(drowsy ? 'bad' : 'warn')

  return (
    <section aria-label="System overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
      <KpiCard
        to="/events"
        label="Accident Risk"
        note={lastKnown(!!risk?.available)}
        title={risk?.available ? `${riskNote === 'rule-based' ? 'Rule-based estimate (not AI). ' : ''}${risk.method}${risk.factors.length ? '\n' + risk.factors.join('\n') : ''}` : 'No risk inputs available'}
        icon={riskT === 'bad' ? <ShieldAlert size={56} strokeWidth={1.6} className="text-bad" /> : <ShieldCheck size={56} strokeWidth={1.6} className={toneText[riskT === 'neutral' ? 'neutral' : riskT]} />}
        value={riskValue}
        tone={riskT}
        trailing={<StatusDot tone={riskT} className="!size-[15px]" />}
      />
      <KpiCard
        to="/battery"
        label={battery.label}
        note={lastKnown(battery.percent !== null)}
        icon={<BatteryIcon size={58} strokeWidth={1.6} className={cx('-rotate-90', toneText[stale(battery.tone)])} />}
        value={battery.percent === null ? (snapshot ? 'N/A' : '—') : `${Math.round(battery.percent)}%`}
        tone={battery.percent === null ? 'neutral' : live ? 'plain' : 'neutral'}
        trailing={<Pill tone={stale(battery.tone)} className="!text-[14px]">{battery.badge}</Pill>}
      />
      <KpiCard
        to="/network"
        label={useBluetooth ? 'Bluetooth Link' : 'ESP-NOW Link'}
        note={lastKnown(linked !== null)}
        title={useBluetooth ? 'Bluetooth link reported by hardware' : 'Bluetooth is not implemented on this hardware; showing the ESP-NOW link between ESP32 and ESP8266.'}
        icon={useBluetooth ? <Bluetooth size={54} strokeWidth={1.8} className="text-info" /> : <RadioTower size={52} strokeWidth={1.7} className="text-info" />}
        value={linkValue}
        tone={linkTone}
        compact
        trailing={<StatusDot tone={linked === null ? 'neutral' : stale(linked ? 'ok' : 'bad')} className="!size-[15px]" />}
      />
      <KpiCard
        to="/sensors"
        label="Drowsiness"
        note={lastKnown(drowsy !== null)}
        icon={<DrowsyIcon size={54} className="text-warn" />}
        value={drowsyValue}
        tone={drowsyTone}
        compact
        trailing={drowsy !== null ? <StatusDot tone={stale(drowsy ? 'bad' : 'ok')} className="!size-[15px]" /> : undefined}
      />
    </section>
  )
}
