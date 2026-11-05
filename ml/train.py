"""Train the LightSync accident-risk classifier (XGBoost) on the synthetic dataset.

Writes:
  ml/models/risk_xgb.json        the trained model (XGBoost native JSON format)
  ml/models/risk_xgb_meta.json   features, classes, test metrics, feature importance
                                 and the synthesis description the dashboard shows

Usage:
    python ml/synthesize.py   # (re)generate ml/data/lightsync_synthetic.csv
    python ml/train.py
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split

from features import CLASSES, FEATURES
from synthesize import DEFAULT_OUT, DROPOUT, LABEL_NOISE, SCENARIOS, synthesize

ML_DIR = Path(__file__).resolve().parent
MODEL_DIR = ML_DIR / "models"

PARAMS = dict(
    objective="multi:softprob",
    n_estimators=400,
    max_depth=5,
    learning_rate=0.08,
    subsample=0.9,
    colsample_bytree=0.9,
    min_child_weight=2,
    reg_lambda=1.0,
    eval_metric="mlogloss",
    early_stopping_rounds=30,
    tree_method="hist",
)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    if not args.data.exists():
        print(f"{args.data} not found, synthesizing it first")
        args.data.parent.mkdir(parents=True, exist_ok=True)
        synthesize(seed=args.seed).to_csv(args.data, index=False)

    df = pd.read_csv(args.data)
    X = df[FEATURES].astype(float)
    y = df["label"].map({c: i for i, c in enumerate(CLASSES)}).to_numpy()

    # 70 % train, 15 % validation (early stopping), 15 % held-out test
    X_tmp, X_test, y_tmp, y_test = train_test_split(X, y, test_size=0.15, stratify=y, random_state=args.seed)
    X_train, X_val, y_train, y_val = train_test_split(
        X_tmp, y_tmp, test_size=0.15 / 0.85, stratify=y_tmp, random_state=args.seed)

    model = xgb.XGBClassifier(**PARAMS, num_class=len(CLASSES), random_state=args.seed)
    model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

    pred = model.predict(X_test)
    acc = accuracy_score(y_test, pred)
    macro_f1 = f1_score(y_test, pred, average="macro")
    report = classification_report(y_test, pred, target_names=CLASSES, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_test, pred, labels=list(range(len(CLASSES))))

    gain = model.get_booster().get_score(importance_type="gain")
    total = sum(gain.values()) or 1.0
    importance = {f: round(gain.get(f, 0.0) / total, 4) for f in FEATURES}

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(MODEL_DIR / "risk_xgb.json")
    meta = {
        "name": "LightSync accident-risk classifier",
        "algorithm": "XGBoost gradient-boosted trees (multi:softprob)",
        "xgboost_version": xgb.__version__,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "features": FEATURES,
        "classes": CLASSES,
        "params": {k: v for k, v in PARAMS.items()},
        "best_iteration": int(model.best_iteration),
        "data": {
            "source": "synthetic",
            "file": str(args.data.relative_to(ML_DIR.parent)) if args.data.is_relative_to(ML_DIR.parent) else str(args.data),
            "rows": int(len(df)),
            "train_rows": int(len(X_train)), "validation_rows": int(len(X_val)), "test_rows": int(len(X_test)),
            "label_noise": LABEL_NOISE,
            "dropout": DROPOUT,
            "scenarios": [{"name": n, "label": lbl, "share": share, "description": d}
                          for n, (lbl, share, d) in SCENARIOS.items()],
        },
        "metrics": {
            "accuracy": round(float(acc), 4),
            "macro_f1": round(float(macro_f1), 4),
            "per_class": {c: {k: round(float(report[c][k]), 4) for k in ("precision", "recall", "f1-score", "support")}
                          for c in CLASSES},
            "confusion_matrix": cm.tolist(),
            "evaluated_on": "held-out 15 % of the synthetic dataset",
        },
        "feature_importance": importance,
    }
    (MODEL_DIR / "risk_xgb_meta.json").write_text(json.dumps(meta, indent=2))

    print(f"Trained on {len(X_train)} rows (best iteration {model.best_iteration})")
    print(f"Test accuracy {acc:.3f}  macro F1 {macro_f1:.3f}")
    print(pd.DataFrame(cm, index=CLASSES, columns=CLASSES).to_string())
    print("Feature importance (gain):", json.dumps(importance))
    print(f"Saved {MODEL_DIR / 'risk_xgb.json'}")


if __name__ == "__main__":
    np.set_printoptions(suppress=True)
    main()
