# LightSync ML — XGBoost accident-risk model

The dashboard's **ML Insights** page and the "XGBoost prediction" line on the Overview safety card come from a gradient-boosted tree classifier (XGBoost). Every telemetry update is classified as:

| Class | Meaning |
|---|---|
| `safe` | Normal driving or parked with nothing close |
| `caution` | Something needs attention: obstacle approaching, boxed in, edge detected, battery nearly empty |
| `danger` | Collision is imminent, or the car is being thrown around |
| `accident` | An impact or a tip-over has happened |

## Files

| Path | What it is |
|---|---|
| `features.py` | The 8 input features and 4 classes, shared by every script |
| `synthesize.py` | Generates the labelled training data from driving scenarios |
| `train.py` | Trains XGBoost, evaluates it and saves the model and its metadata |
| `data/lightsync_synthetic.csv` | The generated dataset (24 000 rows) |
| `models/risk_xgb.json` | The trained model, loaded by the backend (`backend/app/ml.py`) |
| `models/risk_xgb_meta.json` | Features, classes, test metrics, feature importance and the synthesis description shown on the dashboard |

## Input features

Computed from live telemetry by `backend/app/ml.py`, in the same way they were generated for training:

| Feature | From | Unit |
|---|---|---|
| `front_cm` | front ultrasonic | cm |
| `rear_cm` | rear ultrasonic | cm |
| `closing_speed_cms` | change in front distance between updates; positive = getting closer | cm/s |
| `ir_any` | either IR edge sensor triggered | 0/1 |
| `dyn_accel_ms2` | acceleration beyond gravity, \| \|a\| − 9.81 \| | m/s² |
| `gyro_dps` | rotation-rate magnitude | °/s |
| `tilt_deg` | angle between measured gravity and the car's Z axis (0° = flat) | ° |
| `battery_soc` | battery charge | % |

A sensor that isn't reporting is passed to the model as missing (NaN). XGBoost handles missing values natively, and the training data contains deliberate dropouts so it learns to.

## How the data is synthesized

Real accident data can't be collected without crashing the car, so the training set is **synthetic**. It is generated from ten driving scenarios. Each scenario describes what the sensors physically report in that situation, and every row is labelled with its scenario's class.

| Scenario | Label | Share | What the sensors see |
|---|---|---|---|
| `cruising` | safe | 30 % | Nothing within 70 cm, small closing speeds, light vibration, gentle turns |
| `parked` | safe | 8 % | Stopped, nothing close, almost no motion |
| `approaching` | caution | 14 % | Obstacle 25–70 cm ahead, closing at 4–35 cm/s |
| `boxed_in` | caution | 6 % | Stopped with obstacles under 25 cm in front and behind |
| `edge_detected` | caution | 7 % | IR edge sensor triggered, fast rotation while steering away |
| `low_battery` | caution | 5 % | Driving normally below 14 % charge |
| `imminent_collision` | danger | 12 % | Obstacle under 25 cm, closing at 12–60 cm/s |
| `rough_terrain` | danger | 5 % | 3.5–9 m/s² beyond gravity and 60–160 °/s rotation while moving |
| `impact` | accident | 8 % | 9–35 m/s² spike, 80–400 °/s rotation, obstacle at 0–15 cm |
| `tip_over` | accident | 5 % | Tilt of 50–175° |

Every value is drawn from a random distribution, not fixed, so the scenarios overlap at the edges. To make the data realistic rather than clean:

- **Measurement noise:** every reading gets Gaussian noise, like real sensors.
- **Sensor dropouts:** some values are blanked: rear distance 10 %, rotation 8 %, tilt 5 %, battery 5 %, closing speed 4 %, acceleration 3 %.
- **Label noise:** 2 % of labels are flipped at random, as if a human labeller made mistakes. This also means a perfect score is impossible; about 98 % is the realistic ceiling.

The generator is seeded (`--seed`), so the same command always produces the same dataset.

## Training

- **Split:** 70 % train, 15 % validation (for early stopping), 15 % held-out test, stratified by class.
- **Model:** `XGBClassifier(objective="multi:softprob", max_depth=5, learning_rate=0.08, subsample=0.9, colsample_bytree=0.9)`, up to 400 trees with early stopping after 30 rounds without improvement.
- **Result** (held-out test set): about **97.8 % accuracy, 0.976 macro F1**. The exact numbers, per-class precision/recall, the confusion matrix and feature importance are saved in `models/risk_xgb_meta.json` and shown on the ML Insights page.

These metrics measure how well the model learned the synthetic scenarios. They are not a measured accident-detection rate for the physical car; that would need labelled recordings from the car itself.

## Retrain

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install -r ..\ml\requirements.txt
.\.venv\Scripts\python.exe ..\ml\synthesize.py
.\.venv\Scripts\python.exe ..\ml\train.py
```

Then restart the backend; it loads `ml/models/risk_xgb.json` at startup. To change the scenarios, edit `SCENARIOS` and `_scenario()` in `synthesize.py`, then run both scripts again.

## API

- `GET /api/ml/model`: model metadata (features, classes, metrics, feature importance, synthesis description).
- Every telemetry snapshot carries `derived.ml`: `label`, `confidence`, `probabilities` for all four classes, and the `features` that went into the prediction.
