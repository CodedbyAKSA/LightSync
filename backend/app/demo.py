"""Deterministic demo telemetry.

The simulator replays a fixed 90-second scenario driven only by elapsed time,
so the same instant always produces the same values. Its output is tagged
``source="demo"`` all the way to the UI and is discarded when switching to live.

Scenario per cycle:
  0-40 s   cruising, path clear
  40-60 s  obstacle approaches to ~15 cm (warning, then critical), IR trips
  60-75 s  obstacle recedes, path clear again
  75-79 s  short vibration warning
  throughout: rear and side distances drift; a wall closes in on the left
  at 20-30 s (left IR trips), the right IR trips with the front obstacle
  every 4th cycle the ESP-NOW link drops for 4 s at t=82 s
"""

from __future__ import annotations

import math
import random

from .normalize import GRAVITY

CYCLE_S = 90.0


def _noise(tick: int, channel: int, scale: float) -> float:
    return random.Random(tick * 131 + channel).uniform(-scale, scale)


class DemoProvider:
    def __init__(self) -> None:
        self.autonomous_mode = True
        self.emergency_stop = False

    def values(self, elapsed: float) -> dict[str, float | bool | int]:
        tick = int(elapsed * 2)
        cycle = int(elapsed // CYCLE_S)
        t = elapsed % CYCLE_S

        if 40 <= t < 52:
            distance = 120 - (t - 40) * 8.75          # 120 -> 15 cm
        elif 52 <= t < 60:
            distance = 15.0
        elif 60 <= t < 75:
            distance = 15 + (t - 60) * 7              # 15 -> 120 cm
        else:
            distance = 120 + 12 * math.sin(t / 6)
        distance = max(5.0, distance + _noise(tick, 1, 0.8))

        moving = not self.emergency_stop
        sway = 1.0 if moving else 0.05
        ax = 0.6 * math.sin(t / 3.1) * sway + _noise(tick, 2, 0.15)
        ay = 0.4 * math.cos(t / 4.3) * sway + _noise(tick, 3, 0.15)
        az = GRAVITY + 0.3 * math.sin(t / 2.2) * sway + _noise(tick, 4, 0.1)
        gx = 18 * math.sin(t / 5.0) * sway + _noise(tick, 5, 2)
        gy = 12 * math.cos(t / 3.7) * sway + _noise(tick, 6, 2)
        gz = 30 * math.sin(t / 7.3) * sway + _noise(tick, 7, 3)

        soc = 92.0 - (elapsed % 3600) / 3600 * 3      # slow 3 %/h drain, then resets
        current = (1.8 if moving else 0.35) + _noise(tick, 8, 0.08)
        voltage = 11.1 + (soc / 100) * 1.45 - current * 0.03

        rear = max(5.0, 95 + 25 * math.sin(t / 8) + _noise(tick, 11, 0.8))
        left = 22 + 10 * abs(t - 25) / 5 if 20 <= t < 30 else 60 + 15 * math.sin(t / 5)
        left = max(5.0, left + _noise(tick, 12, 0.8))
        right = max(5.0, 75 + 20 * math.cos(t / 7) + _noise(tick, 13, 0.8))
        ir_left = left < 25
        ir_right = distance < 30

        link_drop = cycle % 4 == 3 and 82 <= t < 86
        return {
            "battery_voltage": round(voltage, 2),
            "battery_current": round(current, 2),
            "battery_soc": round(soc, 1),
            "battery_soh": 92.0,
            "accel_x": round(ax, 3), "accel_y": round(ay, 3), "accel_z": round(az, 3),
            "gyro_x": round(gx, 2), "gyro_y": round(gy, 2), "gyro_z": round(gz, 2),
            "obstacle_distance": round(distance, 1),
            "ir_obstacle": ir_left or ir_right,
            "obstacle_distance_rear": round(rear, 1),
            "obstacle_distance_left": round(left, 1),
            "obstacle_distance_right": round(right, 1),
            "ir_left": ir_left,
            "ir_right": ir_right,
            "vibration": 1 if 75 <= t < 79 else 0,
            "drowsiness": False,
            "espnow_link": not link_drop,
            "lcd_status": True,
            "autonomous_mode": self.autonomous_mode,
            "emergency_stop": self.emergency_stop,
            "espnow_rssi": round(-58 + 4 * math.sin(t / 9) + _noise(tick, 9, 1.5)),
            "espnow_packet_loss": round(max(0.0, 0.8 + _noise(tick, 10, 0.6)), 1),
            "heartbeat": tick,
        }
