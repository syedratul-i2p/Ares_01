# ARES-01 Monolithic Robotics Firmware

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform: ESP32-S3](https://img.shields.io/badge/Platform-ESP32--S3-orange.svg)
![Framework: Arduino](https://img.shields.io/badge/Framework-Arduino-blue.svg)

This repository contains the monolithic, highly optimized C++ firmware for the **ARES-01** robotics platform, built around the GOOUUU ESP32-S3-CAM V1.3 module. The firmware integrates a serverless "Dual-Brain" architecture, handling both offline edge operations and online connectivity seamlessly.

## 🚀 Key Features

*   **Optimized Camera Streaming:** High-performance MJPEG streaming with native DMA bus and PSRAM optimization for the OV3660 sensor (running at 20MHz XCLK).
*   **Dual-Mode Wi-Fi (AP + STA):** Automatically manages connectivity. Acts as a local Access Point (`ARES_01_OFFLINE`) for offline control and dynamically connects to a Station network for cloud operations. Contains logic to prevent AP broadcasting drops when STA is unreachable.
*   **Native ESP Logging:** Implements structured, color-coded logging using the native `esp_log.h` subsystem for clear diagnostics (`SYS`, `WIFI`, `CAM`, `HTTP`) without terminal flooding or IDE freezing.
*   **JSON Command API:** Lightweight, robust HTTP POST endpoint (`/command`) parsing structural JSON payloads via `ArduinoJson` to control hardware (drive, stop, speed adjustments).

## 🛠️ Hardware Requirements

*   **Controller Board:** GOOUUU ESP32-S3-CAM V1.3
*   **Chipset:** ESP32-S3-N16R8 (16MB Flash, 8MB OPI PSRAM)
*   **Camera Sensor:** OV3660 (3 Megapixel)
*   **Connections:** Dual Type-C (Use TTL/UART port for programming/monitoring)

## ⚙️ Quick Start (PlatformIO)

This project is configured for **PlatformIO**.

1.  **Install PlatformIO:** Install the PlatformIO IDE extension in VS Code.
2.  **Open Project:** Open the `esp32_firmware` folder in VS Code.
3.  **Build:** Click the PlatformIO **Build** (✓) button on the bottom status bar.
4.  **Upload:** Connect your ESP32-S3 via the TTL Type-C port and click the **Upload** (➔) button.
5.  **Monitor:** Click the **Serial Monitor** (🔌) button to view the native logs (Baud rate is `115200`).

## 📡 API Endpoints

*   `GET /stream`: Serves the live MJPEG camera feed.
*   `POST /command`: Accepts JSON commands. Example:
    ```json
    {
      "type": "drive",
      "command": "FORWARD",
      "speed": 255
    }
    ```

## 📄 License

This project is licensed under the MIT License - see below for details:

```text
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
