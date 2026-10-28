// Shared ESP-NOW payload between the ESP8266 node and the ESP32 gateway.
// Identical copies live in both sketch folders (the Arduino IDE only sees files
// inside the sketch folder). Keep them in sync.
#pragma once
#include <stdint.h>

#define LIGHTSYNC_PACKET_VERSION 1

// Packed so both chips agree on the layout byte-for-byte.
typedef struct __attribute__((packed)) {
  uint8_t  version;        // LIGHTSYNC_PACKET_VERSION
  uint32_t seq;            // increments every packet; used for loss estimation
  float    distance_cm;    // NAN when the ultrasonic sensor has no echo
  uint8_t  ir_obstacle;    // 0 clear, 1 detected, 255 sensor missing
  uint8_t  vibration;      // 0 normal, 1 warning, 2 active, 255 sensor missing
} LightSyncPacket;
