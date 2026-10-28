"""Safety-event detection.

Events are derived from *transitions* between consecutive snapshots, so a
condition that persists produces one event rather than one per poll. Every event
carries the source of the snapshot that triggered it (``blynk`` for real
hardware, ``demo`` for simulated data, ``system`` for connection changes).
"""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .normalize import flag, number, state
from .schemas import SafetyEvent, Severity, Source, TelemetrySnapshot

_ids = itertools.count(1)

ABNORMAL_ACCEL_COOLDOWN_S = 5.0


def make_event(type_: str, severity: Severity, message: str, source: Source, when: datetime,
               **details: Any) -> SafetyEvent:
    return SafetyEvent(id=f"evt-{int(time.time() * 1000)}-{next(_ids)}", type=type_,
                       severity=severity, message=message, timestamp=when, source=source,
                       details=details)


@dataclass
class EventDetector:
    proximity: str | None = None
    battery_band: str | None = None
    low_voltage: bool | None = None
    espnow: bool | None = None
    estop: bool | None = None
    drowsy: bool | None = None
    unstable: bool | None = None
    connection: str | None = None
    last_abnormal_at: float = field(default=-1e9)

    def process(self, snap: TelemetrySnapshot, thresholds) -> list[SafetyEvent]:  # noqa: ANN001
        events: list[SafetyEvent] = []
        now = snap.generated_at
        conn = snap.connection.state

        if conn != self.connection:
            if self.connection is not None and conn in {"stale", "offline"}:
                events.append(make_event(
                    f"telemetry_{conn}", "warning",
                    "Telemetry is stale" if conn == "stale" else "Telemetry connection offline",
                    "system", now, reason=snap.connection.reason))
            elif self.connection in {"stale", "offline", "connecting"} and conn == "live":
                events.append(make_event("telemetry_live", "info", "Live telemetry restored",
                                         "system", now))
            self.connection = conn

        # Only fresh data may generate hardware events.
        if conn not in {"live", "demo"}:
            return events

        src: Source = "demo" if snap.mode == "demo" else "blynk"
        r = snap.readings

        prox = snap.derived.proximity
        rank = {"clear": 0, "warning": 1, "critical": 2}
        if prox != "unknown" and prox != self.proximity:
            distance = number(r, "obstacle_distance")
            # Only escalations are detections; receding from critical to warning is not news.
            if prox in {"warning", "critical"} and rank[prox] > rank.get(self.proximity or "clear", 0):
                events.append(make_event(
                    "obstacle_detected", prox, f"Obstacle detected at {distance:.0f} cm",
                    src, now, distance_cm=distance, level=prox))  # type: ignore[arg-type]
            elif prox == "clear" and self.proximity in {"warning", "critical"}:
                events.append(make_event("obstacle_cleared", "info", "Path clear", src, now,
                                         distance_cm=distance))
        if prox != "unknown":
            self.proximity = prox

        soc = number(r, "battery_soc")
        if soc is not None:
            band = ("critical" if soc <= thresholds.battery_critical_pct
                    else "warning" if soc <= thresholds.battery_warning_pct else "ok")
            if band != self.battery_band and band != "ok":
                events.append(make_event("battery_warning", band,  # type: ignore[arg-type]
                                         f"Battery {band}: {soc:.0f}% charge", src, now, soc=soc))
            self.battery_band = band

        voltage = number(r, "battery_voltage")
        if voltage is not None:
            low = voltage < thresholds.battery_min_voltage
            if low and self.low_voltage is False:
                events.append(make_event("battery_low_voltage", "warning",
                                         f"Battery voltage low: {voltage:.2f} V", src, now,
                                         voltage=voltage))
            self.low_voltage = low

        link = flag(r, "espnow_link")
        if link is not None:
            if self.espnow is True and not link:
                events.append(make_event("espnow_lost", "critical", "ESP-NOW connection lost",
                                         src, now))
            elif self.espnow is not True and link:
                events.append(make_event("espnow_established", "info", "ESP-NOW link established",
                                         src, now))
            self.espnow = link

        estop = flag(r, "emergency_stop")
        if estop is not None:
            if estop and self.estop is not True:
                events.append(make_event("emergency_stop", "critical", "Emergency stop activated",
                                         src, now))
            elif not estop and self.estop is True:
                events.append(make_event("emergency_stop_released", "info",
                                         "Emergency stop released", src, now))
            self.estop = estop

        drowsy = flag(r, "drowsiness")
        if drowsy is not None:
            if drowsy and self.drowsy is not True:
                events.append(make_event("drowsiness", "warning", "Drowsiness detected", src, now))
            self.drowsy = drowsy

        dyn_reading = snap.derived.dynamic_accel
        dyn = float(dyn_reading.value) if dyn_reading.valid else None  # type: ignore[arg-type]
        vib = state(r, "vibration")
        if dyn is not None or vib is not None:
            abnormal = dyn is not None and dyn > thresholds.abnormal_accel_ms2
            mono = time.monotonic()
            if abnormal and mono - self.last_abnormal_at > ABNORMAL_ACCEL_COOLDOWN_S:
                events.append(make_event("abnormal_acceleration", "critical",
                                         f"Abnormal acceleration: {dyn:.1f} m/s² beyond gravity",
                                         src, now, dynamic_accel=dyn))
                self.last_abnormal_at = mono
            unstable = abnormal or vib in {"warning", "active"}
            if vib == "active" and self.unstable is not True:
                events.append(make_event("vibration", "warning", "Strong vibration detected",
                                         src, now))
            if self.unstable is True and not unstable:
                events.append(make_event("motion_stable", "info", "Motion stable", src, now))
            self.unstable = unstable

        return events
