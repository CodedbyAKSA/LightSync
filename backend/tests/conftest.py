from __future__ import annotations

import json
from typing import Any, Callable

import httpx
import pytest

from app.config import Settings
from app.datastreams import resolve_pin_map
from app.security import command_limiter, config_limiter
from app.telemetry import TelemetryService

TOKEN = "TEST-TOKEN-abc123-secret"


def make_settings(**overrides: Any) -> Settings:
    base = dict(lightsync_mode="demo", blynk_token=None, lightsync_api_key=None,
                history_max_samples=60, telemetry_freshness_seconds=15)
    base.update(overrides)
    return Settings(_env_file=None, **base)


class FakeBlynk:
    """In-memory stand-in for the Blynk HTTPS API, served via httpx.MockTransport."""

    def __init__(self, values: dict[str, Any] | None = None, connected: bool = True):
        self.values: dict[str, Any] = dict(values or {})
        self.connected = connected
        self.fail_status: int | None = None
        self.requests: list[httpx.Request] = []
        self.on_update: Callable[[str, str], None] | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail_status:
            return httpx.Response(self.fail_status, json={"error": {"message": f"boom {TOKEN}"}})
        params = dict(request.url.params)
        if params.get("token") != TOKEN:
            return httpx.Response(400, json={"error": {"message": "Invalid token."}})
        path = request.url.path
        if path.endswith("/getAll"):
            return httpx.Response(200, content=json.dumps(self.values))
        if path.endswith("/isHardwareConnected"):
            return httpx.Response(200, text="true" if self.connected else "false")
        if path.endswith("/update"):
            for key, value in params.items():
                if key != "token":
                    self.values[key] = int(value) if value.isdigit() else value
                    if self.on_update:
                        self.on_update(key, value)
            return httpx.Response(200, text="")
        return httpx.Response(404)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


FULL_VALUES = {
    "v0": 12.4, "v1": 1.8, "v2": 92, "v3": 90, "v4": 0.1, "v5": 0.2, "v6": 9.8,
    "v7": 1, "v8": 2, "v9": 3, "v10": 84, "v11": 0, "v12": 0, "v13": 0, "v14": 10,
    "v15": 1, "v16": 1, "v17": 1, "v18": 0,
}


@pytest.fixture(autouse=True)
def _reset_limiters():
    command_limiter._hits.clear()
    config_limiter._hits.clear()
    yield


@pytest.fixture
def default_pins() -> dict[str, str | None]:
    return resolve_pin_map({})


def live_service(fake: FakeBlynk, pins: dict[str, str | None] | None = None,
                 **overrides: Any) -> TelemetryService:
    settings = make_settings(lightsync_mode="live", blynk_token=TOKEN, **overrides)
    return TelemetryService(settings, pins or resolve_pin_map({}),
                            blynk_transport=fake.transport, ack_poll_interval=0.01)
