import type { Tone } from '../components/ui/primitives'
import type { ConnectionStateName, RiskLevel, TelemetrySnapshot, Thresholds } from '../types/telemetry'
import { bool, num, str } from './format'

export const riskTone: Record<RiskLevel, Tone> = { LOW: 'ok', MEDIUM: 'warn', HIGH: 'bad', CRITICAL: 'bad' }

export function fresh(state: ConnectionStateName): boolean {
  return state === 'live' || state === 'demo'
}

export interface SafetyState {
  tone: Tone
  title: string
  description: string
}

/** Overall safety summary for the Safety & Accident Detection card. */
export function safetyState(snap: TelemetrySnapshot | null, conn: ConnectionStateName): SafetyState {
  if (!snap || conn === 'connecting') {
    return { tone: 'neutral', title: 'Waiting for telemetry', description: 'Connecting to the telemetry service.' }
  }
  if (!fresh(conn)) {
    return {
      tone: 'warn',
      title: 'Safety state unknown',
      description: conn === 'stale' ? 'Telemetry is stale; the current state cannot be confirmed.' : 'Telemetry is offline; the current state cannot be confirmed.',
    }
  }
  const r = snap.readings
  const d = snap.derived
  if (bool(r.emergency_stop)) return { tone: 'bad', title: 'Emergency stop active', description: 'The hardware reports the emergency-stop latch is engaged.' }
  if (d.proximity === 'critical') return { tone: 'bad', title: 'Collision risk', description: `Obstacle at ${num(r.obstacle_distance)?.toFixed(0)} cm — inside the critical distance.` }
  if (d.risk.available && (d.risk.level === 'HIGH' || d.risk.level === 'CRITICAL')) {
    return { tone: 'bad', title: `${d.risk.level === 'CRITICAL' ? 'Critical' : 'High'} accident risk`, description: d.risk.factors[0] ?? d.risk.method }
  }
  if (bool(r.espnow_link) === false) return { tone: 'bad', title: 'ESP-NOW link lost', description: 'The gateway is not receiving packets from the node.' }
  if (bool(r.drowsiness)) return { tone: 'warn', title: 'Drowsiness detected', description: 'The on-board detector reports drowsiness.' }
  if (d.proximity === 'warning') return { tone: 'warn', title: 'Obstacle ahead', description: `Obstacle at ${num(r.obstacle_distance)?.toFixed(0)} cm — approaching the safety threshold.` }
  const vib = str(r.vibration)
  if (vib === 'warning' || vib === 'active') return { tone: 'warn', title: 'Vibration detected', description: 'Vibration sensor reports abnormal motion.' }
  if (!d.risk.available) return { tone: 'neutral', title: 'No safety inputs', description: 'None of the safety sensors are publishing data.' }
  return { tone: 'ok', title: 'No active incident', description: 'System is operating safely.' }
}

export interface BatteryDisplay {
  percent: number | null
  metric: 'soh' | 'soc' | null
  label: string
  badge: string
  tone: Tone
}

/** Battery health vs. charge: never present one as the other. */
export function batteryDisplay(snap: TelemetrySnapshot | null, t: Thresholds | undefined): BatteryDisplay {
  const soh = snap ? num(snap.readings.battery_soh) : null
  const soc = snap ? num(snap.readings.battery_soc) : null
  if (soh !== null) {
    const degraded = t ? soh < t.soh_warning_pct : false
    return { percent: soh, metric: 'soh', label: 'Battery Health', badge: degraded ? 'Degraded' : 'Healthy', tone: degraded ? 'warn' : 'ok' }
  }
  if (soc !== null) {
    const tone: Tone = t && soc <= t.battery_critical_pct ? 'bad' : t && soc <= t.battery_warning_pct ? 'warn' : 'ok'
    return { percent: soc, metric: 'soc', label: 'Battery Charge', badge: 'SoH n/a', tone }
  }
  return { percent: null, metric: null, label: 'Battery Health', badge: 'Unavailable', tone: 'neutral' }
}
