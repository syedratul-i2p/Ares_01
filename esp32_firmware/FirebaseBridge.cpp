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
    
    // 2. Camera Init
    initCamera();

    // 3. Firebase Configuration
    config.api_key = apiKey;
    config.database_url = databaseUrl;
    auth.user.email = "rover@ares.ai";     // Firebase anonymous auth or dedicated user
    auth.user.password = "ares123456"; 
    
    storageBucketPath = String(storageBucket);

    config.token_status_callback = tokenStatusCallback;
    
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

void FirebaseBridge::initCamera() {
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
    
    // Low resolution for faster cloud upload
    if(psramFound()){
        config.frame_size = FRAMESIZE_VGA;
        config.jpeg_quality = 12;
        config.fb_count = 2;
    } else {
        config.frame_size = FRAMESIZE_SVGA;
        config.jpeg_quality = 12;
        config.fb_count = 1;
    }

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("[Camera] Init Failed with error 0x%x\n", err);
    } else {
        Serial.println("[Camera] Initialized successfully.");
    }
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
    
    // 2Hz Camera Upload (Cloud limits)
    if (currentMillis - lastFrameTime >= 500) {
        uploadCameraFrame();
        lastFrameTime = currentMillis;
    }
}
