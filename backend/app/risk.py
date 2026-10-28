"""Accident-risk assessment.

If the firmware publishes a risk score (``risk_score`` datastream, 0-100) it is
used as-is. Otherwise the backend computes a transparent, rule-based estimate
from whichever sensor inputs are available. This is a heuristic, not a trained
model, and the UI labels it that way.

Points (summed, capped at 100):

=============================================  ======
Obstacle distance <= critical threshold          45
Obstacle distance <= warning threshold           25
IR sensor detects an obstacle                    15
Vibration "warning" / "active"                10 / 20
Dynamic acceleration > abnormal threshold        30
Dynamic acceleration > half the threshold        10
Angular rate magnitude > abnormal threshold      15
Drowsiness detected                              30
Battery state of charge <= critical threshold     5
=============================================  ======

Levels: score < 25 LOW, < 50 MEDIUM, < 75 HIGH, otherwise CRITICAL.
"""

from __future__ import annotations

from typing import Mapping

from .normalize import GRAVITY, flag, number, state, vector_magnitude
from .schemas import ProximityLevel, Reading, RiskAssessment, RiskLevel

RULE_METHOD = "Rule-based estimate from live sensor inputs (see backend/app/risk.py)"


def level_for(score: float) -> RiskLevel:
    if score < 25:
        return "LOW"
    if score < 50:
        return "MEDIUM"
    if score < 75:
        return "HIGH"
    return "CRITICAL"


def proximity_level(distance: float | None, warning_cm: float, critical_cm: float) -> ProximityLevel:
    if distance is None:
        return "unknown"
    if distance <= critical_cm:
        return "critical"
    if distance <= warning_cm:
        return "warning"
    return "clear"


def dynamic_acceleration(readings: Mapping[str, Reading]) -> float | None:
    magnitude = vector_magnitude(readings, "accel")
    return None if magnitude is None else abs(magnitude - GRAVITY)


def assess_risk(readings: Mapping[str, Reading], thresholds) -> RiskAssessment:  # noqa: ANN001
    reported = number(readings, "risk_score")
    if reported is not None:
        return RiskAssessment(available=True, level=level_for(reported), score=round(reported, 1),
                              source=readings["risk_score"].source,
                              method="Reported by the hardware (risk_score datastream)")

    score = 0.0
    factors: list[str] = []
    inputs = 0

    distance = number(readings, "obstacle_distance")
    if distance is not None:
        inputs += 1
        prox = proximity_level(distance, thresholds.obstacle_warning_cm, thresholds.obstacle_critical_cm)
        if prox == "critical":
            score += 45
            factors.append(f"Obstacle at {distance:.0f} cm (critical) +45")
        elif prox == "warning":
            score += 25
            factors.append(f"Obstacle at {distance:.0f} cm (warning) +25")

    ir = flag(readings, "ir_obstacle")
    if ir is not None:
        inputs += 1
        if ir:
            score += 15
            factors.append("IR sensor detects obstacle +15")

    vib = state(readings, "vibration")
    if vib is not None:
        inputs += 1
        if vib == "warning":
            score += 10
            factors.append("Vibration warning +10")
        elif vib == "active":
            score += 20
            factors.append("Vibration active +20")

    dyn = dynamic_acceleration(readings)
    if dyn is not None:
        inputs += 1
        if dyn > thresholds.abnormal_accel_ms2:
            score += 30
            factors.append(f"Abnormal acceleration {dyn:.1f} m/s² +30")
        elif dyn > thresholds.abnormal_accel_ms2 / 2:
            score += 10
            factors.append(f"Elevated acceleration {dyn:.1f} m/s² +10")

    gyro = vector_magnitude(readings, "gyro")
    if gyro is not None:
        inputs += 1
        if gyro > thresholds.abnormal_gyro_dps:
            score += 15
            factors.append(f"High angular rate {gyro:.0f} °/s +15")

    drowsy = flag(readings, "drowsiness")
    if drowsy is not None:
        inputs += 1
        if drowsy:
            score += 30
            factors.append("Drowsiness detected +30")

    soc = number(readings, "battery_soc")
    if soc is not None:
        inputs += 1
        if soc <= thresholds.battery_critical_pct:
            score += 5
            factors.append(f"Battery critical ({soc:.0f}%) +5")

    if inputs == 0:
        return RiskAssessment(available=False, method="No risk inputs are available")

    score = min(score, 100.0)
    if not factors:
        factors.append(f"No risk factors across {inputs} sensor inputs")
    return RiskAssessment(available=True, level=level_for(score), score=score, source="computed",
                          method=RULE_METHOD, factors=factors)
