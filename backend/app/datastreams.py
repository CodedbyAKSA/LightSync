"""Central registry of the telemetry fields LightSync understands.

Every field has a *logical* key (``battery_voltage``) that the rest of the
application uses, and an optional Blynk virtual pin that the field is read
from. The default pins below are suggestions only; they must be checked against
the real Blynk template and firmware. Override any of them with an environment
variable named ``PIN_<FIELD_KEY_UPPERCASE>`` (for example ``PIN_BATTERY_VOLTAGE=V0``).
Set the variable to ``none`` (or leave it empty) to mark the field as not
published by the hardware; the dashboard then renders it as unavailable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Mapping

FieldKind = Literal["number", "bool", "state"]

PIN_PATTERN = re.compile(r"^[vV](\d{1,3})$")


@dataclass(frozen=True)
class FieldSpec:
    key: str
    label: str
    kind: FieldKind
    group: str
    default_pin: str | None
    unit: str | None = None
    minimum: float | None = None
    maximum: float | None = None
    # For ``state`` fields: numeric code -> state name.
    states: Mapping[int, str] | None = None
    description: str = ""


VIBRATION_STATES = {0: "normal", 1: "warning", 2: "active"}

FIELDS: tuple[FieldSpec, ...] = (
    FieldSpec("battery_voltage", "Battery voltage", "number", "battery", "V0", "V", 0, 60,
              description="Measured pack voltage."),
    FieldSpec("battery_current", "Battery current", "number", "battery", "V1", "A", -50, 50,
              description="Measured pack current (positive = discharge)."),
    FieldSpec("battery_soc", "State of charge", "number", "battery", "V2", "%", 0, 100,
              description="Remaining charge estimated by the firmware."),
    FieldSpec("battery_soh", "State of health", "number", "battery", "V3", "%", 0, 100,
              description="Capacity relative to new, from the firmware's health estimator."),
    FieldSpec("accel_x", "Accelerometer X", "number", "motion", "V4", "m/s²", -160, 160),
    FieldSpec("accel_y", "Accelerometer Y", "number", "motion", "V5", "m/s²", -160, 160),
    FieldSpec("accel_z", "Accelerometer Z", "number", "motion", "V6", "m/s²", -160, 160),
    FieldSpec("gyro_x", "Gyroscope X", "number", "motion", "V7", "°/s", -2000, 2000),
    FieldSpec("gyro_y", "Gyroscope Y", "number", "motion", "V8", "°/s", -2000, 2000),
    FieldSpec("gyro_z", "Gyroscope Z", "number", "motion", "V9", "°/s", -2000, 2000),
    FieldSpec("obstacle_distance", "Obstacle distance", "number", "obstacle", "V10", "cm", 0, 1000,
              description="Distance to the nearest obstacle in front of the vehicle."),
    FieldSpec("ir_obstacle", "IR obstacle sensor", "bool", "obstacle", "V11",
              description="1 = IR sensor sees an obstacle, 0 = clear."),
    FieldSpec("vibration", "Vibration state", "state", "obstacle", "V12", states=VIBRATION_STATES,
              description="0 = normal, 1 = warning, 2 = active (boolean true is treated as active)."),
    FieldSpec("drowsiness", "Drowsiness detection", "bool", "safety", "V13",
              description="1 = drowsiness detected by the on-board detector."),
    FieldSpec("risk_score", "Accident risk score", "number", "safety", "V14", "score", 0, 100,
              description="Optional firmware-computed risk score (0-100). If absent the backend "
                          "computes a rule-based estimate."),
    FieldSpec("espnow_link", "ESP-NOW link", "bool", "network", "V15",
              description="1 = gateway is receiving packets from the ESP8266 node."),
    FieldSpec("lcd_status", "LCD status", "bool", "system", "V16",
              description="1 = on-board LCD is active."),
    FieldSpec("autonomous_mode", "Autonomous mode", "bool", "automation", "V17",
              description="Hardware-reported autonomous mode state."),
    FieldSpec("emergency_stop", "Emergency stop", "bool", "automation", "V18",
              description="Hardware-reported emergency-stop latch state (1 = stopped)."),
    FieldSpec("bluetooth_link", "Bluetooth link", "bool", "network", None,
              description="Only map this if the hardware really implements Bluetooth."),
    FieldSpec("espnow_rssi", "ESP-NOW RSSI", "number", "network", None, "dBm", -120, 0),
    FieldSpec("espnow_packet_loss", "ESP-NOW packet loss", "number", "network", None, "%", 0, 100),
    FieldSpec("heartbeat", "Gateway heartbeat", "number", "system", None, "count", 0, 1e15,
              description="Counter the gateway increments on every publish. Strongly recommended: "
                          "it is the most reliable freshness signal."),
)

FIELD_BY_KEY: dict[str, FieldSpec] = {f.key: f for f in FIELDS}


@dataclass(frozen=True)
class CommandSpec:
    key: str
    label: str
    state_field: str
    default_pin: str | None


# Command pins are deliberately separate from state pins: the hardware must
# apply the request and then publish the resulting state on the state pin. That
# is how the dashboard confirms a command was really executed.
COMMANDS: tuple[CommandSpec, ...] = (
    CommandSpec("cmd_autonomous_mode", "Autonomous mode request", "autonomous_mode", None),
    CommandSpec("cmd_emergency_stop", "Emergency stop request", "emergency_stop", None),
)

COMMAND_BY_KEY: dict[str, CommandSpec] = {c.key: c for c in COMMANDS}


class PinConfigError(ValueError):
    pass


def normalize_pin(value: str | None) -> str | None:
    """Return a canonical lowercase pin (``v10``) or ``None`` for unmapped."""
    if value is None:
        return None
    value = value.strip()
    if value == "" or value.lower() in {"none", "null", "-", "off", "unmapped"}:
        return None
    match = PIN_PATTERN.match(value)
    if not match or int(match.group(1)) > 255:
        raise PinConfigError(f"Invalid virtual pin {value!r}; expected V0..V255 or 'none'")
    return f"v{int(match.group(1))}"


def resolve_pin_map(env: Mapping[str, str]) -> dict[str, str | None]:
    """Build ``{field_or_command_key: pin}`` from defaults plus ``PIN_*`` overrides."""
    upper_env = {k.upper(): v for k, v in env.items()}
    pins: dict[str, str | None] = {}
    for key, default in [(f.key, f.default_pin) for f in FIELDS] + [
        (c.key, c.default_pin) for c in COMMANDS
    ]:
        override = upper_env.get(f"PIN_{key.upper()}")
        pins[key] = normalize_pin(override if override is not None else default)

    used: dict[str, str] = {}
    for key, pin in pins.items():
        if pin is None:
            continue
        if pin in used:
            raise PinConfigError(f"Pin {pin.upper()} is assigned to both {used[pin]} and {key}")
        used[pin] = key
    return pins
