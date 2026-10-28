# Configuring Blynk for LightSync

This guide connects the LightSync Safety Console to real hardware through **Blynk IoT**. It goes from an empty Blynk account to live data on the dashboard.

```
ESP8266 node ──ESP-NOW──▶ ESP32 gateway ──Wi-Fi──▶ Blynk Cloud ──HTTPS──▶ LightSync backend ──SSE──▶ dashboard
```

Only the **ESP32 gateway** talks to Blynk; the ESP8266 sends its readings to the gateway over ESP-NOW. The **Blynk token stays on the backend**. It's never put in the frontend or the browser.

You can finish steps 1–5 before any hardware exists, and step 6 lets you test the dashboard by writing values by hand.

---

## Contents

1. [Create a Blynk account and enable Developer Mode](#1-create-a-blynk-account-and-enable-developer-mode)
2. [Create the LightSync template](#2-create-the-lightsync-template)
3. [Add the datastreams](#3-add-the-datastreams)
4. [Create a device and copy its credentials](#4-create-a-device-and-copy-its-credentials)
5. [Configure the LightSync backend](#5-configure-the-lightsync-backend)
6. [Test live mode without hardware (optional)](#6-test-live-mode-without-hardware-optional)
7. [Flash the firmware](#7-flash-the-firmware)
8. [Switch the dashboard to live mode](#8-switch-the-dashboard-to-live-mode)
9. [Enable remote commands (optional)](#9-enable-remote-commands-optional)
10. [Using different pins](#10-using-different-pins)
11. [Blynk troubleshooting](#11-blynk-troubleshooting)

---

## 1. Create a Blynk account and enable Developer Mode

1. Sign up or log in at <https://blynk.cloud>.
2. Open **My Profile** (top-right corner of Blynk.Console) and switch **Developer Mode** on. Templates and datastreams are only editable in Developer Mode.
3. Note the **server address shown at the bottom right of Blynk.Console**, for example `blynk.cloud` or `fra1.blynk.cloud`. You'll need it for `BLYNK_SERVER`.

## 2. Create the LightSync template

1. Open **Developer Zone → My Templates** and click **+ New Template**.
2. Fill in:
   - **Name:** `LightSync`
   - **Hardware:** `ESP32`
   - **Connection type:** `WiFi`
3. Save. The template page now shows **Template ID** and **Firmware Configuration**. You'll copy them into the firmware in step 7.

## 3. Add the datastreams

Inside the template, open the **Datastreams** tab and click **+ New Datastream → Virtual Pin** for each row below. Use the **Datastream Name**, **Virtual Pin**, **Data Type**, **Unit**, **Min Value** and **Max Value** shown.

> The pins below are the LightSync defaults, and the example firmware uses the same ones. You can choose other pins; see [section 10](#10-using-different-pins).

### Telemetry (written by the gateway)

| Datastream Name | Virtual Pin | Data Type | Unit | Min | Max | Decimals |
|---|---|---|---|---|---|---|
| Battery voltage | V0 | Double | V | 0 | 60 | #.## |
| Battery current | V1 | Double | A | -50 | 50 | #.## |
| State of charge | V2 | Double | % | 0 | 100 | # |
| State of health | V3 | Double | % | 0 | 100 | # |
| Accel X | V4 | Double | m/s² | -160 | 160 | #.## |
| Accel Y | V5 | Double | m/s² | -160 | 160 | #.## |
| Accel Z | V6 | Double | m/s² | -160 | 160 | #.## |
| Gyro X | V7 | Double | °/s | -2000 | 2000 | #.# |
| Gyro Y | V8 | Double | °/s | -2000 | 2000 | #.# |
| Gyro Z | V9 | Double | °/s | -2000 | 2000 | #.# |
| Obstacle distance | V10 | Double | cm | 0 | 1000 | # |
| IR obstacle | V11 | Integer | — | 0 | 1 | — |
| Vibration | V12 | Integer | — | 0 | 2 | — |
| Drowsiness | V13 | Integer | — | 0 | 1 | — |
| Risk score *(optional)* | V14 | Double | — | 0 | 100 | # |
| ESP-NOW link | V15 | Integer | — | 0 | 1 | — |
| LCD status | V16 | Integer | — | 0 | 1 | — |
| Autonomous mode (state) | V17 | Integer | — | 0 | 1 | — |
| Emergency stop (state) | V18 | Integer | — | 0 | 1 | — |
| ESP-NOW packet loss *(optional)* | V21 | Double | % | 0 | 100 | #.# |
| Heartbeat *(recommended)* | V22 | Integer | — | 0 | 2147483647 | — |

Value meanings:

- **IR obstacle, Drowsiness, ESP-NOW link, LCD status, Autonomous mode, Emergency stop:** `1` = yes/on/detected, `0` = no/off/clear.
- **Vibration:** `0` = normal, `1` = warning, `2` = active.
- **Heartbeat:** a counter the gateway increments on every publish. It's the most reliable way for the dashboard to know data is fresh rather than stale.

### Command requests (written by the dashboard, read by the gateway)

Only needed if you enable remote commands ([section 9](#9-enable-remote-commands-optional)).

| Datastream Name | Virtual Pin | Data Type | Min | Max | Default Value |
|---|---|---|---|---|---|
| Autonomous mode request | V19 | Integer | 0 | 1 | 0 |
| Emergency stop request | V20 | Integer | 0 | 1 | 0 |

For both request pins:

- Turn **off** “Sync with the latest server value on reconnect”. An old request must never be replayed after the gateway reboots.
- Leave “Wait for confirmation from device” **off**. LightSync confirms commands itself by watching the state pins V17/V18.

### Important datastream settings

- **Min Value / Max Value:** Blynk *clamps* values outside this range to the limit. Keep the limits wider than what your sensors can really produce, otherwise a faulty reading can look like a valid one.
- **Expiration → “Invalidate after”:** optional. If you use it, set **“Then set to”** to *Blank* or *No data*, **not** *Default value*. A default value would make Blynk show a made-up reading after the device stops sending.
- **History:** *Last Value* is enough for LightSync, because the backend keeps its own rolling history.

**Save** the template when all datastreams are added.

## 4. Create a device and copy its credentials

1. Go to **Devices → Create New Device → From template**.
2. Choose the **LightSync** template, name the device (for example `LightSync gateway`) and click **Create**.
3. Blynk shows the firmware configuration:

   ```c
   #define BLYNK_TEMPLATE_ID   "TMPL..."
   #define BLYNK_TEMPLATE_NAME "LightSync"
   #define BLYNK_AUTH_TOKEN    "..."
   ```

   You can find these again later under **Devices → *your device* → Developer Tools**.

Treat `BLYNK_AUTH_TOKEN` like a password. Anyone with it can read and write your device's datastreams.

## 5. Configure the LightSync backend

1. In the project root, create `.env` from the template if you haven't already:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `.env`:

   ```ini
   LIGHTSYNC_MODE=live
   BLYNK_TOKEN=paste-the-device-auth-token-here
   BLYNK_SERVER=blynk.cloud          # use the host shown at the bottom right of Blynk.Console
   LIGHTSYNC_API_KEY=a-long-random-string
   PIN_HEARTBEAT=V22                 # if you added the heartbeat datastream
   PIN_ESPNOW_PACKET_LOSS=V21        # if you added it
   ```

   Generate the operator key with:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

3. Rules for these values:
   - `.env` is git-ignored. Never commit it.
   - Never put the token in `frontend/`, and never in a `VITE_*` variable. Vite copies those into the JavaScript sent to every browser.
   - `BLYNK_SERVER` is just the host name: no `https://` and no path.

## 6. Test live mode without hardware (optional)

Blynk's documented HTTPS API lets you write values yourself, which is handy before the firmware is ready. Keep the token out of your shell history by reading it into a variable.

In Git Bash, macOS or Linux:

```bash
read -rs BLYNK_TOKEN
```

```bash
curl "https://blynk.cloud/external/api/batch/update?token=$BLYNK_TOKEN&v0=12.4&v1=1.8&v2=92&v3=90&v10=84&v11=0&v12=0&v15=1&v16=1&v17=1&v18=0"
```

```bash
curl "https://blynk.cloud/external/api/getAll?token=$BLYNK_TOKEN"
```

In Windows PowerShell:

```powershell
$env:BLYNK_TOKEN = Read-Host "Blynk token"
```

```powershell
curl.exe "https://blynk.cloud/external/api/getAll?token=$env:BLYNK_TOKEN"
```

Replace `blynk.cloud` with your server.

`getAll` should return JSON such as `{"v0":12.4,"v1":1.8,...}`, and the dashboard cards will fill in. Without a device actually connected, Blynk reports the hardware as offline. The header therefore shows **OFFLINE** ("Blynk reports the gateway device is offline"), and the cards are marked *last known*. That's expected and honest: values written by hand aren't a live device.

## 7. Flash the firmware

Example sketches live in `firmware/`. Install the **Blynk** library (Arduino Library Manager) plus the ESP32 and ESP8266 board packages.

### ESP32 gateway: `firmware/esp32_gateway/`

1. Copy `secrets.example.h` to `secrets.h` (git-ignored) and fill in your values:

   ```c
   #define BLYNK_TEMPLATE_ID   "TMPL..."        // from step 4
   #define BLYNK_TEMPLATE_NAME "LightSync"
   #define BLYNK_AUTH_TOKEN    "..."            // from step 4
   #define WIFI_SSID           "your-wifi"
   #define WIFI_PASS           "your-password"
   ```

2. Replace the `read*()` sensor hooks with your sensor drivers. Until you do, they return `NAN` or `false`, and the gateway publishes **nothing** for those fields, so the dashboard shows them as *Unavailable* rather than as fake zeros.
3. Upload, then open the Serial Monitor at 115200 baud. You should see Blynk's `Ready (ping: …ms)` line and the gateway's **STA MAC address**. Copy that MAC.

### ESP8266 node: `firmware/esp8266_node/`

1. Set `GATEWAY_MAC` to the MAC printed by the gateway, and `ROUTER_SSID` to the gateway's Wi-Fi network. The node uses the SSID to find the same Wi-Fi channel, which ESP-NOW requires.
2. Upload.

Back in Blynk.Console, the device should show **Online** and its datastreams should update about once per second.

## 8. Switch the dashboard to live mode

Restart the backend so it reads `.env` (see [RUNNING.md](RUNNING.md)), or use **Settings → Data source → Switch to live** in the dashboard.

Check that it's working:

| Where | What you should see |
|---|---|
| Header | **SYSTEM ONLINE** (green) |
| Footer | `Live mode · Blynk <server> · live` |
| Cards | values with a **Hardware** badge on the Live Sensors page |
| Device Network page | Token configured: yes; API reachable: yes; Hardware connected: yes |
| Settings → Datastream mapping | every pin you use shown as mapped |

If a card says **Unavailable**, either that field has no pin mapped or the datastream has no value in Blynk yet. **Invalid** means a value arrived but failed validation, for example out of range or not a number.

## 9. Enable remote commands (optional)

Remote commands let the dashboard *request* a change in autonomous mode or the emergency stop. The hardware decides and reports back.

1. Make sure the request datastreams V19/V20 exist (step 3) and the firmware handles them. The example sketch does: it applies the request, then writes the resulting state to V17/V18.
2. In `.env`:

   ```ini
   COMMANDS_ENABLED=true
   PIN_CMD_AUTONOMOUS_MODE=V19
   PIN_CMD_EMERGENCY_STOP=V20
   LIGHTSYNC_API_KEY=a-long-random-string
   ```

3. Restart the backend.
4. In the dashboard, open **Settings → Operator access** and enter the `LIGHTSYNC_API_KEY` value. It's stored for the browser session only.
5. Use the controls on **Overview → Dark Factory Automation** or on the **Automation** page. Every command asks for confirmation, and its result shows as:
   - **acknowledged:** the hardware reported the requested state on V17/V18.
   - **unconfirmed:** the request was written, but the hardware didn't confirm it within `COMMAND_ACK_TIMEOUT` seconds.
   - **failed:** Blynk rejected the write.

> **Safety:** the dashboard's emergency stop is a *request* over the internet. The vehicle must have a physical emergency-stop circuit that cuts motor power on its own, without depending on Wi-Fi, Blynk or this dashboard.

## 10. Using different pins

If your template or firmware already uses other pins, don't rename anything in Blynk. Point LightSync at your pins in `.env` instead:

```ini
PIN_OBSTACLE_DISTANCE=V30
PIN_BATTERY_VOLTAGE=V31
PIN_DROWSINESS=none        # this hardware has no drowsiness sensor → shown as "Sensor Unavailable"
```

- The variable is `PIN_` followed by the field name in capitals. The full list is in `.env.example` and on **Settings → Datastream mapping**.
- Allowed values are `V0`–`V255`, or `none`.
- The same pin can't be used twice. A command request pin must be different from its state pin.
- Restart the backend after changing pins. Mistakes appear as a yellow warning on the **Settings** page, and the backend falls back to the default pins.

## 11. Blynk troubleshooting

| What you see | Cause and fix |
|---|---|
| **OFFLINE** – “BLYNK_TOKEN is not configured on the server” | `BLYNK_TOKEN` is empty or `.env` wasn't found. Put `.env` in the project root (or `backend/`) and restart the backend. |
| **OFFLINE** – “Blynk /getAll returned HTTP 400: Invalid token.” | Wrong token, or a token from another region. Copy it again from **Devices → *device* → Developer Tools** and check that `BLYNK_SERVER` matches the host at the bottom right of Blynk.Console. |
| **OFFLINE** – “Timed out contacting …” / “Network error contacting …” | The backend PC can't reach Blynk. Check internet access, proxy or firewall, and the spelling of `BLYNK_SERVER`. |
| **OFFLINE** – “Blynk reports the gateway device is offline” | The ESP32 isn't connected. Check its power and Wi-Fi details, and that its Serial Monitor shows `Ready`. Templates and devices must match the token used in the firmware. |
| **DATA STALE** | Values stopped changing. Make sure the gateway publishes on a timer and that the heartbeat (V22) increments. Map it with `PIN_HEARTBEAT=V22`. You can raise `TELEMETRY_FRESHNESS_SECONDS` if your publish interval is long. |
| Card shows **Unavailable** | That pin isn't mapped, or the datastream has never received a value. Blynk's `getAll` omits datastreams with no stored value. |
| Card shows **Invalid** | The value is the wrong type (for example text in a numeric stream) or outside LightSync's accepted range. Hover over the reading tile on Live Sensors to see the reason. |
| ESP-NOW link **Disconnected** | `GATEWAY_MAC` in the node sketch is wrong, or the two boards are on different Wi-Fi channels. Check that `ROUTER_SSID` matches the gateway's Wi-Fi. |
| “Blynk rate limit reached” | Polling is too fast or too many tools use the same token. Raise `BLYNK_POLL_INTERVAL`; the backend backs off automatically. |
| Command result **unconfirmed** | The gateway didn't write the new state back to V17/V18. Check the `BLYNK_WRITE(V19)` / `BLYNK_WRITE(V20)` handlers in the firmware. |
| Command refused: “COMMANDS_ENABLED is false…” / “PIN_CMD_… is not set” | Complete [section 9](#9-enable-remote-commands-optional). |
| “Missing or invalid operator key” (401) / “LIGHTSYNC_API_KEY must be configured…” (403) | Set `LIGHTSYNC_API_KEY` in `.env`, restart, then enter the same key in **Settings → Operator access**. |

For general start-up problems (ports, Python, Node, blank pages), see [RUNNING.md](RUNNING.md#troubleshooting).
