#include "HardwareController.h"

// Unified 5V Power Architecture
// The Buck Converter steps down the 12.6V to 5.0V, safely powering everything.

HardwareController Hardware;

HardwareController::HardwareController() {}

void HardwareController::begin() {
    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 100000);
    delay(50);
    
    // Initialize PCA9685 - 1 (Chassis) at 0x40
    pca1.begin();
    pca1.setOscillatorFrequency(27000000);
    pca1.setPWMFreq(1000);
    
    // Initialize PCA9685 - 2 (Arm) at 0x41 on the SAME bus
    pca2.begin();
    pca2.setOscillatorFrequency(27000000);
    pca2.setPWMFreq(1000);
    
    Serial.println("[SYS] Dual PCA9685 Daisy-Chain Initialized on Wire.");

    // Initialize Sensors
    pinMode(HC_SR04_TRIG_PIN, OUTPUT);
    pinMode(HC_SR04_ECHO_PIN, INPUT);
    // Configure ADC for ESP32-S3 (12-bit by default, but set 11db attenuation for 0-3.3V range)
    analogSetPinAttenuation(BATTERY_ADC_PIN, ADC_11db);
    
    // Ensure all motors are initially stopped
    drive(0, 0);
    setArmMotor("base", 90);
    setArmMotor("shoulder", 90);
    setArmMotor("elbow", 90);
    setArmMotor("wrist", 90);
    setArmMotor("gripper", 90);

    // Pull STBY HIGH for TB6612FNG on PCA1 Pin 15 (if used)
    pca1.setPWM(15, 4096, 0);
}

void HardwareController::setPWM(Adafruit_PWMServoDriver &pwm, uint8_t channel, uint16_t on, uint16_t off) {
    pwm.setPWM(channel, on, off);
}

void HardwareController::setMotorState(Adafruit_PWMServoDriver &pca, int pwmPin, int in1Pin, int in2Pin, int uiValue) {
    int speed = 0;
    bool dirForward = true;
    
    // Minimum PWM required to overcome gravity and mechanical inertia (approx 85% power)
    int MIN_PWM = 3500; 

    if (uiValue > 91) {
        // Map 91-180 strictly to MIN_PWM-4095
        speed = map(uiValue, 91, 180, MIN_PWM, 4095);
        dirForward = true;
    } else if (uiValue < 89) {
        // Map 89-0 strictly to MIN_PWM-4095
        speed = map(uiValue, 89, 0, MIN_PWM, 4095);
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

void HardwareController::setArmMotor(String jointStr, int value) {
    if (jointStr == "shoulder") { setMotorState(pca2, 6, 7, 8, value); }
    else if (jointStr == "elbow") { setMotorState(pca2, 3, 4, 5, value); }
    else if (jointStr == "wrist") { setMotorState(pca2, 0, 1, 2, value); }
    else if (jointStr == "gripper") { setMotorState(pca2, 9, 15, 11, value); }
    else if (jointStr == "base") { setMotorState(pca2, 12, 13, 14, value); }
    else { Serial.printf("[ARM ERR] Unknown Joint: %s\n", jointStr.c_str()); }
}

float HardwareController::getBatteryVoltage() {
    long sum = 0;
    int valid_count = 0;
    for (int i = 0; i < 10; i++) {
        int val = analogRead(BATTERY_ADC_PIN);
        if (val > 50) { // Filter out erratic 0 drops
            sum += val;
            valid_count++;
        }
        delayMicroseconds(100);
    }
    
    if (valid_count == 0) return -1.0; // Voltage divider is likely unplugged

    int rawValue = sum / valid_count;
    
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
    
    // Disable interrupts briefly for accurate pulse-in reading without WiFi interference
    // WARNING: Removing noInterrupts() because blocking Core 0 for 30ms with interrupts off kills WiFi!
    long duration = pulseIn(HC_SR04_ECHO_PIN, HIGH, 30000); // 30ms strict timeout

    if (duration == 0) return 999.0; // timeout or error
    
    // speed of sound = 343 m/s -> 29.15 us/cm
    float distance = (duration / 2.0) / 29.1;
    if (isnan(distance) || isinf(distance)) return 999.0;
    return distance;
}
