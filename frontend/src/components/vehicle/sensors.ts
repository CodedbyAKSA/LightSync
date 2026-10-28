import type { ProximityLevel, Side } from '../../types/telemetry'

/** One ultrasonic as the vehicle views draw it. */
export interface SensorView {
  side: Side
  /** Measured distance in cm, or null when that sensor reports nothing. */
  distanceCm: number | null
  proximity: ProximityLevel
}

/** Beyond this the path is drawn as clear: waves, but no obstacle. */
export const MAX_CM = 200
