import asyncio

import pytest
from fastapi.testclient import TestClient

from app.datastreams import resolve_pin_map
from app.main import create_app
from app.routes import _sse
from app.telemetry import TelemetryService
from tests.conftest import FULL_VALUES, TOKEN, FakeBlynk, live_service, make_settings


def client_for(service: TelemetryService) -> TestClient:
    asyncio.run(service.tick())
    return TestClient(create_app(service.settings, service, start_loop=False))


@pytest.fixture
def demo_client():
    service = TelemetryService(make_settings(), resolve_pin_map({}))
    with client_for(service) as c:
        yield c


def test_health(demo_client):
    body = demo_client.get("/api/health").json()
    assert body["status"] == "ok" and body["mode"] == "demo" and body["connection"] == "demo"


def test_latest_and_history(demo_client):
    snap = demo_client.get("/api/telemetry/latest").json()
    assert snap["mode"] == "demo" and "battery_voltage" in snap["readings"]
    hist = demo_client.get("/api/telemetry/history", params={"window_seconds": 60}).json()
    assert hist["max_samples"] == 60 and len(hist["samples"]) == 1


def test_history_window_validated(demo_client):
    assert demo_client.get("/api/telemetry/history", params={"window_seconds": 1}).status_code == 422


def test_devices_and_events(demo_client):
    devices = demo_client.get("/api/devices/status").json()
    assert [d["chip"] for d in devices["devices"]] == ["ESP32", "ESP8266"]
    events = demo_client.get("/api/events", params={"severity": "critical"}).json()
    assert all(e["severity"] == "critical" for e in events["events"])


def test_demo_command_without_key_allowed_when_no_key_configured(demo_client):
    r = demo_client.post("/api/commands/autonomous-mode", json={"enabled": False})
    assert r.status_code == 200 and r.json()["source"] == "demo"


def test_command_validation(demo_client):
    assert demo_client.post("/api/commands/emergency-stop", json={"active": "maybe"}).status_code == 422


def test_command_rate_limited(demo_client):
    codes = [demo_client.post("/api/commands/autonomous-mode", json={"enabled": True}).status_code
             for _ in range(12)]
    assert codes[:10] == [200] * 10 and codes[-1] == 429


def test_live_commands_need_configured_key():
    service = live_service(FakeBlynk(FULL_VALUES), commands_enabled=True)
    with client_for(service) as c:
        r = c.post("/api/commands/emergency-stop", json={"active": True})
        assert r.status_code == 403


def test_live_commands_reject_wrong_key_and_unsupported_pins():
    service = live_service(FakeBlynk(FULL_VALUES), commands_enabled=True, lightsync_api_key="op-key")
    with client_for(service) as c:
        assert c.post("/api/commands/emergency-stop", json={"active": True},
                      headers={"X-API-Key": "wrong"}).status_code == 401
        r = c.post("/api/commands/emergency-stop", json={"active": True},
                   headers={"X-API-Key": "op-key"})
        assert r.status_code == 409 and "PIN_CMD_EMERGENCY_STOP" in r.json()["detail"]


def test_config_never_exposes_secrets():
    service = live_service(FakeBlynk(FULL_VALUES), lightsync_api_key="op-key-secret")
    with client_for(service) as c:
        text = c.get("/api/config").text
        assert TOKEN not in text and "op-key-secret" not in text
        body = c.get("/api/config").json()
        assert body["blynk_configured"] is True and body["operator_auth_required"] is True
        latest = c.get("/api/telemetry/latest").text
        assert TOKEN not in latest


def test_thresholds_update_and_validation(demo_client):
    cfg = demo_client.get("/api/config").json()["thresholds"]
    ok = demo_client.put("/api/config/thresholds", json={**cfg, "obstacle_warning_cm": 60})
    assert ok.status_code == 200 and ok.json()["thresholds"]["obstacle_warning_cm"] == 60
    bad = demo_client.put("/api/config/thresholds",
                          json={**cfg, "obstacle_warning_cm": 10, "obstacle_critical_cm": 20})
    assert bad.status_code == 422


def test_mode_switch_endpoint(demo_client):
    r = demo_client.put("/api/config/mode", json={"mode": "live"})
    assert r.status_code == 200 and r.json()["mode"] == "live"
    # Live mode with no key configured: further operator actions are refused.
    assert demo_client.put("/api/config/mode", json={"mode": "demo"}).status_code == 403


def test_sse_format():
    assert _sse("snapshot", {"a": 1}) == 'event: snapshot\ndata: {"a":1}\n\n'
