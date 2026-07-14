#ifndef HARDWARE_CONTROLLER_H
#define HARDWARE_CONTROLLER_H

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <ArduinoJson.h>

class HardwareController {
public:
    HardwareController();
    void initHardware();
    void updateTelemetry();
    void executeCommand(String commandJson);
    
    // Telemetry Getters
    float getBatteryPercentage();
    float getObstacleDistance();

private:
    // I2C Dual PWM Drivers
    Adafruit_PWMServoDriver pwm1; // 0x40 (Locomotion & Arm Base/Elbow)
    Adafruit_PWMServoDriver pwm2; // 0x41 (Arm Shoulder/Wrist & Gripper)

    // ESP32-S3 Hardware Pins
    const int TRIG_PIN = 5;
    const int ECHO_PIN = 18;
    const int BATTERY_ADC_PIN = 4; // ADC1_CH3 on ESP32-S3

    // Telemetry State
    float batteryPercentage = 0.0;
    float obstacleDistance = 999.9;
    
    // Internal Methods
    void calculateBattery();
    void calculateSonar();
    void emergencyStop();

    // Hybrid Motor Drivers Mapping
    void setLocomotion(String direction, int speed);
    void executeArmMacro(String macro);
};

#endif
