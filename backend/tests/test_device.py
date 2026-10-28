import asyncio
from datetime import timedelta

from fastapi.testclient import TestClient

from app.datastreams import resolve_pin_map
from app.main import create_app
from app.telemetry import TelemetryService
from tests.conftest import make_settings

DEVICE_KEY = "car-key-xyz"
CAR_POST = {"obstacle_distance": 42.5, "ir_obstacle": 0, "accel_x": 0.1, "accel_y": 0.2,
            "accel_z": 9.8, "gyro_x": 1, "gyro_y": 2, "gyro_z": 3, "lcd_status": 1,
            "autonomous_mode": 1, "emergency_stop": 0, "heartbeat": 1}


def device_service(**overrides) -> TelemetryService:
    base = dict(lightsync_mode="live", lightsync_live_source="device",
                lightsync_device_key=DEVICE_KEY)
    base.update(overrides)
    return TelemetryService(make_settings(**base), resolve_pin_map({}))


def client_for(service: TelemetryService) -> TestClient:
    asyncio.run(service.tick())
    return TestClient(create_app(service.settings, service, start_loop=False))


def post(c: TestClient, body: dict, key: str | None = DEVICE_KEY):
    headers = {"X-Device-Key": key} if key is not None else {}
    return c.post("/api/device/telemetry", json=body, headers=headers)


def test_offline_until_the_car_posts():
    s = device_service()
    asyncio.run(s.tick())
    assert s.latest.connection.state == "offline"
    assert "/api/device/telemetry" in s.latest.connection.reason
    assert len(s.history) == 0


def test_post_publishes_live_snapshot_with_device_source():
    s = device_service()
    with client_for(s) as c:
        r = post(c, {**CAR_POST, "rear_distance": 12})
        assert r.status_code == 200
        body = r.json()
        assert body["ignored"] == ["rear_distance"] and "obstacle_distance" in body["accepted"]
        snap = c.get("/api/telemetry/latest").json()
    assert snap["connection"]["state"] == "live"
    dist = snap["readings"]["obstacle_distance"]
    assert dist["value"] == 42.5 and dist["source"] == "device"
    battery = snap["readings"]["battery_voltage"]
    assert battery["available"] is False and "car firmware" in battery["reason"]
    assert len(s.history) == 1


def test_invalid_value_is_flagged_not_guessed():
    s = device_service()
    with client_for(s) as c:
        assert post(c, {**CAR_POST, "obstacle_distance": 5000}).status_code == 200
    r = s.latest.readings["obstacle_distance"]
    assert r.available and not r.valid and r.value is None


def test_events_from_car_are_tagged_device():
    s = device_service()
    with client_for(s) as c:
        post(c, CAR_POST)
        post(c, {**CAR_POST, "emergency_stop": 1})
    estop = [e for e in s.events if e.type == "emergency_stop"]
    assert estop and estop[0].source == "device"


def test_goes_stale_when_the_car_stops_posting():
    s = device_service()
    with client_for(s) as c:
        post(c, CAR_POST)
    s._device_received_at -= timedelta(seconds=60)
    s._last_fresh -= timedelta(seconds=60)
    asyncio.run(s.tick())
    assert s.latest.connection.state == "stale"
    assert len(s.history) == 1  # stale ticks never add samples
    assert s.devices().devices[0].state == "offline"


def test_device_key_required_and_checked():
    with client_for(device_service()) as c:
        assert post(c, CAR_POST, key=None).status_code == 401
        assert post(c, CAR_POST, key="wrong").status_code == 401
    with client_for(device_service(lightsync_device_key=None)) as c:
        assert post(c, CAR_POST).status_code == 403


def test_rejected_when_server_not_in_device_mode():
    with client_for(device_service(lightsync_mode="demo")) as c:
        r = post(c, CAR_POST)
        assert r.status_code == 409 and "LIGHTSYNC_MODE=live" in r.json()["detail"]
    with client_for(device_service(lightsync_live_source="blynk")) as c:
        r = post(c, CAR_POST)
        assert r.status_code == 409 and "LIGHTSYNC_LIVE_SOURCE" in r.json()["detail"]


def test_too_many_fields_rejected():
    with client_for(device_service()) as c:
        assert post(c, {f"k{i}": i for i in range(65)}).status_code == 413


def test_config_and_devices_describe_device_source():
    s = device_service()
    with client_for(s) as c:
        post(c, CAR_POST)
        cfg = c.get("/api/config").json()
        devices = c.get("/api/devices/status").json()
    assert cfg["live_source"] == "device" and cfg["device_key_configured"] is True
    assert DEVICE_KEY not in str(cfg)
    assert all(not cmd["available"] for cmd in cfg["commands"])
    assert [d["name"] for d in devices["devices"]] == ["LightSync car"]
    assert devices["devices"][0]["state"] == "online"
