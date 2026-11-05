"""Feature and class definitions shared by the synthesizer, the trainer and
the backend (backend/app/ml.py computes the same features from live telemetry)."""

FEATURES = [
    "front_cm",           # front ultrasonic distance, cm (400 = nothing in range)
    "rear_cm",            # rear ultrasonic distance, cm
    "closing_speed_cms",  # how fast the front gap shrinks, cm/s (positive = approaching)
    "ir_any",             # 1 if either IR edge sensor triggers
    "dyn_accel_ms2",      # | |a| - 9.81 |: acceleration beyond gravity, m/s²
    "gyro_dps",           # rotation rate magnitude, °/s
    "tilt_deg",           # angle between the measured gravity vector and the car's Z axis
    "battery_soc",        # state of charge, %
]

CLASSES = ["safe", "caution", "danger", "accident"]
