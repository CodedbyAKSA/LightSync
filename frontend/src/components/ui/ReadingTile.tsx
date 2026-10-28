import { formatAgo } from '../../lib/format'
import type { Reading } from '../../types/telemetry'
import { Card, cx, SourceBadge } from './primitives'

/** One telemetry field with value, unit, source and freshness. */
export function ReadingTile({ label, reading, digits = 2, format }: {
  label: string
  reading: Reading | undefined
  digits?: number
  format?: (r: Reading) => string
}) {
  const usable = !!reading && reading.valid && reading.value !== null
  let text = 'Unavailable'
  if (reading && reading.available && !reading.valid) text = 'Invalid'
  if (usable) {
    text = format ? format(reading!) : typeof reading!.value === 'number' ? reading!.value.toFixed(digits) : String(reading!.value)
  }
  return (
    <Card className="p-4" title={reading?.reason ?? undefined}>
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-medium text-muted">{label}</span>
        {reading && <span className="ml-auto"><SourceBadge source={reading.source} /></span>}
      </div>
      <div className={cx('mt-2 flex items-baseline gap-1.5 font-bold tabular-nums', usable ? 'text-[24px] text-fg' : 'text-[16px] text-dim')}>
        {text}
        {usable && reading?.unit && <span className="text-[13px] font-semibold text-muted">{reading.unit}</span>}
      </div>
      <div className="mt-1 truncate text-[11px] text-dim">
        {reading?.pin ? `${reading.pin.toUpperCase()} · ` : ''}
        {usable ? `observed ${formatAgo(reading!.observed_at)}` : reading?.reason ?? 'No data'}
      </div>
    </Card>
  )
}
