// Copy to secrets.h (git-ignored) and fill in. Never commit real values.
#pragma once
#define WIFI_SSID   "your-wifi-ssid"
#define WIFI_PASS   "your-wifi-password"

// Where the LightSync backend runs.
//  - On your PC: http://<PC IPv4 on the same Wi-Fi>:8000  (find it with ipconfig / ip addr)
//    and start uvicorn with --host 0.0.0.0, not 127.0.0.1.
//  - On a cloud server: https://your-domain.example
// No trailing slash.
#define LIGHTSYNC_URL        "http://192.168.1.50:8000"

// Must equal LIGHTSYNC_DEVICE_KEY in the backend's .env
#define LIGHTSYNC_DEVICE_KEY "paste-the-same-long-random-key-here"
