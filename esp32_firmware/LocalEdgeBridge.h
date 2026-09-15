#ifndef LOCAL_EDGE_BRIDGE_H
#define LOCAL_EDGE_BRIDGE_H

#include <Arduino.h>
#include <WiFi.h>
#include <AsyncUDP.h>
#include "HardwareController.h"
#include "esp_camera.h"

class LocalEdgeBridge {
public:
    LocalEdgeBridge(HardwareController* hw);
    
    // Attempt STA, fallback to AP
    bool begin(const char* staSsid, const char* staPassword, const char* apSsid = "ARES_01", const char* apPassword = "");
    
    void loop();

private:
    HardwareController* hwController;
    AsyncUDP udp;
    WiFiServer mjpegServer;
    
    unsigned long lastTelemetryTime = 0;
    
    void startAP(const char* ssid, const char* password);
    void setupUdpListener();
    void handleMjpegStream();
    void pushUdpTelemetry();
};

#endif
