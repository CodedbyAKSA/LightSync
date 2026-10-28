// LightSync ESP32 gateway — receives ESP-NOW packets from the ESP8266 node,
// reads its own sensors and publishes everything to Blynk Cloud.
//
// Board: ESP32 (Arduino core 3.x). Library: Blynk (>= 1.3).
// Put credentials in secrets.h (git-ignored), see secrets.example.h.
//
// Datastreams below match the dashboard defaults (backend/app/datastreams.py).
// Create them in your Blynk template with the same pins, or change both sides.
//
//  V0 battery voltage (V)     V7..V9  gyro X/Y/Z (°/s)       V16 LCD status (0/1)
//  V1 battery current (A)     V10 obstacle distance (cm)     V17 autonomous state (0/1)
//  V2 state of charge (%)     V11 IR obstacle (0/1)          V18 e-stop latch state (0/1)
//  V3 state of health (%)     V12 vibration (0/1/2)          V19 autonomous REQUEST (write-only)
//  V4..V6 accel X/Y/Z (m/s²)  V13 drowsiness (0/1)           V20 e-stop REQUEST (write-only)
//  V15 ESP-NOW link (0/1)     V21 ESP-NOW packet loss (%)    V22 heartbeat counter
//
// SAFETY: the emergency stop MUST be enforced by hardware. Wire the physical
// e-stop button so it cuts motor-driver power directly (normally-closed loop),
// independent of this firmware, Wi-Fi and Blynk. The remote request below only
// adds a software latch on top of that circuit.

#include "secrets.h"  // defines BLYNK_TEMPLATE_ID, BLYNK_TEMPLATE_NAME, BLYNK_AUTH_TOKEN, WIFI_SSID, WIFI_PASS
#include <WiFi.h>
#include <esp_now.h>
#include <BlynkSimpleEsp32.h>
#include "lightsync_packet.h"

// ---- pins (example) ------------------------------------------------------
static const int PIN_MOTOR_ENABLE = 25;  // drives the motor-driver enable through the hardware e-stop loop
static const int PIN_ESTOP_SENSE  = 26;  // reads the physical e-stop loop (LOW = loop open = stopped)
// --------------------------------------------------------------------------

static const uint32_t LINK_TIMEOUT_MS = 1500;

BlynkTimer timer;
volatile uint32_t lastPacketMs = 0;
volatile uint32_t lastSeq = 0, received = 0, expected = 0;
LightSyncPacket latest;
portMUX_TYPE packetMux = portMUX_INITIALIZER_UNLOCKED;

bool autonomousMode = false;
bool remoteStopLatched = false;
uint32_t heartbeat = 0;

// ESP32 Arduino core 3.x signature. For core 2.x use:
//   void onEspNowRecv(const uint8_t *mac, const uint8_t *data, int len)
void onEspNowRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len != sizeof(LightSyncPacket)) return;
  LightSyncPacket p;
  memcpy(&p, data, sizeof(p));
  if (p.version != LIGHTSYNC_PACKET_VERSION) return;
  portENTER_CRITICAL(&packetMux);
  if (received > 0 && p.seq > lastSeq) expected += p.seq - lastSeq;
  else expected += 1;
  received++;
  lastSeq = p.seq;
  latest = p;
  lastPacketMs = millis();
  portEXIT_CRITICAL(&packetMux);
}

bool stopActive() {
  // Stopped if the physical loop is open OR a remote stop is latched.
  return digitalRead(PIN_ESTOP_SENSE) == LOW || remoteStopLatched;
}

void applyOutputs() {
  digitalWrite(PIN_MOTOR_ENABLE, stopActive() ? LOW : HIGH);
}

// ---- sensor hooks: replace with your drivers. Return NAN when unavailable ----
float readBatteryVoltage() { return NAN; }   // e.g. ADC + divider, or INA219 bus voltage
float readBatteryCurrent() { return NAN; }   // e.g. INA219 / ACS712
float readStateOfCharge()  { return NAN; }   // from your coulomb counter / fuel gauge
float readStateOfHealth()  { return NAN; }   // from your health estimator
bool  readImu(float a[3], float g[3]) { return false; }  // e.g. MPU6050: m/s² and °/s
int   readDrowsiness()     { return -1; }    // -1 = no detector fitted
bool  lcdActive()          { return true; }
// -----------------------------------------------------------------------------

void writeIfValid(uint8_t pin, float v) {
  if (!isnan(v)) Blynk.virtualWrite(pin, v);  // never publish a made-up value
}

void publish() {
  LightSyncPacket p;
  uint32_t age, rx, exp;
  portENTER_CRITICAL(&packetMux);
  p = latest;
  age = millis() - lastPacketMs;
  rx = received; exp = expected;
  portEXIT_CRITICAL(&packetMux);
  bool linkUp = lastPacketMs != 0 && age < LINK_TIMEOUT_MS;

  writeIfValid(V0, readBatteryVoltage());
  writeIfValid(V1, readBatteryCurrent());
  writeIfValid(V2, readStateOfCharge());
  writeIfValid(V3, readStateOfHealth());

  float a[3], g[3];
  if (readImu(a, g)) {
    Blynk.virtualWrite(V4, a[0]); Blynk.virtualWrite(V5, a[1]); Blynk.virtualWrite(V6, a[2]);
    Blynk.virtualWrite(V7, g[0]); Blynk.virtualWrite(V8, g[1]); Blynk.virtualWrite(V9, g[2]);
  }

  if (linkUp) {
    writeIfValid(V10, p.distance_cm);
    if (p.ir_obstacle != 255) Blynk.virtualWrite(V11, p.ir_obstacle);
    if (p.vibration != 255) Blynk.virtualWrite(V12, p.vibration);
  }
  int drowsy = readDrowsiness();
  if (drowsy >= 0) Blynk.virtualWrite(V13, drowsy);

  Blynk.virtualWrite(V15, linkUp ? 1 : 0);
  Blynk.virtualWrite(V16, lcdActive() ? 1 : 0);
  Blynk.virtualWrite(V17, autonomousMode ? 1 : 0);
  Blynk.virtualWrite(V18, stopActive() ? 1 : 0);  // confirms (or refutes) stop requests
  if (exp > 0) Blynk.virtualWrite(V21, 100.0f * (exp - rx) / exp);
  Blynk.virtualWrite(V22, ++heartbeat);
}

// Remote requests from the dashboard (via Blynk). The state pins above report
// what the hardware actually did; the dashboard waits for that confirmation.
BLYNK_WRITE(V19) {
  bool want = param.asInt() == 1;
  autonomousMode = want && !stopActive();  // never enter autonomous while stopped
  Blynk.virtualWrite(V17, autonomousMode ? 1 : 0);
}

BLYNK_WRITE(V20) {
  remoteStopLatched = param.asInt() == 1;
  if (remoteStopLatched) autonomousMode = false;
  applyOutputs();
  Blynk.virtualWrite(V18, stopActive() ? 1 : 0);
  Blynk.virtualWrite(V17, autonomousMode ? 1 : 0);
}

BLYNK_CONNECTED() {
  // Do not restore request pins from the server on reconnect: a stale stop
  // release must never re-enable motors after a reboot.
  Blynk.virtualWrite(V18, stopActive() ? 1 : 0);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_MOTOR_ENABLE, OUTPUT);
  digitalWrite(PIN_MOTOR_ENABLE, LOW);  // start stopped
  pinMode(PIN_ESTOP_SENSE, INPUT_PULLUP);

  WiFi.mode(WIFI_STA);
  Blynk.begin(BLYNK_AUTH_TOKEN, WIFI_SSID, WIFI_PASS);  // ESP-NOW then shares the router channel
  Serial.print("Gateway STA MAC (put this in the node sketch): ");
  Serial.println(WiFi.macAddress());

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
    ESP.restart();
  }
  esp_now_register_recv_cb(onEspNowRecv);

  timer.setInterval(1000L, publish);   // 1 Hz: ~15 writes/s, far below Blynk's 50 req/s limit
  timer.setInterval(50L, applyOutputs);
}

void loop() {
  Blynk.run();
  timer.run();
}
