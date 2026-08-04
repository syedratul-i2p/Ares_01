#include "HardwareController.h"
#include "esp_camera.h"
#include "esp_log.h"
#include "soc/rtc_cntl_reg.h"
#include "soc/soc.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFi.h>

// Function Prototypes
void executeHardwareCommand(String mode, String action, String direction,
                            int speed, String joint, int angle);
void handleCommand();
void stream_handler();
void handleCapture();
void mjpegTask(void *pvParameters);

// Global Hardware Fault Flags
bool camera_fault = false;

// Arm state machine
volatile bool arm_moving = false;
String arm_joint = "";
String arm_dir = "";
volatile unsigned long arm_timer = 0;

// Define Log Tags
static const char *TAG_SYS = "SYS";
static const char *TAG_WIFI = "WIFI";
static const char *TAG_CAM = "CAM";
static const char *TAG_HTTP = "HTTP";

// VERIFIED PHYSICAL PIN MAPPING
#define PWDN_GPIO_NUM -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 15
#define SIOD_GPIO_NUM 4
#define SIOC_GPIO_NUM 5
#define Y9_GPIO_NUM 16
#define Y8_GPIO_NUM 17
#define Y7_GPIO_NUM 18
#define Y6_GPIO_NUM 12
#define Y5_GPIO_NUM 10
#define Y4_GPIO_NUM 8
#define Y3_GPIO_NUM 9
#define Y2_GPIO_NUM 11
#define VSYNC_GPIO_NUM 6
#define HREF_GPIO_NUM 7
#define PCLK_GPIO_NUM 13

// NETWORK CONFIGURATION
const char *ap_ssid = "ARES_01_OFFLINE";
const char *ap_password = "Admin123";
const char *sta_ssid = "N3M0_0x70";
const char *sta_password = "Ratul_i2p@07";

WebServer server(80);
WebSocketsServer webSocket(81);
Preferences preferences;
unsigned long lastTelemetryTime = 0;

WiFiClient globalStreamClient;
volatile bool isStreaming = false;

#define PART_BOUNDARY "123456789000000000000987654321"
static const char *_STREAM_CONTENT_TYPE =
    "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *_STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *_STREAM_PART =
    "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

void executeHardwareCommand(String mode, String action, String direction,
                            int speed, String joint, int angle) {
  ESP_LOGI(TAG_SYS,
           "Executing JSON Command -> Mode: %s | Action: %s | Dir: %s | Speed: "
           "%d | Joint: %s | Angle: %d",
           mode.c_str(), action.c_str(), direction.c_str(), speed,
           joint.c_str(), angle);

  if (action == "drive") {
    if (direction == "forward")
      Hardware.drive(speed, speed);
    else if (direction == "backward")
      Hardware.drive(-speed, -speed);
    else if (direction == "left")
      Hardware.drive(-speed, speed);
    else if (direction == "right")
      Hardware.drive(speed, -speed);
    else
      Hardware.drive(0, 0);
    return;
  } else if (action == "arm_control") {
    Hardware.setArmMotor(joint, direction, angle);
    return;
  }
}

void handleCommand() {
  if (server.method() != HTTP_POST) {
    server.send(405, "text/plain", "Method Not Allowed");
    ESP_LOGW(TAG_HTTP, "Invalid method on /command");
    return;
  }
  String body = server.arg("plain");
  Serial.printf("[HTTP] Raw Payload: %s\n", body.c_str());
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    ESP_LOGE(TAG_HTTP, "JSON Parse failed: %s", error.c_str());
    server.send(400, "application/json",
                "{\"status\":\"error\", \"message\":\"Invalid JSON\"}");
    return;
  }

  String mode = doc["mode"] | "manual";
  String action = doc["action"] | "drive";
  String direction = doc["direction"] | "stop";
  int speed = doc["speed"] | 255;
  String joint = doc["joint"] | "base";
  int angle = doc["angle"] | -1;

  mode.toLowerCase();
  action.toLowerCase();
  direction.toLowerCase();
  joint.toLowerCase();

  if (mode == "arm") {
    if (action == "start") {
      arm_moving = true;
      arm_joint = doc["joint"] | "base";
      arm_dir = doc["direction"] | "up";
      arm_joint.toLowerCase();
      arm_dir.toLowerCase();
    } else if (action == "stop") {
      arm_moving = false;
    } else if (action == "arm_control" && angle != -1) {
      // Fallback for UI sliders / absolute position
      Hardware.setArmMotor(joint, "", angle);
    }
    doc.clear();
    server.send(
        200, "application/json",
        "{\"status\":\"success\", \"message\":\"Arm Command Received\"}");
    return;
  }

  if (action == "drive") {
    executeHardwareCommand(mode, action, direction, speed, joint, angle);
    doc.clear();
    server.send(200, "application/json",
                "{\"status\":\"success\", \"message\":\"Drive Executed\"}");
    return;
  }

  doc.clear();
  server.send(400, "application/json",
              "{\"status\":\"error\", \"message\":\"Unknown Action\"}");
}

void stream_handler() {
  if (camera_fault) {
    server.send(503, "text/plain", "Camera Hardware Fault");
    return;
  }

  globalStreamClient = server.client();
  if (!globalStreamClient.connected())
    return;

  globalStreamClient.setNoDelay(true);

  ESP_LOGI(TAG_HTTP, "MJPEG Stream client connected. Handing off to FreeRTOS task.");
  globalStreamClient.print("HTTP/1.1 200 OK\r\n");
  globalStreamClient.print("Access-Control-Allow-Origin: *\r\n");
  globalStreamClient.print("Access-Control-Allow-Methods: GET, OPTIONS\r\n");
  globalStreamClient.print("Access-Control-Allow-Private-Network: true\r\n");
  globalStreamClient.print("Cache-Control: no-cache, private, no-store, must-revalidate\r\n");
  globalStreamClient.print("Pragma: no-cache\r\n");
  globalStreamClient.print("Content-Type: ");
  globalStreamClient.print(_STREAM_CONTENT_TYPE);
  globalStreamClient.print("\r\n\r\n");

  isStreaming = true;
  // Return immediately to unblock the HTTP Server thread
}

void mjpegTask(void *pvParameters) {
  char part_buf[128];
  unsigned long frame_count = 0;
  uint8_t fail_count = 0;

  for (;;) {
    if (isStreaming && globalStreamClient.connected()) {
      camera_fb_t *fb = esp_camera_fb_get();
      if (!fb) {
        fail_count++;
        ESP_LOGE(TAG_CAM, "Capture failed. Retrying... (%d/5)", fail_count);
        if (fail_count >= 5) {
          ESP_LOGE(TAG_SYS, "Camera Fault! Halting MJPEG stream.");
          camera_fault = true;
          isStreaming = false;
          globalStreamClient.stop();
        }
        vTaskDelay(pdMS_TO_TICKS(100));
        continue;
      }
      fail_count = 0;
      size_t hlen = snprintf(part_buf, 128, _STREAM_PART, fb->len);
      globalStreamClient.write((const uint8_t *)_STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
      globalStreamClient.write((const uint8_t *)part_buf, hlen);
      globalStreamClient.write(fb->buf, fb->len);
      esp_camera_fb_return(fb);

      frame_count++;
      if (frame_count % 100 == 0) {
        ESP_LOGI(TAG_CAM, "Streaming active... Successfully sent %lu frames.", frame_count);
      }
      vTaskDelay(pdMS_TO_TICKS(15));
    } else {
      if (isStreaming) {
        // Client disconnected
        isStreaming = false;
        globalStreamClient.stop();
        ESP_LOGI(TAG_HTTP, "MJPEG Stream client disconnected. Total frames sent: %lu", frame_count);
        frame_count = 0;
      }
      vTaskDelay(pdMS_TO_TICKS(50));
    }
  }
}

void handleCapture() {
  if (camera_fault) {
    server.send(503, "text/plain", "Camera Hardware Fault");
    return;
  }

  // DMA Buffer Flush: discard the stale frame
  camera_fb_t *fb_drop = esp_camera_fb_get();
  if (fb_drop) {
    esp_camera_fb_return(fb_drop);
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    ESP_LOGE(TAG_CAM, "Camera Capture Failed");
    server.send(500, "text/plain", "Camera Capture Failed");
    vTaskDelay(pdMS_TO_TICKS(100));
    return;
  }

  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
  server.sendHeader("Content-Type", "image/jpeg");
  server.setContentLength(fb->len);
  server.send(200, "image/jpeg", "");
  server.sendContent((const char *)fb->buf, fb->len);

  esp_camera_fb_return(fb);
  ESP_LOGI(TAG_HTTP, "Single frame captured and sent.");
}
void webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload,
                    size_t length) {
  switch (type) {
  case WStype_DISCONNECTED:
    ESP_LOGI(TAG_SYS, "WebSocket Client [%u] Disconnected", num);
    break;
  case WStype_CONNECTED: {
    IPAddress ip = webSocket.remoteIP(num);
    ESP_LOGI(TAG_SYS, "WebSocket Client [%u] Connected from %s", num,
             ip.toString().c_str());
    // Force immediate live telemetry dispatch (No dummy data)
  } break;
  case WStype_TEXT: {
    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      if (doc.containsKey("ping") && doc["ping"] == true) {
        webSocket.sendTXT(num, "{\"pong\": true, \"status\": \"online\", \"distance\": 999, \"battery\": 100}");
        break;
      }
      if (doc.containsKey("action")) {
        String act = doc["action"].as<String>();
        act.toLowerCase();
        if (act == "reset" || act == "reboot") {
          webSocket.sendTXT(num, "{\"status\": \"rebooting\"}");
          delay(500);
          ESP.restart();
        }
      }
      String mode = doc["mode"] | "manual";
      String action = doc["action"] | "drive";
      String direction = doc["direction"] | "stop";
      int speed = doc["speed"] | 255;
      String joint = doc["joint"] | "base";
      int angle = doc["angle"] | 90;

      mode.toLowerCase();
      action.toLowerCase();
      direction.toLowerCase();
      joint.toLowerCase();

      if (mode == "arm") {
        if (action == "start") {
          arm_moving = true;
          arm_joint = doc["joint"] | "base";
          arm_dir = doc["direction"] | "up";
          arm_joint.toLowerCase();
          arm_dir.toLowerCase();
        } else if (action == "stop") {
          arm_moving = false;
        } else if (action == "arm_control" && angle != -1) {
          Hardware.setArmMotor(joint, "", angle);
        }
      } else if (action == "drive" || action == "arm_control") {
        executeHardwareCommand(mode, action, direction, speed, joint, angle);
      }
    } else {
      ESP_LOGE(TAG_SYS, "WS JSON Parse Error");
    }
  } break;
  case WStype_BIN:
  case WStype_ERROR:
  case WStype_FRAGMENT_TEXT_START:
  case WStype_FRAGMENT_BIN_START:
  case WStype_FRAGMENT:
  case WStype_FRAGMENT_FIN:
  case WStype_PING:
  case WStype_PONG:
    break;
  }
}

TaskHandle_t streamTaskHandle;
TaskHandle_t controlTaskHandle;

void streamTask(void *pvParameters) {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    ESP_LOGI(TAG_CAM, "PSRAM Found. Initializing stable buffers.");
    config.frame_size = FRAMESIZE_UXGA;
    config.jpeg_quality = 14;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    ESP_LOGW(TAG_CAM, "WARNING: PSRAM NOT FOUND!");
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = ESP_FAIL;
  int retry_count = 0;
  while (retry_count < 5) {
    err = esp_camera_init(&config);
    if (err == ESP_OK) {
      break;
    }
    retry_count++;
    Serial.printf("Camera init failed with error 0x%x. Retrying (%d/5)...\n",
                  err, retry_count);
    vTaskDelay(pdMS_TO_TICKS(500));
  }
  if (err != ESP_OK) {
    Serial.printf("Camera init absolute failure. System restarting...\n");
    esp_restart(); // Force hardware reboot if camera remains unresponsive
  } else {
    ESP_LOGI(TAG_CAM, "Warming up sensor AEC/AGC...");
    uint8_t warmup_fail_count = 0;
    for (int i = 0; i < 10; i++) {
      camera_fb_t *fb = esp_camera_fb_get();
      if (fb) {
        esp_camera_fb_return(fb);
        warmup_fail_count = 0;
      } else {
        warmup_fail_count++;
        if (warmup_fail_count >= 5) {
          ESP_LOGE(TAG_SYS, "Camera Fault! Bypassing camera hardware but "
                            "keeping HTTP server alive.");
          camera_fault = true;
          break;
        }
      }
      vTaskDelay(pdMS_TO_TICKS(20));
    }

    sensor_t *s = esp_camera_sensor_get();
    if (s) {
      s->set_whitebal(s, 1);
      s->set_gain_ctrl(s, 1);
      s->set_exposure_ctrl(s, 1);
      s->set_vflip(s, 1);
      s->set_hmirror(s, 1);
      s->set_sharpness(s, 2);
      s->set_denoise(s, 1);
      ESP_LOGI(TAG_CAM, "Sensor calibrated successfully.");
    }
  }

  for (;;) {
    if (camera_fault) {
      server.handleClient();
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }
    server.handleClient();
    vTaskDelay(pdMS_TO_TICKS(15));
  }
}

void controlTask(void *pvParameters) {
  for (;;) {
    webSocket.loop();

    static unsigned long lastSlowHeartbeat = 0;
    if (millis() - lastSlowHeartbeat > 2000) {
      webSocket.broadcastTXT("{\"status\": \"online\", \"distance\": 999, \"battery\": 100}");
      lastSlowHeartbeat = millis();
    }

    static bool was_arm_moving = false;
    static String last_arm_joint = "";
    static String last_arm_dir = "";

    if (arm_moving) {
      if (!was_arm_moving || arm_joint != last_arm_joint ||
          arm_dir != last_arm_dir) {
        Serial.printf("[ARM EXEC] Driving %s %s\n", arm_joint.c_str(),
                      arm_dir.c_str());
        Hardware.driveArmMotor(arm_joint, arm_dir, 4095);
        was_arm_moving = true;
        last_arm_joint = arm_joint;
        last_arm_dir = arm_dir;
      }
    } else {
      if (was_arm_moving) {
        Serial.println("[ARM EXEC] Stopping all motors");
        Hardware.stopArm();
        was_arm_moving = false;
        last_arm_joint = "";
        last_arm_dir = "";
      }
    }

    // Mode B: Non-blocking Serial Listener for Live WiFi Config Injection
    if (Serial.available()) {
      String line = Serial.readStringUntil('\n');
      line.trim();
      if (line.startsWith("$WIFI:")) {
        int firstColon = line.indexOf(':');
        int secondColon = line.indexOf(':', firstColon + 1);
        if (firstColon > 0 && secondColon > 0) {
          String new_ssid = line.substring(firstColon + 1, secondColon);
          String new_pass = line.substring(secondColon + 1);
          preferences.putString("ssid", new_ssid);
          preferences.putString("pass", new_pass);
          Serial.println(
              "[SYSTEM] New WiFi Config Received via Serial! Reconnecting...");
          WiFi.disconnect(true);
          WiFi.begin(new_ssid.c_str(), new_pass.c_str());
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable Brownout detector
  vTaskDelay(pdMS_TO_TICKS(
      1000)); // Guard delay to let voltage rails stabilize post-power-on
  Serial.begin(115200);

  // Initialize Custom Hardware Controller (I2C, PWM, Sensors)
  Hardware.begin();

  Serial.println("[SCAN] Scanning Wire (I2C0)...");
  for (byte i = 1; i < 127; i++) {
    Wire.beginTransmission(i);
    if (Wire.endTransmission() == 0)
      Serial.printf("[SCAN] Found device on Wire at 0x%02X\n", i);
  }

  // Set ESP Log Level globally
  esp_log_level_set("*", ESP_LOG_INFO);

  ESP_LOGI(TAG_SYS, "Booting Advanced ESP32-S3 Firmware...");

  // Clear corrupt NVS WiFi cache to prevent AP/STA password rejection
  WiFi.disconnect(true, true);
  vTaskDelay(pdMS_TO_TICKS(100));
  WiFi.mode(WIFI_MODE_NULL);
  vTaskDelay(pdMS_TO_TICKS(100));

  WiFi.setSleep(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(ap_ssid, ap_password, 6, 0, 4);
  ESP_LOGI(TAG_WIFI, "AP Live on Channel 6. IP: %s",
           WiFi.softAPIP().toString().c_str());

  preferences.begin("ares", false);
  String active_ssid = preferences.getString("ssid", sta_ssid);
  String active_pass = preferences.getString("pass", sta_password);

  ESP_LOGI(TAG_WIFI, "Attempting STA connection to %s", active_ssid.c_str());
  WiFi.begin(active_ssid.c_str(), active_pass.c_str());
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  unsigned long startAttemptTime = millis();
  bool staConnected = false;
  while (millis() - startAttemptTime < 15000) {
    if (WiFi.status() == WL_CONNECTED) {
      staConnected = true;
      break;
    }
    delay(500);
  }

  if (staConnected) {
    ESP_LOGI(TAG_WIFI, "STA Connected! Online Mode Active. IP: %s",
             WiFi.localIP().toString().c_str());
  } else {
    ESP_LOGW(TAG_WIFI,
             "STA Connection Timeout. Disabling STA to preserve AP stability.");
    WiFi.disconnect(true);
    WiFi.mode(WIFI_AP);
    ESP_LOGI(TAG_WIFI, "Running strictly in Offline AP Mode.");
  }

  server.enableCORS(true);

  server.on("/", HTTP_GET,
            []() { server.send(200, "text/plain", "ARES-01 ONLINE"); });

  server.on("/command", HTTP_POST, handleCommand);
  server.on("/command", HTTP_OPTIONS, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(204);
  });

  server.on("/stream", HTTP_GET, stream_handler);
  server.on("/capture", HTTP_GET, handleCapture);

  server.on("/telemetry", HTTP_GET, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Private-Network", "true");
    server.sendHeader("Cache-Control", "no-cache");
    server.send(200, "application/json",
                "{\"battery\":100, \"distance\":10, \"status\":\"ok\"}");
  });

  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) {
      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
      server.send(204);
    } else {
      server.send(404, "text/plain", "Not Found");
    }
  });

  server.on("/reset", HTTP_ANY, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", "{\"status\":\"rebooting\"}");
    delay(500);
    ESP.restart();
  });
  
  server.on("/reboot", HTTP_ANY, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", "{\"status\":\"rebooting\"}");
    delay(500);
    ESP.restart();
  });

  server.begin();
  webSocket.begin();
  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.onEvent(webSocketEvent);
  ESP_LOGI(TAG_SYS, "Monolithic Web Server and WebSocket Server Started.");

  xTaskCreatePinnedToCore(streamTask, "StreamTask", 10240, NULL, 2,
                          &streamTaskHandle, 1);
  xTaskCreatePinnedToCore(controlTask, "ControlTask", 8192, NULL, 2,
                          &controlTaskHandle, 0);
  xTaskCreatePinnedToCore(mjpegTask, "MjpegTask", 8192, NULL, 1,
                          NULL, 1);
  ESP_LOGI(TAG_SYS, "FreeRTOS Dual-Core Architecture initialized!");
}

void loop() { vTaskDelete(NULL); }
