/***********************************************************************
 *  lightsync_car.ino  —  autonomous car → LightSync dashboard (v26)
 *
 *  One ESP32 does everything: drives the motors, reads the sensors and
 *  POSTs a JSON snapshot straight to the LightSync backend over Wi-Fi
 *  (same idea as the TrafficIntelli gateway). No ESP-NOW, no Blynk.
 *
 *     ESP32 car ──Wi-Fi / HTTP POST──▶ LightSync API ──SSE──▶ dashboard
 *               POST {LIGHTSYNC_URL}/api/device/telemetry
 *               header X-Device-Key: {LIGHTSYNC_DEVICE_KEY}
 *
 *  Board: ESP32 Dev Module (Arduino core 3.x)
 *  Libraries: MPU6050 (Electronic Cats), LiquidCrystal I2C
 *  Fill in YOUR SETTINGS below (Wi-Fi, server address, device key).
 *  Optional: put them in a secrets.h next to this file instead (see
 *  secrets.example.h); if secrets.h exists it is used automatically.
 *
 *  v26 changes vs v25:
 *    • ESP-NOW peers, SensorPacket and Blynk removed
 *    • Uplink task on core 0 posts telemetry every UPLINK_INTERVAL_MS;
 *        a slow or dead server can never freeze driving (core 1)
 *    • Battery voltage always sent: estimated from charge used and a
 *        Li-ion discharge curve, or measured on GPIO36 (USE_BATT_ADC = 1)
 *    • Vibration sensor removed
 *    • LCD line 1 shows the uplink state: OK / ERR / -- (no Wi-Fi);
 *        line 2 flashes the Wi-Fi problem (SET SSID / NOT FOUND / BAD PASS?)
 *    • Navigation, motor soft-start, accident detection: same as v25
 *
 *  Fields sent (LightSync keys):
 *    obstacle_distance        front ultrasonic, cm (400 = nothing in range)
 *    obstacle_distance_rear   rear ultrasonic, cm (400 = nothing in range)
 *    obstacle_distance_left/right  side ultrasonics (only when USE_SIDE_ULTRASONIC = 1)
 *    ir_left, ir_right  1 when that IR edge sensor triggers
 *    ir_obstacle        1 if either IR sensor triggers
 *    accel_x/y/z        m/s²     gyro_x/y/z  °/s
 *    battery_voltage    V  (estimated, or measured when USE_BATT_ADC = 1)
 *    battery_soc        %
 *    lcd_status, autonomous_mode, emergency_stop (= accident hold), heartbeat
 ***********************************************************************/

/*************** TYPES FIRST — before any includes ***************/
// (Arduino puts auto-generated prototypes above the sketch, so types they use go here.)
enum MotorCmd { MC_NONE, MC_STOP, MC_FORWARD, MC_BACKWARD, MC_STEER_R, MC_STEER_L };
void applyCmd(MotorCmd cmd);

// Snapshot the driving loop hands to the uplink task
struct CarTelemetry {
  float    front, rear, left, right;   // cm, 400 = nothing in range
  bool     irL, irR, irAny;
  float    ax, ay, az, gx, gy, gz;
  bool     mpuOk;           // false = MPU not answering, accel/gyro not sent
  float    battV;           // estimated or measured, volts
  int      soc;
  bool     lcdOk;
  bool     accident;
  bool     valid;
};

/*************** INCLUDES ***************/
/***********************************************************************
 *  YOUR SETTINGS — edit these four lines
 *  LIGHTSYNC_URL: http://<your PC's IPv4 on the same Wi-Fi>:8000  (no trailing /)
 *  LIGHTSYNC_DEVICE_KEY: exactly the same as LIGHTSYNC_DEVICE_KEY in .env
 ***********************************************************************/
#if __has_include("secrets.h")
  #include "secrets.h"
#else
  #define WIFI_SSID            "Karthikkk"
  #define WIFI_PASS            "karthik2005"
  #define LIGHTSYNC_URL        "http://10.58.35.57:8000"   // PC Wi-Fi IPv4 (ipconfig) — recheck if it changes
  #define LIGHTSYNC_DEVICE_KEY "bcM7yuw1fkBcBzPZ6kF89_8NGwhSGSMqgA3jcqo-NJU"   // = LIGHTSYNC_DEVICE_KEY in .env
#endif
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_system.h"
#include <Wire.h>
#include <MPU6050.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <LiquidCrystal_I2C.h>

/*************** UPLINK ***************/
#define UPLINK_INTERVAL_MS  1000   // one post per second
#define UPLINK_TIMEOUT_MS   3000
#define WIFI_RETRY_MS       20000  // start a fresh join if not connected for this long
// 0 = full Wi-Fi power (best range). Set 1 only if the ESP32 resets when Wi-Fi starts.
#define WIFI_LOW_TX_POWER   0
const char* TELEMETRY_PATH = "/api/device/telemetry";

/*************** BATTERY ***************/
// Pack being watched (default: the 2-cell 2000 mAh pack that runs the ESP32)
#define BATT_CELLS      2
#define BATT_START_PCT  100     // charge when switched on (used while estimating)
#define CELL_RINT_OHM   0.08f   // internal resistance per cell → voltage sag under load
#define BATT_SMOOTH     0.15f   // smoothing per sensor update (~3 s settle, like a real pack)

// Without a divider the voltage is ESTIMATED: open-circuit voltage from the
// Li-ion curve at the estimated charge, minus I×R sag for the motor state.
// It tracks the real pack only as well as BATT_START_PCT and the current
// figures (CURRENT_*_MA) match reality — wire the divider for a true reading.
//
// Optional real measurement — voltage divider to GPIO36 (VP):
//   pack + ── R1 ──┬── R2 ── GND        GPIO36 ── junction
// 2-cell pack (8.4 V max): R1 = 100k, R2 = 47k  → 2.7 V at the pin
// 3-cell pack (12.6 V max): R1 = 100k, R2 = 22k → 2.3 V at the pin
// Never let the pin see more than 3.3 V. Leave USE_BATT_ADC at 0 until wired.
#define USE_BATT_ADC    0
#define BATT_ADC_PIN    36
#define BATT_R1_KOHM    100.0f
#define BATT_R2_KOHM    47.0f

// Li-ion open-circuit voltage per cell at 0, 10, 20 … 100 % charge
const float OCV_TABLE[11] = { 3.20f, 3.55f, 3.68f, 3.74f, 3.77f, 3.80f,
                              3.84f, 3.90f, 3.97f, 4.06f, 4.20f };

/*************** MOTOR PINS ***************/
#define EN_RIGHT   33
#define IN1        13
#define IN2        27
#define EN_LEFT    14
#define IN3        25
#define IN4        26
#define MAX_SPEED  150
#define TURN_SPEED 150
#define PWM_FREQ   1000
#define PWM_RES    8

// Soft-start: PWM climbs RAMP_STEP every RAMP_INTERVAL_MS (0→150 in ~90 ms)
#define RAMP_STEP         25
#define RAMP_INTERVAL_MS  15

/*************** SENSOR PINS ***************/
#define IR_LEFT        34
#define IR_RIGHT       35
#define TRIG_PIN        5
#define ECHO_PIN       18
#define TRIG_PIN_REAR   2  // NOTE: GPIO2 = on-board blue LED on most boards (it will blink faintly)
#define ECHO_PIN_REAR   4

// Optional left/right ultrasonics — display only, they don't change driving.
// Wire two more HC-SR04s (5V, GND) and set USE_SIDE_ULTRASONIC to 1.
#define USE_SIDE_ULTRASONIC 0
#define TRIG_PIN_LEFT  32
#define ECHO_PIN_LEFT  39   // input-only pin, fine for ECHO
#define TRIG_PIN_RIGHT 17
#define ECHO_PIN_RIGHT 16

MPU6050 mpu(0x68);

/*************** HARDWARE STATUS (filled in setup) ***************/
bool lcdPresent = false;
bool mpuPresent = false;   // MPU found and initialised
bool mpuOk      = false;   // last reading was real (not zeros / frozen)

/*************** BOOT DIAGNOSTICS ***************/
RTC_DATA_ATTR int bootCount = 0;   // survives resets, cleared on power-off

const char* resetReasonStr(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON:  return "PWRON";
    case ESP_RST_EXT:      return "EXT";
    case ESP_RST_SW:       return "SW";
    case ESP_RST_PANIC:    return "PANIC";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:      return "WDT";
    case ESP_RST_BROWNOUT: return "BROWN";
    case ESP_RST_DEEPSLEEP:return "SLEEP";
    default:               return "OTHER";
  }
}

/*************** TIMING ***************/
unsigned long lastSensorMs = 0;
#define SENSOR_MS 400

/*************** STARTUP DELAY ***************/
#define STARTUP_DELAY_MS 2000
unsigned long bootMs = 0;

/***********************************************************************
 *  DISTANCE THRESHOLDS
 *
 *    Front  > 30 cm          → FORWARD   (rear is ignored when going forward)
 *    Front 25–30 cm (incl.)  → STOP      (dead-band, prevents oscillation)
 *    Front  < 25 cm          → BACKWARD  — but ONLY if rear > 25 cm,
 *                                          otherwise STOP
 ***********************************************************************/
#define FRONT_STOP_NEAR_CM   25.0f
#define FRONT_STOP_FAR_CM    30.0f
#define REAR_STOP_CM         25.0f
#define MAX_REVERSE_MS       1200

/***********************************************************************
 *  FALL / ACCIDENT DETECTION THRESHOLDS  (unchanged from v24)
 *
 *  A) WHILE MOVING:  Amp >= CRASH_AMP_MIN → instant ALERT
 *  B) WHILE STOPPED: 3-stage chain T1 free-fall → T2 impact → T3 rotation
 ***********************************************************************/
#define T1_AMP_MAX          7
#define T2_AMP_MIN         10
#define T3_ANGLE_MIN        5
#define T3_ANGLE_MAX      400
#define T3_CONFIRM_COUNT    3
#define STAGE_TIMEOUT      15

#define CRASH_AMP_MIN      20     // moving-mode instant crash threshold — TUNE THIS

#define ALERT_HOLD_MS    4000     // car stays stopped + LCD shows alert this long
unsigned long alertUntilMs = 0;

/***********************************************************************
 *  LCD + BATTERY ESTIMATOR
 ***********************************************************************/
#define LCD_ADDR        0x27
#define LCD_UPDATE_MS    600

#define BATTERY_MAH      2000.0f
#define CURRENT_STOP_MA      80
#define CURRENT_FORWARD_MA  810
#define CURRENT_BACKWARD_MA 810
#define CURRENT_STEER_MA    450

LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);

float         battMahUsed    = 0.0f;
unsigned long lastCurrentMs  = 0;
unsigned long lastLcdMs      = 0;
bool          lcdAlertActive = false;

// Prints a boot step on LCD line 2 and Serial — shows where boot stops
void bootStep(const char* msg) {
  char buf[17];
  snprintf(buf, sizeof(buf), "%-16s", msg);
  lcd.setCursor(0, 1); lcd.print(buf);
  Serial.printf("[BOOT] %s\n", msg);
}

/***********************************************************************
 *  LIVE SENSOR VALUES  (written on core 1, read by the uplink task)
 ***********************************************************************/
char  motorState[16] = "STOP";
bool  irLeftNow = false, irRightNow = false;
float accelX = 0, accelY = 0, accelZ = 0;   // g
float gyroX  = 0, gyroY  = 0, gyroZ  = 0;   // °/s
float battVolts = NAN;

CarTelemetry  shared = {};
portMUX_TYPE  sharedMux = portMUX_INITIALIZER_UNLOCKED;

// Uplink status for LCD / Serial
volatile int  uplinkHttpCode = 0;      // last HTTP status, <0 = transport error, 0 = never
volatile bool uplinkOk       = false;
volatile uint8_t wifiReason  = 0;      // last Wi-Fi disconnect reason, 0 = none yet
bool          wifiSeen       = true;   // boot scan found WIFI_SSID

/***********************************************************************
 *  ULTRASONIC — front and rear pinged ALTERNATELY (no cross-talk)
 ***********************************************************************/
float         cachedDist     = 999.0;
float         cachedDistRear = 999.0;
float         cachedDistLeft = 999.0;
float         cachedDistRight = 999.0;
unsigned long lastPingMs     = 0;
bool          pingFrontNext  = true;
#define PING_INTERVAL_MS 30            // each sensor refreshes every 60 ms

float pingCm(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH); delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long dur = pulseIn(echoPin, HIGH, 25000);
  if (dur == 0) return 999.0f;               // no echo = nothing in range
  float cm = (dur * 0.034f) / 2.0f;
  return (cm < 2.0f) ? 999.0f : cm;          // < 2 cm is sensor noise
}

void updateUltrasonics() {
  if (millis() - lastPingMs < PING_INTERVAL_MS) return;
  lastPingMs = millis();
#if USE_SIDE_ULTRASONIC
  // Front every other slot so obstacle avoidance stays as fast as before
  static uint8_t slot = 0;
  switch (slot) {
    case 0: case 2: case 4: cachedDist      = pingCm(TRIG_PIN,       ECHO_PIN);       break;
    case 1:                 cachedDistRear  = pingCm(TRIG_PIN_REAR,  ECHO_PIN_REAR);  break;
    case 3:                 cachedDistLeft  = pingCm(TRIG_PIN_LEFT,  ECHO_PIN_LEFT);  break;
    case 5:                 cachedDistRight = pingCm(TRIG_PIN_RIGHT, ECHO_PIN_RIGHT); break;
  }
  slot = (slot + 1) % 6;
#else
  if (pingFrontNext) cachedDist     = pingCm(TRIG_PIN,      ECHO_PIN);
  else               cachedDistRear = pingCm(TRIG_PIN_REAR, ECHO_PIN_REAR);
  pingFrontNext = !pingFrontNext;
#endif
}

/*************** IR DEBOUNCE ***************/
#define IR_DEBOUNCE_MS 60
unsigned long irLFirstMs = 0;
unsigned long irRFirstMs = 0;
bool          irLPrev    = false;
bool          irRPrev    = false;

bool stableIR(bool rawReading, bool& prevState, unsigned long& firstMs) {
  if (rawReading) {
    if (!prevState) { prevState = true; firstMs = millis(); }
    return (millis() - firstMs >= IR_DEBOUNCE_MS);
  } else {
    prevState = false; firstMs = 0;
    return false;
  }
}

/*************** STEER HOLD ***************/
#define STEER_HOLD_MS 400
unsigned long lastSteerMs = 0;
bool          inSteer     = false;

/*************** REVERSE TIMEOUT ***************/
unsigned long reverseStartMs = 0;
bool          inReverse      = false;

// ═══════════════════════════════════════════════════════════════════════
//  MOTOR COMMANDS  (with soft-start ramp)
// ═══════════════════════════════════════════════════════════════════════
int           pwmTargetR = 0, pwmTargetL = 0;
int           pwmNowR    = 0, pwmNowL    = 0;
unsigned long lastRampMs = 0;

// Cut power, set direction, then let rampMotors() bring PWM up gently
void setMotors(bool in1, bool in2, bool in3, bool in4, int targetR, int targetL) {
  pwmNowR = 0; pwmNowL = 0;
  ledcWrite(EN_RIGHT, 0); ledcWrite(EN_LEFT, 0);
  digitalWrite(IN1, in1); digitalWrite(IN2, in2);
  digitalWrite(IN3, in3); digitalWrite(IN4, in4);
  pwmTargetR = targetR; pwmTargetL = targetL;
}

int stepToward(int now, int target) {
  if (now >= target) return target;            // slowing down is instant
  return min(now + RAMP_STEP, target);
}

void rampMotors() {
  if (millis() - lastRampMs < RAMP_INTERVAL_MS) return;
  lastRampMs = millis();
  if (pwmNowR == pwmTargetR && pwmNowL == pwmTargetL) return;
  pwmNowR = stepToward(pwmNowR, pwmTargetR);
  pwmNowL = stepToward(pwmNowL, pwmTargetL);
  ledcWrite(EN_RIGHT, pwmNowR); ledcWrite(EN_LEFT, pwmNowL);
}

void motorsStop() {
  setMotors(LOW, LOW, LOW, LOW, 0, 0);
  strcpy(motorState, "STOP");
  Serial.println("[MOTOR] STOP");
}
void motorsForward() {
  setMotors(LOW, HIGH, LOW, HIGH, MAX_SPEED, MAX_SPEED);
  strcpy(motorState, "FORWARD");
  Serial.println("[MOTOR] FORWARD");
}
void motorsBackward() {
  setMotors(HIGH, LOW, HIGH, LOW, MAX_SPEED, MAX_SPEED);
  strcpy(motorState, "BACKWARD");
  Serial.println("[MOTOR] BACKWARD");
}
void motorsSteerRight() {
  setMotors(LOW, HIGH, LOW, LOW, TURN_SPEED, 0);
  strcpy(motorState, "STEER_R");
  Serial.println("[MOTOR] STEER_R");
}
void motorsSteerLeft() {
  setMotors(LOW, LOW, LOW, HIGH, 0, TURN_SPEED);
  strcpy(motorState, "STEER_L");
  Serial.println("[MOTOR] STEER_L");
}

MotorCmd lastCmd = MC_NONE;
void applyCmd(MotorCmd cmd) {
  if (cmd == lastCmd) return;
  lastCmd = cmd;
  switch (cmd) {
    case MC_STOP:     motorsStop();       break;
    case MC_FORWARD:  motorsForward();    break;
    case MC_BACKWARD: motorsBackward();   break;
    case MC_STEER_R:  motorsSteerRight(); break;
    case MC_STEER_L:  motorsSteerLeft();  break;
    default: break;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  NAVIGATE
//
//  Priority order:
//    0. Startup delay / accident alert hold → STOP
//    1. IR edge sensors → steer away from edge
//    2. Front > 30 cm   → FORWARD
//    3. Front 25–30 cm  → STOP (dead-band)
//    4. Front < 25 cm   → BACKWARD, unless rear ≤ 25 cm → STOP
// ═══════════════════════════════════════════════════════════════════════
void navigate() {
  if (millis() - bootMs < STARTUP_DELAY_MS) { applyCmd(MC_STOP); return; }
  if (millis() < alertUntilMs)              { applyCmd(MC_STOP); return; }

  float dist     = cachedDist;
  float distRear = cachedDistRear;

  // ── 1. IR edge detection ──────────────────────────────────────────
  bool rawL = !digitalRead(IR_LEFT);
  bool rawR = !digitalRead(IR_RIGHT);
  bool irL  = stableIR(rawL, irLPrev, irLFirstMs);
  bool irR  = stableIR(rawR, irRPrev, irRFirstMs);

  if (inSteer && (millis() - lastSteerMs < STEER_HOLD_MS)) return;
  inSteer = false;

  if (irL || irR) {
    if      (irL && irR) { applyCmd(MC_STOP); }
    else if (irL)        { applyCmd(MC_STEER_R); inSteer = true; lastSteerMs = millis(); }
    else                 { applyCmd(MC_STEER_L); inSteer = true; lastSteerMs = millis(); }
    inReverse = false;
    return;
  }

  // ── 2. Front clear (> 30 cm) — FORWARD ───────────────────────────
  if (dist > FRONT_STOP_FAR_CM) {
    applyCmd(MC_FORWARD);
    inReverse = false;
    return;
  }

  // ── 3. Front dead-band 25–30 cm — STOP ───────────────────────────
  if (dist >= FRONT_STOP_NEAR_CM) {
    if (lastCmd != MC_STOP) Serial.printf("[NAV] Front dead-band STOP (%.1f cm)\n", dist);
    applyCmd(MC_STOP);
    inReverse = false;
    return;
  }

  // ── 4. Front < 25 cm — BACKWARD only if rear is clear ────────────
  if (distRear <= REAR_STOP_CM) {
    if (lastCmd != MC_STOP) Serial.printf("[NAV] Boxed in (front=%.1f rear=%.1f) — STOP\n", dist, distRear);
    applyCmd(MC_STOP);
    inReverse = false;
    return;
  }

  if (!inReverse) {
    inReverse      = true;
    reverseStartMs = millis();
  }

  if (millis() - reverseStartMs >= MAX_REVERSE_MS) {
    if (lastCmd != MC_STOP) Serial.println("[NAV] Reverse timeout — stopped");
    applyCmd(MC_STOP);
  } else {
    if (lastCmd != MC_BACKWARD) Serial.printf("[NAV] Reversing — front=%.1f cm  rear=%.1f cm\n", dist, distRear);
    applyCmd(MC_BACKWARD);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  BATTERY
// ═══════════════════════════════════════════════════════════════════════
int estimateCurrent_mA() {
  switch (lastCmd) {
    case MC_FORWARD:  return CURRENT_FORWARD_MA;
    case MC_BACKWARD: return CURRENT_BACKWARD_MA;
    case MC_STEER_R:
    case MC_STEER_L:  return CURRENT_STEER_MA;
    default:          return CURRENT_STOP_MA;
  }
}

void updateBatteryTracking() {
  unsigned long now = millis();
  if (lastCurrentMs == 0) { lastCurrentMs = now; return; }
  float dtHours  = (float)(now - lastCurrentMs) / 3600000.0f;
  battMahUsed   += estimateCurrent_mA() * dtHours;
  lastCurrentMs  = now;
  if (battMahUsed > BATTERY_MAH) battMahUsed = BATTERY_MAH;
}

float ocvPerCell(float pct) {
  pct = constrain(pct, 0.0f, 100.0f);
  int i = min((int)(pct / 10.0f), 9);
  float f = (pct - i * 10.0f) / 10.0f;
  return OCV_TABLE[i] + f * (OCV_TABLE[i + 1] - OCV_TABLE[i]);
}

float percentFromOcv(float perCell) {
  if (perCell <= OCV_TABLE[0])  return 0.0f;
  if (perCell >= OCV_TABLE[10]) return 100.0f;
  int i = 0;
  while (perCell > OCV_TABLE[i + 1]) i++;
  return (i + (perCell - OCV_TABLE[i]) / (OCV_TABLE[i + 1] - OCV_TABLE[i])) * 10.0f;
}

float sagVolts() {
  return estimateCurrent_mA() / 1000.0f * CELL_RINT_OHM * BATT_CELLS;
}

float chargeUsedPercent() {
  return constrain(BATT_START_PCT - battMahUsed / BATTERY_MAH * 100.0f, 0.0f, 100.0f);
}

float rawBatteryVolts() {
#if USE_BATT_ADC
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(BATT_ADC_PIN);
  return (mv / 16.0f / 1000.0f) * (BATT_R1_KOHM + BATT_R2_KOHM) / BATT_R2_KOHM;
#else
  return ocvPerCell(chargeUsedPercent()) * BATT_CELLS - sagVolts();
#endif
}

void updateBatteryVolts() {
  float v = rawBatteryVolts();
  battVolts = isnan(battVolts) ? v : battVolts + BATT_SMOOTH * (v - battVolts);
}

int batteryPercent() {
#if USE_BATT_ADC
  // Add the load sag back so the percentage doesn't dip while the motors run
  return (int)(percentFromOcv((battVolts + sagVolts()) / BATT_CELLS) + 0.5f);
#else
  return (int)(chargeUsedPercent() + 0.5f);
#endif
}

// ═══════════════════════════════════════════════════════════════════════
//  MPU6050 — self-healing
//  A power or wire glitch resets the MPU into sleep (readings freeze) or
//  drops it off the bus (readings are all zero). Both are detected here,
//  the readings are marked invalid, and the MPU is re-initialised.
// ═══════════════════════════════════════════════════════════════════════
#define MPU_RETRY_MS     2000   // look for a missing MPU this often
#define MPU_FROZEN_READS 5      // identical raw readings in a row = asleep
#define MPU_ZERO_READS   3      // all-zero readings in a row = off the bus

bool startMpu() {
  if (!i2cPresent(0x68)) return false;
  mpu.initialize();
  mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_2);
  mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);
  mpu.setSleepEnabled(false);
  return true;
}

void readMpu() {
  static int16_t       last[6]    = {};
  static uint8_t       frozen     = 0, zeros = 0;
  static unsigned long lastRetry  = 0;

  if (!mpuPresent) {
    mpuOk = false;
    if (millis() - lastRetry >= MPU_RETRY_MS) {
      lastRetry = millis();
      if (startMpu()) {
        mpuPresent = true;
        frozen = zeros = 0;
        Serial.println("[MPU] found and started ✓");
      }
    }
    return;
  }

  int16_t r[6];
  mpu.getMotion6(&r[0], &r[1], &r[2], &r[3], &r[4], &r[5]);
  bool allZero = !(r[0] | r[1] | r[2] | r[3] | r[4] | r[5]);
  bool same    = memcmp(r, last, sizeof(r)) == 0;
  memcpy(last, r, sizeof(r));
  zeros  = allZero ? zeros + 1 : 0;
  frozen = (same && !allZero) ? frozen + 1 : 0;

  if (zeros >= MPU_ZERO_READS || frozen >= MPU_FROZEN_READS) {
    Serial.printf("[MPU] %s — re-initialising (check its VCC/GND/SDA/SCL wires)\n",
                  zeros ? "not answering (all zeros)" : "readings frozen (MPU reset into sleep)");
    mpuPresent = false;              // readMpu() retries startMpu() from now on
    mpuOk = false;
    lastRetry = millis() - MPU_RETRY_MS;
    return;
  }
  if (allZero || same) { mpuOk = false; return; }   // suspicious; keep last good values

  mpuOk  = true;
  accelX = r[0] / 16384.0f; accelY = r[1] / 16384.0f; accelZ = r[2] / 16384.0f;
  gyroX  = r[3] /  131.0f;  gyroY  = r[4] /  131.0f;  gyroZ  = r[5] /  131.0f;
}

// ═══════════════════════════════════════════════════════════════════════
//  READ SENSORS + hand a snapshot to the uplink task
// ═══════════════════════════════════════════════════════════════════════
void readSensors() {
  irLeftNow  = !digitalRead(IR_LEFT);
  irRightNow = !digitalRead(IR_RIGHT);

  readMpu();

  updateBatteryTracking();
  updateBatteryVolts();

  const float G = 9.80665f;
  CarTelemetry t;
  t.front    = cachedDist >= 999.0f ? 400.0f : cachedDist;   // HC-SR04 max range
  t.rear     = cachedDistRear  >= 999.0f ? 400.0f : cachedDistRear;
  t.left     = cachedDistLeft  >= 999.0f ? 400.0f : cachedDistLeft;
  t.right    = cachedDistRight >= 999.0f ? 400.0f : cachedDistRight;
  t.irL      = irLeftNow;
  t.irR      = irRightNow;
  t.irAny    = irLeftNow || irRightNow;
  t.ax = accelX * G; t.ay = accelY * G; t.az = accelZ * G;
  t.gx = gyroX;      t.gy = gyroY;      t.gz = gyroZ;
  t.mpuOk    = mpuOk;
  t.battV    = battVolts;
  t.soc      = batteryPercent();
  t.lcdOk    = lcdPresent;
  t.accident = millis() < alertUntilMs;
  t.valid    = true;

  portENTER_CRITICAL(&sharedMux);
  shared = t;
  portEXIT_CRITICAL(&sharedMux);
}

void printSensors() {
  Serial.println("─────────────────────────────");
  Serial.printf("STATE : %s   (PWM R=%d L=%d)\n", motorState, pwmNowR, pwmNowL);
  Serial.printf("IR    : L=%s  R=%s\n", irLeftNow ? "OBS" : "CLR", irRightNow ? "OBS" : "CLR");
  Serial.printf("DIST  : Front=%.1f cm  Rear=%.1f cm", cachedDist, cachedDistRear);
#if USE_SIDE_ULTRASONIC
  Serial.printf("  Left=%.1f cm  Right=%.1f cm", cachedDistLeft, cachedDistRight);
#endif
  Serial.println();
  Serial.printf("ACCEL : X=%.2f Y=%.2f Z=%.2f g  [Amp=%d]%s\n", accelX, accelY, accelZ,
    (int)(sqrt(accelX*accelX + accelY*accelY + accelZ*accelZ) * 10),
    mpuOk ? "" : mpuPresent ? "  (MPU NOT ANSWERING)" : "  (MPU MISSING — retrying)");
  Serial.printf("GYRO  : X=%.1f Y=%.1f Z=%.1f  [Angle=%d]\n", gyroX, gyroY, gyroZ,
    (int)sqrt(gyroX*gyroX + gyroY*gyroY + gyroZ*gyroZ));
  Serial.printf("BATT  : %.2f V  (%d%%, %s)\n", battVolts, batteryPercent(),
    USE_BATT_ADC ? "measured" : "estimated");
  Serial.printf("NET   : WiFi=%s  RSSI=%d  uplink=%s (HTTP %d)\n",
    WiFi.status() == WL_CONNECTED ? "OK" : "--", WiFi.RSSI(), uplinkOk ? "OK" : "FAIL", uplinkHttpCode);
  Serial.println("─────────────────────────────");
}

// ═══════════════════════════════════════════════════════════════════════
//  UPLINK — runs in its own task on core 0
//  Driving stays on core 1, so a slow or unreachable server can never
//  stop the car from reacting to obstacles.
// ═══════════════════════════════════════════════════════════════════════
int buildJson(char* out, size_t len, const CarTelemetry& t, uint32_t heartbeat) {
  int n = snprintf(out, len,
    "{\"obstacle_distance\":%.1f,\"obstacle_distance_rear\":%.1f,"
    "\"ir_obstacle\":%d,\"ir_left\":%d,\"ir_right\":%d,"
    "\"battery_soc\":%d,\"lcd_status\":%d,\"autonomous_mode\":1,"
    "\"emergency_stop\":%d,\"heartbeat\":%lu,\"battery_voltage\":%.2f",
    t.front, t.rear, t.irAny ? 1 : 0, t.irL ? 1 : 0, t.irR ? 1 : 0,
    t.soc, t.lcdOk ? 1 : 0, t.accident ? 1 : 0, (unsigned long)heartbeat, t.battV);
  // A missing MPU is reported as missing (dashboard: Unavailable), never as zeros
  if (t.mpuOk)
    n += snprintf(out + n, len - n,
      ",\"accel_x\":%.3f,\"accel_y\":%.3f,\"accel_z\":%.3f,"
      "\"gyro_x\":%.2f,\"gyro_y\":%.2f,\"gyro_z\":%.2f",
      t.ax, t.ay, t.az, t.gx, t.gy, t.gz);
#if USE_SIDE_ULTRASONIC
  n += snprintf(out + n, len - n, ",\"obstacle_distance_left\":%.1f,"
                "\"obstacle_distance_right\":%.1f", t.left, t.right);
#endif
  n += snprintf(out + n, len - n, "}");
  return n;
}

void uplinkTask(void*) {
  String url = String(LIGHTSYNC_URL) + TELEMETRY_PATH;
  bool   https = url.startsWith("https://");

  WiFiClient       plain;
  WiFiClientSecure secure;
  // NOTE: setInsecure() encrypts but does not verify the server certificate.
  // Fine for a hobby dashboard; use secure.setCACert(...) for anything serious.
  if (https) secure.setInsecure();

  HTTPClient http;
  http.setReuse(true);                 // keep the connection open between posts
  http.setTimeout(UPLINK_TIMEOUT_MS);

  uint32_t      heartbeat = 0;
  unsigned long wifiDownSince = millis();
  int           lastCode  = 0;
  unsigned long failures  = 0;
  bool          wifiWas   = false;
  char          body[512];

  for (;;) {
    unsigned long started = millis();
    bool wifiNow = (WiFi.status() == WL_CONNECTED);
    if (wifiNow != wifiWas) {
      wifiWas = wifiNow;
      if (wifiNow) Serial.printf("[WIFI] connected, IP %s, RSSI %d dBm\n",
                                 WiFi.localIP().toString().c_str(), WiFi.RSSI());
      else         Serial.println("[WIFI] disconnected — reconnecting in background");
    }

    // Auto-reconnect sometimes gives up after a failed first join; kick it
    if (wifiNow) {
      wifiDownSince = millis();
    } else if (millis() - wifiDownSince > WIFI_RETRY_MS) {
      wifiDownSince = millis();
      Serial.printf("[WIFI] still not connected — retrying \"%s\"\n", WIFI_SSID);
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASS);
    }

    CarTelemetry t;
    portENTER_CRITICAL(&sharedMux);
    t = shared;
    portEXIT_CRITICAL(&sharedMux);

    if (!wifiNow) {
      uplinkOk = false; uplinkHttpCode = -1;
    } else if (t.valid) {
      buildJson(body, sizeof(body), t, ++heartbeat);
      bool begun = https ? http.begin(secure, url) : http.begin(plain, url);
      int code = -2;
      String reply;
      if (begun) {
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Key", LIGHTSYNC_DEVICE_KEY);
        code = http.POST((uint8_t*)body, strlen(body));
        if (code > 0) reply = http.getString();
        http.end();
      }
      uplinkHttpCode = code;
      uplinkOk = (code >= 200 && code < 300);

      // Log changes, and every 10th failure, so Serial stays readable
      if (uplinkOk) {
        if (lastCode != code) Serial.printf("[UPLINK] OK → %s\n", url.c_str());
        failures = 0;
      } else {
        failures++;
        if (code != lastCode || failures % 10 == 1) {
          if (code > 0)
            Serial.printf("[UPLINK] HTTP %d: %s\n", code, reply.c_str());
          else
            Serial.printf("[UPLINK] cannot reach %s (%s)\n", url.c_str(),
                          begun ? HTTPClient::errorToString(code).c_str() : "bad URL");
        }
      }
      lastCode = code;
    }

    unsigned long spent = millis() - started;
    vTaskDelay(pdMS_TO_TICKS(spent < UPLINK_INTERVAL_MS ? UPLINK_INTERVAL_MS - spent : 10));
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  FALL / ACCIDENT DETECTION  (two-mode, logic unchanged from v24)
// ═══════════════════════════════════════════════════════════════════════
bool fallDetected  = false;
bool trigger1      = false;
bool trigger2      = false;
bool trigger3      = false;
byte trigger1count = 0;
byte trigger2count = 0;
byte trigger3count = 0;

void resetTriggers() {
  trigger1 = false; trigger1count = 0;
  trigger2 = false; trigger2count = 0;
  trigger3 = false; trigger3count = 0;
}

void detectAccident() {
  if (!mpuOk) { resetTriggers(); return; }  // no real reading = no fake alerts
  if (millis() < alertUntilMs) return;       // already showing an alert

  float ax = accelX, ay = accelY, az = accelZ;
  float gx = gyroX,  gy = gyroY,  gz = gyroZ;

  int Amp         = (int)(sqrt(ax*ax + ay*ay + az*az) * 10);
  int angleChange = (int) sqrt(gx*gx + gy*gy + gz*gz);

  // Useful for tuning CRASH_AMP_MIN — watch this in Serial Monitor
  Serial.printf("[ACCEL] Amp=%d  Angle=%d  Mode=%s\n",
    Amp, angleChange,
    (lastCmd == MC_STOP || lastCmd == MC_NONE) ? "STOPPED" : "MOVING");

  bool motorsRunning = (lastCmd == MC_FORWARD  || lastCmd == MC_BACKWARD ||
                        lastCmd == MC_STEER_R  || lastCmd == MC_STEER_L);

  // ── MODE A: motors running — instant crash spike only ─────────────
  if (motorsRunning) {
    resetTriggers();   // so vibration T1 can't carry over when car stops
    if (Amp >= CRASH_AMP_MIN) {
      Serial.printf("[FALL] ★ CRASH while moving  Amp=%d >= %d\n", Amp, CRASH_AMP_MIN);
      fallDetected = true;
    }
  }

  // ── MODE B: motors stopped — full 3-stage chain ───────────────────
  else {
    // Stage 1: free-fall / air-time
    if (Amp <= T1_AMP_MAX && !trigger2) {
      trigger1 = true;
      Serial.printf("[FALL] T1 low-g  Amp=%d <= %d\n", Amp, T1_AMP_MAX);
    }

    if (trigger1) {
      trigger1count++;
      if (Amp >= T2_AMP_MIN) {
        trigger2 = true;
        trigger1 = false; trigger1count = 0;
        Serial.printf("[FALL] T2 impact  Amp=%d >= %d\n", Amp, T2_AMP_MIN);
      }
    }

    // Stage 2 → 3: rotation after impact
    if (trigger2) {
      trigger2count++;
      if (angleChange >= T3_ANGLE_MIN && angleChange <= T3_ANGLE_MAX) {
        trigger3 = true;
        trigger2 = false; trigger2count = 0;
        Serial.printf("[FALL] T3 rotation  angle=%d\n", angleChange);
      }
    }

    // Stage 3: confirm settled
    if (trigger3) {
      trigger3count++;
      if (trigger3count >= T3_CONFIRM_COUNT) {
        if (angleChange <= 10) {
          fallDetected = true;
        } else {
          Serial.println("[FALL] T3 CANCELLED — still moving");
        }
        trigger3 = false; trigger3count = 0;
      }
    }

    // Stage timeouts
    if (trigger1count >= STAGE_TIMEOUT) {
      trigger1 = false; trigger1count = 0;
      Serial.println("[FALL] T1 timeout — reset");
    }
    if (trigger2count >= STAGE_TIMEOUT) {
      trigger2 = false; trigger2count = 0;
      Serial.println("[FALL] T2 timeout — reset");
    }
  }

  // ── ALERT — fires from either mode (non-blocking) ─────────────────
  // The dashboard sees it as emergency_stop = 1 for ALERT_HOLD_MS.
  if (fallDetected) {
    fallDetected = false;
    resetTriggers();

    Serial.println("╔══════════════════════════════╗");
    Serial.println("║   ⚠  ACCIDENT DETECTED  ⚠   ║");
    Serial.println("╚══════════════════════════════╝");

    applyCmd(MC_STOP);

    lcdAlertActive = true;
    alertUntilMs   = millis() + ALERT_HOLD_MS;
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("!! ACCIDENT !!  ");
    lcd.setCursor(0, 1); lcd.print(uplinkOk ? "SENT TO PORTAL  " : "PORTAL OFFLINE  ");
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  I2C SCANNER
// ═══════════════════════════════════════════════════════════════════════
bool i2cPresent(byte addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

void scanI2C() {
  Serial.println("── I2C Scan ──");
  byte found = 0;
  for (byte addr = 1; addr < 127; addr++) {
    if (i2cPresent(addr)) {
      Serial.printf("  Device at 0x%02X", addr);
      if (addr == 0x27) Serial.print("  ← LCD");
      if (addr == 0x3F) Serial.print("  ← LCD (alt) — change LCD_ADDR to 0x3F!");
      if (addr == 0x68) Serial.print("  ← MPU6050 (AD0=LOW)");
      if (addr == 0x69) Serial.print("  ← MPU6050 (AD0=HIGH)");
      Serial.println();
      found++;
    }
  }
  if (found == 0) Serial.println("  No devices found! Check SDA=21 SCL=22, VCC, GND");
  Serial.println("──────────────");
}

// Short Wi-Fi problem for the LCD, or nullptr when connected
const char* wifiHint() {
  if (WiFi.status() == WL_CONNECTED) return nullptr;
  if (strcmp(WIFI_SSID, "your-wifi-ssid") == 0) return "WiFi: SET SSID";
  switch (wifiReason) {
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_AUTH_EXPIRE:      return "WiFi: BAD PASS?";
    case WIFI_REASON_NO_AP_FOUND:      return "WiFi: NOT FOUND";
    default: break;
  }
  if (!wifiSeen) return "WiFi: NOT FOUND";
  return "WiFi: JOINING..";
}

// ═══════════════════════════════════════════════════════════════════════
//  LCD UPDATE
//    line 0:  I 810mA FWD  OK     (current estimate, motion, uplink OK/ERR/--)
//    line 1:  Batt: 87%  7.92V
// ═══════════════════════════════════════════════════════════════════════
void updateLCD() {
  if (lcdAlertActive) {
    if (millis() < alertUntilMs) return;     // keep alert on screen
    lcdAlertActive = false;
    lcd.clear();
    lastLcdMs = 0;                           // redraw readings right away
  }
  if (millis() - lastLcdMs < LCD_UPDATE_MS) return;
  lastLcdMs = millis();

  updateBatteryTracking();

  const char* st = motorState;
  const char* stShort = "STOP";
  if      (strcmp(st, "FORWARD")  == 0) stShort = "FWD";
  else if (strcmp(st, "BACKWARD") == 0) stShort = "BACK";
  else if (strcmp(st, "STEER_R")  == 0) stShort = "STRR";
  else if (strcmp(st, "STEER_L")  == 0) stShort = "STRL";

  const char* net = WiFi.status() != WL_CONNECTED ? "--" : uplinkOk ? "OK" : "ERR";

  char line0[17];
  char line1[17];
  snprintf(line0, sizeof(line0), "I%4dmA %-4s %3s", estimateCurrent_mA(), stShort, net);
  const char* hint = wifiHint();
  if (hint && (millis() / 2000) % 2)
    snprintf(line1, sizeof(line1), "%-16s", hint);
  else
    snprintf(line1, sizeof(line1), "Batt:%3d%% %5.2fV", batteryPercent(), battVolts);

  lcd.setCursor(0, 0); lcd.print(line0);
  lcd.setCursor(0, 1); lcd.print(line1);
}

// ═══════════════════════════════════════════════════════════════════════
//  WI-FI DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════
void scanForNetwork() {
  if (strcmp(WIFI_SSID, "your-wifi-ssid") == 0) {
    Serial.println("[WIFI] WIFI_SSID / WIFI_PASS are still the placeholders — edit YOUR SETTINGS");
    bootStep("SET WIFI_SSID!");
    delay(2000);
    return;
  }
  int n = WiFi.scanNetworks();
  bool seen = false;
  Serial.printf("[WIFI] %d networks visible (the ESP32 only sees 2.4 GHz):\n", n < 0 ? 0 : n);
  for (int i = 0; i < n; i++) {
    bool mine = WiFi.SSID(i) == WIFI_SSID;
    seen |= mine;
    if (i < 12 || mine)
      Serial.printf("  %-28s ch%-2d %4d dBm%s\n", WiFi.SSID(i).c_str(), WiFi.channel(i),
                    WiFi.RSSI(i), mine ? "   <- yours" : "");
  }
  WiFi.scanDelete();
  wifiSeen = seen;
  if (!seen) {
    Serial.printf("[WIFI] \"%s\" NOT FOUND. Check: hotspot on, 2.4 GHz band (not 5 GHz), "
                  "name spelled exactly (case and spaces matter)\n", WIFI_SSID);
    bootStep("WIFI NOT FOUND");
    delay(2000);
  }
}

// Prints why joining failed; repeats only when the reason changes or every 20th try
void onWifiDisconnected(WiFiEvent_t, WiFiEventInfo_t info) {
  static uint8_t lastReason = 0;
  static uint32_t count = 0;
  uint8_t r = info.wifi_sta_disconnected.reason;
  wifiReason = r;
  count++;
  if (r == lastReason && count % 20 != 1) return;
  lastReason = r;
  const char* hint = "";
  switch (r) {
    case WIFI_REASON_NO_AP_FOUND:
      hint = "network not visible: hotspot off, 5 GHz only, or name misspelled"; break;
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_AUTH_EXPIRE:
      hint = "wrong password, or hotspot set to WPA3-only (use WPA2 or WPA2/WPA3)"; break;
    case WIFI_REASON_ASSOC_TOOMANY:
      hint = "hotspot has too many devices connected"; break;
    default: break;
  }
  Serial.printf("[WIFI] can't join \"%s\": %s (reason %u) %s\n", WIFI_SSID,
                WiFi.disconnectReasonName((wifi_err_reason_t)r), r, hint);
}

// ═══════════════════════════════════════════════════════════════════════
//  SETUP — every step shows on the LCD, nothing here can block forever
// ═══════════════════════════════════════════════════════════════════════
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);
  delay(100);

  bootCount++;
  esp_reset_reason_t rr = esp_reset_reason();
  Serial.printf("\n\n=== BOOT #%d  reset reason: %s ===\n", bootCount, resetReasonStr(rr));
  if (bootCount > 1 && rr != ESP_RST_EXT && rr != ESP_RST_SW)
    Serial.println("!!! ESP32 RESET BY ITSELF — power supply is dropping !!!");

  // Motors OFF first, before anything else draws current
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  ledcAttach(EN_RIGHT, PWM_FREQ, PWM_RES);
  ledcAttach(EN_LEFT,  PWM_FREQ, PWM_RES);
  motorsStop();
  lastCmd = MC_STOP;

  pinMode(IR_LEFT,       INPUT);
  pinMode(IR_RIGHT,      INPUT);
  pinMode(TRIG_PIN,      OUTPUT);
  pinMode(ECHO_PIN,      INPUT);
  pinMode(TRIG_PIN_REAR, OUTPUT);
  pinMode(ECHO_PIN_REAR, INPUT);
#if USE_SIDE_ULTRASONIC
  pinMode(TRIG_PIN_LEFT,  OUTPUT); pinMode(ECHO_PIN_LEFT,  INPUT); digitalWrite(TRIG_PIN_LEFT,  LOW);
  pinMode(TRIG_PIN_RIGHT, OUTPUT); pinMode(ECHO_PIN_RIGHT, INPUT); digitalWrite(TRIG_PIN_RIGHT, LOW);
#endif
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(TRIG_PIN_REAR, LOW);
#if USE_BATT_ADC
  analogSetPinAttenuation(BATT_ADC_PIN, ADC_11db);
#endif

  delay(200);
  Wire.begin(21, 22);
  Wire.setClock(100000);
  Wire.setTimeOut(50);                      // a bad I2C wire can't hang us
  delay(100);

  lcdPresent = i2cPresent(LCD_ADDR);
  mpuPresent = i2cPresent(0x68);

  lcd.init();
  lcd.backlight();
  char line0[17];
  snprintf(line0, sizeof(line0), "v26 #%d %s", bootCount, resetReasonStr(rr));
  lcd.setCursor(0, 0); lcd.print(line0);
  bootStep("I2C scan...");
  Serial.println(lcdPresent ? "LCD OK ✓" : "LCD NOT FOUND at LCD_ADDR ✗");

  scanI2C();

  // ── MPU6050 ───────────────────────────────────────────────────────
  bootStep("MPU6050...");
  mpuPresent = startMpu();
  if (mpuPresent) {
    Serial.println(mpu.testConnection() ? "MPU6050 OK ✓" : "MPU6050 ID mismatch (clone — readings still work)");
  } else {
    bootStep("MPU MISSING!");
    Serial.println("MPU6050 NOT FOUND at 0x68 — will keep retrying every 2 s");
    delay(1000);
  }

  // ── Wi-Fi — scan once so Serial shows whether your network is visible
  bootStep("WiFi scan...");
  WiFi.mode(WIFI_STA);
  scanForNetwork();

  // ── Wi-Fi — started here, connects in the BACKGROUND ─────────────
  bootStep("WiFi start...");
  WiFi.onEvent(onWifiDisconnected, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  WiFi.setAutoReconnect(true);
  Serial.printf("[WIFI] joining \"%s\"\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);         // does NOT wait
#if WIFI_LOW_TX_POWER
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
#endif
  delay(300);                               // let supply settle after radio on
  Serial.print("ESP32 MAC: "); Serial.println(WiFi.macAddress());
  Serial.printf("Portal  : %s%s\n", LIGHTSYNC_URL, TELEMETRY_PATH);

  // ── Uplink task on core 0 (car logic stays on core 1) ────────────
  readSensors();                            // first snapshot before the task starts
  xTaskCreatePinnedToCore(uplinkTask, "uplink", 12288, NULL, 1, NULL, 0);

  bootStep("READY");
  delay(500);

  bootMs        = millis();
  lastCurrentMs = millis();
  lcd.clear();
  lastLcdMs = 0;
  updateLCD();

  Serial.println("=== lightsync_car v26 READY ===");
  Serial.println("NAVIGATION PRIORITY ORDER:");
  Serial.printf("  1   IR edge triggered        → STEER\n");
  Serial.printf("  2   Front  > %.0f cm          → FORWARD\n",      FRONT_STOP_FAR_CM);
  Serial.printf("  3   Front %.0f–%.0f cm (incl.) → STOP (dead-band)\n", FRONT_STOP_NEAR_CM, FRONT_STOP_FAR_CM);
  Serial.printf("  4   Front  < %.0f cm          → BACKWARD (STOP if rear ≤ %.0f cm)\n",
    FRONT_STOP_NEAR_CM, REAR_STOP_CM);
  Serial.printf("  Reverse timeout              : %d ms\n",         MAX_REVERSE_MS);
  Serial.println("ACCIDENT DETECTION:");
  Serial.printf("  MOVING  mode  → crash spike  Amp >= %d\n",       CRASH_AMP_MIN);
  Serial.printf("  STOPPED mode  → T1 Amp<=%d  T2 Amp>=%d  T3 angle %d–%d\n",
    T1_AMP_MAX, T2_AMP_MIN, T3_ANGLE_MIN, T3_ANGLE_MAX);
  Serial.printf("MOTOR  : MAX=%d  TURN=%d  soft-start %d/%dms\n",
    MAX_SPEED, TURN_SPEED, RAMP_STEP, RAMP_INTERVAL_MS);
  Serial.printf("BATTERY: %dS, %s\n", BATT_CELLS,
    USE_BATT_ADC ? "measured on GPIO36" : "estimated from charge used (USE_BATT_ADC=0)");
  Serial.printf("LCD    : SDA=GPIO21 SCL=GPIO22 addr=0x%02X\n",     LCD_ADDR);
}

// ═══════════════════════════════════════════════════════════════════════
//  LOOP — never blocks (the uplink lives in its own task)
// ═══════════════════════════════════════════════════════════════════════
void loop() {
  updateUltrasonics();
  navigate();
  rampMotors();

  if (millis() - lastSensorMs >= SENSOR_MS) {
    lastSensorMs = millis();
    readSensors();
    printSensors();
    detectAccident();
  }

  updateLCD();
}
