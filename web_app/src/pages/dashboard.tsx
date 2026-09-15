import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sun, Moon, Settings, Signal, Battery, ArrowUp, ArrowDown,
  ArrowLeft, ArrowRight, Square, Mic, Send, CheckCircle2, Cpu,
  Thermometer, Zap, Radio, Ruler, Wifi, WifiOff, Loader2,
  Activity, X, RotateCcw, Gamepad2, Bot, AlertTriangle, Database, Camera,
  Monitor, Film, Minus, Brain, Sparkles, Terminal, MapPin
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";
import { motion, AnimatePresence } from "framer-motion";

import { CameraOverlay } from "@/components/CameraOverlay";
import { toast } from "sonner";
import { useInterval } from "@/hooks/use-interval";
import { Progress } from "@/components/ui/progress";
import { extractCurrentFrameBase64 } from "@/utils/frameExtractor";

const normalizeBengaliNumbers = (text: string) => {
  const bengaliToEnglish: { [key: string]: string } = {
    "\u09E6": "0", "\u09E7": "1", "\u09E8": "2", "\u09E9": "3", "\u09EA": "4",
    "\u09EB": "5", "\u09EC": "6", "\u09ED": "7", "\u09EE": "8", "\u09EF": "9"
  };
  return text.replace(/[\u09E6-\u09EF]/g, match => bengaliToEnglish[match] || match);
};

const ContinuousButton = ({ onDown, onUp, className, children, "data-testid": testId }: any) => {
  const handleDown = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (e.currentTarget && e.currentTarget.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch(err){}
    }
    if (onDown) onDown();
  }, [onDown]);

  const handleUp = React.useCallback((e: React.SyntheticEvent) => {
    if (onUp) onUp();
  }, [onUp]);

  return (
    <button 
      className={className} 
      data-testid={testId} 
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onPointerLeave={handleUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "none" }}
    >
      {children}
    </button>
  );
};


const processAutonomousCommand = async (command: string, frame: string | null): Promise<{ action: string; coordinates?: any; drive_direction?: string }> => {
  return { action: "TASK_COMPLETE" };
};

export type DriveDirection = "FORWARD" | "BACKWARD" | "LEFT" | "RIGHT" | "STOP";
export interface ArmAngles {
  base: number;
  shoulder: number;
  elbow: number;
  wrist: number;
  gripper: number;
}
import { parseCommand, ACTION_LABELS, type ParsedCommand } from "@/lib/commandParser";

// ─── Types & Constants ────────────────────────────────────────────────────────

type RoverConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type Direction = "forward" | "backward" | "left" | "right" | "stop";
type ControlMode = "manual" | "ai" | "voice";

interface LogMessage {
  id: number;
  sender: "user" | "system";
  text: string;
  action?: string;
  time: string;
  status: "ok" | "warn" | "info";
}

const LOG = "[ARES-01]";
const COOLDOWN_TIME = 2000;

const CONTROL_TABS: { id: ControlMode; label: string; icon: React.ElementType }[] = [
  { id: "manual", label: "Manual Control", icon: Gamepad2 },
  { id: "ai",     label: "AI Directive",   icon: Bot      },
  { id: "voice",  label: "Voice Command",  icon: Mic      },
];

const renderLogLine = (log: string) => {
  return <div className="py-0.5">{log}</div>;
};

let globalWs: WebSocket | null = null;

const sendCommandViaHttp = async (ip: string, payload: any) => {
  if (globalWs && globalWs.readyState === WebSocket.OPEN) {
    try {
      globalWs.send(JSON.stringify(payload));
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ares_connection_active"));
      return;
    } catch (err) {
      console.warn("WebSocket send failed, falling back to HTTP", err);
    }
  }

  if (!ip) return;
  try {
    let url = ip.trim();
    if (!url.startsWith("http")) url = `http://${url}`;
    // Ensure the URL correctly targets the /command endpoint without trailing slashes duplicated
    const base = url.endsWith("/") ? url.slice(0, -1) : url;
    const endpoint = base.endsWith("/command") ? base : `${base}/command`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (response.ok && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ares_connection_active"));
    }
  } catch (err) {
    console.error("HTTP Command Error:", err);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ares_connection_timeout"));
    throw err;
  }
};

const JOINT_CONFIG = {
  base:     { label: "Base",     color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
  shoulder: { label: "Shoulder", color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
  elbow:    { label: "Elbow",    color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
  wrist:    { label: "Wrist",    color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
  gripper:  { label: "Gripper",  color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
} as const;

const JOINT_ORDER = ["base", "shoulder", "elbow", "wrist", "gripper"] as const;

const ARM_PRESETS = [
  { name: "Home",  joints: { base: 90, shoulder: 90,  elbow: 90,  wrist: 90, gripper: 90  } },
  { name: "Pick",  joints: { base: 90, shoulder: 45,  elbow: 135, wrist: 90, gripper: 180 } },
  { name: "Drop",  joints: { base: 45, shoulder: 60,  elbow: 90,  wrist: 45, gripper: 90  } },
  { name: "Reach", joints: { base: 90, shoulder: 150, elbow: 150, wrist: 90, gripper: 90  } },
];

const DEFAULT_JOINTS: ArmAngles = { base: 90, shoulder: 90, elbow: 90, wrist: 90, gripper: 90 };

// ─── Sub-Components (Memoized to prevent unnecessary re-renders) ───────────────

const getPingColorClass = (pingVal: number | null) => {
  if (pingVal === null) return "text-slate-400 dark:text-slate-500";
  if (pingVal < 60) return "text-emerald-600 dark:text-emerald-400";
  if (pingVal <= 150) return "text-amber-500 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
};

interface HeaderProps {
  roverOnline: boolean;
  showSettings: boolean;
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>;
  theme: string;
  setTheme: (theme: any) => void;
  ping: number | null;
  batteryPct: number;
  roverMode: "MANUAL" | "AUTONOMOUS";
  onToggleRoverMode: (mode: "MANUAL" | "AUTONOMOUS") => void;
}

const Header = React.memo(function Header({
  roverOnline,
  showSettings,
  setShowSettings,
  theme,
  setTheme,
  ping,
  batteryPct,
  roverMode,
  onToggleRoverMode
}: HeaderProps) {
  return (
    <header data-tauri-drag-region className="h-12 shrink-0 flex items-center justify-between px-5 border-b border-border/60 bg-white dark:bg-white/[0.03] backdrop-blur-xl z-20 shadow-sm dark:shadow-none select-none">
      <div className="flex items-center gap-3 pointer-events-none">
        <h1 className="font-bold text-base tracking-tight text-gray-900 dark:text-white">
          <img src="/logo.png" alt="ARES-01 Logo" className="h-7 w-auto object-contain mr-3 inline-block transform-gpu" />
          ARES-01
        </h1>
        <span className="text-gray-500 dark:text-gray-400 text-xs font-medium hidden sm:inline">Rover Mission Control</span>
        <Badge
          variant="outline"
          className={`text-xs h-5 transition-colors duration-500 ${
            roverOnline
              ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
              : "bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/30"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 transition-colors duration-500 ${roverOnline ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <span className="hidden sm:inline">{roverOnline ? "ROVER ONLINE" : "ROVER OFFLINE"}</span>
          <span className="sm:hidden">{roverOnline ? "ON" : "OFF"}</span>
        </Badge>
        {ping !== null && (
          <Badge variant="outline" className="text-xs h-5 bg-slate-50 dark:bg-white/5 border-border/30 dark:border-white/5 gap-1.5 font-mono select-none">
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse bg-current ${getPingColorClass(ping)}`} />
            <span className={`${getPingColorClass(ping)}`}>{ping}ms</span>
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1 pointer-events-auto">
        {/* Rover Mode Segmented Control */}
        <div className="flex items-center p-1 rounded-full bg-slate-200/80 dark:bg-black/40 border border-slate-300/50 dark:border-white/10 shadow-inner relative backdrop-blur-lg">
            <button
              onClick={() => onToggleRoverMode("MANUAL")}
              className={`relative flex items-center gap-1.5 px-4 py-1 rounded-full text-xs font-extrabold tracking-widest transition-all duration-300 z-10 ${
                roverMode === "MANUAL" ? "text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-white/40 dark:hover:text-white/70"
              }`}
            >
              {roverMode === "MANUAL" && (
                <motion.div
                  layoutId="modeIndicator"
                  className="absolute inset-0 bg-white dark:bg-slate-700/80 rounded-full shadow-md border border-slate-200 dark:border-white/20 -z-10"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                />
              )}
              <Gamepad2 className="w-4 h-4" />
              <span>MANUAL</span>
            </button>
            
            <button
              onClick={() => onToggleRoverMode("AUTONOMOUS")}
              className={`relative flex items-center gap-1.5 px-4 py-1 rounded-full text-xs font-extrabold tracking-widest transition-all duration-300 z-10 ${
                roverMode === "AUTONOMOUS" ? "text-indigo-700 dark:text-white drop-shadow-sm" : "text-slate-500 hover:text-indigo-600/70 dark:text-white/40 dark:hover:text-white/70"
              }`}
            >
              {roverMode === "AUTONOMOUS" && (
                <motion.div
                  layoutId="modeIndicator"
                  className="absolute inset-0 bg-white dark:bg-indigo-600/50 rounded-full shadow-md border border-indigo-200 dark:border-indigo-400/50 overflow-hidden -z-10"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-indigo-100/0 via-indigo-400/10 to-purple-400/0 dark:from-indigo-500/0 dark:via-purple-500/30 dark:to-pink-500/0 animate-pulse" />
                </motion.div>
              )}
              <Brain className="w-4 h-4" />
              <span className="ml-1">OFFLINE MACROS</span>
            </button>
          </div>
          <Link href="/studio">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white" data-testid="button-studio">
            <Terminal className="w-3.5 h-3.5" />
          </Button>
        </Link>
        <Button variant={showSettings ? "secondary" : "ghost"} size="icon" className="h-8 w-8 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          onClick={() => setShowSettings(s => !s)} data-testid="button-settings">
          {showSettings ? <X className="w-3.5 h-3.5" /> : <Settings className="w-3.5 h-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")} data-testid="button-theme-toggle">
          {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </Button>

      </div>
    </header>
  );
});

interface SettingsPanelProps {
  showSettings: boolean;
  setShowSettings: (val: boolean) => void;
  roverOnline: boolean;
  roverIp: string;
  setRoverIp: (val: string) => void;
  streamSrc: string | null;
  streamError: boolean;
  handleConnect: () => void;
  handleDisconnect: () => void;
  ping: number | null;
  rebooting: boolean;
  handleReboot: () => void;
  rssi: number | undefined;
}

const ToggleSwitch = ({ checked, onChange }: { checked: boolean, onChange: (c: boolean) => void }) => (
  <button 
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none shadow-inner ${checked ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]' : 'bg-slate-300 dark:bg-slate-700'}`}
  >
    <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
  </button>
);

const SettingsPanel = React.memo(function SettingsPanel({
  showSettings,
  setShowSettings,
  roverOnline,
  roverIp,
  setRoverIp,
  streamSrc,
  streamError,
  handleConnect,
  handleDisconnect,
  ping,
  rebooting,
  handleReboot,
  rssi
}: SettingsPanelProps) {
  
  // RSSI Visualizer Logic
  const getRssiInfo = (val: number) => {
    if (val >= -50) return { label: "Excellent", activeBars: 4, color: "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]" };
    if (val >= -65) return { label: "Good", activeBars: 3, color: "bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]" };
    if (val >= -80) return { label: "Fair", activeBars: 2, color: "bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.5)]" };
    return { label: "Weak", activeBars: 1, color: "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.5)]" };
  };
  const rssiValue = rssi ?? -42;
  const rssiInfo = getRssiInfo(rssiValue);

  return (
    <AnimatePresence>
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop blur background */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm"
            onClick={() => setShowSettings(false)}
          />

          {/* Toast Notification Layer (Removed in favor of Sonner) */}

          {/* Settings Overlay Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="w-full max-w-[480px] bg-white/95 dark:bg-[#1E1E24] backdrop-blur-md border border-slate-200 dark:border-[#333] rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] relative overflow-hidden z-10 flex flex-col max-h-[90vh] font-sans"
          >
            {/* Subtle top glow line */}
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#FF9F43]/50 to-transparent" />

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/10 dark:border-white/10 shrink-0">
              <div className="flex flex-col">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">System Settings</h2>
                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">ARES-01 MISSION CONFIGURATION</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-slate-700 dark:text-white/70 hover:text-slate-950 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setShowSettings(false)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Settings Body */}
            <div className="p-4 space-y-4 overflow-y-auto min-h-0 select-none">
              
              {/* Row 1.2: Rover Connection Status */}
              <div className="flex items-center justify-between py-1.5 border-b border-black/[0.05] dark:border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <Database className="w-4 h-4 text-primary dark:text-primary shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white/90">Rover System Status</span>
                    <span className="text-[10px] text-slate-500 dark:text-white/40">Active telemetry connection status</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    variant="outline"
                    className={`text-[10px] h-4.5 font-mono ${
                      roverOnline
                        ? "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20"
                        : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full mr-1 ${roverOnline ? "bg-green-500 dark:bg-green-400 animate-pulse" : "bg-red-500"}`} />
                    {roverOnline ? "ROVER ONLINE" : "ROVER OFFLINE"}
                  </Badge>
                </div>
              </div>

              {/* Row 1.5: Network Latency Meter */}
              <div className="flex items-center justify-between py-1.5 border-b border-black/[0.05] dark:border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <Signal className="w-4 h-4 text-primary dark:text-primary shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white/90">Network Latency Meter</span>
                    <span className="text-[10px] text-slate-500 dark:text-white/40">Active round-trip-time heartbeat check</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Latency Signal Strength bars visualizer */}
                  <div className="flex items-end gap-[2px] h-3 px-1 select-none">
                    <div className={`w-[2px] h-1.5 rounded-sm transition-colors duration-300 ${
                      ping !== null && ping < 60 ? "bg-primary" : ping !== null && ping <= 150 ? "bg-amber-500" : ping !== null ? "bg-rose-500 animate-pulse" : "bg-slate-300 dark:bg-slate-700"
                    }`} />
                    <div className={`w-[2px] h-2 rounded-sm transition-colors duration-300 ${
                      ping !== null && ping < 60 ? "bg-primary" : ping !== null && ping <= 150 ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-700"
                    }`} />
                    <div className={`w-[2px] h-2.5 rounded-sm transition-colors duration-300 ${
                      ping !== null && ping < 60 ? "bg-primary" : "bg-slate-300 dark:bg-slate-700"
                    }`} />
                  </div>
                  <span className={`text-xs font-mono font-bold ${getPingColorClass(ping)}`}>
                    {ping !== null ? `Ping: ${ping}ms` : "Ping: Offline"}
                  </span>
                </div>
              </div>

              {/* Row 1.75: Uplink RSSI Meter */}
              <div className="flex items-center justify-between py-1.5 border-b border-black/[0.05] dark:border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <Signal className="w-4 h-4 text-primary dark:text-primary shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white/90">Uplink RSSI</span>
                    <span className="text-[10px] text-slate-500 dark:text-white/40">Wireless signal strength</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs font-mono text-primary/80 uppercase">
                    {rssiValue} dBm ({rssiInfo.label})
                  </span>
                  <div className="flex items-end gap-1 h-3">
                    {[1, 2, 3, 4].map((bar) => (
                      <div 
                        key={bar} 
                        className={`w-1 rounded-sm transition-all duration-300 ${
                          bar <= rssiInfo.activeBars ? rssiInfo.color : "bg-slate-300 dark:bg-white/10"
                        }`}
                        style={{ height: `${20 * bar}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Connections (ESP32-CAM and Command) */}
              <div className="space-y-2.5 pt-1">
                <span className="text-xs font-bold text-[#A0A0A0] uppercase tracking-wider">Hardware Connections</span>
                
                {/* Unified Rover Connection */}
                <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-transparent hover:bg-slate-50 dark:hover:bg-[rgba(255,255,255,0.02)] border border-transparent hover:border-slate-200 dark:hover:border-[#333] transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900 dark:text-[#E0E0E0]">Rover IP Address</span>
                    {streamSrc && !streamError && (
                      <span className="w-1 h-1 rounded-full bg-slate-400" />
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-1.5">
                    <input
                      type="text"
                      className="h-6 text-xs bg-slate-100 dark:bg-black/20 text-slate-900 dark:text-[#E0E0E0] font-mono flex-1 border border-slate-200 dark:border-[#333] rounded px-1.5 focus:outline-none focus:border-primary/50"
                      placeholder="Enter Rover IP (e.g., 192.168.4.1)"
                      value={roverIp}
                      onChange={e => setRoverIp(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleConnect()}
                    />
                    {streamSrc ? (
                      <button
                        onClick={handleDisconnect}
                        className="w-full sm:w-auto px-2 py-1.5 sm:py-0.5 text-xs sm:text-[10px] font-bold rounded border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={handleConnect}
                        disabled={!roverIp.trim()}
                        className="w-full sm:w-auto px-2.5 py-1.5 sm:py-0.5 text-xs sm:text-[10px] font-bold rounded bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground transition-all cursor-pointer border-0"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setRoverIp("192.168.4.1")}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-200 dark:bg-white/10 hover:bg-primary/20 hover:text-primary text-slate-700 dark:text-slate-300 font-mono transition-colors cursor-pointer"
                    >
                      ⚡ Offline AP (192.168.4.1)
                    </button>
                    
                  </div>
                </div>
              </div>

              {/* Row 4: ESP32 Firmware reboot */}
              <div className="flex items-center justify-between py-2 border-t border-black/10 dark:border-[#333] mt-1 shrink-0">
                <div className="flex items-center gap-2.5">
                  <RotateCcw className="w-4 h-4 text-[#A0A0A0] shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-900 dark:text-[#E0E0E0]">Firmware Restart</span>
                    <span className="text-[10px] text-[#A0A0A0]">Remote soft-reboot trigger for ESP32</span>
                  </div>
                </div>
                <button
                  onClick={handleReboot}
                  disabled={rebooting}
                  className="px-3 py-1.5 text-[10px] font-bold rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary dark:text-primary hover:text-primary/90 disabled:opacity-50 transition-all flex items-center justify-center cursor-pointer shadow-sm min-w-[90px]"
                >
                  {rebooting ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                      Rebooting
                    </>
                  ) : (
                    "Soft Reset"
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
});

interface CameraViewProps {
  streamSrc: string | null;
  streamError: boolean;
  rssi: number | undefined;
  setStreamError: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamSrc: React.Dispatch<React.SetStateAction<string | null>>;
  roverOnline: boolean;
  roverIp: string;
  streamKey: number;
  isRebooting: boolean;
  isStreamSevered: boolean;
}

const CameraView = React.memo(function CameraView({
  streamSrc,
  streamError,
  rssi,
  setStreamError,
  setStreamSrc,
  roverOnline,
  roverIp,
  streamKey,
  isRebooting,
  isStreamSevered
}: CameraViewProps) {
  const [isStreamLoading, setIsStreamLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ w: width, h: height });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#050505] overflow-hidden flex items-center justify-center rounded-xl">
      
      {roverOnline && streamSrc ? (
        <img 
          id="rover-video-stream"
          key={streamKey}
          src={isStreamSevered || isRebooting ? "" : `${streamSrc}&t=${streamKey}`} 
          alt="ARES-01 live feed"
          className="absolute origin-center pointer-events-none select-none"
          style={{ 
            display: streamError || !roverOnline || isStreamSevered || isRebooting ? 'none' : 'block',
            width: containerSize.h > 0 ? `${containerSize.h}px` : '100%',
            height: containerSize.w > 0 ? `${containerSize.w}px` : '100%',
            transform: 'rotate(90deg)',
            objectFit: 'cover'
          }}
          onLoad={() => {
            retryCountRef.current = 0;
            setIsStreamLoading(false);
            setStreamError(false);
          }}
          onError={() => {
            if (isRebooting || isStreamSevered) return;
            if (retryCountRef.current < 5) {
              retryCountRef.current += 1;
              setTimeout(() => {
                setStreamSrc(`http://${roverIp}:82/stream?timestamp=${Date.now()}`);
              }, 1000);
            } else {
              setStreamError(true);
              setIsStreamLoading(false);
            }
          }}
        />
      ) : null}

      {/* UNROTATED OVERLAY CONTAINER */}
      <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center rounded-xl overflow-hidden">
        {(isStreamSevered || isRebooting) ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 pointer-events-auto">
            <div className="w-24 h-24 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
            <span className="text-indigo-400 font-mono text-xl font-bold tracking-[0.2em] animate-pulse">
              ARES-01 REBOOTING...
            </span>
            <span className="text-white/50 font-mono text-sm tracking-widest mt-2">
              AWAITING TELEMETRY
            </span>
          </div>
        ) : (streamError || !roverOnline || isStreamLoading) && (
          <div className="absolute inset-0 bg-[#0f172a] pointer-events-auto flex items-center justify-center">
            {/* Ambient AI visual glow layers behind the grid */}
            <div 
              className="absolute left-0 top-0 bottom-0 w-1/4 bg-gradient-to-b from-cyan-400/10 via-purple-500/10 to-indigo-500/10 blur-2xl animate-pulse pointer-events-none z-0"
              style={{ animationDuration: '4000ms' }}
            />
            <div 
              className="absolute right-0 top-0 bottom-0 w-1/4 bg-gradient-to-b from-cyan-400/10 via-purple-500/10 to-indigo-500/10 blur-2xl animate-pulse pointer-events-none z-0"
              style={{ animationDuration: '4000ms' }}
            />
            <div className="absolute inset-0 opacity-[0.04] pointer-events-none z-10"
              style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20">
              {streamError ? (
                <>
                  <AlertTriangle className="w-10 h-10 text-red-500 animate-pulse mb-1" />
                  <span className="text-red-400 font-mono text-base font-bold tracking-widest">⚠️ CAMERA SENSOR FAULT</span>
                  <span className="text-white/70 font-mono text-sm mt-1 text-center max-w-xs">Physical connection lost. Check ribbon cable & power supply.</span>
                  <button 
                    onClick={() => {
                      setStreamError(false);
                      setIsStreamLoading(true);
                      if (streamSrc) {
                        const base = streamSrc.split('?')[0];
                        setStreamSrc(`${base}?cb=${Date.now()}`);
                      }
                    }}
                    className="mt-5 px-5 py-2 bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 rounded-lg text-red-100 font-mono text-sm transition-all duration-300 cursor-pointer shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:shadow-[0_0_25px_rgba(239,68,68,0.5)] active:scale-95"
                  >
                    RETRY CAMERA
                  </button>
                </>
              ) : !roverOnline ? (
                <>
                  <span className="text-white/15 font-mono text-xl tracking-widest select-none">CAMERA OFFLINE</span>
                  <span className="text-white/10 font-mono text-xs">AWAITING ROVER TELEMETRY & FEED</span>
                </>
              ) : (
                <>
                  <span className="text-white/30 font-mono text-xl tracking-widest select-none animate-pulse">CONNECTING...</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

interface DPadProps {
  activeDirection: Direction | null;
  onPress: (dir: Direction) => void;
  onRelease: () => void;
  onStop: () => void;
}

const DPad = React.memo(function DPad({
  activeDirection,
  onPress,
  onRelease,
  onStop
}: DPadProps) {
  const getButtonClass = (dir: Direction) => {
    const isActive = activeDirection === dir;
    return `w-12 h-12 sm:w-12 sm:h-12 flex items-center justify-center cursor-pointer transition-all duration-300 ease-out active:scale-95 ${
      isActive
        ? "scale-90 bg-primary border-2 border-primary text-primary-foreground shadow-inner shadow-black/30 ring-4 ring-primary/30 rounded-xl neon-glow-cyan"
        : "border-2 border-slate-300 shadow-[0_3px_10px_rgba(0,0,0,0.03)] bg-white hover:border-primary hover:bg-slate-50 hover:scale-[1.05] hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] text-slate-800 rounded-xl dark:border-white/10 dark:bg-transparent dark:text-white dark:hover:border-primary/50 dark:hover:border-white/30 dark:hover:text-primary"
    }`;
  };

  return (
    <div className="flex flex-col items-center justify-between h-full w-full py-0">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mt-0 mb-0.5">Drive Controls</div>
      <div className="flex flex-col items-center gap-1 select-none mb-1">
        <button
          className={getButtonClass("forward")}
          onMouseDown={() => { onPress("forward"); }} onMouseUp={onRelease} onMouseLeave={onRelease}
          onTouchStart={e => { e.preventDefault(); onPress("forward"); }} onTouchEnd={onRelease}
          data-testid="btn-move-fwd">
          <ArrowUp className="w-5 h-5 sm:w-5 sm:h-5" />
        </button>
        <div className="flex gap-2">
          <button
            className={getButtonClass("left")}
            onMouseDown={() => { onPress("left"); }} onMouseUp={onRelease} onMouseLeave={onRelease}
            onTouchStart={e => { e.preventDefault(); onPress("left"); }} onTouchEnd={onRelease}
            data-testid="btn-move-left">
            <ArrowLeft className="w-5 h-5 sm:w-5 sm:h-5" />
          </button>
          <button
            className={`w-12 h-12 sm:w-12 sm:h-12 flex items-center justify-center cursor-pointer transition-all duration-300 ease-out active:scale-95 ${
              activeDirection === "stop"
                ? "scale-90 bg-destructive border-2 border-destructive text-destructive-foreground shadow-inner shadow-black/30 ring-4 ring-destructive/30 rounded-xl neon-glow-violet"
                : "border-2 border-slate-300 shadow-[0_3px_10px_rgba(0,0,0,0.03)] bg-white hover:border-destructive hover:bg-slate-50 hover:scale-[1.05] hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] text-destructive rounded-xl dark:border-white/10 dark:bg-transparent dark:hover:border-white/30 dark:text-destructive dark:hover:border-destructive/50"
            }`}
            onClick={() => { onStop(); }} data-testid="btn-move-stop">
            <Square className="w-4 h-4 sm:w-4 sm:h-4 fill-current" />
          </button>
          <button
            className={getButtonClass("right")}
            onMouseDown={() => { onPress("right"); }} onMouseUp={onRelease} onMouseLeave={onRelease}
            onTouchStart={e => { e.preventDefault(); onPress("right"); }} onTouchEnd={onRelease}
            data-testid="btn-move-right">
            <ArrowRight className="w-5 h-5 sm:w-5 sm:h-5" />
          </button>
        </div>
        <button
          className={getButtonClass("backward")}
          onMouseDown={() => { onPress("backward"); }} onMouseUp={onRelease} onMouseLeave={onRelease}
          onTouchStart={e => { e.preventDefault(); onPress("backward"); }} onTouchEnd={onRelease}
          data-testid="btn-move-back">
          <ArrowDown className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
        <div className="h-4">
          <AnimatePresence>
            {activeDirection && (
              <motion.span key={activeDirection} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-xs font-mono font-semibold text-primary uppercase tracking-widest" data-testid="text-active-direction">
                ▶ {activeDirection}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
});

interface ArmControlsProps {
  setEditValue?: any;
  commitEdit?: any;
  joints: ArmAngles;
  setJointAngle: (joint: keyof ArmAngles, raw: number) => void;
  updateJoint: (joint: keyof ArmAngles, delta: number) => void;
  stepSize: number;
  setStepSize: React.Dispatch<React.SetStateAction<number>>;
  applyPreset: (p: typeof ARM_PRESETS[0]) => void;
  editingJoint: keyof ArmAngles | null;
  setEditingJoint: React.Dispatch<React.SetStateAction<keyof ArmAngles | null>>;
  editValue: string;
  startEdit: (j: keyof ArmAngles, v: number) => void;
  sendArmCommand: (action: string, joint?: string, direction?: string) => void;
  setActiveJoint: (j: keyof ArmAngles | null) => void;
  setActiveDirection: (d: "UP" | "DOWN" | null) => void;
}

const ArmControls = React.memo(function ArmControls({
  joints,
  setJointAngle,
  updateJoint,
  stepSize,
  setStepSize,
  applyPreset,
  editingJoint,
  setEditingJoint,
  editValue,
  setEditValue,
  commitEdit,
  startEdit,
  sendArmCommand,
  setActiveJoint,
  setActiveDirection
}: ArmControlsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Deep Tech Screen Background
    ctx.fillStyle = "#0f172a"; // slate-900 (deep dark blue)
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Professional HUD Engineering Grid
    ctx.strokeStyle = "rgba(56, 189, 248, 0.1)"; // faint cyan tech grid
    ctx.lineWidth = 1;
    for (let x = canvas.width / 2; x < canvas.width; x += 15) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(canvas.width - x, 0); ctx.lineTo(canvas.width - x, canvas.height); ctx.stroke();
    }
    for (let y = canvas.height - 12; y > 0; y -= 15) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    // Center axis line
    ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(canvas.width / 2, 0); ctx.lineTo(canvas.width / 2, canvas.height); ctx.stroke();
    ctx.setLineDash([]);

    // Geometry parameters (scaled to fit nicely in 110x65)
    const x0 = canvas.width / 2; // base center x
    const y0 = canvas.height - 10; // base center y
    const L1 = 20; // Shoulder length
    const L2 = 18; // Elbow length
    const L3 = 12; // Wrist length

    // Convert angles (0 to 180) to radians
    const baseAngleRad = (joints.base) * Math.PI / 180;
    const shAngleRad = (joints.shoulder) * Math.PI / 180;
    
    // Elbow and wrist angles (relative calculation for 2D forward kinematics side view representation)
    const elAngleAbsRad = (joints.shoulder + joints.elbow - 90) * Math.PI / 180;
    const wrAngleAbsRad = (joints.shoulder + joints.elbow + joints.wrist - 180) * Math.PI / 180;

    // Joint coordinate calculations
    const x1 = x0 + L1 * Math.cos(shAngleRad);
    const y1 = y0 - L1 * Math.sin(shAngleRad);

    const x2 = x1 + L2 * Math.cos(elAngleAbsRad);
    const y2 = y1 - L2 * Math.sin(elAngleAbsRad);

    const x3 = x2 + L3 * Math.cos(wrAngleAbsRad);
    const y3 = y2 - L3 * Math.sin(wrAngleAbsRad);

    // 2. High-Tech Base Mount
    const drawTechBase = (x: number, y: number, color: string) => {
       // Outer Base Platform
       ctx.fillStyle = "#1e293b"; // slate-800
       ctx.beginPath();
       ctx.ellipse(x, y + 2, 24, 7, 0, 0, 2 * Math.PI);
       ctx.fill();

       // Glowing Inner Ring
       ctx.shadowBlur = 10;
       ctx.shadowColor = color;
       ctx.strokeStyle = color;
       ctx.lineWidth = 2;
       ctx.beginPath();
       ctx.ellipse(x, y, 20 + 4 * Math.sin(baseAngleRad), 5, 0, 0, 2 * Math.PI);
       ctx.stroke();
       ctx.shadowBlur = 0;
       
       // Center Hub
       ctx.fillStyle = color;
       ctx.globalAlpha = 0.7;
       ctx.beginPath();
       ctx.ellipse(x, y, 8, 3, 0, 0, 2 * Math.PI);
       ctx.fill();
       ctx.globalAlpha = 1.0;
    };

    // Pedestal stem
    ctx.fillStyle = "#334155";
    ctx.fillRect(x0 - 5, y0, 10, 12);
    ctx.fillStyle = "#475569"; // highlight
    ctx.fillRect(x0 - 3, y0, 6, 12);

    drawTechBase(x0, y0, JOINT_CONFIG.base.color);

    // 3. Robotic Links with metallic styling and colored core
    const drawTechLink = (startX: number, startY: number, endX: number, endY: number, color: string, width: number) => {
      // Outer metallic casing
      ctx.strokeStyle = "#334155"; // slate-700
      ctx.lineWidth = width + 2;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
      
      // Colored LED Core
      ctx.shadowBlur = 6;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = width - 1.5;
      ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
      
      // Center highlight line
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
    };

    drawTechLink(x0, y0, x1, y1, JOINT_CONFIG.shoulder.color, 6);
    drawTechLink(x1, y1, x2, y2, JOINT_CONFIG.elbow.color, 5);
    drawTechLink(x2, y2, x3, y3, JOINT_CONFIG.wrist.color, 4);

    // Draw Gripper Claws
    const gripVal = joints.gripper;
    const clawSpread = (gripVal / 180) * 0.5 + 0.15; // claw angular spread in rad
    const clawLen = 8;
    
    const lfAngle = wrAngleAbsRad - clawSpread;
    const xLf = x3 + clawLen * Math.cos(lfAngle);
    const yLf = y3 - clawLen * Math.sin(lfAngle);
    
    const rfAngle = wrAngleAbsRad + clawSpread;
    const xRf = x3 + clawLen * Math.cos(rfAngle);
    const yRf = y3 - clawLen * Math.sin(rfAngle);

    drawTechLink(x3, y3, xLf, yLf, JOINT_CONFIG.gripper.color, 3.5);
    drawTechLink(x3, y3, xRf, yRf, JOINT_CONFIG.gripper.color, 3.5);

    // 4. Professional Engineering Joints
    const drawProJoint = (x: number, y: number, color: string, r: number) => {
      // Outer dark steel ring
      ctx.fillStyle = "#1e293b"; // slate-800
      ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 2 * Math.PI); ctx.fill();
      
      // Middle colored ring
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, r + 0.5, 0, 2 * Math.PI); ctx.fill();

      // Inner dark gap
      ctx.fillStyle = "#0f172a"; // slate-900
      ctx.beginPath(); ctx.arc(x, y, r - 1, 0, 2 * Math.PI); ctx.fill();

      // Center silver pivot pin
      ctx.fillStyle = "#cbd5e1"; // slate-300
      ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, 2 * Math.PI); ctx.fill();
    };

    drawProJoint(x0, y0, JOINT_CONFIG.base.color, 4.5);
    drawProJoint(x1, y1, JOINT_CONFIG.shoulder.color, 4.5);
    drawProJoint(x2, y2, JOINT_CONFIG.elbow.color, 4);
    drawProJoint(x3, y3, JOINT_CONFIG.wrist.color, 3.5);
  }, [joints]);

  return (
    <div className="arm-controls-wrapper flex flex-col gap-1 py-0">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">5DOF Arm Control</div>
      </div>

      {/* Preset buttons removed — use Reset Arm to Home button or voice commands */}

      <div className="arm-canvas-sliders-flex flex flex-col md:flex-row gap-2 md:gap-1 items-center bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 rounded-xl p-2 md:p-1 w-full font-sans backdrop-blur-md shadow-sm dark:shadow-lg">
        <div className="arm-canvas-wrapper relative w-[110px] h-[65px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center shadow-inner dark:shadow-[inset_0_2px_15px_rgba(0,0,0,0.6)]">
          <canvas ref={canvasRef} width={110} height={65} className="w-full h-full block opacity-80 dark:opacity-100" />
        </div>

        <div className="arm-sliders-container flex-1 w-full space-y-1">
          {JOINT_ORDER.map(key => {
            const cfg = JOINT_CONFIG[key];
            const value = joints[key];
            return (
              <div key={key} className="flex items-center justify-between gap-1.5 flex-1 w-full relative group bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 rounded-lg p-1 transition-colors">
                
                {/* Left Column: Label & Dot */}
                <div className="flex items-center gap-1.5 w-[80px] shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 shadow-[0_0_8px_currentColor]`} style={{ color: cfg.color, backgroundColor: cfg.color }} />
                  <span className="text-[10px] font-semibold text-slate-700 dark:text-muted-foreground uppercase tracking-widest leading-none">{cfg.label}</span>
                </div>

                {/* Center Column: Directional Buttons */}
                <div className="flex items-center gap-2 justify-center flex-1">
                  <ContinuousButton 
                    onDown={() => {
                        setActiveJoint(key as keyof ArmAngles);
                        setActiveDirection("DOWN");
                        sendArmCommand("start", key, "DOWN");
                    }}
                    onUp={() => {
                        setActiveJoint(null);
                        setActiveDirection(null);
                        sendArmCommand("stop");
                    }}
                    className="h-6 w-11 md:h-6 md:w-12 shrink-0 rounded border border-slate-300/50 dark:border-white/10 bg-white hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-600 hover:scale-[1.03] active:scale-95 transition-all duration-300 ease-out flex items-center justify-center shadow-sm dark:shadow-[0_0_10px_rgba(0,0,0,0.4)] text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    data-testid={`btn-arm-${key}-dec`}>
                    {key === "base" ? <ArrowLeft className="w-3.5 h-3.5" /> : 
                     key === "gripper" ? <span className="text-[9px] font-bold tracking-widest">OPEN</span> : 
                     <ArrowDown className="w-3.5 h-3.5" />}
                  </ContinuousButton>
                  
                  <ContinuousButton 
                    onDown={() => {
                        setActiveJoint(key as keyof ArmAngles);
                        setActiveDirection("UP");
                        sendArmCommand("start", key, "UP");
                    }}
                    onUp={() => {
                        setActiveJoint(null);
                        setActiveDirection(null);
                        sendArmCommand("stop");
                    }}
                    className="h-6 w-11 md:h-6 md:w-12 shrink-0 rounded border border-slate-300/50 dark:border-white/10 bg-white hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-600 hover:scale-[1.03] active:scale-95 transition-all duration-300 ease-out flex items-center justify-center shadow-sm dark:shadow-[0_0_10px_rgba(0,0,0,0.4)] text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    data-testid={`btn-arm-${key}-inc`}>
                    {key === "base" ? <ArrowRight className="w-3.5 h-3.5" /> : 
                     key === "gripper" ? <span className="text-[9px] font-bold tracking-widest">CLOSE</span> : 
                     <ArrowUp className="w-3.5 h-3.5" />}
                  </ContinuousButton>
                </div>
                
                {/* Right Column: Degree Display */}
                <div className="shrink-0 w-[35px] text-right bg-white dark:bg-slate-900 rounded px-1 py-0.5 border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none">
                  <span className="text-[10px] font-mono font-bold text-slate-900 dark:text-cyan-400 dark:drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
                    {value}°
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});


const CoordinateControlPanel = React.memo(function CoordinateControlPanel({
  joints,
  commandUrl,
  onExecuteSequence
}: {
  joints: ArmAngles;
  commandUrl: string;
  onExecuteSequence?: (seq: {joint: keyof ArmAngles, angle: number}[]) => void;
}) {
  const [localCoords, setLocalCoords] = useState<ArmAngles>({ ...joints });
  const [sequence, setSequence] = useState<(keyof ArmAngles)[]>([]);

  // Sync local coords when actual joints change, but skip edited ones
  useEffect(() => {
    setLocalCoords(prev => {
      const next = { ...prev };
      for (const k of JOINT_ORDER) {
        if (!sequence.includes(k)) {
          next[k] = joints[k];
        }
      }
      return next;
    });
  }, [joints, sequence]);

  const handleChange = (key: keyof ArmAngles, val: string) => {
    setLocalCoords(prev => ({ ...prev, [key]: Number(val) }));
    if (!sequence.includes(key)) {
      setSequence(prev => [...prev, key]);
    }
  };

  const handleExecute = () => {
    if (sequence.length > 0) {
      if (onExecuteSequence) {
        const seq = sequence.map(k => ({ joint: k, angle: localCoords[k] }));
        onExecuteSequence(seq);
      }
      toast.success("Executing sequence...");
      setSequence([]);
    } else {
      toast.info("No sequence to execute. Adjust values first.");
    }
  };

  const handleClear = () => {
    setSequence([]);
    setLocalCoords({ ...joints });
  };

  return (
    <div className="w-full h-full bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 rounded-xl p-2.5 backdrop-blur-md shadow-sm dark:shadow-lg flex flex-col relative">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3 h-3 text-cyan-600 dark:text-cyan-500" />
          Coordinates
        </div>
        {sequence.length > 0 && (
          <button onClick={handleClear} className="flex items-center gap-1 text-[9px] font-bold text-red-500 hover:text-red-600 bg-red-500/10 hover:bg-red-500/20 px-1.5 py-0.5 rounded transition-colors uppercase tracking-widest ml-1" title="Clear Sequence">
            <RotateCcw className="w-2.5 h-2.5" />
            CLR
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5 mb-2.5 flex-1 justify-between">
        {JOINT_ORDER.map(key => {
          const seqIndex = sequence.indexOf(key);
          const inSeq = seqIndex !== -1;
          return (
            <div key={key} className={`flex items-center justify-between bg-slate-100 dark:bg-slate-800 rounded-lg border ${inSeq ? 'border-cyan-400 dark:border-cyan-500' : 'border-slate-200 dark:border-white/5'} px-3 py-1 relative group hover:border-cyan-400 dark:hover:border-cyan-500/50 transition-colors shadow-[inset_0_1px_3px_rgba(0,0,0,0.02)]`}>
              {inSeq && (
                <div className="absolute -left-1.5 -top-1.5 w-4 h-4 bg-cyan-500 text-white rounded-full flex items-center justify-center text-[9px] font-bold shadow-md z-10 border border-white dark:border-slate-800">
                  {seqIndex + 1}
                </div>
              )}
              <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{JOINT_CONFIG[key].label}</span>
              <input 
                type="number"
                value={localCoords[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                className={`w-12 h-5 bg-transparent text-right text-[11px] font-mono font-bold ${inSeq ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-900 dark:text-white'} outline-none transition-colors`}
              />
            </div>
          );
        })}
      </div>
      <button 
        onClick={handleExecute}
        className="relative overflow-hidden w-full h-7 mt-auto shrink-0 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-cyan-600/20 dark:hover:bg-cyan-600/40 dark:border dark:border-cyan-500/50 text-white dark:text-cyan-400 text-[11px] font-bold tracking-widest uppercase transition-all duration-300 active:scale-[0.97] active:ring-2 active:ring-slate-400/50 dark:active:ring-cyan-500/50 shadow-md flex items-center justify-center gap-1.5 group"
      >
        <span className="absolute inset-0 bg-white/20 translate-y-full group-active:translate-y-0 transition-transform duration-100 ease-out"></span>
        <Send className="w-3 h-3 relative z-10" /> <span className="relative z-10">Execute</span>
      </button>
    </div>
  );
});

// ─── Main Dashboard ─────────────────────────────────────────────────────────────


// -- Offline Control Stubs
const setDriveDirection = (dir: string) => {};
const setArmAngles = (angles: any) => {};
const setMaxSpeed = async (speed: number) => {};
const setNavigationMode = async (mode: string) => {};

export default function Dashboard() {

  const { theme, setTheme } = useTheme();

  // ── Network / Connection State
  const initialRoverIp = typeof window !== "undefined" ? (localStorage.getItem('ares_rover_ip') || "192.168.4.1") : "192.168.4.1";
  const [roverConnectionStatus, setRoverConnectionStatus] = useState<RoverConnectionStatus>("disconnected");
  const [ping, setPing] = useState<number | null>(null);
  const [commandUrl, setCommandUrl] = useState(`http://${initialRoverIp}`);
  const [showSettings, setShowSettings] = useState(false);
  const [roverMode, setRoverMode] = useState<"MANUAL" | "AUTONOMOUS">("MANUAL");

  // ── Camera Stream State (Moved up for hook dependency array)
  const [roverIp, setRoverIp] = useState(initialRoverIp);
  const [connectTrigger, setConnectTrigger] = useState(0);
  const [streamSrc, setStreamSrc] = useState<string | null>(null);
  const [streamKey, setStreamKey] = useState(Date.now());
  const [streamError, setStreamError] = useState(false);

  // ── Toast Notification State


  // ── WebSocket References

  // ── Phase 6.1 Telemetry & Task Queue State
  interface SystemTelemetry {
    battery: number;
    motor_temp: number;
    distance: number;
    rssi?: number;
    cpu_temp?: number;
    sys_voltage?: number;
    current_draw?: number;
    uptime?: number;
    connection_status?: "online" | "offline";
    auto_brake?: boolean;
    locked?: boolean;
    x?: number;
    w?: number;
    area?: number;
    heap?: number;
    motorTemp?: number;
  }
  const [telemetry, setTelemetry] = useState<SystemTelemetry>({ 
    rssi: 0, heap: 0, battery: 0, motor_temp: 0, distance: 0 
  });
  const [roverOnline, setRoverOnline] = useState(false);

  useEffect(() => {
    const handleActive = () => {
      setRoverOnline(true);
    };
    window.addEventListener("ares_connection_active", handleActive);
    return () => window.removeEventListener("ares_connection_active", handleActive);
  }, []);

  const [aiTaskState, setAiTaskState] = useState<"idle" | "rotate_to_scan" | "await_lock" | "approach" | "pickup">("idle");
  const aiTaskStateRef = useRef(aiTaskState);
  useEffect(() => { aiTaskStateRef.current = aiTaskState; }, [aiTaskState]);
  const telemetryRef = useRef(telemetry);
  useEffect(() => { telemetryRef.current = telemetry; }, [telemetry]);

  // Connect directly to ESP32-S3 Telemetry via WebSocket and HTTP Fallback
  useEffect(() => {
    if (!roverIp || connectTrigger === 0) return;
    try {
      let lastPacketTime = Date.now();
      let lastPingSent = Date.now();
      
      const onActive = () => { 
        lastPacketTime = Date.now(); 
        setRoverOnline(true);
      };
      window.addEventListener("ares_connection_active", onActive);
      
      const updateTelemetry = (data: any) => {
        setTelemetry(prev => ({
          ...prev,
          rssi: data.rssi ?? prev.rssi,
          heap: data.heap ?? prev.heap,
          battery: data.battery ?? prev.battery,
          distance: data.distance ?? prev.distance
        }));
      };

      const cleanIp = roverIp.trim().replace(/^https?:\/\//i, '').replace(/^ws:\/\//i, '').split('/')[0];
      const wsUrl = `ws://${cleanIp}:81/`;
      console.log(`[ARES-01] Auto-init WebSocket telemetry to: ${wsUrl}`);
      const telemetryWs = new WebSocket(wsUrl);
      globalWs = telemetryWs;
      
      let initialConnect = false;
      let pingInterval: NodeJS.Timeout;
      telemetryWs.onopen = () => {
        initialConnect = true;
        lastPacketTime = Date.now();
        setRoverOnline(true);
        toast.success(`Connected to Rover (${cleanIp})`);
        lastPingSent = Date.now();
        telemetryWs.send(JSON.stringify({ ping: true }));

        pingInterval = setInterval(() => {
          if (telemetryWs.readyState === WebSocket.OPEN) {
            lastPingSent = Date.now();
            telemetryWs.send(JSON.stringify({ ping: true }));
          }
        }, 1500); // 1.5s ping keeps ESP32 responding with telemetry
      };
      
      telemetryWs.onmessage = (e) => {
        // ANY message from the rover means it's online - set this FIRST before parsing
        setRoverOnline(true);
        lastPacketTime = Date.now();
        try {
          const data = JSON.parse(e.data);
          
          // Only calculate RTT ping if the message is a specific pong response
          if (data.pong) {
             const rtt = Math.max(1, Math.round(Date.now() - lastPingSent));
             setPing(rtt);
          } else if (data.ping !== undefined) {
             // Or if the rover explicitly provided a ping value (e.g. mock server)
             setPing(data.ping);
          }

          if (data.battery !== undefined || data.distance !== undefined) {
             updateTelemetry(data);
          }
            if (data.rssi !== undefined) {
               setTelemetry(prev => ({ ...prev, rssi: data.rssi }));
            }
        } catch (err) {
          // Non-JSON message from ESP32 is fine - rover is still online
        }
      };

      // Fallback: If WS is disconnected or slow, HTTP poll keeps rover connection active
      const httpPollInterval = setInterval(async () => {
        if (!globalWs || globalWs.readyState !== WebSocket.OPEN) {
          try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 1200);
            const t0 = Date.now();
            const res = await fetch(`http://${cleanIp}/telemetry`, { signal: controller.signal, mode: "cors" });
            clearTimeout(tid);
            if (res.ok) {
              const data = await res.json();
              setRoverOnline(true);
              lastPacketTime = Date.now();
              setPing(Math.max(1, Math.round(Date.now() - t0)));
              if (data.battery !== undefined || data.distance !== undefined) {
                updateTelemetry(data);
              }
            }
          } catch (e) {
            // Ignore background HTTP poll failure
          }
        }
      }, 2500);

      const watchdogInterval = setInterval(() => {
        if (Date.now() - lastPacketTime > 8000) {
          setRoverOnline(false);
          setPing(null);
        }
      }, 2000);

      const resetTelemetry = () => {
        if (pingInterval) clearInterval(pingInterval);
        setRoverOnline(false);
        setPing(null);
      };

      telemetryWs.onclose = (e) => {
        console.warn("[WS] Telemetry closed", e);
        if (initialConnect) {
           toast.error("Lost connection to Rover.");
        }
        resetTelemetry();
      };
      telemetryWs.onerror = (e) => {
        console.error("[WS] Telemetry error", e);
        resetTelemetry();
      };

      return () => {
        if (pingInterval) clearInterval(pingInterval);
        clearInterval(httpPollInterval);
        window.removeEventListener("ares_connection_active", onActive);
        clearInterval(watchdogInterval);
        globalWs = null;
        telemetryWs.close();
      };
    } catch (e) {
      console.warn("Invalid rover IP for WebSocket", e);
      toast.error("Invalid IP Address Format");
    }
  }, [roverIp, connectTrigger]);

  // Send camera URL to Python backend when available
  useEffect(() => {
    if (streamSrc && !streamError) {
      const hostname = window.location.hostname || "127.0.0.1";
      fetch(`http://${hostname}:5000/api/set_camera_url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: streamSrc })
      }).catch(() => {});
    }
  }, [streamSrc, streamError]);

  // Autonomous Task Queue State Machine Loop
  useInterval(() => {
    if (controlMode !== "ai" && controlMode !== "voice") return;
    const state = aiTaskStateRef.current;
    if (state === "idle") return;
    
    const tel = telemetryRef.current;
    
    // Phase 7: Emergency Auto-Brake Override
    if (tel.auto_brake) {
      setAiTaskState("idle"); // Halt the mission immediately
      console.warn("[SYS] EMERGENCY AUTO-BRAKE INJECTED");
      return;
    }
    
    if (state === "rotate_to_scan") {
      if (tel.locked) {
        setAiTaskState("await_lock");
      } else {
      }
    } else if (state === "await_lock") {
      if (!tel.locked) {
        setAiTaskState("rotate_to_scan");
      } else {
        setAiTaskState("approach");
      }
    } else if (state === "approach") {
      if (!tel.locked) {
        setAiTaskState("rotate_to_scan");
        return;
      }
      
      const dx = (tel.x ?? 0) - ((tel.w ?? 0) > 0 ? 320 : 160); // Roughly center
      if ((tel.area ?? 0) > 15000) {
        setAiTaskState("pickup");
      } else {
      }
    } else if (state === "pickup") {
      const nextAngles = { base: 90, shoulder: 45, elbow: 120, wrist: 90, gripper: 180 };
      setAiTaskState("idle");
    }
  }, 200);

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const reqFrameRef = useRef<number>(0);

  const handleCapturePhoto = useCallback(async () => {
    try {
      const base64Data = await extractCurrentFrameBase64();
      if (!base64Data) {
        toast.error("⚠️ Capture Failed: No video stream active or stream dropped.");
        return;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `ARES01_SNAP_${timestamp}.jpg`;
      

      
      const link = document.createElement('a');
      link.href = base64Data;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`📸 Saved to Downloads`);
    } catch (err) {
      console.error(`${LOG} Failed to capture photo:`, err);
      toast.error(`⚠️ Capture Failed: ${err instanceof Error ? err.message : err}`);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    console.log(`${LOG} Video recording stopped.`);
  }, []);

  const startRecording = useCallback(() => {
    setIsRecording(true);
    console.log(`${LOG} Video recording UI started.`);

    const img = document.getElementById('rover-video-stream') as HTMLImageElement;
    if (!img) {
      console.warn(`${LOG} Camera stream not found. Recording UI will run, but no video will be saved.`);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Continuously draw the img stream to the canvas
    const drawFrame = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      reqFrameRef.current = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    // Capture a 30fps MediaStream from the canvas
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    
    recordedChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };
    
    recorder.onstop = async () => {
      cancelAnimationFrame(reqFrameRef.current);
      if (recordedChunksRef.current.length === 0) return;
      
      try {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.style.display = "none";
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `ARES01_REC_${timestamp}.webm`;
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        toast.success(`🎥 Video Saved to Downloads`);
      } catch (err) {
        console.error(`${LOG} Failed to save video:`, err);
        toast.error(`⚠️ Video Save Failed: ${err}`);
      }
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
  }, []);

  const handleRecordVideo = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // ── Live telemetry from Firebase
  const [liveTelemetry, setLiveTelemetry] = useState<{
    obstacle_distance?: number;
    battery_percentage?: number;
    motor_temp?: number;
    rssi?: number;
  }>({});

  const distance  = liveTelemetry.obstacle_distance;

  const motorTemp = liveTelemetry.motor_temp;
  const rssi      = liveTelemetry.rssi;

  // ── System configuration settings (dynamic Firebase bindings)
  const [maxSpeed, setMaxSpeedState] = useState<number>(80); // Default speed limit
  const [rebooting, setRebooting] = useState(false);

  const handleMaxSpeedChange = useCallback(async (speed: number) => {
    setMaxSpeedState(speed);
    await setMaxSpeed(speed);
  }, []);

  const [isStreamSevered, setIsStreamSevered] = useState(false);

  const handleReboot = async () => {
    if (rebooting) return;
    setRebooting(true);
    setIsStreamSevered(true);
    setRoverConnectionStatus("reconnecting");

    try {
      // Phase 1: Dispatch Reboot Packets across WS & HTTP
      if (globalWs && globalWs.readyState === WebSocket.OPEN) {
        globalWs.send(JSON.stringify({ action: "reboot" }));
        globalWs.close();
      }
      if (roverIp) {
        let base = roverIp.trim();
        if (!base.startsWith("http")) base = `http://${base}`;
        base = base.endsWith("/") ? base.slice(0, -1) : base;
        fetch(`${base}/reboot`, { method: "POST", mode: "no-cors", signal: AbortSignal.timeout(1500) }).catch(() => {});
      }
    } catch (e) {
      console.warn("Reboot command fired:", e);
    }

    // Phase 2: Smart Health-Check Polling Loop via WS Probe (bypasses CORS)
    const POLLING_DELAY_MS = 3000;
    const POLLING_INTERVAL_MS = 1000;
    const MAX_ATTEMPTS = 15;

    setTimeout(() => {
      let attempts = 0;
      const pollTimer = setInterval(() => {
        attempts++;
        if (!roverIp) return;
        
        const probeWs = new WebSocket(`ws://${roverIp.trim()}:81`);
        
        probeWs.onopen = () => {
          // Hardware is back!
          clearInterval(pollTimer);
          probeWs.close();
          
          setRebooting(false);
          setIsStreamSevered(false);
          setStreamKey(Date.now());
          
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ares_connection_active"));
          toast.success("ARES-01 Hardware rebooted and reconnected!");
        };

        probeWs.onerror = () => {
          // WS connection failed, meaning server isn't up yet
          probeWs.close();
          if (attempts >= MAX_ATTEMPTS) {
            clearInterval(pollTimer);
            setRebooting(false);
            setIsStreamSevered(false);
            setRoverConnectionStatus("disconnected");
            toast.error("Reboot timed out. Check hardware power.");
          }
        };
        
      }, POLLING_INTERVAL_MS);
    }, POLLING_DELAY_MS);
  };

    

  // ── Control Mode
  const [controlMode, setControlModeState] = useState<ControlMode>("manual");
  const setControlMode = useCallback(async (mode: ControlMode) => {
    setControlModeState(mode);
    
  }, []);

  const handleRoverModeToggle = useCallback(async (mode: "MANUAL" | "AUTONOMOUS") => {
    setRoverMode(mode);
    setControlMode(mode === "AUTONOMOUS" ? "ai" : "manual");
    if (globalWs && globalWs.readyState === WebSocket.OPEN) {
      globalWs.send(JSON.stringify({ command: "set_mode", mode }));
    }
    await setNavigationMode(mode);
  }, [setControlMode]);

  useEffect(() => {
    if (roverMode === "AUTONOMOUS") {
      setControlMode("ai");
    } else {
      setControlMode("manual");
    }
  }, [roverMode, setControlMode]);

  

  // ── D-Pad
  const [activeDirection, setActiveDirection] = useState<Direction | null>(null);

  const handleDirectionPress = useCallback(async (dir: Direction) => {
    if (roverMode !== "MANUAL") {
      toast.warning("Switch to MANUAL Mode to drive the rover.");
      return;
    }
    setActiveDirection(dir);
    const fbDir = dir.toUpperCase() as DriveDirection;
    setDriveDirection(fbDir);
    try {
      if (commandUrl) {
        await sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: fbDir, speed: 255 });
      }
    } catch (err) {
      console.error("HTTP Drive Error:", err);
      toast.error(`Drive Error: ${err}`);
    }
  }, [commandUrl, roverMode]);

  const handleDirectionRelease = useCallback(async () => {
    if (roverMode !== "MANUAL") return;
    setActiveDirection(null);
    setDriveDirection("STOP");
    try {
      if (commandUrl) {
        await sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "STOP", speed: 255 });
      }
    } catch (err) {
      console.error("HTTP Drive Error:", err);
      toast.error(`Drive Error: ${err}`);
    }
  }, [commandUrl, roverMode]);

  const handleStop = useCallback(() => {
    setActiveDirection(null);
    setDriveDirection("STOP");
  }, []);

  // ── Keyboard Controls for Rover D-Pad
  // ── Keyboard Controls for Rover D-Pad
  const activeKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const validKeys = [
      "PageUp", "PageDown", "Home", "End",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "w", "a", "s", "d", "W", "A", "S", "D",
      " "
    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (!validKeys.includes(key)) return;

      // Ignore keyboard controls if user is currently typing inside input or textarea
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
        return;
      }

      event.preventDefault();

      if (event.repeat || activeKeysRef.current.has(key)) return;

      activeKeysRef.current.add(key);

      let dir: Direction;
      switch (key) {
        case "PageUp":
        case "ArrowUp":
        case "w":
        case "W":
          dir = "forward";
          break;
        case "PageDown":
        case "ArrowDown":
        case "s":
        case "S":
          dir = "backward";
          break;
        case "Home":
        case "ArrowLeft":
        case "a":
        case "A":
          dir = "left";
          break;
        case "End":
        case "ArrowRight":
        case "d":
        case "D":
          dir = "right";
          break;
        case " ":
          dir = "stop";
          break;
        default:
          return;
      }

      handleDirectionPress(dir);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key;
      if (!validKeys.includes(key)) return;

      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
        return;
      }

      event.preventDefault();

      if (activeKeysRef.current.has(key)) {
        activeKeysRef.current.delete(key);
        
        if (key === " " || activeKeysRef.current.size === 0) {
          handleDirectionRelease();
        } else {
          // Transition to the next remaining active key
          const remainingKeys = Array.from(activeKeysRef.current);
          const nextKey = remainingKeys[remainingKeys.length - 1];
          let dir: Direction;
          switch (nextKey) {
            case "PageUp":
            case "ArrowUp":
            case "w":
            case "W":
              dir = "forward";
              break;
            case "PageDown":
            case "ArrowDown":
            case "s":
            case "S":
              dir = "backward";
              break;
            case "Home":
            case "ArrowLeft":
            case "a":
            case "A":
              dir = "left";
              break;
            case "End":
            case "ArrowRight":
            case "d":
            case "D":
              dir = "right";
              break;
            case " ":
              dir = "stop";
              break;
            default:
              return;
          }
          handleDirectionPress(dir);
        }
      }
    };

    const handleBlur = () => {
      if (activeKeysRef.current.size > 0) {
        activeKeysRef.current.clear();
        handleDirectionRelease();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // ── 5DOF Arm
  const [joints, setJoints] = useState<ArmAngles>(() => {
    try {
      const saved = localStorage.getItem("ares_arm_joints");
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_JOINTS, ...parsed }; // Merge in case of schema changes
      }
    } catch (e) {
      console.warn("Failed to load joints from localStorage", e);
    }
    return DEFAULT_JOINTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem("ares_arm_joints", JSON.stringify(joints));
    } catch (e) {
      console.warn("Failed to save joints to localStorage", e);
    }
  }, [joints]);

  const resetAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const lastCommandTimeRef = useRef<number>(0);
  const pendingCommandRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendThrottledCommand = useCallback((url: string, payload: any) => {
    const now = Date.now();
    if (now - lastCommandTimeRef.current < 100) {
      if (!pendingCommandRef.current) {
        pendingCommandRef.current = setTimeout(() => {
          pendingCommandRef.current = null;
          lastCommandTimeRef.current = Date.now();
          sendCommandViaHttp(url, payload).catch(e => { console.error(e); toast.error(String(e)); });
        }, 100);
      }
      return;
    }
    lastCommandTimeRef.current = now;
    sendCommandViaHttp(url, payload).catch(e => { console.error(e); toast.error(String(e)); });
  }, []);

  const sendArmCommand = useCallback((action: string, joint?: string, direction?: string) => {
    if (commandUrl) {
      const payload: any = { mode: "arm", action: action };
      if (joint) payload.joint = joint;
      if (direction) payload.direction = direction;
      sendCommandViaHttp(commandUrl, payload).catch(console.error);
    }
  }, [commandUrl]);

  const updateJoint = useCallback((joint: keyof ArmAngles, delta: number) => {
    setJoints(prev => {
      const nextAngle = Math.max(10, Math.min(170, prev[joint] + delta));
      if (prev[joint] === nextAngle) return prev; // Prevent unnecessary dispatches when hitting bounds
      const next = { ...prev, [joint]: nextAngle };
      if (commandUrl) {
        sendThrottledCommand(commandUrl, { mode: "manual", action: "arm_control", joint: joint, angle: nextAngle });
      }
      setArmAngles(next);
      return next;
    });
  }, [commandUrl]);

  // ── Restore local UI animation loop purely for the graphic rendering
  const [activeJoint, setActiveJoint] = useState<keyof ArmAngles | null>(null);
  const [activeArmDirection, setActiveArmDirection] = useState<"UP" | "DOWN" | null>(null);

  useEffect(() => {
    if (!activeJoint || !activeArmDirection) return;
    const interval = setInterval(() => {
      setJoints(prev => {
        const delta = activeArmDirection === "UP" ? 3 : -3;
        const nextAngle = Math.max(10, Math.min(170, prev[activeJoint] + delta));
        return { ...prev, [activeJoint]: nextAngle };
      });
    }, 50);
    return () => clearInterval(interval);
  }, [activeJoint, activeArmDirection]);

  const setJointAngle = useCallback((joint: keyof ArmAngles, raw: number) => {
    const val = Math.max(10, Math.min(170, raw));
    setJoints(prev => {
      const next = { ...prev, [joint]: val };
      if (commandUrl) {
        sendThrottledCommand(commandUrl, { mode: "manual", action: "arm_control", joint: joint, angle: val });
      }
      setArmAngles(next);
      return next;
    });
  }, [commandUrl]);

  const animateJointsTo = useCallback((target: ArmAngles, label: string) => {
    if (resetAnimRef.current) clearInterval(resetAnimRef.current);
    const start = { ...joints };
    const steps = 24;
    let step = 0;
    resetAnimRef.current = setInterval(() => {
      step++;
      const t = 1 - Math.pow(1 - step / steps, 3);
      const next: ArmAngles = {
        base:     Math.round(start.base     + (target.base     - start.base)     * t),
        shoulder: Math.round(start.shoulder + (target.shoulder - start.shoulder) * t),
        elbow:    Math.round(start.elbow    + (target.elbow    - start.elbow)    * t),
        wrist:    Math.round(start.wrist    + (target.wrist    - start.wrist)    * t),
        gripper:  Math.round(start.gripper  + (target.gripper  - start.gripper)  * t),
      };
      setJoints(next);
      if (step >= steps) {
        clearInterval(resetAnimRef.current!);
        resetAnimRef.current = null;
        setArmAngles(next); // final sync
      }
    }, 16);
  }, [joints]);



  const handleExecuteSequence = useCallback(async (seq: {joint: keyof ArmAngles, angle: number}[]) => {
    let currentAngles = { ...joints };
    for (const step of seq) {
      const diff = step.angle - currentAngles[step.joint];
      if (diff === 0) continue;
      
      const dir = diff > 0 ? "UP" : "DOWN";
      
      // 1. Send hardware START command
      sendArmCommand("start", step.joint, dir);
      
      // 2. Animate the UI smoothly over the calculated duration
      const durationMs = Math.abs(diff) * 20; // 20ms per degree -> 90 degrees = 1.8 seconds.
      const frames = Math.floor(durationMs / 16);
      const startAngle = currentAngles[step.joint];
      
      for (let i = 1; i <= frames; i++) {
        const t = i / frames;
        const currentAnimAngle = Math.round(startAngle + diff * t);
        setJoints(prev => ({ ...prev, [step.joint]: currentAnimAngle }));
        await new Promise(r => setTimeout(r, 16));
      }
      
      // 3. Send STOP command to ESP32
      sendArmCommand("stop", step.joint);
      
      // Update local tracker and snap UI to exact target
      currentAngles[step.joint] = step.angle;
      setJoints(prev => {
        const next = { ...prev, [step.joint]: step.angle };
        // If there's any other state synced, it updates here. The original used setJointAngle which might call other things.
        return next;
      });
      
      // Pause between joints
      await new Promise(r => setTimeout(r, 400));
    }
  }, [joints, sendArmCommand]);

  const applyPreset = useCallback((p: typeof ARM_PRESETS[0]) => {
    animateJointsTo(p.joints, `Preset: ${p.name}`);
    if (commandUrl) {
      const macroCmd = p.name.toUpperCase();
      sendCommandViaHttp(commandUrl, { mode: "manual", action: "arm_macro", direction: macroCmd, speed: 255 }).catch(e => { console.error(e); toast.error(String(e)); });
    }
  }, [animateJointsTo, commandUrl]);

  const [stepSize, setStepSize] = useState<number>(3);
  const [editingJoint, setEditingJoint] = useState<keyof ArmAngles | null>(null);
  const [editValue, setEditValue] = useState("");
  const startEdit = useCallback((j: keyof ArmAngles, v: number) => { setEditingJoint(j); setEditValue(String(v)); }, []);
  
  const commitEdit = useCallback((j: keyof ArmAngles) => {
    const p = parseInt(editValue, 10);
    if (!isNaN(p)) setJointAngle(j, p);
    setEditingJoint(null);
  }, [editValue, setJointAngle]);

  // ── AI Command / Voice Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [directiveInput, setDirectiveInput] = useState("");
  const [aiLogs, setAiLogs] = useState<string[]>([
    `[SYS] AI Kernel Initialized. Ready for NLP routing.`
  ]);
  const queueTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [activeQueue, setActiveQueue] = useState<{command: string, duration_ms: number, index: number, total: number} | null>(null);

  // ── Autonomous Vision AI Pipeline ─────────────
  useEffect(() => {
    if (roverMode !== "AUTONOMOUS") return;
    let isActive = true;
    let timer: any;

    const runVisionPoll = async () => {
      try {
        if (!streamSrc) return;
        const captureUrl = streamSrc.replace('/stream', '/capture');
        const res = await fetch(captureUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error("Capture failed");
        const blob = await res.blob();
        
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          if (!isActive) return;
          const base64data = reader.result as string;
          const apiKey = import.meta.env.VITE_GROQ_API_KEY;
          if (!apiKey) {
            setAiLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] [VISION ERROR] Groq API Key missing.`].slice(-8));
            return;
          }

          const prompt = "You are a rover avoiding obstacles. Output strict JSON: {\"action\": \"FORWARD\" | \"LEFT\" | \"RIGHT\" | \"STOP\", \"reasoning\": \"brief reason\"}.";
          const payload = {
            model: "llama-3.2-11b-vision-preview",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: base64data } }
                ]
              }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1
          };

          try {
            const apiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            });
            const data = await apiRes.json();
            if (!isActive) return;
            if (data.choices && data.choices[0] && data.choices[0].message.content) {
              const content = JSON.parse(data.choices[0].message.content);
              const action = content.action;
              setAiLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] [VISION] ${content.reasoning} -> ${action}`].slice(-8));
              if (["FORWARD", "BACKWARD", "LEFT", "RIGHT", "STOP"].includes(action)) {
                 console.log("Offline Command executed");
              }
            }
          } catch (e) {
            console.error("Vision API Error:", e);
            if (isActive) {
               setAiLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] [VISION ERROR] Halt sequence initiated.`].slice(-8));
               console.log("Offline Command executed");
            }
          }
        };
      } catch (e) {
        console.error("Frame capture error:", e);
      } finally {
        if (isActive) {
          timer = setTimeout(runVisionPoll, 2000);
        }
      }
    };

    runVisionPoll();

    return () => {
      isActive = false;
      if (timer) clearTimeout(timer);
    };
  }, [roverMode, streamSrc]);
  const [voiceLogs, setVoiceLogs] = useState<string[]>([
    "> Voice module online. Awaiting speech...",
  ]);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const aiLogsContainerRef = useRef<HTMLDivElement>(null);
  const voiceLogsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (aiLogsContainerRef.current) {
      setTimeout(() => {
        if (!aiLogsContainerRef.current) return;
        const container = aiLogsContainerRef.current;
        container.scrollTop = container.scrollHeight;
      }, 50);
    }
  }, [aiLogs]);

  useEffect(() => {
    if (voiceLogsContainerRef.current) {
      setTimeout(() => {
        if (!voiceLogsContainerRef.current) return;
        const container = voiceLogsContainerRef.current;
        container.scrollTop = container.scrollHeight;
      }, 50);
    }
  }, [voiceLogs]);

  const [isExecuting, setIsExecuting] = useState(false);
  const isExecutingRef = useRef(false);

  const executeAutonomousDirective = async (commandText: string, appendLog: (msg: string) => void) => {
    if (isExecutingRef.current) return;
    setIsExecuting(true);
    isExecutingRef.current = true;
    
    appendLog(`[${new Date().toLocaleTimeString()}] [AI] Initiated directive: "${commandText}"`);

      while (isExecutingRef.current) {
        const base64Frame = await extractCurrentFrameBase64();
        if (!base64Frame) {
         appendLog(`[${new Date().toLocaleTimeString()}] [ERROR] Camera frame extraction failed.`);
         break;
      }
      
      try {
        const result = await processAutonomousCommand(commandText, base64Frame);
        appendLog(`[${new Date().toLocaleTimeString()}] [VISION] Action: ${result.action}`);
        
        if (result.action === "TASK_COMPLETE") {
           appendLog(`[${new Date().toLocaleTimeString()}] [AI] Task accomplished successfully.`);
           break;
        }

        // Kinematics Translation
        if (result.coordinates && result.coordinates.length === 2) {
           const [y, x] = result.coordinates; // normalized 0-1000
           // X-axis maps to Arm Base (0-180)
           const baseAngle = Math.max(0, Math.min(180, Math.round((1000 - x) * 180 / 1000)));
           // Y-axis maps to Shoulder and Elbow (Depth/Height)
           const shoulderAngle = Math.max(0, Math.min(180, Math.round((1000 - y) * 180 / 1000)));

           if (globalWs && globalWs.readyState === WebSocket.OPEN) {
             globalWs.send(JSON.stringify({ mode: "arm", action: "arm_control", joint: "base", angle: baseAngle }));
             await new Promise(r => setTimeout(r, 200));
             globalWs.send(JSON.stringify({ mode: "arm", action: "arm_control", joint: "shoulder", angle: shoulderAngle }));
             await new Promise(r => setTimeout(r, 200));
             globalWs.send(JSON.stringify({ mode: "arm", action: "arm_control", joint: "elbow", angle: shoulderAngle })); // Approximate elbow
             await new Promise(r => setTimeout(r, 200));
             if (result.action === "PICK") {
                 globalWs.send(JSON.stringify({ mode: "arm", action: "arm_control", joint: "gripper", angle: 180 })); // OPEN
                 await new Promise(r => setTimeout(r, 500));
             }
           }
        }
        
        if (result.drive_direction && result.drive_direction !== "STOP") {
           if (globalWs && globalWs.readyState === WebSocket.OPEN) {
             globalWs.send(JSON.stringify({ mode: "manual", action: "drive", direction: result.drive_direction.toLowerCase(), speed: 120 }));
             await new Promise(r => setTimeout(r, 500));
             globalWs.send(JSON.stringify({ mode: "manual", action: "drive", direction: "stop", speed: 0 }));
           }
        }
        
      } catch (e) {
        appendLog(`[${new Date().toLocaleTimeString()}] [ERROR] Gemini AI failure: ${e}`);
        break;
      }
      
      await new Promise(r => setTimeout(r, 2000));
    }
    
    setIsExecuting(false);
    isExecutingRef.current = false;
  };

  // ── Local Keyword Fallback (used when Gemini is unavailable) ─────────────
  const executeLocalKeywordFallback = useCallback(async (text: string, timestamp: string, appendLog: (msg: string) => void) => {
    const lowerText = text.toLowerCase();

    // 1. Check for time-based parameter (e.g. "৫ সেকেন্ড", "5s", "3 sec")
    const numMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(?:সেকেন্ড|sec|s)/);
    const durationSec = numMatch ? parseFloat(numMatch[1]) : 0;

    // Keywords
    const hasDriveKeyword = ['সামনে', 'আগা', 'এগিয়ে', 'forw', 'ahead', 'samne', 'agao', 'agiye', 'straight', 'ফরওয়ার্ড'].some(k => lowerText.includes(k));
    const hasReverseKeyword = ['পিছনে', 'পেছনে', 'পিছা', 'পেছা', 'back', 'rev', 'piche', 'pechone', 'pichao', 'ব্যাক', 'রিভার্স'].some(k => lowerText.includes(k));
    const hasPickKeyword = ['pick', 'grab', 'pikap', 'collect', 'পিকআপ', 'পিক'].some(k => lowerText.includes(k));
    const hasDropKeyword = ['drop', 'ড্রপ'].some(k => lowerText.includes(k));
    const hasScanKeyword = ['চারপাশ', 'দেখ', 'খুঁজ', 'scan', 'search', 'dekho', 'khojo', 'khujo', 'স্ক্যান', 'সার্চ'].some(k => lowerText.includes(k));
    
    // Explicit entity keywords
    const explicitRover = ['রোভার', 'রোবার', 'rover', 'গাড়ি', 'gari', 'car', 'গাড়ী'].some(k => lowerText.includes(k));

    // Color keyword detection
    const colorMap: Record<string, string> = {
      'লাল': 'RED', 'red': 'RED',
      'নীল': 'BLUE', 'blue': 'BLUE',
      'সবুজ': 'GREEN', 'green': 'GREEN',
      'হলুদ': 'YELLOW', 'yellow': 'YELLOW',
      'কালো': 'BLACK', 'black': 'BLACK',
      'সাদা': 'WHITE', 'white': 'WHITE', 'shada': 'WHITE', 'sada': 'WHITE',
      'হোয়াইট': 'WHITE', 'গ্রিন': 'GREEN', 'ব্লু': 'BLUE', 'ইয়েলো': 'YELLOW',
      'ব্ল্যাক': 'BLACK', 'রেড': 'RED',
    };
    const detectedColorEntry = Object.entries(colorMap).find(([k]) => lowerText.includes(k));
    if (detectedColorEntry) {
      appendLog(`[${timestamp}] [VISION] Target color identified: ${detectedColorEntry[1]}`);
    }

    // If color + object word detected but no explicit pick keyword, treat as pick
    const hasObjectWord = ['বস্তু', 'object', 'ball', 'বল', 'thing', 'জিনিস', 'jinish', 'bostu', 'অবজেক্ট'].some(k => lowerText.includes(k));
    const hasColorAndObject = detectedColorEntry && hasObjectWord;

    // A. Sequential Macro: Reverse and Drop
    if (hasReverseKeyword && hasDropKeyword) {
      const driveDuration = durationSec > 0 ? durationSec * 1000 : 2000;
      appendLog(`[${timestamp}] [MISSION] Phase 1: Reversing to target zone (${driveDuration / 1000}s)...`);
      setDriveDirection("BACKWARD");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "BACKWARD", speed: 255 }).catch(console.error);
      
      await new Promise(r => setTimeout(r, driveDuration));
      
      appendLog(`[${new Date().toLocaleTimeString()}] [MISSION] Phase 2: Target reached. Braking rover.`);
      setDriveDirection("STOP");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "STOP", speed: 255 }).catch(console.error);
      
      await new Promise(r => setTimeout(r, 400));
      
      appendLog(`[${new Date().toLocaleTimeString()}] [MISSION] Phase 3: Executing autonomous drop macro...`);
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "arm_macro", direction: "DROP", speed: 255 }).catch(console.error);
      
      setJoints(prev => ({ ...prev, shoulder: 45, elbow: 120, gripper: 180 }));
      await new Promise(r => setTimeout(r, 4000));
      
      appendLog(`[${new Date().toLocaleTimeString()}] [MISSION] Phase 4: Mission Completed. Arm homed.`);
      setJoints(DEFAULT_JOINTS);
      
      toast.success("Autonomous Drop Mission Completed!");
      return;
    }

    // B. Sequential Macro: Forward and Pick
    if (hasDriveKeyword && (hasPickKeyword || hasColorAndObject)) {
      const driveDuration = durationSec > 0 ? durationSec * 1000 : 2000;
      appendLog(`[${timestamp}] [MISSION] Phase 1: Driving forward to target (${driveDuration / 1000}s)...`);
      setDriveDirection("FORWARD");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "FORWARD", speed: 255 }).catch(console.error);
      
      await new Promise(r => setTimeout(r, driveDuration));
      
      appendLog(`[${new Date().toLocaleTimeString()}] [MISSION] Phase 2: Target reached. Braking rover.`);
      setDriveDirection("STOP");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "STOP", speed: 255 }).catch(console.error);
      
      await new Promise(r => setTimeout(r, 400));
      
      appendLog(`[${new Date().toLocaleTimeString()}] [MISSION] Phase 3: Executing autonomous pickup macro...`);
      // Trigger the ESP32 internal macro
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "arm_macro", direction: "PICKUP", speed: 255 }).catch(console.error);
      
      // The ESP32 macro takes about 6 seconds to complete. 
      // Update UI to show picking down
      setJoints({ base: 90, shoulder: 45, elbow: 120, wrist: 90, gripper: 180 });
      await new Promise(r => setTimeout(r, 6500));
      
      appendLog(`[${new Date().toLocaleTimeString()}] [MISSION] Phase 4: Mission Completed. Arm homed with payload.`);
      // Sync UI to final state (Home with closed gripper)
      setJoints({ ...DEFAULT_JOINTS, gripper: 0 });
      
      toast.success("Autonomous Pick Mission Completed!");
      return;
    }

    const hasDanceKeyword = ['নাচ', 'ডান্স', 'dance', 'celebrate', 'nacho', 'anondo'].some(k => lowerText.includes(k));

    // C. Autonomous Scan Sequence
    if (hasScanKeyword) {
      appendLog(`[${timestamp}] [MISSION] Initiating Area Scan Sequence...`);
      setDriveDirection("LEFT");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "LEFT", speed: 200 }).catch(console.error);
      
      await new Promise(r => setTimeout(r, 1500));
      
      appendLog(`[${new Date().toLocaleTimeString()}] [MISSION] Scanning right sector...`);
      setDriveDirection("RIGHT");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "RIGHT", speed: 200 }).catch(console.error);
      
      await new Promise(r => setTimeout(r, 3000));
      
      appendLog(`[${new Date().toLocaleTimeString()}] [MISSION] Scan complete. Holding position.`);
      setDriveDirection("STOP");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "STOP", speed: 200 }).catch(console.error);
      
      toast.success("Scan Completed");
      return;
    }

    // C2. Dance / Celebrate Sequence
    if (hasDanceKeyword) {
      appendLog(`[${timestamp}] [MISSION] Initiating Celebration Routine...`);
      
      setDriveDirection("LEFT");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "LEFT", speed: 255 }).catch(console.error);
      setJoints({ base: 90, shoulder: 45, elbow: 180, wrist: 90, gripper: 180 }); // Arm up
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "arm_macro", direction: "PICKUP", speed: 255 }).catch(console.error);
      await new Promise(r => setTimeout(r, 800));

      setDriveDirection("RIGHT");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "RIGHT", speed: 255 }).catch(console.error);
      setJoints(prev => ({ ...prev, gripper: 90 })); // Snap gripper
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "arm_macro", direction: "DROP", speed: 255 }).catch(console.error);
      await new Promise(r => setTimeout(r, 1600));

      setDriveDirection("LEFT");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "LEFT", speed: 255 }).catch(console.error);
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "arm_macro", direction: "PICKUP", speed: 255 }).catch(console.error);
      await new Promise(r => setTimeout(r, 800));

      setDriveDirection("STOP");
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "STOP", speed: 255 }).catch(console.error);
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "arm_macro", direction: "HOME", speed: 255 }).catch(console.error);
      
      toast.success("Celebration Complete!");
      return;
    }

    // D. Timed Movement
    if (durationSec > 0) {
      let dir: DriveDirection = "FORWARD";
      let dirLabel = "FORWARD";
      if (hasReverseKeyword) {
        dir = "BACKWARD";
        dirLabel = "BACKWARD";
      } else if (['বামে', 'বাম', 'left', 'বাঁয়ে', 'বাঁয়ে', 'bame', 'bam'].some(k => lowerText.includes(k))) {
        dir = "LEFT";
        dirLabel = "LEFT";
      } else if (['ডানে', 'ডান', 'right', 'ডানদিকে', 'daine', 'dan'].some(k => lowerText.includes(k))) {
        dir = "RIGHT";
        dirLabel = "RIGHT";
      }

      appendLog(`[${timestamp}] [NAV] Moving ${dirLabel} for ${durationSec} seconds...`);
      setDriveDirection(dir);
      if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: dir, speed: 255 }).catch(console.error);

      setTimeout(() => {
        setDriveDirection("STOP");
        if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "STOP", speed: 255 }).catch(console.error);
        toast.info(`Completed ${durationSec}s movement.`);
      }, durationSec * 1000);
      return;
    }

    // E. Individual Arm Joint Commands — CHECK FIRST before drive to avoid conflicts
    const hasGripper = ['গ্রিপার', 'gripper', 'grip', 'griper', 'greeper', 'গ্রিপ্পার', 'গ্রিপের', 'ধরন', 'চিমটা', 'claw', 'jaw', 'ক্ল', 'গ্রিপ', 'হাত', 'haat', 'আঙ্গুল', 'angul', 'ধরো', 'dhoro', 'ছাড়ো', 'charo', 'চিমটি', 'chimti', 'কামড়', 'kamor', 'মুঠো', 'mutho', 'গ্রিপারটা', 'gripperta'].some(k => lowerText.includes(k));
    const hasShoulder = ['শোল্ডার', 'shoulder', 'কাঁধ', 'kandh', 'কাধ', 'সোল্ডার'].some(k => lowerText.includes(k));
    const hasElbow = ['এলবো', 'elbow', 'কনুই', 'konui', 'কনু', 'এলব'].some(k => lowerText.includes(k));
    const hasWrist = ['রিস্ট', 'wrist', 'কবজি', 'kobji', 'risk', 'rist', 'rest', 'রিষ্ট', 'রিস্', 'কব্জি'].some(k => lowerText.includes(k));
    // Aggressive Bengali base detection to combat STT boundary issues
    const hasBaseJoint = ['বেস', 'base', 'bass', 'bays', 'pace', 'বেইস', 'বেজ', 'বেশ', 'baze', 'bej', 'bez', 'vesh', 'bes', 'besh', 'বেস্ট', 'best', 'ব্যাস', 'byas', 'ফেস', 'face', 'দেশ', 'desh', 'গেস', 'guess', 'ব্রেস', 'brace', 'পেস', 'pesh', 'pes', 'bace', 'vas', 'vash', 'ভেজ', 'vej', 'বেছ', 'bech', 'bese', 'veze', 'besei', 'বেসেই'].some(k => lowerText.includes(k));

    const hasUp = ['উপরে', 'ওপরে', 'up', 'upore', 'upar', 'উঠাও', 'তোলো', 'ওঠাও', 'raise', 'lift', 'ওঠা', 'উঠা', 'তুলো', 'আপ', 'উড়াও', 'উডাও', 'ওঠো', 'udao', 'urao'].some(k => lowerText.includes(k)) || lowerText.split(/\s+/).includes('ও');
    const hasDown = ['নিচে', 'niche', 'down', 'নামাও', 'নেও', 'namao', 'lower', 'নামা', 'ডাউন'].some(k => lowerText.includes(k));
    const hasOpen = ['খোলো', 'খুলো', 'open', 'kholo', 'khulo', 'ওপেন', 'release', 'খোলা', 'khola', 'ছাড়ো', 'charo'].some(k => lowerText.includes(k));
    const hasClose = ['বন্ধ', 'close', 'bondho', 'ক্লোজ', 'আটকাও', 'atkao', 'shut', 'clamp', 'bondo', 'ধরো', 'dhoro', 'কামড়', 'মুঠো'].some(k => lowerText.includes(k));
    const hasLeft = ['বামে', 'বাম', 'left', 'bame', 'বাঁয়ে', 'বাঁয়ে', 'bamdike', 'baame'].some(k => lowerText.includes(k));
    const hasRight = ['ডানে', 'ডান', 'right', 'daine', 'dan', 'ডানদিকে', 'dane', 'daane'].some(k => lowerText.includes(k));

    // Auto-stop duration for DC motors (ms)
    const JOINT_RUN_MS = 1500;
    const sendJointWithAutoStop = (joint: string, angle: number) => {
      if (commandUrl) {
        sendCommandViaHttp(commandUrl, { mode: "arm", action: "arm_control", joint, angle }).catch(console.error);
        setTimeout(() => {
          sendCommandViaHttp(commandUrl, { mode: "arm", action: "arm_control", joint, angle: 90 }).catch(console.error);
        }, JOINT_RUN_MS);
      }
    };

    const hasAnyJoint = hasGripper || hasShoulder || hasElbow || hasWrist || hasBaseJoint;

    // RULE: If user EXPLICITLY mentions "rover" or "gari", we bypass the Arm Joint execution block!
    // This allows "rover bame ghurao" to correctly fall to the driving block, even if STT hallucinates a joint word.
    if (hasAnyJoint && !explicitRover) {
      if (hasGripper) {
        if (hasOpen) {
          appendLog(`[${timestamp}] [ARM] Gripper: OPENING.`);
          setJoints(prev => ({ ...prev, gripper: 0 }));
          sendJointWithAutoStop("gripper", 0);
        } else if (hasClose) {
          appendLog(`[${timestamp}] [ARM] Gripper: CLOSING.`);
          setJoints(prev => ({ ...prev, gripper: 180 }));
          sendJointWithAutoStop("gripper", 180);
        } else {
          appendLog(`[${timestamp}] [ARM] Gripper: OPENING (default).`);
          setJoints(prev => ({ ...prev, gripper: 0 }));
          sendJointWithAutoStop("gripper", 0);
        }
      } else if (hasShoulder) {
        const angle = hasUp ? 180 : hasDown ? 0 : 90;
        appendLog(`[${timestamp}] [ARM] Shoulder: ${hasUp ? 'UP' : hasDown ? 'DOWN' : 'STOP'}.`);
        setJoints(prev => ({ ...prev, shoulder: angle }));
        sendJointWithAutoStop("shoulder", angle);
      } else if (hasElbow) {
        const angle = hasUp ? 180 : hasDown ? 0 : 90;
        appendLog(`[${timestamp}] [ARM] Elbow: ${hasUp ? 'UP' : hasDown ? 'DOWN' : 'STOP'}.`);
        setJoints(prev => ({ ...prev, elbow: angle }));
        sendJointWithAutoStop("elbow", angle);
      } else if (hasWrist) {
        const angle = hasUp ? 180 : hasDown ? 0 : 90;
        appendLog(`[${timestamp}] [ARM] Wrist: ${hasUp ? 'UP' : hasDown ? 'DOWN' : 'STOP'}.`);
        setJoints(prev => ({ ...prev, wrist: angle }));
        sendJointWithAutoStop("wrist", angle);
      } else if (hasBaseJoint) {
        const angle = hasLeft ? 0 : hasRight ? 180 : 90;
        appendLog(`[${timestamp}] [ARM] Base: ${hasLeft ? 'LEFT' : hasRight ? 'RIGHT' : 'STOP'}.`);
        setJoints(prev => ({ ...prev, base: angle }));
        sendJointWithAutoStop("base", angle);
      }
    } else if (['হোম', 'জায়গা', 'সোজা', 'রিসো', 'রিসেট', 'home', 'reset', 'ghore', 'normal'].some(k => lowerText.includes(k))) {
      // G. Home/Reset — only if no joint name was specified
      appendLog(`[${timestamp}] [ARM] Manipulator system homing sequence initiated.`);
      const homeState = { base: 90, shoulder: 90, elbow: 90, wrist: 90, gripper: 0 };
      setJoints(homeState);
      if (commandUrl) {
        sendCommandViaHttp(commandUrl, { mode: "manual", action: "arm_macro", direction: "HOME", speed: 255 }).catch(e => { console.error(e); toast.error(String(e)); });
      }
    } else {
      // H. Standard Continuous Driving (Only if no Arm/Home commands matched)
      if (hasDriveKeyword) {
        appendLog(`[${timestamp}] [NAV] Propulsion system initialized: FORWARD.`);
        setDriveDirection("FORWARD");
        if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "FORWARD", speed: 255 }).catch(e => { console.error(e); toast.error(String(e)); });
      } else if (hasReverseKeyword) {
        appendLog(`[${timestamp}] [NAV] Propulsion system initialized: BACKWARD.`);
        setDriveDirection("BACKWARD");
        if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "BACKWARD", speed: 255 }).catch(e => { console.error(e); toast.error(String(e)); });
      } else if (hasLeft) {
        appendLog(`[${timestamp}] [NAV] Propulsion system initialized: LEFT.`);
        setDriveDirection("LEFT");
        if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "LEFT", speed: 255 }).catch(e => { console.error(e); toast.error(String(e)); });
      } else if (hasRight) {
        appendLog(`[${timestamp}] [NAV] Propulsion system initialized: RIGHT.`);
        setDriveDirection("RIGHT");
        if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "RIGHT", speed: 255 }).catch(e => { console.error(e); toast.error(String(e)); });
      } else if (['থামো', 'দাঁড়াও', 'দাঁড়াও', 'দাড়াও', 'থাম', 'দারান', 'দাঁড়ান', 'stop', 'halt', 'break', 'thamo', 'dara', 'thak'].some(k => lowerText.includes(k))) {
        appendLog(`[${timestamp}] [NAV] Propulsion system halted: STOP.`);
        setDriveDirection("STOP");
        if (commandUrl) sendCommandViaHttp(commandUrl, { mode: "manual", action: "drive", direction: "STOP", speed: 255 }).catch(e => { console.error(e); toast.error(String(e)); });
        setAiTaskState("idle");
      }
    }

    // Status
    appendLog(`[${timestamp}] [SYS] Local parser sequence completed successfully.`);
  }, [commandUrl]);

  // Voice language ref — accessible before the voice state block is declared
  const voiceLanguageRef = useRef("bn-BD");

  const handleAiDirectiveSubmit = useCallback(async (overrideText?: string | any, source: "ai" | "voice" = "ai") => {
    const rawTextToProcess = typeof overrideText === 'string' ? overrideText : directiveInput;
    if (typeof rawTextToProcess !== 'string' || !rawTextToProcess.trim() || isProcessing || isExecutingRef.current) return;

    const textToProcess = normalizeBengaliNumbers(rawTextToProcess);
    setIsProcessing(true);
    if (!overrideText) setDirectiveInput("");

    const appendLog = (msg: string) => {
      const setter = source === "voice" ? setVoiceLogs : setAiLogs;
      setter(prev => [...prev, msg].slice(-10));
    };

    const lowerText = textToProcess.toLowerCase();

    // Enforce strict English rejection in Bengali mode
    if (source === "voice" && voiceLanguageRef.current === "bn-BD") {
      const realBengaliWords = [
        // Drive keywords
        'সামনে', 'আগা', 'এগিয়ে', 'পিছনে', 'পেছনে', 'বামে', 'ডানে', 'থামো', 'দাঁড়াও', 'তোল', 'উঠাও', 'ধরো', 'নাও', 'ছাড়ো', 'নামা', 'ফেল', 'রাখ',
        'জায়গা', 'সোজা', 'ঘুরে', 'চারপাশ', 'দেখ', 'খুঁজ', 'নাচ', 'লাল', 'নীল', 'সবুজ', 'হলুদ', 'কালো', 'সাদা', 'বস্তু', 'বল', 'জিনিস', 'গিয়ে', 'করো', 'দাও',
        'রোভার', 'রোবার', 'gari', 'গাড়ি', 'car', 'rover',
        // Arm joint keywords
        'গ্রিপার', 'শোল্ডার', 'এলবো', 'রিস্ট', 'বেস', 'কাঁধ', 'কনুই', 'কবজি', 'খোলো', 'খুলো', 'খোলা', 'বন্ধ', 'ওপরে', 'উপরে', 'নিচে', 'নামাও', 'ঘুরাও', 'আটকাও', 'চিমটা', 'ধরন',
        // Additional Bengali arm words
        'রিষ্ট', 'কব্জি', 'কাধ', 'কনু', 'এলব', 'গ্রিপ', 'ক্ল', 'ঘোরাও', 'সোল্ডার', 'বেইস', 'বেজ', 'বেশ', 'bondo',
        // Direction words
        'উঠা', 'তুলো', 'ওঠা', 'ডাউন', 'আপ', 'ওঠাও', 'তোলো', 'যাও', 'নেও', 'ঘুরাও', 'উড়াও', 'উডাও', 'ওঠো', 'ও', 'bamdike', 'baame', 'daane',
        // Bengali mode home/reset
        'হোম', 'রিসেট', 'রিসো', 'পিকআপ', 'পিক', 'ড্রপ', 'রিলিজ'
      ];
      const hasRealBengaliWord = realBengaliWords.some(k => lowerText.includes(k));
      if (!hasRealBengaliWord) {
        appendLog(`[${new Date().toLocaleTimeString()}] [SYS] Ignored: Full English command in Bengali mode. Use English mode or Banglish.`);
        setIsProcessing(false);
        return;
      }
    }

    // FAST-PATH: Local Keyword Matching (Instant response for voice/text driving)
    const isNavCommand = [
      'সামনে', 'আগা', 'এগিয়ে', 'forw', 'ahead', 'samne', 'agao', 'agiye', 'straight', 'ফরওয়ার্ড',
      'পিছনে', 'পেছনে', 'পিছা', 'পেছা', 'back', 'rev', 'piche', 'pechone', 'pichao', 'ব্যাক', 'রিভার্স',
      'বামে', 'বাম', 'left', 'বাঁয়ে', 'bame', 'bam', 'bamdike', 'baame',
      'ডানে', 'ডান', 'right', 'ডানদিকে', 'daine', 'dan', 'dane', 'daane',
      'থামো', 'দাঁড়াও', 'দাড়াও', 'থাম', 'দারান', 'দাঁড়ান', 'stop', 'halt', 'break', 'thamo', 'dara', 'thak',
      'তোল', 'তুল', 'উঠাও', 'ধর', 'নাও', 'pick', 'grab', 'tulo', 'tolo', 'uthao', 'dhoro', 'pikap', 'উঠা', 'তুলে', 'ওঠাও', 'collect', 'lift', 'পিকআপ', 'পিক', 'উড়াও', 'উডাও', 'ওঠো', 'ও', 'udao', 'urao',
      'ছাড়', 'ছাড়ো', 'নামা', 'ফেল', 'রাখ', 'drop', 'releas', 'chharo', 'chere', 'rakho', 'namo', 'ড্রপ', 'রিলিজ',
      'হোম', 'জায়গা', 'সোজা', 'রিসো', 'রিসেট', 'home', 'reset', 'ghore', 'normal',
      'চারপাশ', 'দেখ', 'খুঁজ', 'scan', 'search', 'dekho', 'khojo', 'khujo', 'স্ক্যান', 'সার্চ',
      'নাচ', 'ডান্স', 'dance', 'celebrate', 'nacho', 'anondo', 'ghuro',
      'sec', 'সেকেন্ড',
      // Color keywords
      'লাল', 'red', 'নীল', 'blue', 'সবুজ', 'green', 'হলুদ', 'yellow', 'কালো', 'black', 'সাদা', 'white', 'shada', 'sada', 'হোয়াইট', 'গ্রিন', 'ব্লু', 'ইয়েলো', 'ব্ল্যাক', 'রেড',
      // Object words
      'বস্তু', 'object', 'ball', 'বল', 'thing', 'জিনিস', 'jinish', 'bostu', 'অবজেক্ট',
      // Individual arm joint keywords (with phonetic variations for speech recognition)
      'gripper', 'grip', 'griper', 'greeper', 'গ্রিপার', 'গ্রিপ্পার', 'গ্রিপের', 'চিমটা', 'ধরন', 'claw', 'jaw', 'ক্ল', 'গ্রিপ',
      'shoulder', 'শোল্ডার', 'কাঁধ', 'kandh', 'কাধ', 'সোল্ডার',
      'elbow', 'এলবো', 'কনুই', 'konui', 'কনু', 'এলব',
      'wrist', 'রিস্ট', 'কবজি', 'kobji', 'risk', 'rist', 'rest', 'রিষ্ট', 'কব্জি',
      'base', 'বেস', 'ঘুরাও', 'ghurao', 'rotate', 'turn', 'ঘোরাও', 'spin', 'bass', 'bays', 'pace', 'বেইস', 'বেজ', 'বেশ', 'baze', 'bej', 'bez', 'vesh', 'bes', 'besh',
      'খোলো', 'খুলো', 'খোলা', 'khola', 'open', 'kholo', 'ওপেন', 'release',
      'বন্ধ', 'bondo', 'close', 'bondho', 'ক্লোজ', 'আটকাও', 'shut', 'clamp',
      'উপরে', 'ওপরে', 'up', 'upore', 'raise', 'উঠা', 'তুলো', 'আপ',
      'নিচে', 'niche', 'down', 'নামাও', 'নেও', 'lower', 'ডাউন'
    ].some(k => lowerText.includes(k));

    if (isNavCommand) {
        // Run instantly
        appendLog(`[${new Date().toLocaleTimeString()}] [SYS] Fast-path local command executed.`);
        await executeLocalKeywordFallback(textToProcess, new Date().toLocaleTimeString(), appendLog);
        setIsProcessing(false);
        return;
    }

    // SLOW-PATH: Send complex directives to Gemini
    executeAutonomousDirective(textToProcess, appendLog);

    setTimeout(() => {
        setIsProcessing(false);
    }, 500);
  }, [directiveInput, isProcessing, commandUrl, executeLocalKeywordFallback, executeAutonomousDirective]);





  // ── Voice
  const [isListening, setIsListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceLanguage, setVoiceLanguageState] = useState("bn-BD");
  const setVoiceLanguage = useCallback(async (lang: string) => {
    setVoiceLanguageState(lang);
    voiceLanguageRef.current = lang;
    // Update the recognition object's lang property directly
    if (recognitionRef.current) {
      if (shouldListenRef.current) {
        // If currently listening, stop and restart with new language
        try { recognitionRef.current.stop(); } catch (e) {}
        setTimeout(() => {
          if (recognitionRef.current) {
            recognitionRef.current.lang = lang;
            try { recognitionRef.current.start(); } catch (e) {}
          }
        }, 300);
      } else {
        recognitionRef.current.lang = lang;
      }
    }
  }, []);
  const recognitionRef = useRef<any | null>(null);
  const isVoiceProcessingRef = useRef(false);
  const shouldListenRef = useRef(false);
  const handleAiDirectiveSubmitRef = useRef(handleAiDirectiveSubmit);
  useEffect(() => { handleAiDirectiveSubmitRef.current = handleAiDirectiveSubmit; }, [handleAiDirectiveSubmit]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = "bn-BD"; // Default, will be updated on toggle

      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (interimTranscript) {
          setVoiceTranscript(`Hearing: "${interimTranscript}"...`);
        }

        if (finalTranscript) {
          if (isVoiceProcessingRef.current) return;
          const spokenText = finalTranscript.trim();
          console.log("Recognized:", spokenText);
          
          setVoiceTranscript(`Executing: "${spokenText}"`);
          
          const commandText = spokenText.toLowerCase();
          if (!commandText) return;
          isVoiceProcessingRef.current = true;

          handleAiDirectiveSubmitRef.current(commandText, "voice");

          setTimeout(() => {
            isVoiceProcessingRef.current = false;
            setVoiceTranscript("");
          }, COOLDOWN_TIME);
        }
      };

      recognition.onerror = (err: any) => {
        console.error(`${LOG} Speech recognition error:`, err);
        isVoiceProcessingRef.current = false;
        // Don't kill shouldListenRef on transient errors like 'no-speech'
        if (err.error === 'aborted' || err.error === 'not-allowed') {
          shouldListenRef.current = false;
          setIsListening(false);
          toast.error("Voice recognition failed: " + err.error);
        }
      };

      recognition.onend = () => {
        if (shouldListenRef.current) {
          try {
            recognition.start();
          } catch (e) {
            console.error(`${LOG} Auto-reconnect failed:`, e);
            shouldListenRef.current = false;
            setIsListening(false);
          }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
    } catch (e) {
      console.error("Failed to initialize speech recognition:", e);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }
    };
  }, []); // Run ONCE on mount — stable recognition object

  const handleVoiceToggle = useCallback(async () => {
    if (!recognitionRef.current) {
      console.warn("Speech recognition not supported or not initialized.");
      return;
    }

    if (isVoiceProcessingRef.current) {
      console.log("Speech recognition is in 2s cooldown period.");
      return;
    }

    if (!isListening) {
      shouldListenRef.current = true;
      recognitionRef.current.lang = voiceLanguage;
      try {
        recognitionRef.current.start();
        setIsListening(true);
        console.log(`${LOG} Voice recognition started (language: ${voiceLanguage})`);
      } catch (e: any) {
        shouldListenRef.current = false;
        setIsListening(false);
        console.error("Speech recognition start failed:", e);
        toast.error("Speech API Error: " + (e.message || String(e)));
      }
    } else {
      shouldListenRef.current = false;
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      setIsListening(false);
      console.log(`${LOG} Voice recognition stopped.`);
    }
  }, [isListening, voiceLanguage]);

  // ── Camera Stream Handlers

  const handleConnect = useCallback(() => {
    let rawIp = roverIp.trim();
    if (!rawIp) return;
    
    // Strip protocols, slashes, and spaces
    let cleanIp = rawIp.replace(/^https?:\/\//i, '').replace(/^ws:\/\//i, '').split('/')[0].trim();
    
    const newCommandUrl = `http://${cleanIp}`;
    const newStreamUrl = `http://${cleanIp}:82/stream?cb=${Date.now()}`;
    
    setCommandUrl(newCommandUrl);
    setRoverIp(cleanIp);
    localStorage.setItem('ares_rover_ip', cleanIp);
    
    // Bind stream instantly
    setStreamError(false);
    setStreamSrc(newStreamUrl);
    setConnectTrigger(c => c + 1);
    
    toast.info(`Connecting to Rover (${cleanIp})...`);
  }, [roverIp]);

  const handleDisconnect = useCallback(() => {
    setStreamSrc(null);
    setStreamError(false);
    setCommandUrl("");
    setRoverOnline(false);
    setPing(null);
    setConnectTrigger(0);
    setRoverIp("");
    console.log(`${LOG} Disconnected from Rover`);
  }, []);

  // ── Settings Panel & WS Cleanup// ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-white dark:bg-[#0B0F19]">
      
      {/* Header */}
      <Header
        roverOnline={roverOnline}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        theme={theme}
        setTheme={setTheme}
        ping={ping}
        batteryPct={telemetry.battery || 0}
        roverMode={roverMode}
        onToggleRoverMode={handleRoverModeToggle}
      />

      {/* Settings / Connection Panel */}
      <SettingsPanel
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        roverOnline={roverOnline}
        roverIp={roverIp}
        setRoverIp={setRoverIp}
        streamSrc={streamSrc}
        streamError={streamError}
        handleConnect={handleConnect}
        handleDisconnect={handleDisconnect}
        ping={ping}
        rebooting={rebooting}
        handleReboot={handleReboot}
        rssi={rssi}
      />

      {/* Main Layout - Split Screen on lg */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 w-full z-10">
        
        {/* LEFT COLUMN: Camera View Section */}
        <div className="w-full lg:w-[55%] flex-shrink-0 flex flex-col relative bg-transparent z-10 h-[50vh] lg:h-full border-b lg:border-b-0 lg:border-r border-border/50">
        <style>{`
            @keyframes geminiGradient {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            @keyframes float1 {
              0% { transform: translate(0px, 0px) scale(1); }
              33% { transform: translate(30px, -20px) scale(1.1); }
              66% { transform: translate(-20px, 15px) scale(0.95); }
              100% { transform: translate(0px, 0px) scale(1); }
            }
            @keyframes float2 {
              0% { transform: translate(0px, 0px) scale(1.05); }
              50% { transform: translate(-30px, 25px) scale(0.95); }
              100% { transform: translate(0px, 0px) scale(1.05); }
            }
            .gemini-bg {
              background: linear-gradient(-45deg, #0f0c20, #15103c, #051c2c, #1f0b2a, #0c152a);
              background-size: 300% 300%;
              animation: geminiGradient 16s ease infinite;
            }
            .float-blob-1 {
              animation: float1 18s ease-in-out infinite;
            }
            .float-blob-2 {
              animation: float2 22s ease-in-out infinite;
            }
            @keyframes progressGlow {
              0% { box-shadow: 0 0 10px rgba(168,85,247,0.5), inset 0 0 10px rgba(168,85,247,0.5); }
              50% { box-shadow: 0 0 20px rgba(168,85,247,0.8), inset 0 0 20px rgba(168,85,247,0.8); }
              100% { box-shadow: 0 0 10px rgba(168,85,247,0.5), inset 0 0 10px rgba(168,85,247,0.5); }
            }
            .progress-glow {
              animation: progressGlow 2s infinite;
            }
            .dpad-button {
              box-shadow: inset 0 2px 5px rgba(255,255,255,0.1), 0 4px 10px rgba(0,0,0,0.5);
              transition: all 0.1s;
            }
            .dpad-button:active {
              box-shadow: inset 0 1px 2px rgba(0,0,0,0.8), 0 2px 5px rgba(0,0,0,0.5);
              transform: translateY(2px);
            }
            /* Disable body scroll completely for the app feel */
            body, html { overflow: hidden !important; touch-action: none; }
            button, a, input[type="range"] {
               touch-action: manipulation !important;
            }
            .arm-slider-control-row button, .arm-presets-grid button, .arm-reset-bottom, .dpad-button {
               position: relative;
            }
            .arm-slider-control-row button::after, .arm-presets-grid button::after, .arm-reset-bottom::after, .dpad-button::after {
               content: '';
               position: absolute;
               top: 50%;
               left: 50%;
               width: 48px;
               height: 48px;
               transform: translate(-50%, -50%);
               z-index: 10;
               pointer-events: auto;
             }
        `}</style>

        {/* Central Widescreen Camera Frame */}
        <div className="flex-[1] w-[98%] mx-auto flex flex-row justify-between items-end pb-2">
          {/* Top Overlays */}
          <div className="flex items-center gap-2 pointer-events-none">
            <div className={`flex items-center gap-2 bg-black/40 backdrop-blur-xl border border-white/20 rounded-lg shadow-[0_4px_30px_rgba(0,0,0,0.5)] px-3 py-1.5 transition-all duration-500 ${streamSrc && !streamError ? "shadow-[0_0_15px_rgba(74,222,128,0.2)] border-green-500/40" : ""}`}>
              <span className={`w-2 h-2 rounded-full transition-colors duration-500 ${streamSrc && !streamError ? "bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.8)] animate-pulse" : "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"}`} />
              <span className="text-white text-xs font-semibold tracking-wide uppercase">{streamSrc && !streamError ? "Live Feed" : "No Signal"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 pointer-events-none">
            {rssi !== undefined && (
              <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-xl border border-white/20 rounded-lg shadow-[0_4px_30px_rgba(0,0,0,0.5)] px-3 py-1.5">
                <Signal className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-white font-mono text-xs font-bold tracking-wider">{rssi} dBm</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex-[4] w-[98%] mx-auto relative flex items-center justify-center overflow-hidden">
          <div className="h-full aspect-[4/3] max-w-full relative flex items-center justify-center bg-black overflow-hidden shadow-2xl rounded-xl border border-white/10">
            {/* Ambient Auroras restricted to the container */}
            <div className="absolute -top-10 -left-10 w-72 h-72 rounded-full bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 blur-[80px] pointer-events-none float-blob-1" />
            <div className="absolute -bottom-16 -right-16 w-80 h-80 rounded-full bg-gradient-to-br from-blue-500/20 via-teal-500/20 to-indigo-500/20 blur-[90px] pointer-events-none float-blob-2" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] rounded-full bg-gradient-to-tr from-purple-600/5 via-blue-600/5 to-teal-500/5 blur-[100px] pointer-events-none animate-pulse" style={{ animationDuration: "8s" }} />

            <CameraView
              streamSrc={streamSrc}
              streamError={streamError}
              rssi={rssi}
              setStreamError={setStreamError}
              setStreamSrc={setStreamSrc}
              roverOnline={roverOnline}
              roverIp={roverIp}
              streamKey={streamKey}
              isRebooting={rebooting}
              isStreamSevered={isStreamSevered}
            />
          </div>
        </div>
        <div className="flex-[1] w-[98%] mx-auto flex flex-row justify-center items-start pt-4 gap-4">
          <CameraOverlay 
            onCapturePhoto={handleCapturePhoto} 
            onRecordVideo={handleRecordVideo} 
            isRecording={isRecording} 
          />
        </div>
        </div>

        {/* RIGHT COLUMN: Interactive Control Section */}
        <div className="w-full lg:w-[45%] flex-1 overflow-y-auto overflow-x-hidden flex flex-col bg-background z-10 pb-6 pt-2">
        
        {/* 2. MODE SELECTOR TABS */}
        <div className="shrink-0 px-4 pt-1 pb-1 bg-transparent z-10" style={{ display: roverMode === 'MANUAL' ? 'none' : 'block' }}>
          <div className="relative flex overflow-x-auto scrollbar-hide flex-nowrap rounded-xl bg-muted/80 p-1 gap-1 max-w-xl mx-auto border border-border/50">
            {CONTROL_TABS.filter(tab => roverMode === "AUTONOMOUS" ? (tab.id === "ai" || tab.id === "voice") : tab.id === "manual").map(tab => (
              <button key={tab.id} onClick={() => { setControlMode(tab.id); }}
                className={`relative flex flex-1 min-w-[140px] sm:min-w-0 items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg z-10 transition-all duration-300 ease-out active:scale-95 select-none ${
                  controlMode === tab.id ? "text-foreground shadow-[0_0_10px_rgba(255,255,255,0.05)] scale-[1.02]" : "text-muted-foreground hover:text-foreground hover:scale-105"
                }`}
                data-testid={`tab-${tab.id}`}>
                {controlMode === tab.id && (
                  <motion.div layoutId="tab-pill" className="absolute inset-0 bg-background border border-border/30 rounded-lg shadow-sm"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                )}
                <tab.icon className="w-3.5 h-3.5 relative z-10 shrink-0" />
                <span className="relative z-10 flex items-center gap-1.5">
                  {tab.id === "ai" && isExecuting && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                  )}
                  {tab.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. INTERACTIVE CONTROL AREA */}
        <div className="flex-1 min-h-0 md:overflow-hidden relative">
          <AnimatePresence mode="wait" initial={false}>

            {/* ── MANUAL CONTROL ── */}
            {(controlMode === "manual" && roverMode === "MANUAL") && (
              <motion.div key="manual"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className={`px-4 py-0 md:h-full md:overflow-x-hidden md:overflow-y-auto flex items-start justify-center`}>
                <div className="your-main-control-container flex flex-col items-center justify-start gap-1 w-full max-w-[600px] lg:max-w-2xl mx-auto py-2 px-1 mt-4 pb-6">
                  
                  {/* TOP ROW: Arm Controls (Left) + Coordinate Controls (Right) */}
                  <div className="flex flex-row items-stretch justify-center gap-3 w-full">
                    {/* LEFT: 5DOF Arm */}
                    <div className="arm-control-section flex-1 min-w-[280px] max-w-[370px] flex flex-col justify-start">
                      <ArmControls
                        joints={joints}
                        setJointAngle={setJointAngle}
                        updateJoint={updateJoint}
                        stepSize={stepSize}
                        setStepSize={setStepSize}
                        applyPreset={applyPreset}
                        editingJoint={editingJoint}
                        setEditingJoint={setEditingJoint}
                        editValue={editValue}
                        setEditValue={setEditValue}
                        commitEdit={commitEdit}
                        startEdit={startEdit}
                        sendArmCommand={sendArmCommand}
                        setActiveJoint={setActiveJoint}
                        setActiveDirection={setActiveArmDirection}
                      />
                    </div>

                    {/* RIGHT: Coordinate Control Panel */}
                    <div className="shrink-0 w-[190px] flex flex-col justify-start">
                      <CoordinateControlPanel 
                        joints={joints} 
                        commandUrl={commandUrl} 
                        onExecuteSequence={handleExecuteSequence}
                      />
                    </div>
                  </div>

                  {/* BOTTOM: Drive D-Pad */}
                  <div className="drive-control-section shrink-0 w-[240px] mt-8 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 rounded-xl p-3 backdrop-blur-md shadow-sm dark:shadow-lg relative">
                    <DPad
                      activeDirection={activeDirection}
                      onPress={handleDirectionPress}
                      onRelease={handleDirectionRelease}
                      onStop={handleStop}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── AI DIRECTIVE ── */}
            {(controlMode === "ai" && roverMode === "AUTONOMOUS") && (
              <motion.div key="ai"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="p-3 overflow-y-auto h-full flex flex-col animate-none">
                <div className="flex flex-col w-full justify-start items-center gap-8 p-4 max-w-full pb-8">
                  {/* TOP SIDE (Controls) */}
                  <div className="flex justify-center items-center">
                    <div className="w-full max-w-md flex flex-col gap-4">
                      <div className="text-center">
                        <div className="text-xs sm:text-sm font-semibold">Offline Text Command</div>
                        <div className="text-xs sm:text-xs text-muted-foreground mt-0.5">
                          Local Keyword Matching (Offline) <code className="font-mono text-xs bg-muted px-1 rounded">ares01/autonomous/action</code>
                        </div>
                      </div>


                      <div className="flex gap-2">
                        <input ref={commandInputRef} type="text" inputMode="text" autoComplete="off"
                          placeholder="e.g., 'Initiate pick up sequence'"
                          value={directiveInput}
                          onChange={e => setDirectiveInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && !(isProcessing || isExecuting) && handleAiDirectiveSubmit()}
                          onClick={() => commandInputRef.current?.focus()}
                          disabled={isProcessing || isExecuting}
                          className="cmd-input flex-1 h-9 rounded-lg border border-input bg-background px-4 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/65 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          data-testid="input-ai-cmd" />
                        <Button onClick={handleAiDirectiveSubmit} data-testid="btn-ai-send" disabled={isProcessing || isExecuting || !directiveInput.trim()}
                          className="h-9 px-4 active:scale-95 transition-transform shrink-0">
                          <Send className="w-4 h-4" />
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-1 justify-center max-h-[48px] overflow-y-auto">
                        {["pick ball", "drop target", "home position"].map(chip => (
                          <button key={chip} onClick={() => setDirectiveInput(chip)}
                            className="text-[10px] px-2.5 py-1 rounded-full border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-all font-medium cursor-pointer">
                            {chip}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {/* BOTTOM SIDE (Logs) */}
                  <div className="w-full max-w-[400px] flex justify-center shrink-0">
                    <div className="flex flex-col shrink-0 w-[400px] h-[260px] bg-muted/5 p-3 rounded-2xl border border-border/50 shadow-sm relative">
                      <div className="flex justify-between items-center mb-1">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          Offline Command Log
                          {activeQueue && (
                            <div className="flex items-center gap-1.5 bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 text-[10px] font-bold">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              <span>STEP {activeQueue.index}/{activeQueue.total}: {activeQueue.command}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between h-4">
                          {isProcessing ? (
                            <div className="flex items-center gap-1 text-[10px] font-mono text-primary font-semibold tracking-wider animate-pulse">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              <span>AI PROCESSING...</span>
                            </div>
                          ) : (
                            <div className="text-[8.5px] font-mono text-muted-foreground">
                              SYSTEM READY
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="relative w-full h-0.5 bg-muted border border-border rounded-full overflow-hidden mb-1.5 shrink-0">
                        {isProcessing && (
                          <div className="absolute inset-y-0 bg-gradient-to-r from-blue-500 via-indigo-500 to-pink-500 w-1/2 rounded-full animate-progress-glow" />
                        )}
                      </div>
                      <div ref={aiLogsContainerRef} className="space-y-1.5 flex-1 overflow-y-auto pr-1 pb-4 bg-[#0a0a0a] text-green-500 font-mono text-xs p-2 rounded-md border border-border/50">
                      <AnimatePresence initial={false}>
                        {aiLogs.map((log, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="w-full text-left break-words whitespace-pre-wrap"
                          >
                            {renderLogLine(log)}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                  </div>
                </div>
              </motion.div>
            )}

            {(controlMode === "voice" && roverMode === "AUTONOMOUS") && (
              <motion.div key="voice"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="p-3 overflow-y-auto h-full flex flex-col animate-none">
                <div className="flex flex-col w-full justify-start items-center gap-8 p-4 max-w-full pb-8">
                  {/* TOP SIDE (Controls) */}
                  <div className="flex justify-center items-center">
                    <div className="w-full sm:w-[420px] max-w-full flex flex-col items-center px-5 pt-4 pb-2 gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl relative overflow-hidden select-none">
                      <div className="flex items-center justify-between w-full border-b border-slate-100 dark:border-slate-800 pb-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">Voice Link</span>
                        <select
                          id="voice-lang"
                          value={voiceLanguage}
                          onChange={e => setVoiceLanguage(e.target.value)}
                          className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer text-slate-800 dark:text-slate-200 font-medium"
                        >
                          <option value="bn-BD">বাংলা</option>
                          <option value="en-US">English</option>
                        </select>
                      </div>


                      {/* Concentric Pulsing Microphone Container */}
                      <div className="relative flex items-center justify-center w-24 h-24 my-2">
                        {/* Concentric glowing rings */}
                        <div className="absolute inset-0 rounded-full bg-indigo-500/5 dark:bg-indigo-400/5 animate-ping pointer-events-none" style={{ animationDuration: '1000ms' }} />
                        <div className="absolute inset-2 rounded-full border border-indigo-400/10 dark:border-indigo-400/5 animate-ping pointer-events-none" style={{ animationDuration: '1500ms', animationDelay: '200ms' }} />
                        <div className="absolute inset-4 rounded-full bg-indigo-500/10 dark:bg-indigo-400/10 animate-ping pointer-events-none" style={{ animationDuration: '2000ms', animationDelay: '400ms' }} />
                        
                        {/* Central Button */}
                        <button
                          id="voice-toggle-btn"
                          onClick={handleVoiceToggle}
                          disabled={isProcessing || isExecuting}
                          className={`relative z-10 w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            isListening 
                              ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/30' 
                              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/30'
                          }`}
                        >
                          <Mic className={`w-6 h-6 ${isListening ? 'animate-pulse' : ''}`} />
                        </button>
                      </div>

                      {/* Horizontal Waveform Skeleton */}
                      <div className="flex items-center justify-center gap-1.5 h-8 w-full max-w-[160px] py-1">
                        <div className={`w-1 rounded-full transition-all duration-300 ${isListening ? 'bg-red-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} style={{ height: isListening ? '12px' : '4px', animationDuration: '0.7s' }} />
                        <div className={`w-1 rounded-full transition-all duration-300 ${isListening ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} style={{ height: isListening ? '24px' : '4px', animationDuration: '1.1s' }} />
                        <div className={`w-1 rounded-full transition-all duration-300 ${isListening ? 'bg-purple-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} style={{ height: isListening ? '18px' : '4px', animationDuration: '0.8s' }} />
                        <div className={`w-1 rounded-full transition-all duration-300 ${isListening ? 'bg-cyan-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} style={{ height: isListening ? '28px' : '4px', animationDuration: '1.3s' }} />
                        <div className={`w-1 rounded-full transition-all duration-300 ${isListening ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} style={{ height: isListening ? '14px' : '4px', animationDuration: '0.9s' }} />
                      </div>
                      
                      {/* Live Transcript Display Box */}
                      <div className="w-full text-center">
                        <p className="text-xs text-slate-500 dark:text-slate-400 italic font-medium" id="voice-transcript-preview">
                          {voiceTranscript ? voiceTranscript : (isListening ? "Listening..." : "Click button to speak")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* BOTTOM SIDE (Logs) */}
                  <div className="w-full max-w-[400px] flex justify-center shrink-0">
                    <div className="flex flex-col shrink-0 w-[400px] h-[260px] bg-muted/5 p-3 rounded-2xl border border-border/50 shadow-sm relative">
                      <div className="flex justify-between items-center mb-1">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Voice Commands Log</div>
                        <div className="flex items-center justify-between h-4">
                          <div className="text-[8.5px] font-mono text-muted-foreground">
                            AUDIO SYSTEM ACTIVE
                          </div>
                        </div>
                      </div>
                      <div className="relative w-full h-0.5 bg-muted border border-border rounded-full overflow-hidden mb-1.5 shrink-0">
                        <div className="absolute inset-y-0 bg-indigo-500/50 w-full rounded-full" />
                      </div>
                      <div ref={voiceLogsContainerRef} className="space-y-1.5 flex-1 overflow-y-auto pr-1 pb-4 bg-[#0a0a0a] text-cyan-400 font-mono text-xs p-2 rounded-md border border-border/50">
                      <AnimatePresence initial={false}>
                        {voiceLogs.map((log, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="w-full text-left break-words whitespace-pre-wrap"
                          >
                            {renderLogLine(log)}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
      </div>
    </div>
  );
}
