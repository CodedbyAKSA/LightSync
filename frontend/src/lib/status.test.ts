import { describe, expect, it } from 'vitest'
import type { Reading, TelemetrySnapshot, Thresholds } from '../types/telemetry'
import { batteryDisplay, safetyState } from './status'

const TH: Thresholds = {
  obstacle_warning_cm: 50, obstacle_critical_cm: 20, battery_warning_pct: 20, battery_critical_pct: 10,
  battery_min_voltage: 10.5, soh_warning_pct: 70, abnormal_accel_ms2: 15, abnormal_gyro_dps: 250,
}

function reading(field: string, value: Reading['value'], available = true): Reading {
  return { field, value, unit: null, source: 'blynk', pin: null, available, valid: available && value !== null, observed_at: null, changed_at: null, reason: null }
}

function snap(values: Record<string, Reading['value']>, extra: Partial<TelemetrySnapshot['derived']> = {}): TelemetrySnapshot {
  const keys = ['battery_voltage', 'battery_current', 'battery_soc', 'battery_soh', 'obstacle_distance', 'ir_obstacle', 'vibration', 'drowsiness', 'espnow_link', 'emergency_stop', 'bluetooth_link']
  const readings = Object.fromEntries(keys.map((k) => [k, reading(k, values[k] ?? null, k in values)])) as TelemetrySnapshot['readings']
  const empty = reading('x', null, false)
  return {
    device_id: 'd', mode: 'live', generated_at: new Date().toISOString(),
    connection: { state: 'live', last_update: null, age_seconds: 0, hardware_connected: true, reason: null },
    readings,
    derived: {
      accel_magnitude: empty, gyro_magnitude: empty, dynamic_accel: empty, proximity: 'clear',
      risk: { available: true, level: 'LOW', score: 0, source: 'computed', method: '', factors: [] },
      ...extra,
    },
  }
}

describe('batteryDisplay', () => {
  it('uses state of health when published', () => {
    expect(batteryDisplay(snap({ battery_soh: 92, battery_soc: 40 }), TH)).toMatchObject({ metric: 'soh', percent: 92, badge: 'Healthy' })
  })
  it('never relabels charge as health', () => {
    expect(batteryDisplay(snap({ battery_soc: 55 }), TH)).toMatchObject({ metric: 'soc', label: 'Battery Charge', badge: 'SoH n/a' })
  })
  it('is unavailable without either stream', () => {
    expect(batteryDisplay(snap({ battery_voltage: 12.4 }), TH)).toMatchObject({ metric: null, percent: null, badge: 'Unavailable' })
  })
})

describe('safetyState', () => {
  it('reports no active incident only with fresh data and no risk factors', () => {
    expect(safetyState(snap({ espnow_link: true }), 'live').title).toBe('No active incident')
  })
  it('refuses to claim safety while stale or offline', () => {
    expect(safetyState(snap({}), 'stale').title).toBe('Safety state unknown')
    expect(safetyState(snap({}), 'offline').tone).toBe('warn')
  })
  it('prioritises emergency stop and collision risk', () => {
    expect(safetyState(snap({ emergency_stop: true }), 'live').title).toBe('Emergency stop active')
    expect(safetyState(snap({ obstacle_distance: 10 }, { proximity: 'critical' }), 'live').tone).toBe('bad')
  })
  it('flags ESP-NOW loss', () => {
    expect(safetyState(snap({ espnow_link: false }), 'live').title).toBe('ESP-NOW link lost')
  })
  it('says so when no safety inputs exist', () => {
    expect(safetyState(snap({}, { risk: { available: false, level: null, score: null, source: null, method: '', factors: [] } }), 'live').title).toBe('No safety inputs')
  })
})
