#ifndef HARDWARE_CONTROLLER_H
#define HARDWARE_CONTROLLER_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

// I2C MAPPING for Unified Bus
#define I2C_SDA_PIN 1
#define I2C_SCL_PIN 2



class HardwareController {
private:
    Adafruit_PWMServoDriver pca1 = Adafruit_PWMServoDriver(0x40); // Chassis
    Adafruit_PWMServoDriver pca2 = Adafruit_PWMServoDriver(0x41); // Arm

    // Helper for PCA9685 PWM
    void setPWM(Adafruit_PWMServoDriver &pwm, uint8_t channel, uint16_t on, uint16_t off);
    void setMotorState(Adafruit_PWMServoDriver &pca, int pwmPin, int in1Pin, int in2Pin, int uiValue);

public:
    HardwareController();

    void begin();

    // Wheel Drive (PCA-1)
    void drive(int speedLeft, int speedRight);
    void stop();
    
    // Arm Drive (PCA-2)
    void setArmMotor(String joint, String direction, int absoluteAngle);
    void driveArmMotor(String joint, String dir, int speed);
    void stopArm();
};
extern HardwareController Hardware;

#endif // HARDWARE_CONTROLLER_H
