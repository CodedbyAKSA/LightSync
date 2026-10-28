// Mirrors backend/app/schemas.py. Keep the two in sync.

export type Mode = 'demo' | 'live'
export type LiveSource = 'blynk' | 'device'
export type ConnectionStateName = 'connecting' | 'live' | 'stale' | 'offline' | 'demo'
export type Source = 'blynk' | 'device' | 'demo' | 'computed' | 'system'
export type Severity = 'info' | 'warning' | 'critical'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type ProximityLevel = 'clear' | 'warning' | 'critical' | 'unknown'
export type Side = 'front' | 'rear' | 'left' | 'right'

export type FieldKey =
  | 'battery_voltage' | 'battery_current' | 'battery_soc' | 'battery_soh'
  | 'accel_x' | 'accel_y' | 'accel_z' | 'gyro_x' | 'gyro_y' | 'gyro_z'
  | 'obstacle_distance' | 'ir_obstacle' | 'vibration' | 'drowsiness' | 'risk_score'
  | 'obstacle_distance_rear' | 'obstacle_distance_left' | 'obstacle_distance_right'
  | 'ir_left' | 'ir_right'
  | 'espnow_link' | 'lcd_status' | 'autonomous_mode' | 'emergency_stop'
  | 'bluetooth_link' | 'espnow_rssi' | 'espnow_packet_loss' | 'heartbeat'

export interface Reading {
  field: string
  value: number | boolean | string | null
  unit: string | null
  source: Source
  pin: string | null
  available: boolean
  valid: boolean
  observed_at: string | null
  changed_at: string | null
  reason: string | null
}

export interface ConnectionStatus {
  state: ConnectionStateName
  last_update: string | null
  age_seconds: number | null
  hardware_connected: boolean | null
  reason: string | null
}

export interface RiskAssessment {
  available: boolean
  level: RiskLevel | null
  score: number | null
  source: Source | null
  method: string
  factors: string[]
}

export interface Derived {
  accel_magnitude: Reading
  gyro_magnitude: Reading
  dynamic_accel: Reading
  proximity: ProximityLevel
  proximity_sides: Partial<Record<Side, ProximityLevel>>
  risk: RiskAssessment
}

export interface TelemetrySnapshot {
  device_id: string
  mode: Mode
  generated_at: string
  connection: ConnectionStatus
  readings: Record<FieldKey, Reading>
  derived: Derived
}

export interface Sample {
  t: number
  accel: number | null
  gyro: number | null
  ax: number | null
  ay: number | null
  az: number | null
  gx: number | null
  gy: number | null
  gz: number | null
  distance: number | null
  voltage: number | null
  current: number | null
  soc: number | null
  soh: number | null
  risk: number | null
}

export interface HistoryResponse {
  mode: Mode
  window_seconds: number
  max_samples: number
  samples: Sample[]
}

export interface SafetyEvent {
  id: string
  type: string
  severity: Severity
  message: string
  timestamp: string
  source: Source
  details: Record<string, unknown>
}

export interface EventsResponse {
  mode: Mode
  total: number
  events: SafetyEvent[]
}

export interface DeviceInfo {
  id: string
  name: string
  chip: string
  role: string
  state: 'online' | 'offline' | 'unknown' | 'demo'
  last_seen: string | null
  details: Record<string, unknown>
}

export interface BlynkStatus {
  configured: boolean
  server: string
  reachable: boolean | null
  hardware_connected: boolean | null
  last_poll: string | null
  last_success: string | null
  last_error: string | null
  consecutive_failures: number
}

export interface DevicesResponse {
  mode: Mode
  devices: DeviceInfo[]
  blynk: BlynkStatus
  espnow: {
    state: 'connected' | 'disconnected' | 'unknown'
    available: boolean
    rssi_dbm: number | null
    packet_loss_pct: number | null
    metrics_available: boolean
    source: Source
  }
}

export interface DatastreamInfo {
  key: string
  label: string
  kind: string
  group: string
  unit: string | null
  pin: string | null
  default_pin: string | null
  mapped: boolean
  description: string
}

export interface CommandAvailability {
  key: 'cmd_autonomous_mode' | 'cmd_emergency_stop'
  label: string
  available: boolean
  pin: string | null
  state_field: string
  reason: string | null
}

export interface Thresholds {
  obstacle_warning_cm: number
  obstacle_critical_cm: number
  battery_warning_pct: number
  battery_critical_pct: number
  battery_min_voltage: number
  soh_warning_pct: number
  abnormal_accel_ms2: number
  abnormal_gyro_dps: number
}

export interface ConfigResponse {
  mode: Mode
  live_source: LiveSource
  device_id: string
  poll_interval: number
  freshness_seconds: number
  history_max_samples: number
  thresholds: Thresholds
  datastreams: DatastreamInfo[]
  commands: CommandAvailability[]
  commands_enabled: boolean
  blynk_configured: boolean
  blynk_server: string
  device_key_configured: boolean
  operator_key_configured: boolean
  operator_auth_required: boolean
  config_errors: string[]
}

export interface CommandResult {
  id: string
  command: string
  requested_value: boolean
  status: 'acknowledged' | 'unconfirmed' | 'rejected' | 'failed'
  source: Source
  message: string
  requested_at: string
  completed_at: string | null
}
