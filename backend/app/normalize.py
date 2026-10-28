"""Turn raw Blynk / demo values into validated ``Reading`` objects.

Rules (all covered by tests):

* A field with no pin mapped is ``available=False`` ("not mapped").
* A mapped pin that Blynk returned no value for is ``available=False``.
  Blynk's ``getAll`` only lists datastreams that have a stored value.
* A value that cannot be parsed or is outside the field's range is
  ``available=True, valid=False, value=None``. It is never replaced by a guess.
* ``0`` is a genuine reading and stays distinct from "unavailable".
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Mapping

from .datastreams import FIELDS, FieldSpec
from .schemas import Reading, Source

GRAVITY = 9.80665

_TRUE = {"1", "true", "on", "yes", "detected"}
_FALSE = {"0", "false", "off", "no", "clear"}


class ParseError(ValueError):
    pass


def _as_float(raw: Any) -> float:
    if isinstance(raw, bool):
        return float(raw)
    if isinstance(raw, (int, float)):
        value = float(raw)
    elif isinstance(raw, str):
        try:
            value = float(raw.strip())
        except ValueError as exc:
            raise ParseError(f"not a number: {raw[:40]!r}") from exc
    elif isinstance(raw, list) and len(raw) == 1:
        return _as_float(raw[0])
    else:
        raise ParseError(f"unsupported type {type(raw).__name__}")
    if not math.isfinite(value):
        raise ParseError("not a finite number")
    return value


def parse_value(spec: FieldSpec, raw: Any) -> float | bool | str:
    if spec.kind == "number":
        value = _as_float(raw)
        if isinstance(raw, bool):
            raise ParseError("boolean where a number was expected")
        if spec.minimum is not None and value < spec.minimum:
            raise ParseError(f"{value:g} below minimum {spec.minimum:g}")
        if spec.maximum is not None and value > spec.maximum:
            raise ParseError(f"{value:g} above maximum {spec.maximum:g}")
        return value
    if spec.kind == "bool":
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str) and raw.strip().lower() in _TRUE | _FALSE:
            return raw.strip().lower() in _TRUE
        value = _as_float(raw)
        if value in (0.0, 1.0):
            return value == 1.0
        raise ParseError(f"expected 0 or 1, got {value:g}")
    if spec.kind == "state":
        assert spec.states is not None
        if isinstance(raw, bool):
            return spec.states[max(spec.states)] if raw else spec.states[min(spec.states)]
        if isinstance(raw, str) and raw.strip().lower() in spec.states.values():
            return raw.strip().lower()
        value = _as_float(raw)
        if value.is_integer() and int(value) in spec.states:
            return spec.states[int(value)]
        raise ParseError(f"unknown state code {raw!r}")
    raise ParseError(f"unknown field kind {spec.kind}")


def build_reading(
    spec: FieldSpec,
    *,
    present: bool,
    raw: Any,
    source: Source,
    pin: str | None,
    observed_at: datetime | None,
    changed_at: datetime | None,
    unavailable_reason: str | None = None,
) -> Reading:
    base = dict(field=spec.key, unit=spec.unit, source=source, pin=pin)
    if not present:
        return Reading(**base, available=False, valid=False, reason=unavailable_reason)
    try:
        value = parse_value(spec, raw)
    except ParseError as exc:
        return Reading(**base, available=True, valid=False, observed_at=observed_at,
                       changed_at=changed_at, reason=f"invalid value: {exc}")
    return Reading(**base, value=value, available=True, valid=True,
                   observed_at=observed_at, changed_at=changed_at)


def readings_from_blynk(
    raw: Mapping[str, Any],
    pin_map: Mapping[str, str | None],
    *,
    observed_at: datetime | None,
    changed_at: Mapping[str, datetime],
) -> dict[str, Reading]:
    lowered = {str(k).lower(): v for k, v in raw.items()}
    readings: dict[str, Reading] = {}
    for spec in FIELDS:
        pin = pin_map.get(spec.key)
        if pin is None:
            readings[spec.key] = build_reading(
                spec, present=False, raw=None, source="blynk", pin=None, observed_at=None,
                changed_at=None, unavailable_reason="not mapped to a Blynk datastream")
            continue
        present = pin in lowered
        readings[spec.key] = build_reading(
            spec, present=present, raw=lowered.get(pin), source="blynk", pin=pin,
            observed_at=observed_at if present else None, changed_at=changed_at.get(spec.key),
            unavailable_reason=f"Blynk has no stored value for {pin.upper()}")
    return readings


def readings_from_values(
    values: Mapping[str, Any], *, source: Source, observed_at: datetime,
    changed_at: Mapping[str, datetime] | None = None,
) -> dict[str, Reading]:
    """Build readings straight from logical field values (used by demo mode)."""
    changed_at = changed_at or {}
    return {
        spec.key: build_reading(
            spec, present=spec.key in values, raw=values.get(spec.key), source=source, pin=None,
            observed_at=observed_at, changed_at=changed_at.get(spec.key, observed_at),
            unavailable_reason="not simulated")
        for spec in FIELDS
    }


def number(readings: Mapping[str, Reading], key: str) -> float | None:
    r = readings.get(key)
    if r is None or not r.valid or isinstance(r.value, bool) or not isinstance(r.value, (int, float)):
        return None
    return float(r.value)


def flag(readings: Mapping[str, Reading], key: str) -> bool | None:
    r = readings.get(key)
    if r is None or not r.valid or not isinstance(r.value, bool):
        return None
    return r.value


def state(readings: Mapping[str, Reading], key: str) -> str | None:
    r = readings.get(key)
    if r is None or not r.valid or not isinstance(r.value, str):
        return None
    return r.value


def vector_magnitude(readings: Mapping[str, Reading], prefix: str) -> float | None:
    """Euclidean norm of the X/Y/Z axes; ``None`` unless all three are valid."""
    axes = [number(readings, f"{prefix}_{axis}") for axis in "xyz"]
    if any(a is None for a in axes):
        return None
    return math.sqrt(sum(a * a for a in axes))  # type: ignore[operator]


def derived_reading(field: str, value: float | None, unit: str, observed_at: datetime | None,
                    reason: str) -> Reading:
    if value is None:
        return Reading(field=field, unit=unit, source="computed", available=False, valid=False,
                       reason=reason)
    return Reading(field=field, value=round(value, 3), unit=unit, source="computed",
                   available=True, valid=True, observed_at=observed_at)
