"""XGBoost accident-risk prediction from live telemetry.

The model is trained offline by ``ml/train.py`` on synthetic data (see
``ml/README.md``). This module turns a snapshot's readings into the same eight
features the model was trained on and returns class probabilities. Missing
sensors are passed as NaN, which XGBoost handles natively (the training data
contains deliberate dropouts for exactly this reason).

If xgboost is not installed or the model file is missing, predictions are
reported as unavailable with a reason; nothing else in the backend depends on it.
"""

from __future__ import annotations

import json
import logging
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from .normalize import GRAVITY, flag, number, vector_magnitude
from .risk import dynamic_acceleration
from .schemas import MlPrediction, Reading

log = logging.getLogger("lightsync.ml")

REPO_DIR = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_PATH = REPO_DIR / "ml" / "models" / "risk_xgb.json"


def tilt_degrees(readings: Mapping[str, Reading]) -> float | None:
    """Angle between measured gravity and the car's Z axis (0° = flat)."""
    mag = vector_magnitude(readings, "accel")
    az = number(readings, "accel_z")
    if mag is None or az is None or mag < 0.3 * GRAVITY:
        return None
    return math.degrees(math.acos(max(-1.0, min(1.0, az / mag))))


def extract_features(readings: Mapping[str, Reading], closing_speed: float | None) -> dict[str, float | None]:
    irs = [flag(readings, k) for k in ("ir_obstacle", "ir_left", "ir_right")]
    known = [v for v in irs if v is not None]
    return {
        "front_cm": number(readings, "obstacle_distance"),
        "rear_cm": number(readings, "obstacle_distance_rear"),
        "closing_speed_cms": closing_speed,
        "ir_any": (1.0 if any(known) else 0.0) if known else None,
        "dyn_accel_ms2": dynamic_acceleration(readings),
        "gyro_dps": vector_magnitude(readings, "gyro"),
        "tilt_deg": tilt_degrees(readings),
        "battery_soc": number(readings, "battery_soc"),
    }


@lru_cache(maxsize=4)
def load_model(path: str | None = None) -> "RiskModel":
    """One shared model instance per file (loading takes a moment)."""
    return RiskModel(path)


class RiskModel:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else DEFAULT_MODEL_PATH
        self.meta_path = self.path.with_name(self.path.stem + "_meta.json")
        self._model: Any = None
        self.meta: dict[str, Any] | None = None
        self.error: str | None = None
        self._load()

    def _load(self) -> None:
        if not self.path.is_file():
            self.error = f"model file not found: {self.path.name} (run ml/train.py)"
            return
        try:
            import numpy  # noqa: F401
            import xgboost as xgb
        except ImportError:
            self.error = "xgboost is not installed on the server (pip install -r requirements.txt)"
            return
        try:
            self.meta = json.loads(self.meta_path.read_text()) if self.meta_path.is_file() else None
            model = xgb.XGBClassifier()
            model.load_model(self.path)
            self._model = model
            log.info("Loaded XGBoost risk model from %s", self.path)
        except Exception as exc:  # pragma: no cover - corrupt file
            self.error = f"could not load model: {type(exc).__name__}"
            log.warning("Could not load ML model: %s", exc)

    @property
    def available(self) -> bool:
        return self._model is not None

    @property
    def features(self) -> list[str]:
        return list(self.meta["features"]) if self.meta else []

    @property
    def classes(self) -> list[str]:
        return list(self.meta["classes"]) if self.meta else []

    def predict(self, features: dict[str, float | None]) -> MlPrediction:
        if not self.available or not self.meta:
            return MlPrediction(available=False, reason=self.error or "model metadata missing")
        known = sum(v is not None for v in features.values())
        if features.get("front_cm") is None or known < 3:
            return MlPrediction(available=False, features=features,
                                reason="not enough sensor data for a prediction")
        import numpy as np

        row = np.array([[np.nan if features.get(f) is None else float(features[f]) for f in self.features]])
        probs = self._model.predict_proba(row)[0]
        best = int(probs.argmax())
        return MlPrediction(
            available=True,
            label=self.classes[best],
            confidence=round(float(probs[best]), 4),
            probabilities={c: round(float(p), 4) for c, p in zip(self.classes, probs)},
            features={k: (None if v is None else round(v, 3)) for k, v in features.items()},
            model="XGBoost",
        )
