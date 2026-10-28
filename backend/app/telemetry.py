"""Telemetry service: the single place that talks to Blynk (or the simulator).

One background loop fetches data, normalizes it, keeps a bounded history,
detects events and fans snapshots out to SSE subscribers. Dashboard
components never call Blynk themselves.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import logging
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Literal

import httpx

from .blynk import BlynkClient, BlynkError
from .config import Settings, Thresholds
from .datastreams import COMMAND_BY_KEY, COMMANDS, FIELD_BY_KEY
from .demo import DemoProvider
from .events import EventDetector, make_event
from .normalize import (
    derived_reading,
    flag,
    number,
    parse_value,
    readings_from_blynk,
    readings_from_values,
    vector_magnitude,
)
from .risk import assess_risk, dynamic_acceleration, proximity_level
from .schemas import (
    BlynkStatus,
    CommandAvailability,
    CommandResult,
    ConnectionStateName,
    ConnectionStatus,
    Derived,
    DeviceInfo,
    DevicesResponse,
    Mode,
    Reading,
    SafetyEvent,
    Sample,
    TelemetrySnapshot,
)

log = logging.getLogger("lightsync.telemetry")

DEMO_INTERVAL_S = 1.0
_cmd_ids = itertools.count(1)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CommandRejected(Exception):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


class TelemetryService:
    def __init__(self, settings: Settings, pin_map: dict[str, str | None], *,
                 config_errors: list[str] | None = None,
                 blynk_transport: httpx.AsyncBaseTransport | None = None,
                 ack_poll_interval: float = 1.0):
        self.settings = settings
        self.pin_map = pin_map
        self.config_errors = list(config_errors or [])
        self.thresholds = Thresholds()
        self.mode: Mode = settings.lightsync_mode
        self._blynk_transport = blynk_transport
        self._ack_poll_interval = ack_poll_interval
        self._blynk: BlynkClient | None = None
        self._task: asyncio.Task | None = None
        self._subscribers: set[asyncio.Queue] = set()
        self._command_lock = asyncio.Lock()
        self.blynk_status = BlynkStatus(configured=settings.blynk_configured,
                                        server=settings.blynk_server)
        self._reset_state()

    # ------------------------------------------------------------------ state
    def _reset_state(self) -> None:
        self.history: deque[Sample] = deque(maxlen=self.settings.history_max_samples)
        self.events: deque[SafetyEvent] = deque(maxlen=self.settings.events_max)
        self.commands_log: deque[CommandResult] = deque(maxlen=100)
        self.detector = EventDetector()
        self.latest: TelemetrySnapshot | None = None
        self._prev_raw: dict[str, Any] = {}
        self._changed_at: dict[str, datetime] = {}
        self._last_readings: dict[str, Reading] | None = None
        self._last_fresh: datetime | None = None
        self._hardware_connected: bool | None = None
        self._last_hw_check = -1e9
        self._espnow_last_seen: datetime | None = None
        self._demo = DemoProvider()
        self._demo_started = time.monotonic()
        self.blynk_status = BlynkStatus(configured=self.settings.blynk_configured,
                                        server=self.settings.blynk_server)

    def _ensure_blynk(self) -> BlynkClient | None:
        if self._blynk is None and self.settings.blynk_token is not None:
            self._blynk = BlynkClient(self.settings.blynk_server,
                                      self.settings.blynk_token.get_secret_value(),
                                      timeout=self.settings.blynk_timeout,
                                      transport=self._blynk_transport)
        return self._blynk

    # -------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="telemetry-loop")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._blynk is not None:
            await self._blynk.aclose()
            self._blynk = None

    async def set_mode(self, mode: Mode) -> None:
        """Switch data source. All buffered samples and events are discarded so
        demo data can never leak into live charts or the live event log."""
        running = self._task is not None
        if running:
            await self.stop()
        self.mode = mode
        self._reset_state()
        self._broadcast("reset", {"mode": mode})
        log.info("Telemetry mode switched to %s", mode)
        if running:
            await self.start()

    async def _run(self) -> None:
        while True:
            try:
                delay = await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - defensive
                log.exception("Telemetry loop iteration failed")
                delay = 5.0
            await asyncio.sleep(delay)

    async def tick(self) -> float:
        """Run one acquisition cycle; returns the delay before the next one."""
        if self.mode == "demo":
            self._tick_demo()
            return DEMO_INTERVAL_S
        return await self._tick_live()

    # ------------------------------------------------------------------- demo
    def _tick_demo(self) -> None:
        now = utcnow()
        values = self._demo.values(time.monotonic() - self._demo_started)
        readings = readings_from_values(values, source="demo", observed_at=now)
        self._last_fresh = now
        self._publish(readings, ConnectionStatus(state="demo", last_update=now, age_seconds=0,
                                                 reason="Simulated data — not from hardware"), now)

    # ------------------------------------------------------------------- live
    async def _tick_live(self) -> float:
        now = utcnow()
        client = self._ensure_blynk()
        interval = self.settings.blynk_poll_interval
        if client is None:
            self._publish(self._last_readings or self._empty_readings(),
                          ConnectionStatus(state="offline",
                                           reason="BLYNK_TOKEN is not configured on the server"), now)
            return 5.0

        self.blynk_status.last_poll = now
        try:
            raw = await client.get_all()
            mono = time.monotonic()
            if mono - self._last_hw_check >= self.settings.blynk_connected_check_interval:
                self._hardware_connected = await client.is_hardware_connected()
                self._last_hw_check = mono
        except BlynkError as exc:
            self.blynk_status.reachable = exc.status is not None and exc.status != 429
            self.blynk_status.consecutive_failures += 1
            self.blynk_status.last_error = str(exc)
            log.warning("Blynk poll failed (%d in a row): %s",
                        self.blynk_status.consecutive_failures, exc)
            self._publish(self._last_readings or self._empty_readings(),
                          ConnectionStatus(state="offline", last_update=self._last_fresh,
                                           age_seconds=self._age(now),
                                           hardware_connected=self._hardware_connected,
                                           reason=str(exc)), now)
            if exc.retry_after:
                return exc.retry_after
            return min(30.0, interval * 2 ** min(self.blynk_status.consecutive_failures, 4))

        self.blynk_status.reachable = True
        self.blynk_status.consecutive_failures = 0
        self.blynk_status.last_error = None
        self.blynk_status.last_success = now
        self.blynk_status.hardware_connected = self._hardware_connected

        self._track_changes(raw, now)
        readings = readings_from_blynk(raw, self.pin_map, observed_at=now,
                                       changed_at=self._changed_at)
        self._last_readings = readings
        self._last_fresh = self._freshness_marker()
        self._publish(readings, self._live_connection(now), now)
        return interval

    def _track_changes(self, raw: dict[str, Any], now: datetime) -> None:
        lowered = {str(k).lower(): v for k, v in raw.items()}
        for key, pin in self.pin_map.items():
            if pin is None or key not in FIELD_BY_KEY or pin not in lowered:
                continue
            value = lowered[pin]
            if key not in self._prev_raw or self._prev_raw[key] != value:
                self._changed_at[key] = now
                self._prev_raw[key] = value

    def _freshness_marker(self) -> datetime | None:
        if self.pin_map.get("heartbeat"):
            return self._changed_at.get("heartbeat")
        return max(self._changed_at.values(), default=None)

    def _age(self, now: datetime) -> float | None:
        return None if self._last_fresh is None else max(0.0, (now - self._last_fresh).total_seconds())

    def _live_connection(self, now: datetime) -> ConnectionStatus:
        age = self._age(now)
        hw = self._hardware_connected
        state: ConnectionStateName
        if hw is False:
            state, reason = "offline", "Blynk reports the gateway device is offline"
        elif self._last_fresh is None:
            state, reason = "stale", "Blynk returned no values for the mapped datastreams"
        elif age is not None and age > self.settings.telemetry_freshness_seconds:
            marker = "heartbeat" if self.pin_map.get("heartbeat") else "any datastream"
            state, reason = "stale", f"No change in {marker} for {age:.0f} s"
        else:
            state, reason = "live", None
        return ConnectionStatus(state=state, last_update=self._last_fresh, age_seconds=age,
                                hardware_connected=hw, reason=reason)

    def _empty_readings(self) -> dict[str, Reading]:
        return readings_from_blynk({}, self.pin_map, observed_at=None, changed_at={})

    # ---------------------------------------------------------------- publish
    def build_snapshot(self, readings: dict[str, Reading], connection: ConnectionStatus,
                       now: datetime) -> TelemetrySnapshot:
        observed = now if connection.state in {"live", "demo"} else None
        accel = vector_magnitude(readings, "accel")
        gyro = vector_magnitude(readings, "gyro")
        th = self.thresholds
        derived = Derived(
            accel_magnitude=derived_reading("accel_magnitude", accel, "m/s²", observed,
                                            "needs valid accel_x, accel_y and accel_z"),
            gyro_magnitude=derived_reading("gyro_magnitude", gyro, "°/s", observed,
                                           "needs valid gyro_x, gyro_y and gyro_z"),
            dynamic_accel=derived_reading("dynamic_accel", dynamic_acceleration(readings), "m/s²",
                                          observed, "needs valid accel_x, accel_y and accel_z"),
            proximity=proximity_level(number(readings, "obstacle_distance"),
                                      th.obstacle_warning_cm, th.obstacle_critical_cm),
            risk=assess_risk(readings, th),
        )
        return TelemetrySnapshot(device_id=self.settings.lightsync_device_id, mode=self.mode,
                                 generated_at=now, connection=connection, readings=readings,
                                 derived=derived)

    def _publish(self, readings: dict[str, Reading], connection: ConnectionStatus,
                 now: datetime) -> None:
        snap = self.build_snapshot(readings, connection, now)
        self.latest = snap
        if connection.state in {"live", "demo"}:
            sample = self._sample(snap)
            self.history.append(sample)
            self._broadcast("sample", sample.model_dump(mode="json"))
            if flag(readings, "espnow_link"):
                self._espnow_last_seen = now
        for event in self.detector.process(snap, self.thresholds):
            self._add_event(event)
        self._broadcast("snapshot", snap.model_dump(mode="json"))

    def _add_event(self, event: SafetyEvent) -> None:
        self.events.append(event)
        self._broadcast("event", event.model_dump(mode="json"))

    @staticmethod
    def _sample(snap: TelemetrySnapshot) -> Sample:
        r = snap.readings
        d = snap.derived

        def val(reading: Reading) -> float | None:
            return float(reading.value) if reading.valid and not isinstance(reading.value, (bool, str)) \
                and reading.value is not None else None

        return Sample(
            t=snap.generated_at.timestamp() * 1000,
            accel=val(d.accel_magnitude), gyro=val(d.gyro_magnitude),
            ax=number(r, "accel_x"), ay=number(r, "accel_y"), az=number(r, "accel_z"),
            gx=number(r, "gyro_x"), gy=number(r, "gyro_y"), gz=number(r, "gyro_z"),
            distance=number(r, "obstacle_distance"), voltage=number(r, "battery_voltage"),
            current=number(r, "battery_current"), soc=number(r, "battery_soc"),
            soh=number(r, "battery_soh"), risk=d.risk.score,
        )

    # ------------------------------------------------------------ subscribers
    def _broadcast(self, kind: str, payload: dict[str, Any]) -> None:
        for queue in list(self._subscribers):
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait((kind, payload))

    @contextlib.asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue]:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)

    # ---------------------------------------------------------------- queries
    def history_window(self, window_seconds: float) -> list[Sample]:
        cutoff = (time.time() - window_seconds) * 1000
        return [s for s in self.history if s.t >= cutoff]

    def devices(self) -> DevicesResponse:
        snap = self.latest
        readings = snap.readings if snap else self._empty_readings()
        demo = self.mode == "demo"
        hw = self._hardware_connected
        gateway_state: Literal["online", "offline", "unknown", "demo"]
        gateway_state = "demo" if demo else ("online" if hw else "offline" if hw is False else "unknown")

        link = flag(readings, "espnow_link")
        node_state: Literal["online", "offline", "unknown", "demo"]
        if demo:
            node_state = "demo" if link else "offline"
        else:
            node_state = "online" if link else "offline" if link is False else "unknown"

        rssi = number(readings, "espnow_rssi")
        loss = number(readings, "espnow_packet_loss")
        conn = snap.connection.state if snap else "connecting"
        return DevicesResponse(
            mode=self.mode,
            devices=[
                DeviceInfo(id=self.settings.lightsync_device_id, name="LightSync gateway",
                           chip="ESP32", role="Sensor hub, ESP-NOW receiver, Blynk uplink",
                           state=gateway_state, last_seen=self._last_fresh,
                           details={"uplink": "Wi-Fi → Blynk Cloud", "telemetry": conn}),
                DeviceInfo(id=f"{self.settings.lightsync_device_id}-node", name="LightSync node",
                           chip="ESP8266", role="ESP-NOW peer (no direct Blynk connection)",
                           state=node_state, last_seen=self._espnow_last_seen,
                           details={"link": "ESP-NOW → gateway",
                                    "reported_via": "espnow_link datastream"}),
            ],
            blynk=self.blynk_status if not demo else BlynkStatus(
                configured=self.settings.blynk_configured, server=self.settings.blynk_server),
            espnow={
                "state": "unknown" if link is None else ("connected" if link else "disconnected"),
                "available": link is not None,
                "rssi_dbm": rssi,
                "packet_loss_pct": loss,
                "metrics_available": rssi is not None or loss is not None,
                "source": "demo" if demo else "blynk",
            },
        )

    def command_availability(self) -> list[CommandAvailability]:
        out = []
        for spec in COMMANDS:
            pin = self.pin_map.get(spec.key)
            state_pin = self.pin_map.get(spec.state_field)
            reason = None
            if self.mode == "demo":
                available = True
                reason = "Simulated in demo mode — no hardware is involved"
            elif not self.settings.commands_enabled:
                available, reason = False, "COMMANDS_ENABLED is false on the server"
            elif not self.settings.blynk_configured:
                available, reason = False, "BLYNK_TOKEN is not configured"
            elif pin is None:
                available, reason = False, f"PIN_{spec.key.upper()} is not set"
            elif state_pin is None:
                available, reason = False, (f"{spec.state_field} state datastream is not mapped, so "
                                            "the hardware cannot acknowledge the command")
            else:
                available = True
            out.append(CommandAvailability(key=spec.key, label=spec.label, available=available,
                                           pin=pin, state_field=spec.state_field, reason=reason))
        return out

    # --------------------------------------------------------------- commands
    async def send_command(self, key: str, value: bool) -> CommandResult:
        spec = COMMAND_BY_KEY[key]
        availability = next(c for c in self.command_availability() if c.key == key)
        requested_at = utcnow()
        cmd_id = f"cmd-{int(time.time() * 1000)}-{next(_cmd_ids)}"
        if not availability.available:
            raise CommandRejected(availability.reason or "Command unavailable")

        async with self._command_lock:
            if self.mode == "demo":
                setattr(self._demo, spec.state_field, value)
                result = CommandResult(id=cmd_id, command=key, requested_value=value,
                                       status="acknowledged", source="demo",
                                       message="Simulated acknowledgement (demo mode)",
                                       requested_at=requested_at, completed_at=utcnow())
            else:
                result = await self._send_live(cmd_id, spec.key, spec.state_field, value, requested_at)

        self.commands_log.appendleft(result)
        severity = "info" if result.status == "acknowledged" else "warning"
        self._add_event(make_event(
            "command", severity, f"{spec.label} → {'ON' if value else 'OFF'}: {result.status}",
            "demo" if self.mode == "demo" else "system", utcnow(), command=key, status=result.status))
        return result

    async def _send_live(self, cmd_id: str, key: str, state_field: str, value: bool,
                         requested_at: datetime) -> CommandResult:
        client = self._ensure_blynk()
        assert client is not None
        pin = self.pin_map[key]
        state_pin = self.pin_map[state_field]
        assert pin and state_pin
        try:
            await client.update(pin, 1 if value else 0)
        except BlynkError as exc:
            return CommandResult(id=cmd_id, command=key, requested_value=value, status="failed",
                                 source="blynk", message=f"Could not write {pin.upper()}: {exc}",
                                 requested_at=requested_at, completed_at=utcnow())

        deadline = time.monotonic() + self.settings.command_ack_timeout
        spec = FIELD_BY_KEY[state_field]
        while time.monotonic() < deadline:
            await asyncio.sleep(self._ack_poll_interval)
            try:
                raw = await client.get_all()
            except BlynkError:
                continue
            lowered = {str(k).lower(): v for k, v in raw.items()}
            if state_pin in lowered:
                try:
                    if parse_value(spec, lowered[state_pin]) == value:
                        return CommandResult(
                            id=cmd_id, command=key, requested_value=value, status="acknowledged",
                            source="blynk",
                            message=f"Hardware confirmed on {state_pin.upper()}",
                            requested_at=requested_at, completed_at=utcnow())
                except ValueError:
                    pass
        return CommandResult(
            id=cmd_id, command=key, requested_value=value, status="unconfirmed", source="blynk",
            message=(f"Request written to {pin.upper()} but the hardware did not confirm on "
                     f"{state_pin.upper()} within {self.settings.command_ack_timeout:.0f} s"),
            requested_at=requested_at, completed_at=utcnow())
