import { describe, expect, it } from 'vitest'
import { appendBounded, downsample, insertGaps, mergeSamples, nullSample, relativeTick, windowed } from './series'

const s = (t: number, accel: number | null = 1) => ({ ...nullSample(t), accel })

describe('rolling buffers', () => {
  it('never exceeds the configured limit', () => {
    let buf: number[] = []
    for (let i = 0; i < 10_000; i++) buf = appendBounded(buf, [i], 3600)
    expect(buf).toHaveLength(3600)
    expect(buf[buf.length - 1]).toBe(9999)
  })

  it('mergeSamples drops duplicates and older samples', () => {
    const buf = [s(1), s(2), s(3)]
    const merged = mergeSamples(buf, [s(2), s(3), s(5), s(4)], 10)
    expect(merged.map((x) => x.t)).toEqual([1, 2, 3, 4, 5])
    expect(mergeSamples(merged, [s(6), s(7)], 4).map((x) => x.t)).toEqual([4, 5, 6, 7])
  })
})

describe('windowing and downsampling', () => {
  it('selects samples inside the window', () => {
    const buf = Array.from({ length: 100 }, (_, i) => s(i * 1000))
    expect(windowed(buf, 10_000, 99_000).map((x) => x.t)[0]).toBe(89_000)
  })

  it('downsamples to at most maxPoints and averages values', () => {
    const buf = Array.from({ length: 1000 }, (_, i) => s(i, i % 2))
    const out = downsample(buf, 100)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(out[0].accel).toBeCloseTo(0.5, 1)
  })

  it('keeps nulls as gaps rather than inventing values', () => {
    const out = downsample([s(0, null), s(1, null), s(2, null), s(3, null)], 2)
    expect(out.every((x) => x.accel === null)).toBe(true)
  })

  it('inserts a null break across long gaps', () => {
    const out = insertGaps([s(0), s(1000), s(60_000)], 5000)
    expect(out).toHaveLength(4)
    expect(out[2].accel).toBeNull()
  })
})

describe('axis labels', () => {
  it('formats relative ticks', () => {
    expect(relativeTick(0, 60_000, 60)).toBe('-60s')
    expect(relativeTick(60_000, 60_000, 60)).toBe('Now')
    expect(relativeTick(0, 300_000, 300)).toBe('-5m')
  })
})
