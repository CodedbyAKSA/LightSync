"""Canonical API contract. ``frontend/src/types/telemetry.ts`` mirrors these models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Mode = Literal["demo", "live"]
LiveSource = Literal["blynk", "device"]
ConnectionStateName = Literal["connecting", "live", "stale", "offline", "demo"]
Source = Literal["blynk", "device", "demo", "computed", "system"]
Severity = Literal["info", "warning", "critical"]
RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
ProximityLevel = Literal["clear", "warning", "critical", "unknown"]

ReadingValue = float | bool | str | None


class Reading(BaseModel):
    field: str
    value: ReadingValue = None
    unit: str | None = None
    source: Source
    pin: str | None = None
    available: bool = Field(description="False when the hardware does not publish this field.")
    valid: bool = Field(description="False when a value arrived but failed validation.")
    observed_at: datetime | None = Field(
        None, description="When the backend last received this value. Blynk's read API does not "
                          "return measurement timestamps, so this is the observation time.")
    changed_at: datetime | None = Field(None, description="When the value last changed.")
    reason: str | None = None


class ConnectionStatus(BaseModel):
    state: ConnectionStateName
    last_update: datetime | None = Field(None, description="Time of the most recent fresh telemetry.")
    age_seconds: float | None = None
    hardware_connected: bool | None = None
    reason: str | None = None


class RiskAssessment(BaseModel):
    available: bool
    level: RiskLevel | None = None
    score: float | None = None
    source: Source | None = None
    method: str = ""
    factors: list[str] = []


class Derived(BaseModel):
    accel_magnitude: Reading
    gyro_magnitude: Reading
    dynamic_accel: Reading
    proximity: ProximityLevel
    risk: RiskAssessment


class TelemetrySnapshot(BaseModel):
    device_id: str
    mode: Mode
    generated_at: datetime
    connection: ConnectionStatus
    readings: dict[str, Reading]
    derived: Derived


class Sample(BaseModel):
    """Compact history point used by charts. ``None`` means no valid reading."""

    t: float = Field(description="Unix epoch milliseconds")
    accel: float | None = None
    gyro: float | None = None
    ax: float | None = None
    ay: float | None = None
    az: float | None = None
    gx: float | None = None
    gy: float | None = None
    gz: float | None = None
    distance: float | None = None
    voltage: float | None = None
    current: float | None = None
    soc: float | None = None
    soh: float | None = None
    risk: float | None = None


class HistoryResponse(BaseModel):
    mode: Mode
    window_seconds: float
    max_samples: int
    samples: list[Sample]


class SafetyEvent(BaseModel):
    id: str
    type: str
    severity: Severity
    message: str
    timestamp: datetime
    source: Source
    details: dict[str, Any] = {}


class EventsResponse(BaseModel):
    mode: Mode
    total: int
    events: list[SafetyEvent]


class DeviceInfo(BaseModel):
    id: str
    name: str
    chip: str
    role: str
    state: Literal["online", "offline", "unknown", "demo"]
    last_seen: datetime | None = None
    details: dict[str, Any] = {}


class BlynkStatus(BaseModel):
    configured: bool
    server: str
    reachable: bool | None = None
    hardware_connected: bool | None = None
    last_poll: datetime | None = None
    last_success: datetime | None = None
    last_error: str | None = None
    consecutive_failures: int = 0


class DevicesResponse(BaseModel):
    mode: Mode
    devices: list[DeviceInfo]
    blynk: BlynkStatus
    espnow: dict[str, Any]


class DatastreamInfo(BaseModel):
    key: str
    label: str
    kind: str
    group: str
    unit: str | None
    pin: str | None
    default_pin: str | None
    mapped: bool
    description: str


class CommandAvailability(BaseModel):
    key: str
    label: str
    available: bool
    pin: str | None
    state_field: str
    reason: str | None = None


class ThresholdsModel(BaseModel):
    obstacle_warning_cm: float
    obstacle_critical_cm: float
    battery_warning_pct: float
    battery_critical_pct: float
    battery_min_voltage: float
    soh_warning_pct: float
    abnormal_accel_ms2: float
    abnormal_gyro_dps: float


class ConfigResponse(BaseModel):
    mode: Mode
    live_source: LiveSource
    device_id: str
    poll_interval: float
    freshness_seconds: float
    history_max_samples: int
    thresholds: ThresholdsModel
    datastreams: list[DatastreamInfo]
    commands: list[CommandAvailability]
    commands_enabled: bool
    blynk_configured: bool
    blynk_server: str
    device_key_configured: bool
    operator_key_configured: bool
    operator_auth_required: bool
    config_errors: list[str] = []


class ModeUpdate(BaseModel):
    mode: Mode


class AutonomousCommand(BaseModel):
    enabled: bool


class EmergencyStopCommand(BaseModel):
    active: bool


class CommandResult(BaseModel):
    id: str
    command: str
    requested_value: bool
    status: Literal["acknowledged", "unconfirmed", "rejected", "failed"]
    source: Source
    message: str
    requested_at: datetime
    completed_at: datetime | None = None


class DeviceIngestResponse(BaseModel):
    status: Literal["accepted"]
    accepted: list[str] = Field(description="Fields stored from this post.")
    ignored: list[str] = Field(description="Keys that are not LightSync fields; check the firmware spelling.")
    received: int = Field(description="Posts accepted since the server started or the mode last changed.")


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    mode: Mode
    connection: ConnectionStateName
    blynk_configured: bool
