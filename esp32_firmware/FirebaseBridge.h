#ifndef FIREBASE_BRIDGE_H
#define FIREBASE_BRIDGE_H

#include <Arduino.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>
#include "HardwareController.h"
#include "esp_camera.h"

// CAMERA_MODEL_AI_THINKER
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

class FirebaseBridge {
public:
    FirebaseBridge(HardwareController* hw);
    void begin(const char* ssid, const char* password, const char* apiKey, const char* databaseUrl, const char* storageBucket);
    void loop();
    void pushTelemetry();
    void uploadCameraFrame();

private:
    HardwareController* hwController;
    
    FirebaseData fbdo;
    FirebaseData streamFbdo; // Dedicated FirebaseData object for stream
    FirebaseAuth auth;
    FirebaseConfig config;
    
    String storageBucketPath;
    
    bool isConnected = false;
    unsigned long lastTelemetryTime = 0;
    unsigned long lastFrameTime = 0;

    void initCamera();
    static void streamCallback(FirebaseStream data);
    static void streamTimeoutCallback(bool timeout);
    
    // Internal reference for the static stream callback to access hardware
    static HardwareController* staticHwRef;
};

#endif
