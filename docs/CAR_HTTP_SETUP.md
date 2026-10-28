# Car → LightSync over HTTP

This setup uses **one ESP32** that drives the car and posts its readings straight to the LightSync backend over Wi-Fi. There is no ESP-NOW and no Blynk.

```
ESP32 car ──Wi-Fi / HTTP POST──▶ LightSync backend ──SSE──▶ Browser
          X-Device-Key            /api/device/telemetry
```

The sketch is in `firmware/lightsync_car/`.

## 1. Configure the backend

In `.env` at the repository root:

```ini
LIGHTSYNC_MODE=live
LIGHTSYNC_LIVE_SOURCE=device
LIGHTSYNC_DEVICE_KEY=<long random string>
LIGHTSYNC_API_KEY=<another long random string>
```

Generate each key with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

`LIGHTSYNC_DEVICE_KEY` is what the car sends. `LIGHTSYNC_API_KEY` is the operator key you type into **Settings** in the dashboard. Keep them different.

For a 2-cell pack, lower the low-voltage alarm so it doesn't fire all the time:

```ini
THRESHOLD_BATTERY_MIN_VOLTAGE=6.6
```

## 2. Start the backend so the car can reach it

The car is a separate device on your Wi-Fi, so the backend must listen on the network, not only on `127.0.0.1`:

```bash
cd backend && .venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

(On macOS or Linux, use `.venv/bin/python`.)

Then:

1. Find your PC's IPv4 address on the same Wi-Fi (`ipconfig` on Windows, `ip addr` on Linux).
2. On Windows, allow Python through the firewall for **private** networks when asked. If you missed the prompt, add an inbound rule for TCP port 8000.
3. From your phone's browser on the same Wi-Fi, open `http://<PC IP>:8000/api/health`. If that page doesn't load, the car can't reach the backend either.

If the backend runs on a cloud server instead, put it behind HTTPS and use its `https://` address in the sketch.

## 3. Flash the car

1. Open `firmware/lightsync_car/lightsync_car.ino` and edit the four lines under **YOUR SETTINGS**:
   - `WIFI_SSID`, `WIFI_PASS`. The ESP32 only supports 2.4 GHz Wi-Fi.
   - `LIGHTSYNC_URL`: `http://<PC IP>:8000`, with no trailing slash.
   - `LIGHTSYNC_DEVICE_KEY`: the same value as in `.env`.

   The sketch compiles on its own. If you'd rather keep these out of the `.ino` (for example before committing), copy `secrets.example.h` to `secrets.h` in the same folder and fill it in. When `secrets.h` exists it's used automatically, and it's git-ignored.
2. Board: **ESP32 Dev Module**, Arduino core 3.x. Libraries: **MPU6050** (Electronic Cats) and **LiquidCrystal I2C**.
3. Upload, then open the Serial Monitor at 115200 baud.

## 4. Check it works

| Where | What you should see |
|---|---|
| Serial Monitor | `[WIFI] connected, IP …` then `[UPLINK] OK → http://…/api/device/telemetry` |
| Car LCD, top line, right end | `OK` (uplink working), `ERR` (Wi-Fi up, post failing), `--` (no Wi-Fi) |
| Dashboard header | **SYSTEM ONLINE**. It turns **DATA STALE** within `TELEMETRY_FRESHNESS_SECONDS` of the car going quiet. |
| Device Network page | **LightSync car · online** with a rising *posts received* count |

## What the car sends

The car posts one flat JSON object about once a second. Keys are LightSync field names:

| Key | Meaning |
|---|---|
| `obstacle_distance` | Front ultrasonic, cm. `400` means nothing in range. |
| `ir_obstacle` | `1` if either IR edge sensor triggers |
| `accel_x`, `accel_y`, `accel_z` | m/s², Z includes gravity |
| `gyro_x`, `gyro_y`, `gyro_z` | °/s |
| `battery_voltage` | Volts. Estimated by default (see below); measured when `USE_BATT_ADC` is `1` and the divider is wired. |
| `battery_soc` | %. From the measured voltage, or from the charge-used estimate. |
| `lcd_status` | `1` when the LCD answered on I2C |
| `autonomous_mode` | Always `1`; the car always drives itself |
| `emergency_stop` | `1` while the car is stopped after detecting an accident |
| `heartbeat` | Counter that goes up on every post |

### How the battery voltage is estimated

Without a voltage divider, the firmware estimates the pack voltage:

1. It tracks charge used from the motor state (`CURRENT_*_MA`) and time, starting from `BATT_START_PCT`.
2. It looks up the Li-ion open-circuit voltage for that charge in `OCV_TABLE` and multiplies by `BATT_CELLS`.
3. It subtracts the voltage sag under load (current × `CELL_RINT_OHM` per cell) and smooths the result over a few seconds.

A full 2-cell pack reads about 8.39 V at rest and 8.27 V while driving, and falls along the Li-ion curve as charge is used. The estimate is only as good as `BATT_START_PCT` and the current figures. Wire the divider and set `USE_BATT_ADC 1` for a true reading; nothing else changes.

Fields the car doesn't send show as **Unavailable** on the dashboard, never as 0. Unknown keys are listed under `ignored` in the reply, which helps catch typos. Remote commands are turned off in this mode, because the car doesn't listen for them.

## Troubleshooting

The Serial Monitor prints the server's reply whenever a post fails.

| Message | Fix |
|---|---|
| `cannot reach … (connection refused)` | The backend isn't running, is bound to `127.0.0.1`, or the IP or port in `LIGHTSYNC_URL` is wrong |
| `cannot reach … (read Timeout)` | The firewall is blocking port 8000, or the PC and car are on different networks |
| `HTTP 401: Missing or invalid device key` | `LIGHTSYNC_DEVICE_KEY` differs between `.env` and `secrets.h` |
| `HTTP 403: LIGHTSYNC_DEVICE_KEY must be configured` | Set it in `.env` and restart the backend |
| `HTTP 409: … demo mode` or `… LIGHTSYNC_LIVE_SOURCE …` | Set `LIGHTSYNC_MODE=live` and `LIGHTSYNC_LIVE_SOURCE=device`, then restart |
| `HTTP 429` | More than 300 posts a minute from one address; raise `UPLINK_INTERVAL_MS` |
