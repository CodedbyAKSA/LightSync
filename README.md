# LightSync Safety Console

A hardware telemetry dashboard for the LightSync vehicle: ESP32 and ESP8266 boards linked over ESP-NOW, publishing through Blynk IoT. It has a React frontend, a FastAPI backend, light and dark themes, and an interactive 3D vehicle view.

```
ESP8266 node ──ESP-NOW──▶ ESP32 gateway ──Wi-Fi/HTTPS──▶ Blynk Cloud
                                                           │  device HTTPS API (polled)
                                                           ▼
                         Browser ◀──SSE── LightSync backend (FastAPI)
                                          token stays here
```

- **ESP-NOW** is the local radio link between the boards. It does not reach the internet.
- Only the **ESP32 gateway** connects to Wi-Fi and Blynk. The ESP8266 never talks to Blynk directly.
- The **backend** is the only component that knows the Blynk token. It polls Blynk, validates and normalizes the values, keeps a bounded history, detects events and streams snapshots to the browser over Server-Sent Events (SSE). If streaming is unavailable, the browser falls back to polling.

A simpler setup is also supported: a **single ESP32 car** posts its readings straight to the backend over Wi-Fi, with no ESP-NOW and no Blynk. Set `LIGHTSYNC_LIVE_SOURCE=device` and see [docs/CAR_HTTP_SETUP.md](docs/CAR_HTTP_SETUP.md).

```
ESP32 car ──Wi-Fi / HTTP POST──▶ LightSync backend ──SSE──▶ Browser
          X-Device-Key            /api/device/telemetry
```

## Documentation

| Guide | What it covers |
|---|---|
| [RUN.md](RUN.md) | Start to end on Windows: install, configure, start the dashboard, flash the car and see its live data |
| [docs/RUNNING.md](docs/RUNNING.md) | Install, start, check, test and deploy the app, plus troubleshooting for every common error |
| [docs/BLYNK_SETUP.md](docs/BLYNK_SETUP.md) | Step-by-step Blynk setup: template, datastreams, device token, `.env`, firmware, live mode and commands |
| [docs/CAR_HTTP_SETUP.md](docs/CAR_HTTP_SETUP.md) | Single-ESP32 car that posts straight to the backend over Wi-Fi (no ESP-NOW, no Blynk) |

## Screenshots

All screenshots are from the built-in **demo mode**, except the last row, which shows live mode with no Blynk token configured. Every simulated value carries a *Demo* label in the app.

| Overview (dark) | Overview (light) |
|---|---|
| ![Overview, dark theme](docs/screenshots/01-overview-dark.png) | ![Overview, light theme](docs/screenshots/02-overview-light.png) |
| **Collision warning** (obstacle inside the critical zone) | **Command confirmation** |
| ![Collision warning](docs/screenshots/03-collision-warning-dark.png) | ![Emergency stop confirmation](docs/screenshots/10-emergency-stop-confirm.png) |
| **Live Sensors** | **Safety Events** |
| ![Live Sensors page](docs/screenshots/04-live-sensors.png) | ![Safety Events page](docs/screenshots/05-safety-events.png) |
| **Battery Health** | **Automation** |
| ![Battery Health page](docs/screenshots/06-battery-health.png) | ![Automation page](docs/screenshots/07-automation.png) |
| **Device Network** | **Settings** |
| ![Device Network page](docs/screenshots/08-device-network.png) | ![Settings page](docs/screenshots/09-settings.png) |


## Contents

| Path | What it is |
|---|---|
| `backend/app/datastreams.py` | Field registry and virtual-pin mapping (the single place pins are defined) |
| `backend/app/blynk.py` | Client for the documented Blynk device HTTPS API |
| `backend/app/normalize.py` | Validation and normalization of raw values into readings |
| `backend/app/risk.py` | Rule-based accident-risk estimate (documented point table) |
| `backend/app/events.py` | Safety-event detection from state transitions |
| `backend/app/telemetry.py` | Acquisition loop, freshness logic, history buffer, commands |
| `backend/app/demo.py` | Deterministic demo simulator |
| `backend/app/routes.py` | REST, SSE and command endpoints |
| `frontend/src/` | React + TypeScript + Tailwind dashboard |
| `ml/` | XGBoost accident-risk model: data synthesizer, trainer, dataset and trained model (see [ml/README.md](ml/README.md)) |
| `backend/app/ml.py` | Runs the XGBoost model on every telemetry update |
| `frontend/src/components/vehicle/VehicleScene.tsx` | React Three Fiber vehicle scene (procedural geometry) |
| `firmware/esp32_gateway/` | Example gateway sketch (ESP-NOW receiver + Blynk publisher) |
| `firmware/esp8266_node/` | Example node sketch (sensors → ESP-NOW) |
| `firmware/lightsync_car/` | Single-ESP32 car sketch that POSTs telemetry to `/api/device/telemetry` |

## 1. Prerequisites

- Python 3.11 or newer (tested on 3.13)
- Node.js 20 or newer (tested on 22) and npm
- For real hardware:
  - a Blynk account with a template and device
  - an ESP32 (gateway) and an ESP8266 (node)
  - Arduino IDE or PlatformIO with the ESP32 core 3.x, ESP8266 core 3.x and the Blynk library

## 2. Installation

```bash
cp .env.example .env
```

```bash
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
```

(On macOS or Linux, use `.venv/bin/pip`.)

```bash
cd frontend && npm install
```

## 3. Running

Start the backend on port 8000:

```bash
cd backend && .venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Start the frontend on port 5173. It proxies `/api` to the backend:

```bash
cd frontend && npm run dev
```

Open <http://localhost:5173>. With the default `.env`, the backend runs in **demo mode**. The header reads **DEMO MODE**, the footer reads **Demo data**, and every reading and event carries a *Demo* badge.

For a production build, run `npm run build` in `frontend/` and serve `frontend/dist` behind a reverse proxy that forwards `/api` to the backend. Disable response buffering for `/api/telemetry/stream`.

## 4. Configuring Blynk credentials securely

> For a full walkthrough with Blynk.Console steps, see [docs/BLYNK_SETUP.md](docs/BLYNK_SETUP.md).

1. In Blynk Console, open **Device → Device Info** and copy the **auth token**.
2. Put it in `.env` as `BLYNK_TOKEN=...`. Set `BLYNK_SERVER` to the host shown at the bottom right of the Console, for example `blynk.cloud` or `fra1.blynk.cloud`.
3. Set `LIGHTSYNC_API_KEY` to a long random string:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

   Operators enter this key in **Settings → Operator access**. It's kept in browser session storage only, and it isn't the Blynk token.

The token is read only by the backend. It's stored as a `SecretStr`, never returned by any endpoint, and scrubbed from error messages. httpx request logging is turned down so URLs carrying the token are never logged. Never place secrets in `VITE_*` variables or anywhere in `frontend/`. `.env` is git-ignored.

## 5. Blynk template and datastreams

Create one **virtual-pin datastream** per field you actually publish. The defaults below are only suggestions; your firmware and template must agree with each other.

| Field | Default pin | Type / range | Notes |
|---|---|---|---|
| battery_voltage | V0 | double, 0–60 V | measured |
| battery_current | V1 | double, −50–50 A | measured; positive = discharge |
| battery_soc | V2 | double, 0–100 % | firmware estimate |
| battery_soh | V3 | double, 0–100 % | firmware health estimator |
| accel_x / y / z | V4–V6 | double, m/s² | calibrated; Z includes gravity |
| gyro_x / y / z | V7–V9 | double, °/s | calibrated |
| obstacle_distance | V10 | double, 0–1000 cm | |
| ir_obstacle | V11 | int 0/1 | 1 = obstacle |
| obstacle_distance_rear / _left / _right | none | double, 0–1000 cm | rear and side ultrasonics |
| ir_left / ir_right | none | int 0/1 | individual IR sensors |
| vibration | V12 | int 0/1/2 | normal / warning / active |
| drowsiness | V13 | int 0/1 | only if a detector exists |
| risk_score | V14 | double 0–100 | optional; otherwise computed |
| espnow_link | V15 | int 0/1 | gateway hears the node |
| lcd_status | V16 | int 0/1 | |
| autonomous_mode | V17 | int 0/1 | **state** reported by hardware |
| emergency_stop | V18 | int 0/1 | **state** reported by hardware |
| bluetooth_link | none | int 0/1 | map only if Bluetooth really exists |
| espnow_rssi | none | double dBm | optional metric |
| espnow_packet_loss | none | double % | optional metric |
| heartbeat | none | int counter | **recommended** freshness signal |
| cmd_autonomous_mode | none | int 0/1 | write-only **request** pin |
| cmd_emergency_stop | none | int 0/1 | write-only **request** pin |

The example firmware uses V19 and V20 for the two request pins, V21 for packet loss and V22 for the heartbeat.

## 6. Mapping your real virtual pins

Override any pin in `.env` with `PIN_<FIELD>`:

```
PIN_OBSTACLE_DISTANCE=V30
PIN_DROWSINESS=none        # not published → shown as "Sensor Unavailable"
PIN_HEARTBEAT=V22
```

Restart the backend after changing pins. The backend rejects invalid pins and duplicate assignments, including a request pin that equals a state pin, and reports them in **Settings**. **Settings → Datastream mapping** shows the active mapping.

A mapped pin that Blynk has no stored value for is shown as **Unavailable**, never as 0. Values that fail validation (out of range, wrong type) are shown as **Invalid**.

## 7. Connecting the ESP32 gateway and ESP8266 node

1. Flash `firmware/esp32_gateway/` first:
   - Copy `secrets.example.h` to `secrets.h` and fill in your Blynk and Wi-Fi details. `secrets.h` is git-ignored.
   - Replace the `read*()` sensor hooks with your drivers. They return `NAN` or `false` until you do, and nothing is published for them.
   - Open the serial monitor and note the printed **STA MAC address**.
2. Flash `firmware/esp8266_node/`:
   - Set `GATEWAY_MAC` to that address and `ROUTER_SSID` to the gateway's Wi-Fi network.
   - ESP-NOW only works when both radios share a channel. The node scans for the router's SSID and switches to its channel.
3. Keep `lightsync_packet.h` identical in both sketch folders.
4. **Emergency stop:** wire the physical e-stop so it cuts motor-driver power directly, with a normally-closed loop. It must work without any firmware, Wi-Fi, Blynk or dashboard involvement. The gateway reads the loop state and reports it on V18. The dashboard's stop control is only an extra request.

## 8. Enabling live telemetry

Set `LIGHTSYNC_MODE=live` in `.env` and restart the backend. You can also use **Settings → Data source → Switch to live**, which requires the operator key.

The backend calls `GET /external/api/getAll` every `BLYNK_POLL_INTERVAL` seconds, plus `GET /external/api/isHardwareConnected` every `BLYNK_CONNECTED_CHECK_INTERVAL` seconds. That's a few requests per minute, far below Blynk's limits. The header then shows one of these states:

| State | Meaning |
|---|---|
| **SYSTEM ONLINE** | Recent valid telemetry from the device. |
| **DATA STALE** | No change in the heartbeat (or, if no heartbeat is mapped, in any datastream) for `TELEMETRY_FRESHNESS_SECONDS`. |
| **OFFLINE** | No token, Blynk unreachable or returning errors, Blynk reports the device offline, or the dashboard can't reach the backend. |
| **CONNECTING** | No data received yet. |

Live mode never falls back to demo values. Switching modes discards all buffered samples and events.

Blynk's read API returns no measurement timestamps. Each reading therefore carries `observed_at` (when the backend received it) and `changed_at` (when the value last changed). Freshness is judged from `changed_at`. Map a heartbeat counter: without one, a sensor that legitimately holds a constant value can look stale.

## 9. Enabling remote commands

Commands are **off** by default. To enable them:

1. In the firmware, handle the request pins (V19 and V20 in the example). Apply the change, then write the resulting state to the state pins (V17 and V18).
2. In `.env`, set:

   ```
   COMMANDS_ENABLED=true
   PIN_CMD_AUTONOMOUS_MODE=V19
   PIN_CMD_EMERGENCY_STOP=V20
   ```

   Also set `LIGHTSYNC_API_KEY`.
3. In the dashboard, enter the operator key under **Settings**.

Each command needs a confirmation dialog, the operator key, and stays within a rate limit (10 per minute per client). It's written with `GET /external/api/update`. The backend then polls the state pin for up to `COMMAND_ACK_TIMEOUT` seconds:

- **acknowledged:** the hardware reported the requested state.
- **unconfirmed:** the request was written but the hardware never confirmed it.
- **failed:** the write itself failed.

Unsupported or unauthorized commands are rejected: 401 for a bad key, 403 when no key is configured in live mode, 409 when the command is not configured. History is shown on **Automation**.

## 10. Demo vs live

| | Demo | Live |
|---|---|---|
| Data | deterministic 90-second scenario (`backend/app/demo.py`) | Blynk Cloud |
| Labels | DEMO MODE header, Demo badges, demo events | Hardware badges |
| Commands | change the simulator only; no key needed unless one is configured | real requests, key required |

## 11. Tests

```bash
cd backend && .venv/Scripts/python -m pytest
```

```bash
cd frontend && npm test && npm run lint && npm run build
```

Backend tests cover:

- pin parsing and duplicate detection
- normalization: unmapped, missing, invalid, a genuine zero, bool and state parsing
- risk rules
- the Blynk client against a fake API: endpoints, error handling, token redaction, 429 back-off
- live, stale and offline states
- bounded history and mode-switch isolation
- event detection
- the command acknowledgement flow and API authorization

Frontend tests cover:

- rolling-buffer limits, downsampling and gap insertion
- the battery-health and safety-state labelling rules
- unavailable versus zero rendering

## 12. Troubleshooting

> More error messages and fixes (installation, ports, blank pages, commands, tests) are in [docs/RUNNING.md](docs/RUNNING.md#troubleshooting).

| Symptom | Check |
|---|---|
| OFFLINE: “BLYNK_TOKEN is not configured” | `.env` is in the repo root or `backend/`, and the backend was restarted. |
| OFFLINE: “returned HTTP 400: Invalid token.” | The token belongs to the device (not the template), and `BLYNK_SERVER` matches your region. |
| OFFLINE: “Blynk reports the gateway device is offline” | The gateway is powered, on Wi-Fi, and `Blynk.run()` is being called. |
| DATA STALE | The gateway publishes on a timer and the heartbeat pin increments; consider raising `TELEMETRY_FRESHNESS_SECONDS`. |
| A card shows Unavailable | Open **Settings → Datastream mapping**. Is the field mapped, and does the datastream have a value in Blynk? `getAll` only lists datastreams with stored values. |
| ESP-NOW link always Disconnected | Gateway MAC is correct in the node sketch; both radios are on the router's channel. |
| Rate limited (429) | Raise `BLYNK_POLL_INTERVAL`; the backend backs off automatically. |
| 3D view replaced by a 2D drawing | WebGL is unavailable or failed; the 2D fallback is intentional. |

## Accuracy notes

- **Accident risk** is a transparent rule-based estimate (`backend/app/risk.py`), not an AI model, unless the hardware publishes `risk_score`.
- **Bluetooth:** the link card shows **ESP-NOW** because this hardware doesn't implement Bluetooth. It switches to Bluetooth only if `PIN_BLUETOOTH_LINK` is mapped.
- **Battery:** state of charge and state of health are never derived from voltage or from each other.
- **Charts:** the overview plots vector magnitudes, |a| (m/s², including gravity) and |ω| (°/s), on separate labelled axes. **Live Sensors** shows each axis.
- **3D vehicle:** procedural geometry (no external model). Drag to rotate; the reset button restores the view.
- **History:** kept in memory (default 3600 samples, about 1 hour at 1 Hz) and lost on restart. Blynk's own history export is limited to 10 calls per device per day, so the dashboard does not depend on it.
