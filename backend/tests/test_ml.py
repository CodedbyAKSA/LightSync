import asyncio
import math

from fastapi.testclient import TestClient

from app.datastreams import resolve_pin_map
from app.main import create_app
from app.ml import extract_features, load_model, tilt_degrees
from app.normalize import readings_from_values
from app.telemetry import TelemetryService, utcnow
from tests.conftest import make_settings


def readings(**values):
    return readings_from_values(values, source="device", observed_at=utcnow())


def predict(**values):
    r = readings(**values)
    return load_model().predict(extract_features(r, values.pop("closing", 0.0)))


FLAT = dict(accel_x=0.1, accel_y=0.1, accel_z=9.8, gyro_x=1, gyro_y=1, gyro_z=2, battery_soc=80)


def test_model_loads_with_metadata():
    m = load_model()
    assert m.available, m.error
    assert m.classes == ["safe", "caution", "danger", "accident"]
    assert len(m.features) == 8
    assert m.meta["data"]["source"] == "synthetic"
    assert m.meta["metrics"]["accuracy"] > 0.9


def test_open_floor_is_safe():
    p = predict(obstacle_distance=300, obstacle_distance_rear=250, ir_left=False, ir_right=False, **FLAT)
    assert p.available and p.label == "safe"
    assert math.isclose(sum(p.probabilities.values()), 1.0, abs_tol=1e-3)


def test_close_and_closing_is_danger():
    r = readings(obstacle_distance=12, obstacle_distance_rear=200, ir_left=False, ir_right=False, **FLAT)
    p = load_model().predict(extract_features(r, 35.0))
    assert p.label == "danger"


def test_impact_spike_is_accident():
    p = predict(obstacle_distance=5, accel_x=15, accel_y=10, accel_z=25, gyro_x=150, gyro_y=90, gyro_z=60,
                battery_soc=80, ir_obstacle=False)
    assert p.label == "accident"


def test_tilt_and_missing_sensors():
    assert tilt_degrees(readings(**FLAT)) < 2
    assert 85 < tilt_degrees(readings(accel_x=9.8, accel_y=0, accel_z=0.1)) < 95
    p = predict(obstacle_distance=300)          # too little data
    assert not p.available and "not enough" in p.reason


def test_snapshot_and_api_carry_prediction():
    s = TelemetryService(make_settings(), resolve_pin_map({}))
    asyncio.run(s.tick())
    assert s.latest.derived.ml.available
    assert s.latest.derived.ml.label in {"safe", "caution", "danger", "accident"}
    with TestClient(create_app(s.settings, s, start_loop=False)) as c:
        info = c.get("/api/ml/model").json()
    assert info["available"] and info["meta"]["algorithm"].startswith("XGBoost")


def test_missing_model_is_reported_not_fatal(tmp_path):
    m = load_model(str(tmp_path / "nope.json"))
    assert not m.available and "not found" in m.error
    assert not m.predict({"front_cm": 10}).available
