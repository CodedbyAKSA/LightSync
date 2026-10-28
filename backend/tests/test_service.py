import asyncio
from datetime import timedelta

import pytest

from app.datastreams import resolve_pin_map
from app.telemetry import CommandRejected, TelemetryService
from tests.conftest import FULL_VALUES, TOKEN, FakeBlynk, live_service, make_settings


def demo_service(**overrides) -> TelemetryService:
    return TelemetryService(make_settings(**overrides), resolve_pin_map({}))


def test_demo_snapshot_is_labelled_demo():
    s = demo_service()
    asyncio.run(s.tick())
    snap = s.latest
    assert snap.mode == "demo" and snap.connection.state == "demo"
    assert all(r.source == "demo" for r in snap.readings.values())
    assert snap.readings["battery_voltage"].valid
    assert snap.readings["bluetooth_link"].available is False  # not simulated either


def test_history_buffer_is_bounded():
    s = demo_service(history_max_samples=60)
    for _ in range(150):
        asyncio.run(s.tick())
    assert len(s.history) == 60


def test_mode_switch_discards_demo_data():
    s = demo_service()
    for _ in range(5):
        asyncio.run(s.tick())
    asyncio.run(s.set_mode("live"))
    assert s.mode == "live" and len(s.history) == 0 and len(s.events) == 0 and s.latest is None


def test_live_without_token_is_offline_and_never_falls_back_to_demo():
    s = TelemetryService(make_settings(lightsync_mode="live"), resolve_pin_map({}))
    asyncio.run(s.tick())
    assert s.latest.connection.state == "offline"
    assert "BLYNK_TOKEN" in s.latest.connection.reason
    assert all(not r.available for r in s.latest.readings.values())
    assert len(s.history) == 0


def test_live_poll_normalizes_and_marks_missing_streams_unavailable():
    fake = FakeBlynk({k: v for k, v in FULL_VALUES.items() if k != "v13"})
    s = live_service(fake)
    asyncio.run(s.tick())
    snap = s.latest
    assert snap.connection.state == "live" and snap.connection.hardware_connected is True
    assert snap.readings["obstacle_distance"].value == 84 and snap.readings["obstacle_distance"].source == "blynk"
    assert snap.readings["drowsiness"].available is False
    assert snap.derived.risk.source == "blynk"  # v14 present
    assert len(s.history) == 1


def test_live_goes_stale_when_values_stop_changing():
    fake = FakeBlynk(FULL_VALUES)
    s = live_service(fake, telemetry_freshness_seconds=5)
    asyncio.run(s.tick())
    for key in s._changed_at:
        s._changed_at[key] -= timedelta(seconds=30)
    asyncio.run(s.tick())
    assert s.latest.connection.state == "stale"
    assert len(s.history) == 1  # stale polls are not charted


def test_heartbeat_is_preferred_freshness_signal():
    pins = resolve_pin_map({"PIN_HEARTBEAT": "V22"})
    fake = FakeBlynk({**FULL_VALUES, "v22": 1})
    s = live_service(fake, pins, telemetry_freshness_seconds=5)
    asyncio.run(s.tick())
    s._changed_at["heartbeat"] -= timedelta(seconds=30)
    fake.values["v10"] = 50  # other values change, heartbeat does not
    asyncio.run(s.tick())
    assert s.latest.connection.state == "stale"
    assert "heartbeat" in s.latest.connection.reason


def test_hardware_reported_offline():
    s = live_service(FakeBlynk(FULL_VALUES, connected=False))
    asyncio.run(s.tick())
    assert s.latest.connection.state == "offline"


def test_api_failure_is_offline_with_backoff_and_sanitized_reason():
    fake = FakeBlynk(FULL_VALUES)
    fake.fail_status = 500
    s = live_service(fake)
    delay = asyncio.run(s.tick())
    assert s.latest.connection.state == "offline"
    assert TOKEN not in s.latest.connection.reason
    assert delay > s.settings.blynk_poll_interval
    assert s.blynk_status.consecutive_failures == 1


def test_espnow_loss_raises_critical_event():
    fake = FakeBlynk(FULL_VALUES)
    s = live_service(fake)
    asyncio.run(s.tick())
    fake.values["v15"] = 0
    asyncio.run(s.tick())
    types = [e.type for e in s.events]
    assert "espnow_lost" in types
    lost = next(e for e in s.events if e.type == "espnow_lost")
    assert lost.severity == "critical" and lost.source == "blynk"


def test_demo_command_is_simulated():
    s = demo_service()
    result = asyncio.run(s.send_command("cmd_emergency_stop", True))
    assert result.status == "acknowledged" and result.source == "demo"
    asyncio.run(s.tick())
    assert s.latest.readings["emergency_stop"].value is True


def test_live_commands_disabled_by_default():
    s = live_service(FakeBlynk(FULL_VALUES))
    with pytest.raises(CommandRejected, match="COMMANDS_ENABLED"):
        asyncio.run(s.send_command("cmd_emergency_stop", True))


def test_live_command_requires_command_pin():
    s = live_service(FakeBlynk(FULL_VALUES), commands_enabled=True)
    with pytest.raises(CommandRejected, match="PIN_CMD_EMERGENCY_STOP"):
        asyncio.run(s.send_command("cmd_emergency_stop", True))


def test_live_command_acknowledged_when_hardware_confirms():
    pins = resolve_pin_map({"PIN_CMD_EMERGENCY_STOP": "V20"})
    fake = FakeBlynk(FULL_VALUES)

    def firmware(pin, value):  # hardware applies the request and reports state
        if pin == "v20":
            fake.values["v18"] = int(value)

    fake.on_update = firmware
    s = live_service(fake, pins, commands_enabled=True)
    result = asyncio.run(s.send_command("cmd_emergency_stop", True))
    assert result.status == "acknowledged" and "V18" in result.message


def test_live_command_unconfirmed_without_hardware_ack():
    pins = resolve_pin_map({"PIN_CMD_EMERGENCY_STOP": "V20"})
    s = live_service(FakeBlynk(FULL_VALUES), pins, commands_enabled=True, command_ack_timeout=1)
    result = asyncio.run(s.send_command("cmd_emergency_stop", True))
    assert result.status == "unconfirmed"


def test_obstacle_events_only_on_escalation():
    fake = FakeBlynk({**FULL_VALUES, "v14": None})
    del fake.values["v14"]
    s = live_service(fake)
    for distance in (120, 40, 15, 30, 45, 120):
        fake.values["v10"] = distance
        asyncio.run(s.tick())
    kinds = [(e.type, e.severity) for e in s.events if e.type.startswith("obstacle")]
    assert kinds == [("obstacle_detected", "warning"), ("obstacle_detected", "critical"),
                     ("obstacle_cleared", "info")]
