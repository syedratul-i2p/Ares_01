#include "HardwareController.h"

// Unified 5V Power Architecture
// The Buck Converter steps down the 12.6V to 5.0V, safely powering everything.

HardwareController Hardware;

HardwareController::HardwareController() : pwm1(0x40), pwm2(0x41) {}

void HardwareController::begin() {
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    
    // Initialize PCA9685 - 1 (Wheels)
    pwm1.begin();
    pwm1.setOscillatorFrequency(27000000);
    pwm1.setPWMFreq(1600); // 1.6 kHz for motor driver

    // Initialize PCA9685 - 2 (Arm)
    pwm2.begin();
    pwm2.setOscillatorFrequency(27000000);
    pwm2.setPWMFreq(1600); 
    
    // Initialize Sensors
    pinMode(HC_SR04_TRIG_PIN, OUTPUT);
    pinMode(HC_SR04_ECHO_PIN, INPUT);
    // ADC configuration is usually handled by analogRead on ESP32
    
    // Ensure all motors are initially stopped
    drive(0, 0);
    for(int i = 0; i < 5; i++) {
        setArmMotor(i, 0);
    }
}

void HardwareController::setPWM(Adafruit_PWMServoDriver &pwm, uint8_t channel, uint16_t on, uint16_t off) {
    pwm.setPWM(channel, on, off);
}

void HardwareController::drive(int speedLeft, int speedRight) {
    // Constraint speed between -4095 and 4095 (12-bit PCA9685)
    speedLeft = constrain(speedLeft, -4095, 4095);
    speedRight = constrain(speedRight, -4095, 4095);

    // LEFT WHEELS (L298N #1) -> Front: ENA(0), IN1(1), IN2(2) | Rear: IN3(3), IN4(4), ENB(5)
    if (speedLeft == 0) {
        setPWM(pwm1, 1, 0, 0); setPWM(pwm1, 2, 0, 0); setPWM(pwm1, 0, 0, 0);
        setPWM(pwm1, 3, 0, 0); setPWM(pwm1, 4, 0, 0); setPWM(pwm1, 5, 0, 0);
    } else if (speedLeft > 0) {
        setPWM(pwm1, 1, 4096, 0); setPWM(pwm1, 2, 0, 4096); setPWM(pwm1, 0, 0, speedLeft);
        setPWM(pwm1, 3, 4096, 0); setPWM(pwm1, 4, 0, 4096); setPWM(pwm1, 5, 0, speedLeft);
    } else {
        setPWM(pwm1, 1, 0, 4096); setPWM(pwm1, 2, 4096, 0); setPWM(pwm1, 0, 0, -speedLeft);
        setPWM(pwm1, 3, 0, 4096); setPWM(pwm1, 4, 4096, 0); setPWM(pwm1, 5, 0, -speedLeft);
    }

    // RIGHT WHEELS (L298N #2) -> Front: ENA(6), IN1(7), IN2(8) | Rear: IN3(9), IN4(10), ENB(11)
    if (speedRight == 0) {
        setPWM(pwm1, 7, 0, 0); setPWM(pwm1, 8, 0, 0); setPWM(pwm1, 6, 0, 0);
        setPWM(pwm1, 9, 0, 0); setPWM(pwm1, 10, 0, 0); setPWM(pwm1, 11, 0, 0);
    } else if (speedRight > 0) {
        setPWM(pwm1, 7, 4096, 0); setPWM(pwm1, 8, 0, 4096); setPWM(pwm1, 6, 0, speedRight);
        setPWM(pwm1, 9, 4096, 0); setPWM(pwm1, 10, 0, 4096); setPWM(pwm1, 11, 0, speedRight);
    } else {
        setPWM(pwm1, 7, 0, 4096); setPWM(pwm1, 8, 4096, 0); setPWM(pwm1, 6, 0, -speedRight);
        setPWM(pwm1, 9, 0, 4096); setPWM(pwm1, 10, 4096, 0); setPWM(pwm1, 11, 0, -speedRight);
    }
}

void HardwareController::setArmMotor(uint8_t joint, int speed) {
    speed = constrain(speed, -4095, 4095);

    Adafruit_PWMServoDriver* target_pwm;
    uint8_t ch_pwm, ch_in1, ch_in2;

    switch (joint) {
        case 0: // Arm Joint 1 / Base (L298N #3 on PCA-1)
            target_pwm = &pwm1;
            ch_pwm = 12; ch_in1 = 13; ch_in2 = 14;
            break;
        case 1: // Arm Joint 2 / Shoulder (TB6612 #1 on PCA-2)
            target_pwm = &pwm2;
            ch_pwm = 0; ch_in1 = 1; ch_in2 = 2;
            break;
        case 2: // Arm Joint 3 / Elbow (TB6612 #1 on PCA-2)
            target_pwm = &pwm2;
            ch_pwm = 3; ch_in1 = 4; ch_in2 = 5;
            break;
        case 3: // Arm Joint 4 / Wrist (TB6612 #2 on PCA-2)
            target_pwm = &pwm2;
            ch_pwm = 6; ch_in1 = 7; ch_in2 = 8;
            break;
        case 4: // Arm Joint 5 / Gripper (TB6612 #2 on PCA-2)
            target_pwm = &pwm2;
            ch_pwm = 9; ch_in1 = 10; ch_in2 = 11;
            break;
        default:
            return;
    }
    
    if (speed == 0) {
        setPWM(*target_pwm, ch_in1, 0, 0);
        setPWM(*target_pwm, ch_in2, 0, 0);
        setPWM(*target_pwm, ch_pwm, 0, 0);
    } else if (speed > 0) {
        setPWM(*target_pwm, ch_in1, 4096, 0);
        setPWM(*target_pwm, ch_in2, 0, 4096);
        setPWM(*target_pwm, ch_pwm, 0, speed);
    } else {
        setPWM(*target_pwm, ch_in1, 0, 4096);
        setPWM(*target_pwm, ch_in2, 4096, 0);
        setPWM(*target_pwm, ch_pwm, 0, -speed);
    }
}

float HardwareController::getBatteryVoltage() {
    int rawValue = analogRead(BATTERY_ADC_PIN);
    // ESP32 ADC is 12-bit (0-4095) for 3.3V reference.
    // 3.3V / 4095 = 0.00080586 V per unit
    // Voltage Divider: V_batt = V_pin * ((33k + 10k) / 10k) = V_pin * 4.3
    // Measures the RAW 12.6V line (placed before the buck converter) for Battery Safety
    float vPin = rawValue * (3.3 / 4095.0);
    return vPin * 4.3;
}

float HardwareController::getDistance() {
    digitalWrite(HC_SR04_TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(HC_SR04_TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(HC_SR04_TRIG_PIN, LOW);
    
    long duration = pulseIn(HC_SR04_ECHO_PIN, HIGH, 30000); // 30ms timeout
    if (duration == 0) return -1.0; // timeout or error
    
    // speed of sound = 343 m/s -> 29.15 us/cm
    return (duration / 2.0) / 29.1;
}
