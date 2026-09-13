#include "HardwareController.h"

// Unified 5V Power Architecture
// The Buck Converter steps down the 12.6V to 5.0V, safely powering everything.

HardwareController Hardware;

HardwareController::HardwareController() {}

void HardwareController::begin() {
    if (!Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 100000)) {
        Serial.println("[ERR] Wire init failed! Skipping PCA setup to maintain network stack.");
        return;
    }
    delay(50);
    
    // Initialize PCA9685 - 1 (Chassis) at 0x40
    pca1.begin();
    pca1.setOscillatorFrequency(27000000);
    pca1.setPWMFreq(1000);
    
    // Initialize PCA9685 - 2 (Arm) at 0x41 on the SAME bus
    pca2.begin();
    pca2.setOscillatorFrequency(27000000);
    pca2.setPWMFreq(1000);
    delay(10);
    
    Serial.println("[SYS] Dual PCA9685 Daisy-Chain Initialized on Wire.");

    // (Sensors physically removed to prevent CPU blocking)
    
    // Ensure all motors are initially stopped
    drive(0, 0);
    
    // Center all servos on boot
    setArmMotor("base", "", 90);
    setArmMotor("shoulder", "", 90);
    setArmMotor("elbow", "", 90);
    setArmMotor("wrist", "", 90);
    setArmMotor("gripper", "", 90);

    // Pull STBY HIGH for TB6612FNG on PCA1 Pin 15 (if used)
    pca1.setPWM(15, 4096, 0);
}

void HardwareController::setPWM(Adafruit_PWMServoDriver &pwm, uint8_t channel, uint16_t on, uint16_t off) {
    pwm.setPWM(channel, on, off);
}

void HardwareController::setMotorState(Adafruit_PWMServoDriver &pca, int pwmPin, int in1Pin, int in2Pin, int uiValue) {
    int speed = 0;
    bool dirForward = true;
    
    // Increased minimum PWM for more torque in both directions
    int MIN_PWM = 3800; 

    if (uiValue > 91) {
        // Map 91-180 strictly to MIN_PWM-4096
        speed = map(uiValue, 91, 180, MIN_PWM, 4096);
        dirForward = true;
    } else if (uiValue < 89) {
        // Map 89-0 strictly to MIN_PWM-4096
        speed = map(uiValue, 89, 0, MIN_PWM, 4096);
        dirForward = false;
    } else {
        // Strict Deadband for 89, 90, 91
        speed = 0; 
    }

    if (speed == 0) {
        pca.setPWM(in1Pin, 0, 4096); 
        pca.setPWM(in2Pin, 0, 4096); 
        pca.setPWM(pwmPin, 0, 4096); 
    } else {
        if (dirForward) {
            pca.setPWM(in1Pin, 4096, 0); 
            pca.setPWM(in2Pin, 0, 4096); 
        } else {
            pca.setPWM(in1Pin, 0, 4096); 
            pca.setPWM(in2Pin, 4096, 0); 
        }
        pca.setPWM(pwmPin, 0, speed);
    }
    
    if (pwmPin == 9) { // Gripper specific logic log
        int in3 = (speed == 0) ? 0 : (dirForward ? 4096 : 0);
        int in4 = (speed == 0) ? 0 : (dirForward ? 0 : 4096);
        Serial.printf("[GRIPPER] V: %d, PWM: %d, IN3: %d, IN4: %d\n", uiValue, (speed == 0 ? 0 : speed), in3, in4);
    }
}

void HardwareController::drive(int speedLeft, int speedRight) {
    int leftUi = map(speedLeft, -255, 255, 0, 180);
    int rightUi = map(speedRight, -255, 255, 0, 180);

    // Left Wheels (Inverted: IN2/IN4 is Forward)
    setMotorState(pca1, 0, 2, 1, leftUi); // FL Wheel
    setMotorState(pca1, 5, 4, 3, leftUi); // BL Wheel
    
    // Right Wheels (Inverted: IN2/IN4 is Forward)
    setMotorState(pca1, 6, 8, 7, rightUi); // FR Wheel
    setMotorState(pca1, 11, 10, 9, rightUi); // BR Wheel
    
    Serial.printf("[DRIVE] Left UI:%d, Right UI:%d\n", leftUi, rightUi);
}

void HardwareController::stop() {
    // Front Left
    pca1.setPWM(2, 0, 4096); // FL IN1 LOW
    pca1.setPWM(1, 0, 4096); // FL IN2 LOW
    pca1.setPWM(0, 0, 4096); // FL PWM 0

    // Back Left
    pca1.setPWM(4, 0, 4096); // BL IN3 LOW
    pca1.setPWM(3, 0, 4096); // BL IN4 LOW
    pca1.setPWM(5, 0, 4096); // BL PWM 0

    // Front Right
    pca1.setPWM(8, 0, 4096); // FR IN1 LOW
    pca1.setPWM(7, 0, 4096); // FR IN2 LOW
    pca1.setPWM(6, 0, 4096); // FR PWM 0

    // Back Right
    pca1.setPWM(10, 0, 4096); // BR IN3 LOW
    pca1.setPWM(9, 0, 4096); // BR IN4 LOW
    pca1.setPWM(11, 0, 4096); // BR PWM 0

    Serial.println("[DRIVE] INSTANT BRAKE (STOP)");
}

void HardwareController::setArmMotor(String jointStr, String direction, int absoluteAngle) {
    jointStr.toLowerCase();
    if (jointStr == "shoulder") { setMotorState(pca2, 6, 7, 8, absoluteAngle); }
    else if (jointStr == "elbow") { setMotorState(pca2, 3, 4, 5, absoluteAngle); }
    else if (jointStr == "wrist") { setMotorState(pca2, 0, 1, 2, absoluteAngle); }
    else if (jointStr == "gripper") { setMotorState(pca2, 9, 15, 11, absoluteAngle); }
    else if (jointStr == "base") { setMotorState(pca2, 12, 13, 14, absoluteAngle); }
    else { Serial.printf("[ARM ERR] Unknown Joint: %s\n", jointStr.c_str()); }
}

void HardwareController::driveArmMotor(String jointStr, String dir, int speed) {
    int pwmPin = -1;
    int in1Pin = -1;
    int in2Pin = -1;

    jointStr.toLowerCase();
    dir.toLowerCase();

    if (jointStr == "shoulder") { pwmPin = 6; in1Pin = 7; in2Pin = 8; }
    else if (jointStr == "elbow") { pwmPin = 3; in1Pin = 4; in2Pin = 5; }
    else if (jointStr == "wrist") { pwmPin = 0; in1Pin = 1; in2Pin = 2; }
    else if (jointStr == "gripper") { pwmPin = 9; in1Pin = 15; in2Pin = 11; }
    else if (jointStr == "base") { pwmPin = 12; in1Pin = 13; in2Pin = 14; }
    else return;

    bool isForward = false;
    if (dir == "up" || dir == "right" || dir == "open") isForward = true;
    else if (dir == "down" || dir == "left" || dir == "close") isForward = false;
    else {
        // Brake
        pca2.setPWM(in1Pin, 0, 4096);
        pca2.setPWM(in2Pin, 0, 4096);
        pca2.setPWM(pwmPin, 0, 4096); 
        return;
    }

    if (jointStr == "base") isForward = !isForward; // Invert base

    if (isForward) {
        pca2.setPWM(in1Pin, 4096, 0);
        pca2.setPWM(in2Pin, 0, 4096);
        pca2.setPWM(pwmPin, 0, speed);
    } else {
        pca2.setPWM(in1Pin, 0, 4096);
        pca2.setPWM(in2Pin, 4096, 0);
        pca2.setPWM(pwmPin, 0, speed);
    }
}

void HardwareController::stopArm() {
    // Shoulder (6, 7, 8)
    pca2.setPWM(7, 0, 4096); pca2.setPWM(8, 0, 4096); pca2.setPWM(6, 0, 4096);
    // Elbow (3, 4, 5)
    pca2.setPWM(4, 0, 4096); pca2.setPWM(5, 0, 4096); pca2.setPWM(3, 0, 4096);
    // Wrist (0, 1, 2)
    pca2.setPWM(1, 0, 4096); pca2.setPWM(2, 0, 4096); pca2.setPWM(0, 0, 4096);
    // Gripper (9, 15, 11)
    pca2.setPWM(15, 0, 4096); pca2.setPWM(11, 0, 4096); pca2.setPWM(9, 0, 4096);
    // Base (12, 13, 14)
    pca2.setPWM(13, 0, 4096); pca2.setPWM(14, 0, 4096); pca2.setPWM(12, 0, 4096);
}


