"""Synthesize a labelled LightSync telemetry dataset for the accident-risk model.

Real crash data from the car does not exist (and should not be collected by
crashing it), so the training set is generated from driving *scenarios*. Each
scenario describes what the car's sensors physically report in that situation:
distances, how fast the gap is closing, IR edge sensors, acceleration beyond
gravity, rotation rate, tilt and battery. Every row gets the scenario's label.

To keep the model honest about real-world messiness the generator also adds:
  * sensor noise on every value,
  * hard borderline cases where neighbouring classes overlap,
  * sensor dropouts (values set to NaN, as when a sensor is missing),
  * a small fraction of flipped labels (annotation noise).

Usage:
    python ml/synthesize.py                       # 24 000 rows -> ml/data/lightsync_synthetic.csv
    python ml/synthesize.py --rows 50000 --seed 7
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from features import CLASSES, FEATURES

ML_DIR = Path(__file__).resolve().parent
DEFAULT_OUT = ML_DIR / "data" / "lightsync_synthetic.csv"

# scenario name -> (label, share of rows, description)
SCENARIOS: dict[str, tuple[str, float, str]] = {
    "cruising":          ("safe",     0.30, "Open floor, nothing within 60 cm, steady driving"),
    "parked":            ("safe",     0.08, "Car stopped, nothing close, no motion"),
    "approaching":       ("caution",  0.14, "Obstacle 25-70 cm ahead and getting closer"),
    "boxed_in":          ("caution",  0.06, "Stopped with obstacles close in front and behind"),
    "edge_detected":     ("caution",  0.07, "IR edge sensor triggered, car steering away"),
    "low_battery":       ("caution",  0.05, "Driving normally on a nearly empty pack"),
    "imminent_collision": ("danger",  0.12, "Obstacle under 25 cm and closing fast"),
    "rough_terrain":     ("danger",   0.05, "Strong vibration and rotation while moving"),
    "impact":            ("accident", 0.08, "Collision: acceleration spike and sudden rotation"),
    "tip_over":          ("accident", 0.05, "Car rolled or flipped: large tilt"),
}

DROPOUT = {"rear_cm": 0.10, "gyro_dps": 0.08, "tilt_deg": 0.05, "battery_soc": 0.05,
           "dyn_accel_ms2": 0.03, "closing_speed_cms": 0.04}
LABEL_NOISE = 0.02


def _clip(a, lo, hi):
    return np.clip(a, lo, hi)


def _scenario(name: str, n: int, rng: np.random.Generator) -> pd.DataFrame:
    u, nrm = rng.uniform, rng.normal
    front = u(70, 400, n); rear = u(30, 400, n); closing = nrm(0, 4, n)
    ir = np.zeros(n); dyn = np.abs(nrm(0, 0.35, n)); gyro = np.abs(nrm(4, 3, n))
    tilt = np.abs(nrm(4, 2.5, n)); soc = u(25, 100, n)

    if name == "cruising":
        closing = nrm(3, 6, n); dyn = np.abs(nrm(0.6, 0.4, n)); gyro = np.abs(nrm(10, 12, n))  # includes gentle turns
    elif name == "parked":
        closing = nrm(0, 0.8, n); dyn = np.abs(nrm(0, 0.12, n)); gyro = np.abs(nrm(0.8, 0.6, n))
    elif name == "approaching":
        front = u(25, 70, n); closing = u(4, 35, n)
        dyn = np.abs(nrm(0.7, 0.4, n)); gyro = np.abs(nrm(10, 12, n))
    elif name == "boxed_in":
        front = u(5, 25, n); rear = u(4, 25, n); closing = nrm(0, 1.5, n)
        dyn = np.abs(nrm(0.1, 0.1, n)); gyro = np.abs(nrm(1.5, 1, n))
    elif name == "edge_detected":
        front = u(30, 400, n); ir = np.ones(n); closing = nrm(2, 5, n)
        gyro = np.abs(nrm(35, 15, n)); dyn = np.abs(nrm(0.9, 0.5, n))
    elif name == "low_battery":
        soc = u(0, 14, n); closing = nrm(3, 6, n); dyn = np.abs(nrm(0.6, 0.4, n)); gyro = np.abs(nrm(8, 5, n))
    elif name == "imminent_collision":
        front = u(3, 25, n); closing = u(12, 60, n)
        dyn = np.abs(nrm(1.0, 0.6, n)); gyro = np.abs(nrm(10, 6, n)); ir = (u(0, 1, n) < 0.25).astype(float)
    elif name == "rough_terrain":
        dyn = u(3.5, 9, n); gyro = u(60, 160, n); tilt = u(8, 30, n); closing = nrm(3, 8, n)
    elif name == "impact":
        front = u(0, 15, n); closing = nrm(-5, 15, n)          # gap stops shrinking after the hit
        dyn = u(9, 35, n); gyro = u(80, 400, n); tilt = u(5, 40, n)
    elif name == "tip_over":
        front = u(0, 400, n); closing = nrm(0, 10, n)
        dyn = u(2, 20, n); gyro = u(40, 300, n); tilt = u(50, 175, n)

    # Measurement noise, applied to every scenario
    front = _clip(front + nrm(0, 1.5, n), 0, 400)
    rear = _clip(rear + nrm(0, 1.5, n), 0, 400)
    return pd.DataFrame({
        "front_cm": front.round(1), "rear_cm": rear.round(1),
        "closing_speed_cms": (closing + nrm(0, 1.0, n)).round(2),
        "ir_any": ir,
        "dyn_accel_ms2": _clip(dyn + np.abs(nrm(0, 0.05, n)), 0, 160).round(3),
        "gyro_dps": _clip(gyro + np.abs(nrm(0, 0.5, n)), 0, 2000).round(2),
        "tilt_deg": _clip(tilt, 0, 180).round(1),
        "battery_soc": _clip(soc, 0, 100).round(1),
        "scenario": name,
        "label": SCENARIOS[name][0],
    })


def synthesize(rows: int = 24_000, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    parts = [_scenario(name, max(1, int(rows * share)), rng) for name, (_, share, _) in SCENARIOS.items()]
    df = pd.concat(parts, ignore_index=True)

    for col, p in DROPOUT.items():
        df.loc[rng.uniform(0, 1, len(df)) < p, col] = np.nan

    flip = rng.uniform(0, 1, len(df)) < LABEL_NOISE
    df.loc[flip, "label"] = rng.choice(CLASSES, flip.sum())

    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)
    return df[FEATURES + ["scenario", "label"]]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rows", type=int, default=24_000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    df = synthesize(args.rows, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df)} rows to {args.out}")
    print(df["label"].value_counts().to_string())


if __name__ == "__main__":
    main()
