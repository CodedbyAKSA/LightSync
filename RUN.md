# RUN — LightSync from start to end

Every command you need, in order: install, configure, start the dashboard, flash the car, and see live car data on screen.

Commands are for **Windows PowerShell**, since that's what the project is built on. macOS/Linux equivalents are in [docs/RUNNING.md](docs/RUNNING.md).

```
ESP32 car ──Wi-Fi / HTTP POST──▶ backend (FastAPI, port 8000) ──SSE──▶ dashboard (port 5173)
```

---

## Part 1 — One-time installs

| Install | Get it from | Check |
|---|---|---|
| Python 3.11+ (tick **Add to PATH**) | python.org | `python --version` |
| Node.js 22 LTS | nodejs.org | `node --version` |
| Git | git-scm.com | `git --version` |
| Arduino IDE 2 | arduino.cc | — |

In Arduino IDE:

1. **File → Preferences → Additional boards manager URLs**, add:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. **Boards Manager** → install **esp32 by Espressif Systems** (3.x).
3. **Library Manager** → install **MPU6050** (Electronic Cats) and **LiquidCrystal I2C** (Frank de Brabander).

## Part 2 — Get the code (once)

```powershell
git clone https://github.com/CodedbyAKSA/lightsync.git
```

```powershell
cd lightsync
```

## Part 3 — Install the backend and frontend (once)

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
cd ..
```

```powershell
cd frontend; npm install; cd ..
```

## Part 4 — Configure `.env` (once)

```powershell
Copy-Item .env.example .env
```

Generate two different keys. Run this twice and keep both outputs:

```powershell
py -c "import secrets; print(secrets.token_urlsafe(32))"
```

Open `.env` in Notepad:

```powershell
notepad .env
```

Set these lines; leave everything else as it is:

```ini
LIGHTSYNC_MODE=live
LIGHTSYNC_LIVE_SOURCE=device
LIGHTSYNC_DEVICE_KEY=<first key>     # the car sends this
LIGHTSYNC_API_KEY=<second key>       # you type this into the dashboard's Settings
THRESHOLD_BATTERY_MIN_VOLTAGE=6.6    # 2-cell pack; use 9.9 for a 3-cell pack
```

`.env` is git-ignored. Never commit it.

## Part 5 — Let the car reach your PC (once per Wi-Fi network)

1. **Connect the PC to the same 2.4 GHz Wi-Fi the car will use.** A phone hotspot works too.
2. **Set that network to Private:** Settings → Network & internet → Wi-Fi → your network → **Private network**.
3. **Open port 8000** in PowerShell **run as Administrator**:

   ```powershell
   New-NetFirewallRule -DisplayName "LightSync 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
   ```

4. **Find the PC's IPv4 address.** Look for `IPv4 Address` under your Wi-Fi adapter, for example `192.168.1.50`:

   ```powershell
   ipconfig
   ```

   This address can change when you reconnect, so check it again whenever the car can't connect.

## Part 6 — Start the dashboard (every time)

You need two PowerShell windows, both in the `lightsync` folder.

**Window 1 — backend.** `0.0.0.0` lets the car reach it over Wi-Fi:

```powershell
cd backend; .venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Wait for `Uvicorn running on http://0.0.0.0:8000`.

**Window 2 — frontend:**

```powershell
cd frontend; npm run dev
```

Open **http://localhost:5173**. Until the car posts, the header shows **OFFLINE** with *Waiting for the car to POST to /api/device/telemetry*. That's expected.

**Quick check from your phone** (same Wi-Fi): open `http://<PC IP>:8000/api/health`. If you see `{"status":"ok", …}`, the car will be able to reach the backend too. If not, re-check Part 5.

## Part 7 — Flash the car (when the code or settings change)

1. Open `firmware\lightsync_car\lightsync_car.ino` in Arduino IDE.
2. Edit the four lines under **YOUR SETTINGS**:

   ```cpp
   #define WIFI_SSID            "your Wi-Fi name"
   #define WIFI_PASS            "your Wi-Fi password"
   #define LIGHTSYNC_URL        "http://192.168.1.50:8000"   // your PC's IPv4, no trailing /
   #define LIGHTSYNC_DEVICE_KEY "<first key from Part 4>"
   ```

3. **Tools → Board → esp32 → ESP32 Dev Module**, and pick the COM port.
4. Plug in USB and click **Upload**. If it sticks at `Connecting…`, hold the **BOOT** button until uploading starts.
5. Open **Serial Monitor** at **115200** baud.

Don't commit the `.ino` with your real Wi-Fi password and key. To keep them out of the file, copy `secrets.example.h` to `secrets.h` in the same folder and put them there; it's picked up automatically and git-ignored.

## Part 8 — Run the car and see its data (every time)

1. **Power the car from its batteries.** The motor pack goes to the L298N 12V; the ESP32 runs from the buck converter. Keep all grounds joined, and keep the L298N **5V pin unconnected**.
2. **Watch the LCD.** You'll see the boot steps, then `READY`, then the readings:

   ```
   I 810mA FWD  OK      ← OK = data reaching the dashboard
   Batt: 97%  8.31V
   ```

   The end of the top line is `OK` (posting works), `ERR` (Wi-Fi works but posting fails) or `--` (no Wi-Fi yet).
3. **Watch Serial Monitor** (only while USB is plugged in):

   ```
   [WIFI] connected, IP 192.168.1.73, RSSI -58 dBm
   [UPLINK] OK → http://192.168.1.50:8000/api/device/telemetry
   ```

4. **Watch the dashboard** at http://localhost:5173:
   - The header turns **SYSTEM ONLINE**.
   - **Overview:** obstacle distance, battery, motion and risk.
   - **Live Sensors:** accelerometer, gyro and distance charts.
   - **Safety Events:** obstacles, accidents (shown as *Emergency stop activated*) and connection changes.
   - **Device Network:** *LightSync car · online*, with a rising *posts received* count.
5. **Switch the car off.** Within 15 seconds the header changes to **DATA STALE**. That's how you know the screen is showing real data.

## Part 8b — ML Insights (XGBoost)

After pulling this update, install the new backend packages (xgboost, numpy) once:

```powershell
cd backend; .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt; cd ..
```

The backend loads the trained model from `ml/models/risk_xgb.json` at startup. Open **ML Insights** in the sidebar to see:
- the live prediction (safe / caution / danger / accident) and its probabilities,
- test accuracy, the confusion matrix and feature importance,
- how the training data is synthesized.

The Overview safety card also shows a one-line "XGBoost prediction".

To regenerate the data and retrain (optional; a trained model is already included):

```powershell
cd backend; .\.venv\Scripts\python.exe -m pip install -r ..\ml\requirements.txt
```

```powershell
.\.venv\Scripts\python.exe ..\ml\synthesize.py; .\.venv\Scripts\python.exe ..\ml\train.py; cd ..
```

Restart the backend afterwards. Details: [ml/README.md](ml/README.md).

## Part 9 — Stop everything

Press `Ctrl+C` in both PowerShell windows and switch off the car.

## Part 10 — Checks for developers

```powershell
cd backend; .venv\Scripts\python -m pytest; cd ..
```

```powershell
cd frontend; npm run lint; npm test; npm run build; cd ..
```

## Part 11 — Demo mode (no hardware)

Set `LIGHTSYNC_MODE=demo` in `.env` and restart the backend. Every value is then simulated and labelled **Demo**.

---

## If something doesn't work

| Symptom | Fix |
|---|---|
| Arduino: `secrets.h: No such file or directory` | You have an old copy of the sketch. Use the current `lightsync_car.ino`, which builds on its own. |
| LCD stuck on boot steps, or keeps rebooting | Power problem. Check the boot number on the LCD's top line: if it keeps rising, the ESP32 is resetting. Check the buck converter output (5.0 V), the common ground, and that the L298N 5V pin isn't connected. |
| LCD shows `--` | Wi-Fi isn't joined. The bottom line flashes the cause (`WiFi: SET SSID`, `NOT FOUND`, `BAD PASS?`, `JOINING..`). In Serial Monitor the boot scan lists every network the car can see, and `can't join … (reason …)` says why |
| Serial: `WIFI NOT FOUND` / `NO_AP_FOUND` | Hotspot off, set to 5 GHz, or `WIFI_SSID` misspelled (case and spaces matter) |
| Serial: `AUTH_FAIL` / `HANDSHAKE_TIMEOUT` | Wrong `WIFI_PASS`, or the hotspot is WPA3-only; switch it to WPA2 or WPA2/WPA3 |
| `Front=999.0` and `Rear=999.0` all the time | Both ultrasonics get no echo, usually no 5V. They need 5V from the buck converter, not the L298N 5V pin |
| LCD shows `ERR`; Serial says `connection refused` | The backend isn't running, was started with `127.0.0.1`, or `LIGHTSYNC_URL` has the wrong IP |
| LCD shows `ERR`; Serial says `read Timeout` | The firewall is blocking port 8000, or the network is set to Public (Part 5) |
| Serial: `HTTP 401` | `LIGHTSYNC_DEVICE_KEY` in the sketch and in `.env` differ |
| Serial: `HTTP 403` | `LIGHTSYNC_DEVICE_KEY` is empty in `.env`; set it and restart the backend |
| Serial: `HTTP 409` | `.env` isn't set to `LIGHTSYNC_MODE=live` and `LIGHTSYNC_LIVE_SOURCE=device`; fix it and restart the backend |
| Dashboard says DEMO MODE | Same as `HTTP 409`, then restart the backend |
| Battery voltage warning all the time | Set `THRESHOLD_BATTERY_MIN_VOLTAGE` for your pack (Part 4) |

More detail: [docs/CAR_HTTP_SETUP.md](docs/CAR_HTTP_SETUP.md) (car uplink, battery estimate, error list) and [docs/RUNNING.md](docs/RUNNING.md) (general running and deployment).
