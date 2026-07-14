#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include "esp_camera.h"
#include "esp_log.h"

// Function Prototypes
void executeHardwareCommand(String type, String command, int speed);
void handleCommand();
void handleStream();
void handleCapture();

// Define Log Tags
static const char *TAG_SYS = "SYS";
static const char *TAG_WIFI = "WIFI";
static const char *TAG_CAM = "CAM";
static const char *TAG_HTTP = "HTTP";

// VERIFIED PHYSICAL PIN MAPPING
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     15
#define SIOD_GPIO_NUM      4
#define SIOC_GPIO_NUM      5
#define Y9_GPIO_NUM       16
#define Y8_GPIO_NUM       17
#define Y7_GPIO_NUM       18
#define Y6_GPIO_NUM       12
#define Y5_GPIO_NUM       10
#define Y4_GPIO_NUM       11
#define Y3_GPIO_NUM        9
#define Y2_GPIO_NUM       13
#define VSYNC_GPIO_NUM     6
#define HREF_GPIO_NUM      7
#define PCLK_GPIO_NUM     14

// NETWORK CONFIGURATION
const char* ap_ssid = "ARES_01_OFFLINE";
const char* ap_password = "Password123";
const char* sta_ssid = "N3M0_0x7A";
const char* sta_password = "Ratul_i2p@6072";

WebServer server(80);

#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

void executeHardwareCommand(String type, String command, int speed) {
  ESP_LOGI(TAG_SYS, "Executing JSON Command -> Type: %s | Cmd: %s | Speed: %d", type.c_str(), command.c_str(), speed);
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
    server.send(400, "application/json", "{\"status\":\"error\", \"message\":\"Invalid JSON\"}");
    return;
  }
  String type = doc["type"] | "drive";
  String command = doc["command"] | "STOP";
  int speed = doc["speed"] | 200;
  executeHardwareCommand(type, command, speed);
  server.send(200, "application/json", "{\"status\":\"success\", \"message\":\"Command Executed\"}");
}

void handleStream() {
  WiFiClient client = server.client();
  if (!client.connected()) return;
  
  ESP_LOGI(TAG_HTTP, "MJPEG Stream client connected.");
  client.print("HTTP/1.1 200 OK\r\n");
  client.print("Access-Control-Allow-Origin: *\r\n");
  client.print("Content-Type: ");
  client.print(_STREAM_CONTENT_TYPE);
  client.print("\r\n\r\n");
  
  camera_fb_t * fb = NULL;
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
       ESP_LOGI(TAG_CAM, "Streaming active... Successfully sent %lu frames.", frame_count);
    }
    
    delay(30); 
  }
  
  client.stop();
  ESP_LOGI(TAG_HTTP, "MJPEG Stream client disconnected. Total frames sent: %lu", frame_count);
}

void handleCapture() {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    ESP_LOGE(TAG_CAM, "Camera Capture Failed");
    server.send(500, "text/plain", "Camera Capture Failed");
    return;
  }
  
  server.sendHeader("Content-Type", "image/jpeg");
  server.sendContent((const char *)fb->buf, fb->len);
  
  esp_camera_fb_return(fb);
  ESP_LOGI(TAG_HTTP, "Single frame captured and sent.");
}

void setup() {
  delay(2000); // Hardware stabilization delay to prevent camera brownout
  Serial.begin(115200);
  
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
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  if (psramFound()) {
    ESP_LOGI(TAG_CAM, "PSRAM Found. Initializing stable buffers.");
    config.frame_size = FRAMESIZE_QVGA; 
    config.jpeg_quality = 12;
    config.fb_count = 2;
    config.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    ESP_LOGW(TAG_CAM, "WARNING: PSRAM NOT FOUND!");
    config.frame_size = FRAMESIZE_SVGA;
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    ESP_LOGE(TAG_CAM, "Camera Init Failed with error 0x%x", err);
    ESP_LOGE(TAG_CAM, "Continuing boot without camera to allow diagnostic access.");
  }

  WiFi.setSleep(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(ap_ssid, ap_password, 6, 0, 4);
  ESP_LOGI(TAG_WIFI, "AP Live on Channel 6. IP: %s", WiFi.softAPIP().toString().c_str());

  ESP_LOGI(TAG_WIFI, "Attempting STA connection to %s", sta_ssid);
  WiFi.begin(sta_ssid, sta_password);
  unsigned long startAttemptTime = millis();
  bool staConnected = false;
  while (millis() - startAttemptTime < 8000) {
    if (WiFi.status() == WL_CONNECTED) {
      staConnected = true;
      break;
    }
    delay(500);
  }

  if (staConnected) {
    ESP_LOGI(TAG_WIFI, "STA Connected! Online Mode Active. IP: %s", WiFi.localIP().toString().c_str());
  } else {
    ESP_LOGW(TAG_WIFI, "STA Connection Timeout. Disabling STA to preserve AP stability.");
    WiFi.disconnect(true);
    WiFi.mode(WIFI_AP);
    ESP_LOGI(TAG_WIFI, "Running strictly in Offline AP Mode.");
  }

  server.on("/command", HTTP_POST, handleCommand);
  server.on("/stream", HTTP_GET, handleStream);
  server.on("/capture", HTTP_GET, handleCapture);
  server.begin();
  ESP_LOGI(TAG_SYS, "Monolithic Web Server Started.");
}

void loop() {
  server.handleClient();
}
