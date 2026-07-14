#include "LocalEdgeBridge.h"

// Standard MJPEG HTTP boundary
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

LocalEdgeBridge::LocalEdgeBridge(HardwareController* hw) : mjpegServer(80) {
    hwController = hw;
}

bool LocalEdgeBridge::begin(const char* staSsid, const char* staPassword, const char* apSsid, const char* apPassword) {
    // 1. Attempt STA Mode First (Max 5 seconds)
    Serial.print("[WiFi] Attempting STA connection to ");
    Serial.println(staSsid);
    
    WiFi.mode(WIFI_STA);
    WiFi.begin(staSsid, staPassword);
    
    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 10) {
        delay(500);
        Serial.print(".");
        retries++;
    }
    
    bool isOnline = (WiFi.status() == WL_CONNECTED);

    if (isOnline) {
        Serial.println("\n[WiFi] Connected to STA. IP: " + WiFi.localIP().toString());
    } else {
        // 2. Fallback to AP Mode (Offline Edge)
        Serial.println("\n[WiFi] STA Failed. Falling back to AP Mode (Offline Edge)...");
        startAP(apSsid, apPassword);
    }

    // 3. Setup UDP Listener on port 4210
    setupUdpListener();
    
    // 4. Start MJPEG HTTP Server on port 80
    mjpegServer.begin();
    Serial.println("[MJPEG] Stream server started on port 80");

    return isOnline; // Returns true if Online, false if Offline
}

void LocalEdgeBridge::startAP(const char* ssid, const char* password) {
    WiFi.mode(WIFI_AP);
    // Use fixed IP: 192.168.4.1 by default on ESP32
    WiFi.softAP(ssid, password);
    Serial.print("[WiFi] AP Mode Active: ");
    Serial.println(ssid);
    Serial.print("[WiFi] AP IP: ");
    Serial.println(WiFi.softAPIP());
}

void LocalEdgeBridge::setupUdpListener() {
    if (udp.listen(4210)) {
        Serial.println("[UDP] Listening on port 4210 for commands.");
        udp.onPacket([this](AsyncUDPPacket packet) {
            String jsonPayload = (const char*)packet.data();
            // Serial.printf("[UDP Rx] %s\n", jsonPayload.c_str());
            hwController->executeCommand(jsonPayload);
        });
    }
}

void LocalEdgeBridge::pushUdpTelemetry() {
    // Broadcast Telemetry to 255.255.255.255 on port 4211
    StaticJsonDocument<200> doc;
    doc["battery_percentage"] = hwController->getBatteryPercentage();
    doc["obstacle_distance"] = hwController->getObstacleDistance();
    
    String telemetryStr;
    serializeJson(doc, telemetryStr);
    
    udp.broadcastTo(telemetryStr.c_str(), 4211);
}

void LocalEdgeBridge::handleMjpegStream() {
    WiFiClient client = mjpegServer.available();
    if (!client) return;
    
    Serial.println("[MJPEG] Client connected.");
    
    client.print("HTTP/1.1 200 OK\r\n");
    client.print("Access-Control-Allow-Origin: *\r\n");
    client.print("Content-Type: ");
    client.print(_STREAM_CONTENT_TYPE);
    client.print("\r\n\r\n");
    
    camera_fb_t * fb = NULL;
    char part_buf[128];
    
    while (client.connected()) {
        fb = esp_camera_fb_get();
        if (!fb) {
            Serial.println("[Camera] Capture failed");
            break;
        }
        
        size_t hlen = snprintf(part_buf, 128, _STREAM_PART, fb->len);
        
        client.print(_STREAM_BOUNDARY);
        client.write((const uint8_t *)part_buf, hlen);
        client.write(fb->buf, fb->len);
        
        esp_camera_fb_return(fb);
        
        // Small delay to prevent network congestion
        delay(50);
    }
    
    client.stop();
    Serial.println("[MJPEG] Client disconnected.");
}

void LocalEdgeBridge::loop() {
    unsigned long currentMillis = millis();
    
    // 10Hz Telemetry Broadcast
    if (currentMillis - lastTelemetryTime >= 100) {
        pushUdpTelemetry();
        lastTelemetryTime = currentMillis;
    }
    
    // Check for incoming MJPEG stream clients
    handleMjpegStream();
}
