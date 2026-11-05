import type { Tone } from '../components/ui/primitives'
import type { MlClass } from '../types/telemetry'

export const ML_CLASS_LABEL: Record<MlClass, string> = { safe: 'Safe', caution: 'Caution', danger: 'Danger', accident: 'Accident' }
export const ML_CLASS_TONE: Record<MlClass, Tone> = { safe: 'ok', caution: 'warn', danger: 'bad', accident: 'bad' }

export const ML_FEATURE_LABEL: Record<string, { label: string; unit: string }> = {
  front_cm: { label: 'Front distance', unit: 'cm' },
  rear_cm: { label: 'Rear distance', unit: 'cm' },
  closing_speed_cms: { label: 'Closing speed', unit: 'cm/s' },
  ir_any: { label: 'IR edge sensor', unit: '' },
  dyn_accel_ms2: { label: 'Accel beyond gravity', unit: 'm/s²' },
  gyro_dps: { label: 'Rotation rate', unit: '°/s' },
  tilt_deg: { label: 'Tilt', unit: '°' },
  battery_soc: { label: 'Battery charge', unit: '%' },
}
