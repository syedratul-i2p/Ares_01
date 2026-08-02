import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { 
  ArrowLeft, Terminal, Save, Play, Square, Settings, 
  Trash2, Download, Wifi, Activity 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion } from "framer-motion";

// Polyfill types for WebSerial
declare global {
  interface Navigator {
    serial: any;
  }
}

const FIRMWARE_CODE = `\
#include "HardwareController.h"
#include "esp_camera.h"
#include "esp_log.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// Function Prototypes
void executeHardwareCommand(String mode, String action, String direction,
                            int speed, String joint, int angle);
void handleCommand();
void stream_handler();
void handleCapture();

// Global Hardware Fault Flags
bool camera_fault = false;

// Define Log Tags
static const char *TAG_SYS = "SYS";
static const char *TAG_WIFI = "WIFI";
static const char *TAG_CAM = "CAM";
static const char *TAG_HTTP = "HTTP";

// NETWORK CONFIGURATION
const char *ap_ssid = "ARES_01_OFFLINE";
const char *ap_password = "Admin123";
const char *sta_ssid = "N3M0_0x7A";
const char *sta_password = "Ratul_i2p@6072";

WebServer server(80);
WebSocketsServer webSocket(81);
unsigned long lastTelemetryTime = 0;

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable Brownout detector
  vTaskDelay(pdMS_TO_TICKS(1000)); 
  Serial.begin(115200);

  // Initialize Custom Hardware Controller (I2C, PWM, Sensors)
  Hardware.begin();
  
  ESP_LOGI(TAG_SYS, "Booting Advanced ESP32-S3 Firmware...");
  
  // Connect WiFi
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(ap_ssid, ap_password, 6, 0, 4);
  ESP_LOGI(TAG_WIFI, "AP Live on Channel 6. IP: %s", WiFi.softAPIP().toString().c_str());

  WiFi.begin(sta_ssid, sta_password);
  // ... (Full code omitted for viewer brevity but visible in real deployment)
  ESP_LOGI(TAG_SYS, "FreeRTOS Dual-Core Architecture initialized!");
}

void loop() {
  vTaskDelete(NULL);
}
`;

export default function EspStudio() {
  const [port, setPort] = useState<any>(null);
  const [reader, setReader] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [connected, setConnected] = useState(false);
  
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs, autoScroll]);

  const connectSerial = async () => {
    try {
      if (!navigator.serial) {
        toast.error("WebSerial API is not supported in this browser/webview.");
        return;
      }
      
      const selectedPort = await navigator.serial.requestPort();
      await selectedPort.open({ baudRate: 115200 });
      setPort(selectedPort);
      setConnected(true);
      toast.success("Connected to ESP32 on USB Serial at 115200 baud.");
      
      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = selectedPort.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      setReader(reader);

      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        if (lines.length > 0) {
          setLogs(prev => {
            const newLogs = [...prev, ...lines];
            // Keep last 1000 lines max
            if (newLogs.length > 1000) return newLogs.slice(newLogs.length - 1000);
            return newLogs;
          });
        }
      }
    } catch (err: any) {
      console.error(err);
      if (err.name !== 'NotFoundError') {
        toast.error("Serial connection failed: " + err.message);
      }
      setConnected(false);
      setPort(null);
    }
  };

  const disconnectSerial = async () => {
    if (reader) {
      try {
        await reader.cancel();
      } catch (e) {}
      setReader(null);
    }
    if (port) {
      try {
        await port.close();
      } catch (e) {}
      setPort(null);
    }
    setConnected(false);
    toast.info("Disconnected from Serial Port.");
  };

  const formatLogLine = (line: string) => {
    if (line.includes("IP:") || line.includes("WiFi Connected")) {
      return <span className="text-cyan-400 font-bold">{line}</span>;
    }
    if (line.includes("AP Live") || line.includes("STA Connected")) {
      return <span className="text-green-400 font-bold">{line}</span>;
    }
    if (line.includes("Fault") || line.includes("Error") || line.includes("Failed") || line.includes("failed")) {
      return <span className="text-red-400 font-bold">{line}</span>;
    }
    if (line.includes("[SYS]")) {
      return <span className="text-yellow-300 font-semibold">{line}</span>;
    }
    return <span className="text-green-500/80">{line}</span>;
  };

  const handleFlashConfig = async () => {
    if (!connected || !port) {
      toast.error("Connect Serial Port first!");
      return;
    }
    try {
      const textEncoder = new TextEncoderStream();
      const writableStreamClosed = textEncoder.readable.pipeTo(port.writable);
      const writer = textEncoder.writable.getWriter();
      const jsonStr = JSON.stringify({ mode: "config", ssid, password }) + "\\n";
      await writer.write(jsonStr);
      writer.releaseLock();
      toast.success("WiFi config dispatched over Serial!");
    } catch (e) {
      toast.error("Failed to write to serial port.");
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-zinc-950 text-white font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="h-14 border-b border-white/5 flex items-center justify-between px-4 bg-zinc-900/50 backdrop-blur-xl shrink-0 z-10">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            <h1 className="font-semibold tracking-wide text-sm">ESP Studio & Terminal</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${connected ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {connected ? "COM PORT ACTIVE" : "DISCONNECTED"}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-row overflow-hidden">
        
        {/* Left Column: Code Viewer & Config */}
        <div className="w-1/2 flex flex-col border-r border-white/5 bg-zinc-950">
          {/* Quick Config Card */}
          <div className="p-4 shrink-0 border-b border-white/5">
            <h2 className="text-xs font-bold text-white/50 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Wifi className="w-3.5 h-3.5" />
              Network Configurator
            </h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Input 
                placeholder="WiFi SSID" 
                value={ssid} 
                onChange={e => setSsid(e.target.value)}
                className="bg-black/20 border-white/10 text-white placeholder:text-white/30 h-9 text-sm"
              />
              <Input 
                placeholder="WiFi Password" 
                type="password"
                value={password} 
                onChange={e => setPassword(e.target.value)}
                className="bg-black/20 border-white/10 text-white placeholder:text-white/30 h-9 text-sm"
              />
            </div>
            <Button 
              onClick={handleFlashConfig}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(79,70,229,0.3)] h-9 text-sm"
            >
              <Save className="w-3.5 h-3.5 mr-2" />
              Flash Network Config to ESP32
            </Button>
          </div>

          {/* Firmware Viewer */}
          <div className="flex-1 flex flex-col min-h-0 relative">
            <div className="h-10 border-b border-white/5 flex items-center justify-between px-4 bg-zinc-900/30 shrink-0">
              <span className="text-xs font-mono text-white/50">src/main.cpp</span>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-white/40 hover:text-white">
                <Download className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto bg-[#0d1117] p-4 p-4 font-mono text-xs leading-relaxed custom-scrollbar">
              <pre className="text-slate-300">
                <code>{FIRMWARE_CODE}</code>
              </pre>
            </div>
          </div>
        </div>

        {/* Right Column: Serial Terminal */}
        <div className="w-1/2 flex flex-col bg-[#0a0a0a]">
          {/* Terminal Toolbar */}
          <div className="h-12 border-b border-white/5 flex items-center justify-between px-4 bg-zinc-900/50 shrink-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-white/40" />
              <span className="text-sm font-semibold text-white/80">Serial Monitor (115200)</span>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs border-white/10 bg-black/20 hover:bg-white/10"
                onClick={() => setAutoScroll(!autoScroll)}
              >
                <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${autoScroll ? 'bg-green-500' : 'bg-zinc-600'}`} />
                Auto-scroll
              </Button>
              <Button 
                variant="outline" 
                size="icon"
                className="h-7 w-7 border-white/10 bg-black/20 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30"
                onClick={() => setLogs([])}
                title="Clear Output"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              {connected ? (
                <Button 
                  size="sm" 
                  className="h-7 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                  onClick={disconnectSerial}
                >
                  <Square className="w-3 h-3 mr-1.5" /> Stop
                </Button>
              ) : (
                <Button 
                  size="sm" 
                  className="h-7 text-xs bg-indigo-600 text-white hover:bg-indigo-500 shadow-[0_0_10px_rgba(79,70,229,0.4)]"
                  onClick={connectSerial}
                >
                  <Play className="w-3 h-3 mr-1.5" /> Connect Serial
                </Button>
              )}
            </div>
          </div>
          
          {/* Terminal Output */}
          <div className="flex-1 overflow-auto p-4 font-mono text-[11px] leading-tight custom-scrollbar bg-black text-green-500/80 shadow-[inset_0_0_50px_rgba(0,0,0,0.5)] relative">
            {!connected && logs.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-green-500/30 pointer-events-none">
                <Terminal className="w-12 h-12 mb-2 opacity-50" />
                <p>Waiting for Serial Connection...</p>
                <p className="text-[10px] mt-1">Baud Rate: 115200</p>
              </div>
            )}
            
            {logs.map((line, index) => (
              <div key={index} className="break-all whitespace-pre-wrap mb-1 hover:bg-white/[0.02]">
                {formatLogLine(line)}
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>
        </div>

      </div>
    </div>
  );
}
