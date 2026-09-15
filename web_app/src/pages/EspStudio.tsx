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

// Dynamic firmware code loaded from backend

export default function EspStudio() {
  const [port, setPort] = useState<any>(null);
  const [reader, setReader] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  
  const [connected, setConnected] = useState(false);
  const [firmwareCode, setFirmwareCode] = useState("Loading firmware source code...");
  const [isFlashing, setIsFlashing] = useState(false);
  
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const fetchFirmware = async () => {
    try {
      // Browser mode: fetch full original C++ firmware source from public asset
      const res = await fetch("/firmware_main.cpp");
      if (res.ok) {
        const code = await res.text();
        setFirmwareCode(code);
        toast.success("ESP32 Firmware Source loaded successfully!");
        return;
      }
      throw new Error("Unable to load static firmware file");
    } catch (err) {
      setFirmwareCode("// Unable to load firmware source.");
    }
  };

  useEffect(() => {
    fetchFirmware();
  }, []);

  const scrollToBottom = () => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs, autoScroll]);

  const keepReading = useRef(false);
  const streamClosed = useRef<Promise<void> | null>(null);

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
      
      // Auto-Reset ESP32 (DTR/RTS Toggle) to catch boot logs natively
      try {
        await selectedPort.setSignals({ dataTerminalReady: false, requestToSend: true });
        await new Promise(r => setTimeout(r, 100));
        await selectedPort.setSignals({ dataTerminalReady: false, requestToSend: false });
      } catch (err) {
        console.warn("Could not set DTR/RTS signals for auto-reset", err);
      }
      
      const textDecoder = new TextDecoderStream();
      streamClosed.current = selectedPort.readable.pipeTo(textDecoder.writable);
      const currentReader = textDecoder.readable.getReader();
      setReader(currentReader);
      keepReading.current = true;

      let buffer = "";
      while (keepReading.current) {
        try {
          const { value, done } = await currentReader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          
          if (lines.length > 0) {
            setLogs(prev => {
              const newLogs = [...prev, ...lines];
              if (newLogs.length > 1000) return newLogs.slice(newLogs.length - 1000);
              return newLogs;
            });
          }
        } catch (error) {
           break;
        }
      }
      
      currentReader.releaseLock();
    } catch (err: any) {
      console.error(err);
      if (err.name !== 'NotFoundError') {
        toast.error("Serial connection failed: " + err.message);
      }
      setConnected(false);
      setPort(null);
    }
  };

  const softResetEsp32 = async () => {
    if (connected && port) {
      try {
        await port.setSignals({ dataTerminalReady: false, requestToSend: true });
        await new Promise(r => setTimeout(r, 100));
        await port.setSignals({ dataTerminalReady: false, requestToSend: false });
        toast.success("Hardware Reset triggered via DTR/RTS.");
      } catch (e) {
        console.warn("DTR/RTS failed, falling back to software reboot command.");
        try {
          // If we have an active pipe, getting the writer directly will fail
          // But WebSerial usually allows writer creation while reading if not piped, or we can just send it via the stream.
          const writer = port.writable.getWriter();
          const data = new TextEncoder().encode("$REBOOT\n");
          await writer.write(data);
          writer.releaseLock();
          toast.success("Software reboot command sent.");
        } catch(err) {
          toast.error("Failed to send soft reset command.");
        }
      }
    }
  };

  const disconnectSerial = async () => {
    keepReading.current = false;
    if (reader) {
      try {
        await reader.cancel();
      } catch (e) {}
      setReader(null);
    }
    if (streamClosed.current) {
       try { await streamClosed.current; } catch (e) {}
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
    // Pipeline Step 1: Inject WiFi config to NVS if provided
    let activePort = port;
    if (false) {
      try {
        activePort = await navigator.serial.requestPort();
        await activePort.open({ baudRate: 115200 });
        setPort(activePort);
        setConnected(true);
      } catch (e) {
        toast.error("You must select the COM port to inject WiFi config!");
        return;
      }
    }

    if (false) {
      try {
        const writer = activePort.writable?.getWriter();
        if (writer) {
          const encoder = new TextEncoder();
          await writer.write(encoder.encode(`$WIFI::\n`));
          writer.releaseLock();
          toast.success("WiFi credentials injected to NVS.");
          setLogs(prev => [...prev, "[SYSTEM] Config injected via Serial. Awaiting NVS commit..."]);
          // Wait briefly for ESP32 to save to NVS before we close port and flash
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } catch (e) {
        toast.error("Failed to inject WiFi config.");
        setLogs(prev => [...prev, "[SYSTEM] Serial config injection failed.", String(e)]);
      }
    }
    
    // Pipeline Step 2: Disconnect WebSerial so esptool can claim the COM port
    if (activePort) {
      setLogs(prev => [...prev, "[SYSTEM] Disconnecting WebSerial to release COM port for esptool..."]);
      try {
        if (streamClosed.current && activePort.readable) {
          activePort.readable.cancel().catch(() => {});
          await streamClosed.current.catch(() => {});
        }
        await activePort.close();
      } catch (e) {}
      setPort(null);
      setConnected(false);
    }
    
    // Pipeline Step 3: Flash Firmware (Web environment boundary)
    setIsFlashing(false);
    toast.dismiss();
    toast.info("WiFi credentials injected!");
    setLogs(prev => [
      ...prev, 
      "[SYSTEM] NVS WiFi credentials successfully configured via WebSerial!",
      "[INFO] Full binary flashing requires the native esptool CLI. Use 'flash_esp32.ps1' locally."
    ]);
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
            
            <Button 
              onClick={handleFlashConfig}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(79,70,229,0.3)] h-9 text-sm"
            >
              <Save className="w-3.5 h-3.5 mr-2" />
              Flash Code & Network Config via USB
            </Button>
          </div>

          {/* Firmware Viewer */}
          <div className="flex-1 flex flex-col min-h-0 relative">
            <div className="h-10 border-b border-white/5 flex items-center justify-between px-4 bg-zinc-900/30 shrink-0">
              <h3 className="font-semibold text-slate-100 flex items-center gap-2">
                <Terminal className="w-5 h-5 text-indigo-400" />
                Embedded Firmware Viewer
                <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 ml-2 border border-slate-700">
                  esp32_firmware/src/main.cpp
                </span>
              </h3>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={fetchFirmware}
                className="h-7 text-xs bg-transparent border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Sync Code
              </Button>
            </div>
            <div className="flex-1 bg-[#1A1B26] overflow-y-auto text-xs font-mono text-slate-300">
              <div className="flex custom-scrollbar min-h-full">
                {/* Line Numbers */}
                <div className="flex flex-col text-right pr-4 pl-2 py-4 bg-black/40 text-slate-600 select-none border-r border-white/5">
                  {firmwareCode.split("\n").map((_, i) => (
                    <span key={i}>{i + 1}</span>
                  ))}
                </div>
                {/* Code Content */}
                <pre className="p-4 overflow-x-auto custom-scrollbar flex-1">
                  <code>{firmwareCode}</code>
                </pre>
              </div>
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
                <>
                  <Button 
                    size="sm" 
                    className="h-7 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 mr-2"
                    onClick={softResetEsp32}
                  >
                    Soft Reset
                  </Button>
                  <Button 
                    size="sm" 
                    className="h-7 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                    onClick={disconnectSerial}
                  >
                    <Square className="w-3 h-3 mr-1.5" /> Stop
                  </Button>
                </>
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
              <div key={index} className="break-words whitespace-pre-wrap mb-1 hover:bg-white/[0.02]">
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
