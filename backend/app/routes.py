from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from . import __version__
from .config import Thresholds
from .datastreams import COMMANDS, FIELDS
from .schemas import (
    AutonomousCommand,
    CommandResult,
    ConfigResponse,
    DatastreamInfo,
    DeviceIngestResponse,
    DevicesResponse,
    EmergencyStopCommand,
    EventsResponse,
    HealthResponse,
    HistoryResponse,
    MlModelInfo,
    ModeUpdate,
    TelemetrySnapshot,
    ThresholdsModel,
)
from .security import command_limiter, config_limiter, device_guard, operator_guard
from .telemetry import CommandRejected, DeviceRejected, TelemetryService

router = APIRouter(prefix="/api")

SSE_KEEPALIVE_S = 15.0
MAX_DEVICE_FIELDS = 64


def svc(request: Request) -> TelemetryService:
    return request.app.state.telemetry


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    s = svc(request)
    return HealthResponse(status="ok", version=__version__, mode=s.mode,
                          connection=s.latest.connection.state if s.latest else "connecting",
                          blynk_configured=s.settings.blynk_configured)


@router.get("/telemetry/latest", response_model=TelemetrySnapshot)
def latest(request: Request) -> TelemetrySnapshot:
    s = svc(request)
    if s.latest is None:
        raise HTTPException(503, detail="No telemetry yet; the first acquisition is in progress")
    return s.latest


@router.get("/telemetry/history", response_model=HistoryResponse)
def history(request: Request,
            window_seconds: float = Query(60, ge=10, le=86400)) -> HistoryResponse:
    s = svc(request)
    return HistoryResponse(mode=s.mode, window_seconds=window_seconds,
                           max_samples=s.settings.history_max_samples,
                           samples=s.history_window(window_seconds))


@router.get("/telemetry/stream")
async def stream(request: Request) -> StreamingResponse:
    """Server-Sent Events: ``snapshot``, ``sample``, ``event`` and ``reset`` messages."""
    s = svc(request)

    async def gen():
        async with s.subscribe() as queue:
            yield "retry: 3000\n\n"
            if s.latest is not None:
                yield _sse("snapshot", s.latest.model_dump(mode="json"))
            while True:
                if await request.is_disconnected():
                    break
                try:
                    kind, payload = await asyncio.wait_for(queue.get(), timeout=SSE_KEEPALIVE_S)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield _sse(kind, payload)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _sse(kind: str, payload: dict) -> str:
    return f"event: {kind}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


@router.post("/device/telemetry", response_model=DeviceIngestResponse,
             dependencies=[device_guard()])
def device_telemetry(request: Request,
                     body: dict[str, Any] = Body(..., examples=[{
                         "obstacle_distance": 42.5, "ir_obstacle": 0, "accel_z": 9.79,
                         "emergency_stop": 0, "heartbeat": 17}])) -> DeviceIngestResponse:
    """Telemetry pushed by the car: a flat JSON object of LightSync field keys."""
    if len(body) > MAX_DEVICE_FIELDS:
        raise HTTPException(413, detail=f"At most {MAX_DEVICE_FIELDS} fields per post")
    s = svc(request)
    try:
        accepted, ignored = s.ingest_device(body)
    except DeviceRejected as exc:
        raise HTTPException(exc.status_code, detail=str(exc)) from exc
    return DeviceIngestResponse(status="accepted", accepted=accepted, ignored=ignored,
                                received=s.device_posts)


@router.get("/ml/model", response_model=MlModelInfo)
def ml_model(request: Request) -> MlModelInfo:
    """The XGBoost risk model: features, classes, test metrics and how its data was synthesized."""
    model = svc(request).ml_model
    return MlModelInfo(available=model.available, reason=model.error, meta=model.meta)


@router.get("/devices/status", response_model=DevicesResponse)
def devices(request: Request) -> DevicesResponse:
    return svc(request).devices()


@router.get("/events", response_model=EventsResponse)
def events(request: Request,
           severity: Literal["info", "warning", "critical"] | None = None,
           source: Literal["blynk", "device", "demo", "system", "computed"] | None = None,
           q: str | None = Query(None, max_length=100),
           limit: int = Query(200, ge=1, le=1000)) -> EventsResponse:
    s = svc(request)
    items = list(reversed(s.events))
    if severity:
        items = [e for e in items if e.severity == severity]
    if source:
        items = [e for e in items if e.source == source]
    if q:
        needle = q.lower()
        items = [e for e in items if needle in e.message.lower() or needle in e.type.lower()]
    return EventsResponse(mode=s.mode, total=len(items), events=items[:limit])


def _config(s: TelemetryService) -> ConfigResponse:
    return ConfigResponse(
        mode=s.mode,
        live_source=s.settings.lightsync_live_source,
        device_id=s.settings.lightsync_device_id,
        poll_interval=s.settings.blynk_poll_interval if s.mode == "live" and not s.device_source else 1.0,
        freshness_seconds=s.settings.telemetry_freshness_seconds,
        history_max_samples=s.settings.history_max_samples,
        thresholds=ThresholdsModel(**s.thresholds.model_dump()),
        datastreams=[
            DatastreamInfo(key=f.key, label=f.label, kind=f.kind, group=f.group, unit=f.unit,
                           pin=s.pin_map.get(f.key), default_pin=f.default_pin,
                           mapped=s.pin_map.get(f.key) is not None, description=f.description)
            for f in FIELDS
        ] + [
            DatastreamInfo(key=c.key, label=c.label, kind="command", group="commands", unit=None,
                           pin=s.pin_map.get(c.key), default_pin=c.default_pin,
                           mapped=s.pin_map.get(c.key) is not None,
                           description=f"Write-only request pin; hardware confirms on {c.state_field}")
            for c in COMMANDS
        ],
        commands=s.command_availability(),
        commands_enabled=s.settings.commands_enabled,
        blynk_configured=s.settings.blynk_configured,
        blynk_server=s.settings.blynk_server,
        device_key_configured=s.settings.device_key_configured,
        operator_key_configured=s.settings.lightsync_api_key is not None,
        operator_auth_required=s.settings.lightsync_api_key is not None or s.mode == "live",
        config_errors=s.config_errors,
    )


@router.get("/config", response_model=ConfigResponse)
def get_config(request: Request) -> ConfigResponse:
    return _config(svc(request))


@router.put("/config/thresholds", response_model=ConfigResponse,
            dependencies=[operator_guard(config_limiter)])
def put_thresholds(request: Request, body: ThresholdsModel) -> ConfigResponse:
    s = svc(request)
    try:
        s.thresholds = Thresholds(**body.model_dump())
    except ValidationError as exc:
        raise HTTPException(422, detail=[e["msg"] for e in exc.errors()]) from exc
    return _config(s)


@router.put("/config/mode", response_model=ConfigResponse,
            dependencies=[operator_guard(config_limiter)])
async def put_mode(request: Request, body: ModeUpdate) -> ConfigResponse:
    s = svc(request)
    if body.mode != s.mode:
        await s.set_mode(body.mode)
    return _config(s)


@router.get("/commands/history", response_model=list[CommandResult])
def command_history(request: Request) -> list[CommandResult]:
    return list(svc(request).commands_log)


async def _command(request: Request, key: str, value: bool) -> CommandResult:
    try:
        return await svc(request).send_command(key, value)
    except CommandRejected as exc:
        raise HTTPException(exc.status_code, detail=str(exc)) from exc


@router.post("/commands/autonomous-mode", response_model=CommandResult,
             dependencies=[operator_guard(command_limiter)])
async def cmd_autonomous(request: Request, body: AutonomousCommand) -> CommandResult:
    return await _command(request, "cmd_autonomous_mode", body.enabled)


@router.post("/commands/emergency-stop", response_model=CommandResult,
             dependencies=[operator_guard(command_limiter)])
async def cmd_emergency_stop(request: Request, body: EmergencyStopCommand) -> CommandResult:
    return await _command(request, "cmd_emergency_stop", body.active)
