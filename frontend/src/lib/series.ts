import type { Sample } from '../types/telemetry'

/** Append items, keeping only the newest `max` entries. Never grows unbounded. */
export function appendBounded<T>(buffer: readonly T[], items: readonly T[], max: number): T[] {
  if (max <= 0) return []
  const next = buffer.length + items.length <= max ? [...buffer, ...items] : [...buffer, ...items].slice(-max)
  return next
}

/** Merge samples by timestamp (dedupe + sort), keeping the newest `max`. */
export function mergeSamples(buffer: readonly Sample[], incoming: readonly Sample[], max: number): Sample[] {
  if (incoming.length === 0) return buffer as Sample[]
  const last = buffer.length ? buffer[buffer.length - 1].t : -Infinity
  const fresh = incoming.filter((s) => s.t > last).sort((a, b) => a.t - b.t)
  return appendBounded(buffer, fresh, max)
}

export function windowed(samples: readonly Sample[], windowMs: number, now: number): Sample[] {
  const cutoff = now - windowMs
  let lo = 0
  let hi = samples.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t < cutoff) lo = mid + 1
    else hi = mid
  }
  return samples.slice(lo)
}

type NumericKey = Exclude<keyof Sample, 't'>

/**
 * Average samples into at most `maxPoints` time buckets. Nulls are ignored per
 * key; a bucket where a key has no valid value stays null (rendered as a gap).
 */
export function downsample(samples: readonly Sample[], maxPoints: number): Sample[] {
  if (samples.length <= maxPoints || samples.length === 0) return samples as Sample[]
  const start = samples[0].t
  const span = samples[samples.length - 1].t - start || 1
  const bucketMs = span / maxPoints
  const out: Sample[] = []
  let bucket: Sample[] = []
  let bucketIndex = 0
  const flush = () => {
    if (!bucket.length) return
    const avg = { t: bucket[bucket.length - 1].t } as Sample
    for (const key of Object.keys(bucket[0]) as (keyof Sample)[]) {
      if (key === 't') continue
      const values = bucket.map((s) => s[key as NumericKey]).filter((v): v is number => v !== null && v !== undefined)
      avg[key as NumericKey] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
    }
    out.push(avg)
    bucket = []
  }
  for (const s of samples) {
    const idx = Math.min(maxPoints - 1, Math.floor((s.t - start) / bucketMs))
    if (idx !== bucketIndex) {
      flush()
      bucketIndex = idx
    }
    bucket.push(s)
  }
  flush()
  return out
}

/** Insert an all-null point wherever consecutive samples are further apart
 * than `maxGapMs`, so charts show a break instead of interpolating across
 * stale or offline periods. */
export function insertGaps(samples: readonly Sample[], maxGapMs: number): Sample[] {
  const out: Sample[] = []
  for (let i = 0; i < samples.length; i++) {
    if (i > 0 && samples[i].t - samples[i - 1].t > maxGapMs) {
      out.push(nullSample(samples[i - 1].t + 1))
    }
    out.push(samples[i])
  }
  return out
}

export function nullSample(t: number): Sample {
  return {
    t, accel: null, gyro: null, ax: null, ay: null, az: null, gx: null, gy: null, gz: null,
    distance: null, voltage: null, current: null, soc: null, soh: null, risk: null,
  }
}

export const WINDOWS = [
  { label: 'Last 60 seconds', seconds: 60 },
  { label: 'Last 5 minutes', seconds: 300 },
  { label: 'Last 15 minutes', seconds: 900 },
  { label: 'Last hour', seconds: 3600 },
] as const

export function relativeTick(t: number, now: number, windowSeconds: number): string {
  const secondsAgo = Math.round((now - t) / 1000)
  if (secondsAgo <= windowSeconds * 0.02) return 'Now'
  if (windowSeconds <= 60) return `-${secondsAgo}s`
  return `-${Math.round(secondsAgo / 60)}m`
}
