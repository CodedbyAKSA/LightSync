import math
from datetime import datetime, timezone

import pytest

from app.datastreams import FIELD_BY_KEY, resolve_pin_map
from app.normalize import ParseError, parse_value, readings_from_blynk, vector_magnitude

NOW = datetime(2026, 10, 27, 11, 24, 18, tzinfo=timezone.utc)


def read(raw, pins=None):
    return readings_from_blynk(raw, pins or resolve_pin_map({}), observed_at=NOW, changed_at={})


def test_unmapped_field_is_unavailable_not_zero():
    r = read({})["bluetooth_link"]
    assert r.available is False and r.value is None and "not mapped" in r.reason


def test_mapped_pin_without_value_is_unavailable():
    r = read({"v1": 2})["battery_voltage"]
    assert r.available is False and r.pin == "v0" and "V0" in r.reason


def test_zero_is_a_genuine_reading():
    r = read({"v1": 0})["battery_current"]
    assert r.available and r.valid and r.value == 0.0


def test_out_of_range_is_invalid_and_not_replaced():
    r = read({"v2": 140})["battery_soc"]
    assert r.available and not r.valid and r.value is None and "above maximum" in r.reason


def test_garbage_and_nan_rejected():
    assert not read({"v0": "abc"})["battery_voltage"].valid
    assert not read({"v0": "nan"})["battery_voltage"].valid


def test_pin_keys_are_case_insensitive_and_strings_parse():
    r = read({"V0": "12.40"})["battery_voltage"]
    assert r.valid and r.value == pytest.approx(12.4) and r.unit == "V"


@pytest.mark.parametrize("raw,expected", [(1, True), (0, False), ("1", True), ("false", False),
                                          (True, True), (1.0, True)])
def test_bool_parsing(raw, expected):
    assert parse_value(FIELD_BY_KEY["ir_obstacle"], raw) is expected


def test_bool_rejects_other_numbers():
    with pytest.raises(ParseError):
        parse_value(FIELD_BY_KEY["ir_obstacle"], 2)


@pytest.mark.parametrize("raw,expected", [(0, "normal"), (1, "warning"), (2, "active"),
                                          (True, "active"), ("warning", "warning")])
def test_vibration_states(raw, expected):
    assert parse_value(FIELD_BY_KEY["vibration"], raw) == expected


def test_number_rejects_boolean():
    with pytest.raises(ParseError):
        parse_value(FIELD_BY_KEY["battery_voltage"], True)


def test_vector_magnitude_requires_all_axes():
    full = read({"v4": 3, "v5": 4, "v6": 0})
    assert vector_magnitude(full, "accel") == pytest.approx(5.0)
    partial = read({"v4": 3, "v5": 4})
    assert vector_magnitude(partial, "accel") is None
    assert math.isclose(vector_magnitude(read({"v7": 1, "v8": 2, "v9": 2}), "gyro"), 3.0)
