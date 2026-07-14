#include "HardwareController.h"

HardwareController::HardwareController() : 
    pwm1(0x40), pwm2(0x41) {}

void HardwareController::initHardware() {
    Wire.begin();
    
    // Init PCA9685 #1 (Locomotion & Base/Elbow)
    pwm1.begin();
    pwm1.setOscillatorFrequency(27000000);
    pwm1.setPWMFreq(50); // Standard 50Hz for motor drivers/servos
    
    // Init PCA9685 #2 (Shoulder/Wrist & Gripper)
    pwm2.begin();
    pwm2.setOscillatorFrequency(27000000);
    pwm2.setPWMFreq(50);
    
    // Sonar Pins
    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);
    
    // ADC
    analogReadResolution(12); // ESP32 is 12-bit by default (0-4095)
    
    // Ensure everything is stopped initially
    emergencyStop();
}

void HardwareController::calculateSonar() {
    // Fire a 10us pulse
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    
    // Read echo pulse with a 20ms timeout (~340cm max range)
    long duration = pulseIn(ECHO_PIN, HIGH, 20000); 
    
    if (duration == 0) {
        obstacleDistance = 999.9; // Safe distance if out of range or misread
    } else {
        // Speed of sound is ~343 m/s -> 0.0343 cm/us
        // Divide by 2 for round trip
        obstacleDistance = (duration / 2.0) * 0.0343;
    }
}

void HardwareController::calculateBattery() {
    int raw_adc = analogRead(BATTERY_ADC_PIN);
    
    // ESP32 12-bit ADC mapping (0-4095). 
    // Assuming 3.3V reference and 11dB attenuation.
    float v_adc = (raw_adc / 4095.0) * 3.3; 
    
    // User Specification: 2.93V -> 100%, 2.23V -> 0%
    if (v_adc >= 2.93) {
        batteryPercentage = 100.0;
    } else if (v_adc <= 2.23) {
        batteryPercentage = 0.0;
    } else {
        batteryPercentage = ((v_adc - 2.23) / (2.93 - 2.23)) * 100.0;
    }
}

void HardwareController::updateTelemetry() {
    calculateSonar();
    calculateBattery();
    
    // Strict Auto-Brake Logic
    if (obstacleDistance < 15.0) {
        emergencyStop();
    }
}

void HardwareController::emergencyStop() {
    // Disable all PWM channels on PCA9685 #1 to instantly stop locomotion L298N drivers
    for (int i = 0; i < 4; i++) {
        pwm1.setPWM(i, 0, 0); 
    }
}

void HardwareController::setLocomotion(String direction, int speed) {
    if (obstacleDistance < 15.0 && (direction == "FORWARD" || direction == "APPROACH")) {
        emergencyStop(); // Block forward movement if too close
        return;
    }
    
    // Speed is 0-255, map to 0-4095 for PCA9685
    int pwm_val = map(speed, 0, 255, 0, 4095);
    
    if (direction == "FORWARD" || direction == "APPROACH") {
        pwm1.setPWM(0, 0, pwm_val); // Left Fwd (Channel 0)
        pwm1.setPWM(1, 0, 0);       // Left Rev (Channel 1)
        pwm1.setPWM(2, 0, pwm_val); // Right Fwd (Channel 2)
        pwm1.setPWM(3, 0, 0);       // Right Rev (Channel 3)
    } 
    else if (direction == "BACKWARD") {
        pwm1.setPWM(0, 0, 0);       
        pwm1.setPWM(1, 0, pwm_val); 
        pwm1.setPWM(2, 0, 0);       
        pwm1.setPWM(3, 0, pwm_val); 
    }
    else if (direction == "LEFT") {
        pwm1.setPWM(0, 0, 0);       
        pwm1.setPWM(1, 0, pwm_val); 
        pwm1.setPWM(2, 0, pwm_val); 
        pwm1.setPWM(3, 0, 0);       
    }
    else if (direction == "RIGHT") {
        pwm1.setPWM(0, 0, pwm_val); 
        pwm1.setPWM(1, 0, 0);       
        pwm1.setPWM(2, 0, 0);       
        pwm1.setPWM(3, 0, pwm_val); 
    }
    else if (direction == "STOP") {
        emergencyStop();
    }
}

void HardwareController::executeArmMacro(String macro) {
    // High-Torque Arm (Base/Elbow) via PCA9685 #1 (Channels 4-7)
    // Precision Arm (Shoulder/Wrist/Gripper) via PCA9685 #2 (Channels 0-5)
    
    if (macro == "HOME") {
        // Safe baseline rest angles
        pwm1.setPWM(4, 0, 300); // Base center
        pwm1.setPWM(5, 0, 300); // Elbow rest
        pwm2.setPWM(0, 0, 300); // Shoulder rest
        pwm2.setPWM(1, 0, 300); // Wrist center
        pwm2.setPWM(2, 0, 150); // Gripper open
    }
    else if (macro == "PICKUP") {
        // Open gripper
        pwm2.setPWM(2, 0, 150); 
        delay(300);
        // Lower arm
        pwm1.setPWM(5, 0, 450); // Elbow down
        pwm2.setPWM(0, 0, 450); // Shoulder down
        delay(500);
        // Close gripper
        pwm2.setPWM(2, 0, 450); 
        delay(400);
        // Lift arm
        pwm1.setPWM(5, 0, 300); // Elbow up
        pwm2.setPWM(0, 0, 300); // Shoulder up
    }
    else if (macro == "DROP") {
        // Extend arm
        pwm1.setPWM(5, 0, 400); // Elbow slightly down
        pwm2.setPWM(0, 0, 400); // Shoulder slightly down
        delay(500);
        // Open gripper
        pwm2.setPWM(2, 0, 150); 
        delay(300);
        // Return home
        pwm1.setPWM(5, 0, 300);
        pwm2.setPWM(0, 0, 300);
    }
    else {
        Serial.print("ERROR: Unknown Arm Macro - ");
        Serial.println(macro);
    }
}

void HardwareController::executeCommand(String commandJson) {
    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, commandJson);
    
    if (error) {
        Serial.println("Failed to parse command JSON");
        return;
    }
    
    String type = doc["type"];
    String command = doc["command"];
    
    if (type == "drive") {
        int speed = doc["speed"] | 255;
        setLocomotion(command, speed);
    } 
    else if (type == "arm_macro") {
        executeArmMacro(command);
    }
}

// Getters
float HardwareController::getBatteryPercentage() { return batteryPercentage; }
float HardwareController::getObstacleDistance() { return obstacleDistance; }
