from datetime import datetime, timezone

from app.config import Thresholds
from app.datastreams import resolve_pin_map
from app.normalize import readings_from_blynk
from app.risk import assess_risk, level_for, proximity_level

NOW = datetime.now(timezone.utc)
TH = Thresholds(_env_file=None)


def readings(raw, **pin_overrides):
    return readings_from_blynk(raw, resolve_pin_map(pin_overrides), observed_at=NOW, changed_at={})


def test_levels():
    assert [level_for(s) for s in (0, 24.9, 25, 49, 50, 74, 75, 100)] == [
        "LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "CRITICAL", "CRITICAL"]


def test_proximity():
    assert proximity_level(None, 50, 20) == "unknown"
    assert proximity_level(84, 50, 20) == "clear"
    assert proximity_level(50, 50, 20) == "warning"
    assert proximity_level(20, 50, 20) == "critical"


def test_hardware_score_preferred():
    risk = assess_risk(readings({"v14": 80, "v10": 200}), TH)
    assert risk.level == "CRITICAL" and risk.source == "blynk" and "hardware" in risk.method


def test_unavailable_without_inputs():
    assert assess_risk(readings({}), TH).available is False


def test_rule_based_low_when_clear():
    risk = assess_risk(readings({"v10": 120, "v11": 0, "v12": 0, "v4": 0, "v5": 0, "v6": 9.81}), TH)
    assert risk.available and risk.level == "LOW" and risk.source == "computed" and risk.score == 0


def test_rule_based_accumulates_factors():
    risk = assess_risk(readings({"v10": 15, "v11": 1, "v12": 2}), TH)
    assert risk.score == 45 + 15 + 20 and risk.level == "CRITICAL"
    assert len(risk.factors) == 3


def test_abnormal_acceleration_counts_beyond_gravity_only():
    calm = assess_risk(readings({"v4": 0, "v5": 0, "v6": 9.81}), TH)
    hard = assess_risk(readings({"v4": 30, "v5": 0, "v6": 9.81}), TH)
    assert calm.score == 0
    assert hard.score == 30
