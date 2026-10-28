import pytest

from app.datastreams import PinConfigError, normalize_pin, resolve_pin_map


@pytest.mark.parametrize("raw,expected", [
    ("V0", "v0"), ("v10", "v10"), (" V255 ", "v255"), ("none", None), ("", None), (None, None),
])
def test_normalize_pin(raw, expected):
    assert normalize_pin(raw) == expected


@pytest.mark.parametrize("raw", ["D5", "V256", "A0", "10", "V1;"])
def test_normalize_pin_rejects_bad_values(raw):
    with pytest.raises(PinConfigError):
        normalize_pin(raw)


def test_defaults_are_suggested_pins_and_optional_fields_unmapped():
    pins = resolve_pin_map({})
    assert pins["battery_voltage"] == "v0"
    assert pins["emergency_stop"] == "v18"
    assert pins["bluetooth_link"] is None
    assert pins["heartbeat"] is None
    assert pins["cmd_emergency_stop"] is None


def test_env_overrides_and_unmapping():
    pins = resolve_pin_map({"PIN_BATTERY_VOLTAGE": "V30", "pin_drowsiness": "none",
                            "PIN_HEARTBEAT": "V22"})
    assert pins["battery_voltage"] == "v30"
    assert pins["drowsiness"] is None
    assert pins["heartbeat"] == "v22"


def test_duplicate_pins_rejected_including_command_equal_to_state_pin():
    with pytest.raises(PinConfigError, match="V18"):
        resolve_pin_map({"PIN_CMD_EMERGENCY_STOP": "V18"})
