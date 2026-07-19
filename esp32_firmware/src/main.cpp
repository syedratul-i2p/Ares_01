#include "esp_camera.h"
#include "esp_log.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <WiFi.h>
#include "HardwareController.h"

// Function Prototypes
void executeHardwareCommand(String type, String command, int speed);
void handleCommand();
void stream_handler();
void handleCapture();

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
const char *ap_password = "AresAdmin123";
const char *sta_ssid = "N3M0_0x7A";
const char *sta_password = "Ratul_i2p@6072";

WebServer server(80);

#define PART_BOUNDARY "123456789000000000000987654321"
static const char *_STREAM_CONTENT_TYPE =
    "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *_STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *_STREAM_PART =
    "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

void executeHardwareCommand(String type, String command, int speed) {
  ESP_LOGI(TAG_SYS, "Executing JSON Command -> Type: %s | Cmd: %s | Speed: %d",
           type.c_str(), command.c_str(), speed);

  if (type == "drive") {
      if (command == "FORWARD") Hardware.drive(speed, speed);
      else if (command == "BACKWARD") Hardware.drive(-speed, -speed);
      else if (command == "LEFT") Hardware.drive(-speed, speed);
      else if (command == "RIGHT") Hardware.drive(speed, -speed);
      else Hardware.drive(0, 0);
  } else if (type == "arm") {
      int joint = command.toInt();
      if (command.indexOf("UP") != -1) {
          Hardware.setArmMotor(joint, speed);
      } else if (command.indexOf("DOWN") != -1) {
          Hardware.setArmMotor(joint, -speed);
      } else if (command.indexOf("STOP") != -1) {
          Hardware.setArmMotor(joint, 0);
      } else {
          Hardware.setArmMotor(joint, speed);
      }
  }
}

void handleCommand() {
  if (server.method() != HTTP_POST) {
    server.send(405, "text/plain", "Method Not Allowed");
    ESP_LOGW(TAG_HTTP, "Invalid method on /command");
    return;
  }
  String body = server.arg("plain");
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    ESP_LOGE(TAG_HTTP, "JSON Parse failed: %s", error.c_str());
    server.send(400, "application/json",
                "{\"status\":\"error\", \"message\":\"Invalid JSON\"}");
    return;
  }
  String type = doc["type"] | "drive";
  String command = doc["command"] | "STOP";
  int speed = doc["speed"] | 200;
  executeHardwareCommand(type, command, speed);
  server.send(200, "application/json",
              "{\"status\":\"success\", \"message\":\"Command Executed\"}");
}

void stream_handler() {
  WiFiClient client = server.client();
  if (!client.connected())
    return;

  // Disable Nagle's algorithm for immediate transmission of motion frames
  client.setNoDelay(true);

  ESP_LOGI(TAG_HTTP, "MJPEG Stream client connected.");
  client.print("HTTP/1.1 200 OK\r\n");
  client.print("Access-Control-Allow-Origin: *\r\n");
  client.print("Content-Type: ");
  client.print(_STREAM_CONTENT_TYPE);
  client.print("\r\n\r\n");

  camera_fb_t *fb = NULL;
  char part_buf[128];

  unsigned long frame_count = 0; // Initialize frame counter

  while (client.connected()) {
    fb = esp_camera_fb_get();
    if (!fb) {
      ESP_LOGE(TAG_CAM, "Capture failed. Retrying...");
      delay(100);
      continue;
    }
    size_t hlen = snprintf(part_buf, 128, _STREAM_PART, fb->len);
    client.write((const uint8_t *)_STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    client.write((const uint8_t *)part_buf, hlen);
    client.write(fb->buf, fb->len);
    esp_camera_fb_return(fb);

    frame_count++;
    if (frame_count % 100 == 0) {
      ESP_LOGI(TAG_CAM, "Streaming active... Successfully sent %lu frames.",
               frame_count);
    }

    vTaskDelay(pdMS_TO_TICKS(100));
  }

  client.stop();
  ESP_LOGI(TAG_HTTP, "MJPEG Stream client disconnected. Total frames sent: %lu",
           frame_count);
}

void handleCapture() {
  // DMA Buffer Flush: discard the stale frame
  camera_fb_t *fb_drop = esp_camera_fb_get();
  if (fb_drop) {
    esp_camera_fb_return(fb_drop);
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    ESP_LOGE(TAG_CAM, "Camera Capture Failed");
    server.send(500, "text/plain", "Camera Capture Failed");
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

void setup() {
  vTaskDelay(pdMS_TO_TICKS(
      1000)); // Guard delay to let voltage rails stabilize post-power-on
  Serial.begin(115200);

  // Initialize Custom Hardware Controller (I2C, PWM, Sensors)
  Hardware.begin();

  // Set ESP Log Level globally
  esp_log_level_set("*", ESP_LOG_INFO);

  ESP_LOGI(TAG_SYS, "Booting Advanced ESP32-S3 Firmware...");

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
    for (int i = 0; i < 10; i++) {
      camera_fb_t *fb = esp_camera_fb_get();
      if (fb)
        esp_camera_fb_return(fb);
      delay(20);
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

  ESP_LOGI(TAG_WIFI, "Attempting STA connection to %s", sta_ssid);
  WiFi.begin(sta_ssid, sta_password);
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

  server.on("/command", HTTP_POST, handleCommand);
  server.on("/stream", HTTP_GET, stream_handler);
  server.on("/capture", HTTP_GET, handleCapture);
  server.begin();
  ESP_LOGI(TAG_SYS, "Monolithic Web Server Started.");
}

void loop() { server.handleClient(); }
