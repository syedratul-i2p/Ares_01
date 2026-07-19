#include "FirebaseBridge.h"

// Static reference needed for the Firebase stream callback
HardwareController* FirebaseBridge::staticHwRef = nullptr;

FirebaseBridge::FirebaseBridge(HardwareController* hw) {
    hwController = hw;
    staticHwRef = hw;
}

void FirebaseBridge::begin(const char* ssid, const char* password, const char* apiKey, const char* databaseUrl, const char* storageBucket) {
    // 1. WiFi Connection
    Serial.print("[WiFi] Connecting to ");
    Serial.println(ssid);
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\n[WiFi] Connected. IP: " + WiFi.localIP().toString());
    
    // 2. Camera Init (Removed from bridge)

    // 3. Firebase Configuration
    config.api_key = apiKey;
    config.database_url = databaseUrl;
    auth.user.email = "rover@ares.ai";     // Firebase anonymous auth or dedicated user
    auth.user.password = "ares123456"; 
    
    storageBucketPath = String(storageBucket);

    config.token_status_callback = tokenStatusCallback;
    
    fbdo.setBSSLBufferSize(4096, 1024);
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
    
    // 4. Setup RTDB Listener for Commands
    if (!Firebase.RTDB.beginStream(&streamFbdo, "/ares_01/commands/current_action")) {
        Serial.printf("[Firebase] Stream begin error: %s\n", streamFbdo.errorReason().c_str());
    } else {
        Firebase.RTDB.setStreamCallback(&streamFbdo, streamCallback, streamTimeoutCallback);
        Serial.println("[Firebase] Command Stream Listener Active.");
    }
    
    isConnected = true;
}



void FirebaseBridge::pushTelemetry() {
    // Push Battery & Distance to RTDB at /ares_01/telemetry
    FirebaseJson json;
    json.set("battery_percentage", hwController->getBatteryPercentage());
    json.set("obstacle_distance", hwController->getObstacleDistance());
    
    if (!Firebase.RTDB.updateNode(&fbdo, "/ares_01/telemetry", &json)) {
        // Serial.printf("[Firebase] Telemetry update failed: %s\n", fbdo.errorReason().c_str());
    }
}

void FirebaseBridge::uploadCameraFrame() {
    if (Firebase.ready()) {
        camera_fb_t * fb = esp_camera_fb_get();
        if (!fb) {
            Serial.println("[Camera] Capture failed");
            return;
        }
        
        // Upload directly from memory buffer
        if (Firebase.Storage.upload(&fbdo, storageBucketPath.c_str(), fb->buf, fb->len, "image/jpeg", "/ares_01/camera/live_frame.jpg", nullptr)) {
            // Serial.println("[Firebase] Frame Uploaded.");
        } else {
            Serial.printf("[Firebase] Upload failed: %s\n", fbdo.errorReason().c_str());
        }
        
        esp_camera_fb_return(fb);
    }
}

void FirebaseBridge::streamCallback(FirebaseStream data) {
    if (data.dataType() == "json") {
        String jsonPayload = data.jsonString();
        Serial.printf("[Command Rx] %s\n", jsonPayload.c_str());
        if (staticHwRef) {
            staticHwRef->executeCommand(jsonPayload);
        }
    }
}

void FirebaseBridge::streamTimeoutCallback(bool timeout) {
    if (timeout) {
        Serial.println("[Firebase] Stream timeout, reconnecting...");
    }
}

void FirebaseBridge::loop() {
    if (!isConnected) return;
    
    unsigned long currentMillis = millis();
    
    // 10Hz Telemetry Push
    if (currentMillis - lastTelemetryTime >= 100) {
        pushTelemetry();
        lastTelemetryTime = currentMillis;
    }
    
    // 0.33Hz Camera Upload (Cloud limits & AI Sync)
    if (currentMillis - lastFrameTime >= 3000) {
        uploadCameraFrame();
        lastFrameTime = currentMillis;
    }
}
