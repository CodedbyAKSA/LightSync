import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Reading } from '../../types/telemetry'
import { ReadingTile } from './ReadingTile'

const base: Reading = { field: 'battery_current', value: 0, unit: 'A', source: 'blynk', pin: 'v1', available: true, valid: true, observed_at: new Date().toISOString(), changed_at: null, reason: null }

describe('ReadingTile', () => {
  it('renders a genuine zero reading as a value', () => {
    render(<ReadingTile label="Current" reading={base} />)
    expect(screen.getByText('0.00')).toBeInTheDocument()
    expect(screen.getByText('Hardware')).toBeInTheDocument()
  })

  it('renders unmapped fields as unavailable, not zero', () => {
    render(<ReadingTile label="Current" reading={{ ...base, value: null, available: false, valid: false, pin: null, reason: 'not mapped to a Blynk datastream' }} />)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('0.00')).not.toBeInTheDocument()
  })

  it('marks invalid values', () => {
    render(<ReadingTile label="SoC" reading={{ ...base, value: null, valid: false, reason: 'invalid value: 140 above maximum 100' }} />)
    expect(screen.getByText('Invalid')).toBeInTheDocument()
  })

  it('labels demo data', () => {
    render(<ReadingTile label="Current" reading={{ ...base, source: 'demo' }} />)
    expect(screen.getByText('Demo')).toBeInTheDocument()
  })
})
