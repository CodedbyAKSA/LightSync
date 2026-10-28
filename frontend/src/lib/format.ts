import type { Reading } from '../types/telemetry'

export function formatHeaderTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  return `${date} • ${time}`
}

export function formatClock(iso: string | number | null): string {
  if (iso === null) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${formatClock(iso)}`
}

export function formatAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function num(r: Reading | undefined): number | null {
  if (!r || !r.valid || typeof r.value !== 'number') return null
  return r.value
}

export function bool(r: Reading | undefined): boolean | null {
  if (!r || !r.valid || typeof r.value !== 'boolean') return null
  return r.value
}

export function str(r: Reading | undefined): string | null {
  if (!r || !r.valid || typeof r.value !== 'string') return null
  return r.value
}

export function fmt(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

/** Human description of why a reading is not usable. */
export function unavailableText(r: Reading | undefined): string {
  if (!r) return 'Unavailable'
  if (!r.available) return 'Unavailable'
  if (!r.valid) return 'Invalid'
  return ''
}
