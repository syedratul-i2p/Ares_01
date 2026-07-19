#ifndef HARDWARE_CONTROLLER_H
#define HARDWARE_CONTROLLER_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

// I2C MAPPING for PCA9685
#define I2C_SDA_PIN 1
#define I2C_SCL_PIN 2

// SENSOR MAPPING
#define HC_SR04_TRIG_PIN 41
#define HC_SR04_ECHO_PIN 42
#define BATTERY_ADC_PIN 6

class HardwareController {
private:
    Adafruit_PWMServoDriver pwm1; // Wheel Drive (L298N)
    Adafruit_PWMServoDriver pwm2; // 5-DOF Arm (TB6612FNG)

    // Helper for PCA9685 PWM
    void setPWM(Adafruit_PWMServoDriver &pwm, uint8_t channel, uint16_t on, uint16_t off);

public:
    HardwareController();

    void begin();

    // Wheel Drive (PCA-1)
    void drive(int speedLeft, int speedRight);
    
    // Arm Drive (PCA-2)
    // joint: 0-4
    void setArmMotor(uint8_t joint, int speed);

    // Telemetry
    float getBatteryVoltage();
    float getDistance();
};

extern HardwareController Hardware;

#endif // HARDWARE_CONTROLLER_H
