// LightSync ESP8266 node — reads obstacle sensors and sends them to the ESP32
// gateway over ESP-NOW. This board never talks to Blynk or the internet.
//
// Board: ESP8266 (Arduino core 3.x). Wiring is an example; adjust pins.
//   HC-SR04  TRIG -> D5, ECHO -> D6 (use a divider on ECHO: 5 V -> 3.3 V)
//   IR obstacle sensor OUT -> D7 (LOW = obstacle on most modules)
//   SW-420 vibration OUT -> D1
//
// ESP-NOW only works when both radios are on the same Wi-Fi channel. The
// gateway is on its router's channel, so this node scans for the router SSID
// and switches to that channel before sending.

#include <ESP8266WiFi.h>
#include <espnow.h>
#include "lightsync_packet.h"

// ---- configure ---------------------------------------------------------
static uint8_t GATEWAY_MAC[6] = {0x24, 0x6F, 0x28, 0x00, 0x00, 0x00};  // ESP32 STA MAC (print it from the gateway)
static const char *ROUTER_SSID = "YOUR_WIFI_SSID";                    // only used to discover the channel
static const uint8_t PIN_TRIG = D5, PIN_ECHO = D6, PIN_IR = D7, PIN_VIB = D1;
static const uint32_t SEND_INTERVAL_MS = 200;
// ------------------------------------------------------------------------

static LightSyncPacket packet;
static uint32_t lastSend = 0;
static uint32_t vibrationHits = 0;
static uint32_t vibrationWindowStart = 0;

static int32_t channelForSsid(const char *ssid) {
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    if (WiFi.SSID(i) == ssid) return WiFi.channel(i);
  }
  return 1;
}

static float readDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000UL);  // ~5 m timeout
  if (us == 0) return NAN;                               // no echo: unknown, not 0
  return us * 0.0343f / 2.0f;
}

static uint8_t readVibration() {
  if (digitalRead(PIN_VIB) == HIGH) vibrationHits++;
  if (millis() - vibrationWindowStart >= 1000) {
    uint8_t level = vibrationHits > 20 ? 2 : vibrationHits > 5 ? 1 : 0;
    vibrationHits = 0;
    vibrationWindowStart = millis();
    packet.vibration = level;
  }
  return packet.vibration;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_IR, INPUT);
  pinMode(PIN_VIB, INPUT);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  int32_t channel = channelForSsid(ROUTER_SSID);
  wifi_set_channel(channel);
  Serial.printf("ESP-NOW channel %d\n", channel);

  if (esp_now_init() != 0) {
    Serial.println("ESP-NOW init failed");
    ESP.restart();
  }
  esp_now_set_self_role(ESP_NOW_ROLE_CONTROLLER);
  esp_now_add_peer(GATEWAY_MAC, ESP_NOW_ROLE_SLAVE, channel, NULL, 0);
  packet.version = LIGHTSYNC_PACKET_VERSION;
}

void loop() {
  readVibration();
  if (millis() - lastSend < SEND_INTERVAL_MS) return;
  lastSend = millis();

  packet.seq++;
  packet.distance_cm = readDistanceCm();
  packet.ir_obstacle = digitalRead(PIN_IR) == LOW ? 1 : 0;
  esp_now_send(GATEWAY_MAC, reinterpret_cast<uint8_t *>(&packet), sizeof(packet));
}
