import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sun, Moon, Settings, Signal, Battery, ArrowUp, ArrowDown,
  ArrowLeft, ArrowRight, Square, Mic, Send, CheckCircle2, Cpu,
  Thermometer, Zap, Radio, Ruler, Wifi, WifiOff, Loader2,
  Activity, X, RotateCcw, Gamepad2, Bot, AlertTriangle, Database, Camera,
  Monitor, Film
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useInterval } from "@/hooks/use-interval";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";

import { CameraOverlay } from "@/components/CameraOverlay";
import {
  firebaseConfigured,
  setDriveDirection,
  setArmAngles,
  sendAutonomousCommand,
  subscribeTelemetry,
  setMaxSpeed,
  triggerReboot,
  setFirebaseControlMode,
  setFirebaseLanguage,
  writePingRTT,
  type DriveDirection,
  type ArmAngles,
} from "@/lib/firebase";
import { parseCommand, ACTION_LABELS, type ParsedCommand } from "@/lib/commandParser";

// ─── Types & Constants ────────────────────────────────────────────────────────

type RoverConnectionStatus = "disconnected" | "connecting" | "connected";
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

const JOINT_CONFIG = {
  base:     { label: "Base",     color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
  shoulder: { label: "Shoulder", color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
  elbow:    { label: "Elbow",    color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
  wrist:    { label: "Wrist",    color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
  gripper:  { label: "Gripper",  color: "hsl(243, 75%, 59%)", accentClass: "text-primary",   dotClass: "bg-primary"   },
} as const;

const JOINT_ORDER = ["base", "shoulder", "elbow", "wrist", "gripper"] as const;

const ARM_PRESETS = [
  { name: "Home",  joints: { base: 90, shoulder: 90,  elbow: 90,  wrist: 90, gripper: 0   } },
  { name: "Pick",  joints: { base: 90, shoulder: 45,  elbow: 135, wrist: 90, gripper: 180 } },
  { name: "Drop",  joints: { base: 45, shoulder: 60,  elbow: 90,  wrist: 45, gripper: 0   } },
  { name: "Reach", joints: { base: 90, shoulder: 150, elbow: 150, wrist: 90, gripper: 90  } },
];

const DEFAULT_JOINTS: ArmAngles = { base: 90, shoulder: 90, elbow: 90, wrist: 90, gripper: 0 };

// ─── Sub-Components (Memoized to prevent unnecessary re-renders) ───────────────

const getPingColorClass = (pingVal: number | null) => {
  if (pingVal === null) return "text-slate-400 dark:text-slate-500";
  if (pingVal < 60) return "text-emerald-600 dark:text-emerald-400";
  if (pingVal <= 150) return "text-amber-500 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
};

interface HeaderProps {
  roverOnline: boolean;
  fbStatus: "ready" | "not-configured";
  showSettings: boolean;
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>;
  theme: string;
  setTheme: (theme: any) => void;
  ping: number | null;
}

const Header = React.memo(function Header({
  roverOnline,
  fbStatus,
  showSettings,
  setShowSettings,
  theme,
  setTheme,
  ping
}: HeaderProps) {
  return (
    <header className="h-12 border border-border/60 bg-white dark:bg-white/[0.03] backdrop-blur-xl flex items-center justify-between px-5 shrink-0 z-20 shadow-sm dark:shadow-none">
      <div className="flex items-center gap-3">
        <h1 className="font-bold text-base tracking-tight text-gray-900 dark:text-white">
          <img src="/logo.png" alt="ARES-01 Logo" className="h-7 w-auto object-contain mr-3 inline-block transform-gpu" />
          ARES-01
        </h1>
        <span className="text-gray-500 dark:text-gray-400 text-xs font-medium hidden sm:inline">Rover Mission Control</span>
        <Badge
          variant="outline"
          className={`text-[10px] h-5 transition-colors duration-500 ${
            roverOnline
              ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
              : "bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/30"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 transition-colors duration-500 ${roverOnline ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <span className="hidden sm:inline">{roverOnline ? "ROVER ONLINE" : "ROVER OFFLINE"}</span>
          <span className="sm:hidden">{roverOnline ? "ON" : "OFF"}</span>
        </Badge>
        {fbStatus === "not-configured" && (
          <Badge variant="outline" className="text-[10px] h-5 bg-amber-500/10 text-amber-700 dark:text-amber-600 border-amber-500/30 gap-1">
            <Database className="w-2.5 h-2.5" />
            <span className="hidden sm:inline">Firebase not configured</span>
            <span className="sm:hidden">DB Off</span>
          </Badge>
        )}
        {fbStatus === "ready" && (
          <Badge variant="outline" className="text-[10px] h-5 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30 gap-1">
            <Database className="w-2.5 h-2.5" />
            <span className="hidden sm:inline">Firebase live</span>
            <span className="sm:hidden">DB Live</span>
          </Badge>
        )}
        {fbStatus === "ready" && ping !== null && (
          <Badge variant="outline" className="text-[10px] h-5 bg-slate-50 dark:bg-white/5 border-border/30 dark:border-white/5 gap-1.5 font-mono select-none">
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse bg-current ${getPingColorClass(ping)}`} />
            <span className={`${getPingColorClass(ping)}`}>{ping}ms</span>
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1">
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
  fbStatus: "ready" | "not-configured";
  roverOnline: boolean;
  roverIp: string;
  setRoverIp: (val: string) => void;
  streamSrc: string | null;
  streamError: boolean;
  handleConnectCamera: () => void;
  handleDisconnectCamera: () => void;
  wsUrl: string;
  setWsUrl: (val: string) => void;
  roverConnectionStatus: RoverConnectionStatus;
  handleConnectWs: () => void;
  handleDisconnectWs: () => void;
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
  fbStatus,
  roverOnline,
  roverIp,
  setRoverIp,
  streamSrc,
  streamError,
  handleConnectCamera,
  handleDisconnectCamera,
  wsUrl,
  setWsUrl,
  roverConnectionStatus,
  handleConnectWs,
  handleDisconnectWs,
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
                <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-mono">ARES-01 MISSION CONFIGURATION</span>
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
              
              {/* Row 1: Firebase Link & Heartbeat */}
              <div className="flex items-center justify-between py-1.5 border-b border-black/[0.05] dark:border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <Database className="w-4 h-4 text-primary dark:text-primary shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white/90">Firebase Connection</span>
                    <span className="text-[9px] text-slate-500 dark:text-white/40">Realtime database status & active latency</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    variant="outline"
                    className={`text-[9px] h-4.5 font-mono ${
                      fbStatus === "ready"
                        ? "bg-primary/10 text-primary dark:text-primary border-primary/20"
                        : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                    }`}
                  >
                    <span className={`w-1 h-1 rounded-full mr-1 ${fbStatus === "ready" ? "bg-primary dark:bg-primary" : "bg-red-500"}`} />
                    {fbStatus === "ready" ? `Live ${ping !== null ? `(${ping}ms)` : ""}` : "Not Configured"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-[9px] h-4.5 font-mono ${
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
                    <span className="text-[9px] text-slate-500 dark:text-white/40">Active round-trip-time heartbeat check</span>
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
                    <span className="text-[9px] text-slate-500 dark:text-white/40">Wireless signal strength</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] font-mono text-primary/80 uppercase">
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

              {/* Connections (ESP32-CAM and WS) */}
              <div className="space-y-2.5 pt-1">
                <span className="text-[10px] font-bold text-[#A0A0A0] uppercase tracking-wider">Hardware Connections</span>
                
                {/* ESP32-CAM */}
                <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-transparent hover:bg-slate-50 dark:hover:bg-[rgba(255,255,255,0.02)] border border-transparent hover:border-slate-200 dark:hover:border-[#333] transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-900 dark:text-[#E0E0E0]">ESP32-CAM Stream Host</span>
                    {streamSrc && !streamError && (
                      <span className="w-1 h-1 rounded-full bg-slate-400" />
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      className="h-6 text-[10px] bg-slate-100 dark:bg-black/20 text-slate-900 dark:text-[#E0E0E0] font-mono flex-1 border border-slate-200 dark:border-[#333] rounded px-1.5 focus:outline-none focus:border-primary/50"
                      placeholder="192.168.1.100"
                      value={roverIp}
                      onChange={e => setRoverIp(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleConnectCamera()}
                    />
                    {streamSrc ? (
                      <button
                        onClick={handleDisconnectCamera}
                        className="px-2 py-0.5 text-[9px] font-bold rounded border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={handleConnectCamera}
                        disabled={!roverIp.trim()}
                        className="px-2.5 py-0.5 text-[9px] font-bold rounded bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground transition-all cursor-pointer border-0"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                  
                  {/* Modern Camera Configuration Section */}
                  <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-black/5 dark:border-[#333]">
                    <div className="flex-1 flex items-center gap-1.5 bg-slate-100 dark:bg-black/20 rounded-md px-2 py-1 border border-transparent dark:border-[#333]">
                      <select className="bg-transparent text-[10px] text-slate-700 dark:text-[#E0E0E0] font-mono outline-none w-full appearance-none cursor-pointer">
                        <option value="1080p">1080p HD</option>
                        <option value="720p">720p</option>
                        <option value="480p">480p</option>
                      </select>
                    </div>
                    <div className="flex-1 flex items-center gap-1.5 bg-slate-100 dark:bg-black/20 rounded-md px-2 py-1 border border-transparent dark:border-[#333]">
                      <select className="bg-transparent text-[10px] text-slate-700 dark:text-[#E0E0E0] font-mono outline-none w-full appearance-none cursor-pointer">
                        <option value="60">60 FPS</option>
                        <option value="30">30 FPS</option>
                        <option value="15">15 FPS</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* WebSocket */}
                <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-transparent hover:bg-slate-50 dark:hover:bg-[rgba(255,255,255,0.02)] border border-transparent hover:border-slate-200 dark:hover:border-[#333] transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-900 dark:text-[#E0E0E0]">WebSocket Server Endpoint</span>
                    {roverConnectionStatus === "connected" && (
                      <span className="w-1 h-1 rounded-full bg-slate-400" />
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      className="h-6 text-[10px] bg-slate-100 dark:bg-black/20 text-slate-900 dark:text-[#E0E0E0] font-mono flex-1 border border-slate-200 dark:border-[#333] rounded px-1.5 focus:outline-none focus:border-primary/50"
                      placeholder="ws://192.168.1.100:81"
                      value={wsUrl}
                      onChange={e => setWsUrl(e.target.value)}
                    />
                    {roverConnectionStatus === "connected" ? (
                      <button
                        onClick={handleDisconnectWs}
                        className="px-2 py-0.5 text-[9px] font-bold rounded border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={handleConnectWs}
                        disabled={roverConnectionStatus === "connecting"}
                        className="px-2.5 py-0.5 text-[9px] font-bold rounded bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground transition-all cursor-pointer border-0"
                      >
                        {roverConnectionStatus === "connecting" ? "Connecting..." : "Connect"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 4: ESP32 Firmware reboot */}
              <div className="flex items-center justify-between py-2 border-t border-black/10 dark:border-[#333] mt-1 shrink-0">
                <div className="flex items-center gap-2.5">
                  <RotateCcw className="w-4 h-4 text-[#A0A0A0] shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-900 dark:text-[#E0E0E0]">Firmware Restart</span>
                    <span className="text-[9px] text-[#A0A0A0]">Remote soft-reboot trigger for ESP32</span>
                  </div>
                </div>
                <button
                  onClick={handleReboot}
                  disabled={rebooting}
                  className="px-3 py-1.5 text-[9px] font-bold rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary dark:text-primary hover:text-primary/90 disabled:opacity-50 transition-all flex items-center justify-center cursor-pointer shadow-sm min-w-[90px]"
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
  solar: number | undefined;
  distance: number | undefined;
  setStreamError: React.Dispatch<React.SetStateAction<boolean>>;
}

const CameraView = React.memo(function CameraView({
  streamSrc,
  streamError,
  rssi,
  solar,
  distance,
  setStreamError
}: CameraViewProps) {
  return (
    <div
      className="w-full h-full relative bg-black/60 backdrop-blur-md overflow-hidden flex items-center justify-center pointer-events-none select-none"
      style={{
        transform: "translate3d(0, 0, 0)",
        willChange: "transform"
      }}
    >
      {streamSrc && !streamError ? (
        <img
          src={streamSrc}
          alt="ARES-01 live feed"
          className="w-full h-full object-cover transform-gpu translate-z-0 will-change-transform pointer-events-none select-none"
          onError={() => {
            setStreamError(true);
            console.warn(`[ARES-01] Camera stream error at ${streamSrc}`);
          }}
          data-testid="camera-feed"
        />
      ) : (
        <>
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
                <AlertTriangle className="w-8 h-8 text-red-400/60" />
                <span className="text-red-400/60 font-mono text-sm">STREAM UNREACHABLE</span>
                <span className="text-white/20 font-mono text-xs">{streamSrc}</span>
              </>
            ) : (
              <>
                <span className="text-white/15 font-mono text-xl tracking-widest select-none">FEED — ESP32-CAM</span>
                <span className="text-white/10 font-mono text-xs">Enter rover IP in Settings to connect</span>
              </>
            )}
          </div>
        </>
      )}
      <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
        <div className={`flex items-center gap-1.5 bg-black/55 backdrop-blur-md border border-white/10 rounded-md px-2.5 py-1 transition-all duration-500 ${streamSrc && !streamError ? "border-green-500/30" : ""}`}>
          <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${streamSrc && !streamError ? "bg-green-400 animate-pulse" : "bg-white/30"}`} />
          <span className="text-white text-[11px] font-medium">{streamSrc && !streamError ? "Live" : "No Signal"}</span>
        </div>
      </div>
      <div className="absolute top-3 right-3 flex items-center gap-2 pointer-events-none">
        {rssi !== undefined && (
          <div className="flex items-center gap-1.5 bg-black/55 backdrop-blur-md border border-white/10 rounded-md px-2.5 py-1">
            <Signal className="w-3 h-3 text-white/70" />
            <span className="text-white/80 font-mono text-[11px]">{rssi} dBm</span>
          </div>
        )}
        {solar !== undefined && (
          <div className="flex items-center gap-1.5 bg-black/55 backdrop-blur-md border border-white/10 rounded-md px-2.5 py-1">
            <Zap className="w-3 h-3 text-yellow-400" />
            <span className="text-white/80 font-mono text-[11px]">{solar.toFixed(1)}V</span>
          </div>
        )}
        {distance !== undefined && (
          <div className="flex items-center gap-1.5 bg-black/55 backdrop-blur-md border border-white/10 rounded-md px-2.5 py-1">
            <Ruler className="w-3 h-3 text-blue-400" />
            <span className="text-white/80 font-mono text-[11px]">{distance} cm</span>
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
    return `w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center cursor-pointer transition-all duration-300 ${
      isActive
        ? "scale-90 bg-primary border-2 border-primary text-primary-foreground shadow-inner shadow-black/30 ring-4 ring-primary/30 rounded-xl neon-glow-cyan"
        : "border-2 border-slate-300 shadow-[0_3px_10px_rgba(0,0,0,0.03)] bg-white hover:border-primary hover:bg-slate-50 text-slate-800 rounded-xl dark:border-white/10 dark:bg-transparent dark:text-white dark:hover:border-primary/50 dark:hover:text-primary"
    }`;
  };

  return (
    <div className="flex flex-col items-center justify-between h-full w-full py-1">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mt-1">Drive Controls</div>
      <div className="flex flex-col items-center gap-2 select-none mb-1">
        <button
          className={getButtonClass("forward")}
          onMouseDown={() => onPress("forward")} onMouseUp={onRelease} onMouseLeave={onRelease}
          onTouchStart={e => { e.preventDefault(); onPress("forward"); }} onTouchEnd={onRelease}
          data-testid="btn-move-fwd">
          <ArrowUp className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
        <div className="flex gap-2">
          <button
            className={getButtonClass("left")}
            onMouseDown={() => onPress("left")} onMouseUp={onRelease} onMouseLeave={onRelease}
            onTouchStart={e => { e.preventDefault(); onPress("left"); }} onTouchEnd={onRelease}
            data-testid="btn-move-left">
            <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
          <button
            className={`w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center cursor-pointer transition-all duration-300 ${
              activeDirection === "stop"
                ? "scale-90 bg-destructive border-2 border-destructive text-destructive-foreground shadow-inner shadow-black/30 ring-4 ring-destructive/30 rounded-xl neon-glow-violet"
                : "border-2 border-slate-300 shadow-[0_3px_10px_rgba(0,0,0,0.03)] bg-white hover:border-destructive hover:bg-slate-50 text-destructive rounded-xl dark:border-white/10 dark:bg-transparent dark:text-destructive dark:hover:border-destructive/50"
            }`}
            onClick={onStop} data-testid="btn-move-stop">
            <Square className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
          </button>
          <button
            className={getButtonClass("right")}
            onMouseDown={() => onPress("right")} onMouseUp={onRelease} onMouseLeave={onRelease}
            onTouchStart={e => { e.preventDefault(); onPress("right"); }} onTouchEnd={onRelease}
            data-testid="btn-move-right">
            <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>
        <button
          className={getButtonClass("backward")}
          onMouseDown={() => onPress("backward")} onMouseUp={onRelease} onMouseLeave={onRelease}
          onTouchStart={e => { e.preventDefault(); onPress("backward"); }} onTouchEnd={onRelease}
          data-testid="btn-move-back">
          <ArrowDown className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
        <div className="h-4">
          <AnimatePresence>
            {activeDirection && (
              <motion.span key={activeDirection} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-[10px] font-mono font-semibold text-primary uppercase tracking-widest" data-testid="text-active-direction">
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
  joints: ArmAngles;
  setJointAngle: (joint: keyof ArmAngles, raw: number) => void;
  updateJoint: (joint: keyof ArmAngles, delta: number) => void;
  stepSize: 1 | 5 | 15;
  setStepSize: React.Dispatch<React.SetStateAction<1 | 5 | 15>>;
  applyPreset: (p: typeof ARM_PRESETS[0]) => void;
  handleResetArm: () => void;
  editingJoint: keyof ArmAngles | null;
  setEditingJoint: React.Dispatch<React.SetStateAction<keyof ArmAngles | null>>;
  editValue: string;
  setEditValue: React.Dispatch<React.SetStateAction<string>>;
  commitEdit: (j: keyof ArmAngles) => void;
  startEdit: (j: keyof ArmAngles, v: number) => void;
}

const ArmControls = React.memo(function ArmControls({
  joints,
  setJointAngle,
  updateJoint,
  stepSize,
  setStepSize,
  applyPreset,
  handleResetArm,
  editingJoint,
  setEditingJoint,
  editValue,
  setEditValue,
  commitEdit,
  startEdit
}: ArmControlsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid background
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    for (let x = 10; x < canvas.width; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 10; y < canvas.height; y += 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Geometry parameters (scaled to fit nicely in 150x110)
    const x0 = canvas.width / 2; // base center x
    const y0 = canvas.height - 12; // base center y
    const L1 = 28; // Shoulder length
    const L2 = 24; // Elbow length
    const L3 = 16; // Wrist length

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

    // Draw rotating base disk
    ctx.fillStyle = JOINT_CONFIG.base.color;
    ctx.beginPath();
    ctx.ellipse(x0, y0, 20 + 5 * Math.sin(baseAngleRad), 6, 0, 0, 2 * Math.PI);
    ctx.fill();

    // Pedestal stem
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y0 + 10);
    ctx.stroke();

    // Draw Links (bones)
    ctx.shadowBlur = 4;
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";

    // Link 1 (Shoulder)
    ctx.strokeStyle = JOINT_CONFIG.shoulder.color;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // Link 2 (Elbow)
    ctx.strokeStyle = JOINT_CONFIG.elbow.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Link 3 (Wrist)
    ctx.strokeStyle = JOINT_CONFIG.wrist.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Draw Gripper Claws
    const gripVal = joints.gripper;
    const clawSpread = (gripVal / 180) * 0.5 + 0.15; // claw angular spread in rad
    const clawLen = 8;
    
    // Left claw finger
    const lfAngle = wrAngleAbsRad - clawSpread;
    const xLf = x3 + clawLen * Math.cos(lfAngle);
    const yLf = y3 - clawLen * Math.sin(lfAngle);
    ctx.strokeStyle = JOINT_CONFIG.gripper.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x3, y3);
    ctx.lineTo(xLf, yLf);
    ctx.stroke();

    // Right claw finger
    const rfAngle = wrAngleAbsRad + clawSpread;
    const xRf = x3 + clawLen * Math.cos(rfAngle);
    const yRf = y3 - clawLen * Math.sin(rfAngle);
    ctx.beginPath();
    ctx.moveTo(x3, y3);
    ctx.lineTo(xRf, yRf);
    ctx.stroke();

    // Draw Joint Node dots
    const drawJointNode = (x: number, y: number, color: string, r: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };

    drawJointNode(x0, y0, JOINT_CONFIG.base.color, 4);
    drawJointNode(x1, y1, JOINT_CONFIG.shoulder.color, 4);
    drawJointNode(x2, y2, JOINT_CONFIG.elbow.color, 4);
    drawJointNode(x3, y3, JOINT_CONFIG.wrist.color, 3.5);
  }, [joints]);

  return (
    <div className="arm-controls-wrapper flex flex-col gap-1.5 py-0.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">5DOF Arm Control</div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md overflow-hidden border border-border text-[10px] font-mono">
            {([1, 5, 15] as const).map(s => (
              <button key={s} onClick={() => setStepSize(s)}
                className={`px-2 py-0.5 transition-colors ${stepSize === s ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                data-testid={`btn-step-${s}`}>{s}°</button>
            ))}
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleResetArm} data-testid="btn-arm-reset">
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="arm-presets-grid grid grid-cols-4 gap-2 px-1 pb-1">
        {ARM_PRESETS.map(p => {
          const isActive = joints.base === p.joints.base && joints.shoulder === p.joints.shoulder && joints.elbow === p.joints.elbow && joints.wrist === p.joints.wrist && joints.gripper === p.joints.gripper;
          return (
            <button key={p.name} onClick={() => applyPreset(p)}
              className={`text-[11px] py-1.5 px-1 rounded-md border transition-all font-semibold cursor-pointer active:scale-95 shadow-sm ${
                isActive 
                  ? "bg-primary text-primary-foreground border-primary shadow-[0_0_8px_rgba(var(--primary),0.5)]" 
                  : "bg-slate-100 dark:bg-white/5 border-slate-300 dark:border-white/20 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 hover:border-primary dark:hover:border-primary hover:text-primary dark:hover:text-primary"
              }`}
              data-testid={`btn-preset-${p.name.toLowerCase()}`}>{p.name}</button>
          );
        })}
      </div>

      <div className="arm-canvas-sliders-flex flex flex-col md:flex-row gap-4 md:gap-2 items-center bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 md:p-1.5 md:py-2 w-full font-sans backdrop-blur-md shadow-lg">
        <div className="arm-canvas-wrapper relative w-[130px] h-[80px] rounded-lg border border-white/10 bg-black/40 overflow-hidden shrink-0 flex items-center justify-center shadow-inner">
          <canvas ref={canvasRef} width={130} height={80} className="w-full h-full block" />
        </div>

        <div className="arm-sliders-container flex-1 w-full space-y-2 md:space-y-0.5">
          {JOINT_ORDER.map(key => {
            const cfg = JOINT_CONFIG[key];
            const value = joints[key];
            return (
              <div key={key} className="arm-slider-row flex flex-col md:flex-row md:items-center gap-1 md:gap-1.5 py-1 md:py-0 border-b border-white/[0.03] md:border-0 pb-1.5 md:pb-0">
                {/* Mobile label and value row */}
                <div className="arm-slider-label-row flex items-center justify-between md:w-[70px] shrink-0">
                  <div className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dotClass}`} />
                    <span className="text-xs font-semibold text-muted-foreground truncate">{cfg.label}</span>
                  </div>
                  {/* Show value on right side on mobile */}
                  <span className={`text-xs font-mono font-bold md:hidden ${cfg.accentClass}`}>{value}°</span>
                </div>
                
                {/* Control Row: Dec button, Slider, Inc button, Desktop Value */}
                <div className="arm-slider-control-row flex items-center gap-2 flex-1 w-full relative">
                  <button onClick={() => updateJoint(key, -stepSize)}
                    className="h-6 w-6 md:h-5 md:w-5 shrink-0 rounded border border-white/10 flex items-center justify-center text-xs md:text-[10px] bg-white/5 hover:bg-white/10 hover:border-white/20 active:scale-90 transition-all font-semibold cursor-pointer text-foreground select-none"
                    data-testid={`btn-arm-${key}-dec`}>−</button>
                  
                  <div className="relative flex-1 group flex items-center h-full">
                    {/* Floating Badge */}
                    <div className="absolute -top-7 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none select-none z-10" style={{ left: `calc(${(value / 180) * 100}%)` }}>
                       <div className="px-1.5 py-0.5 rounded-md bg-slate-900 dark:bg-black/80 border border-white/10 text-[9px] font-mono text-white shadow-[0_0_10px_rgba(0,0,0,0.5)] backdrop-blur-md">
                          {value}°
                       </div>
                       <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-white/10 absolute -bottom-[4px] left-1/2 transform -translate-x-1/2" />
                    </div>
                    
                    <input type="range" min={0} max={180} value={value}
                      onChange={e => setJointAngle(key, Number(e.target.value))}
                      className="joint-slider w-full h-1 md:h-1 cursor-pointer"
                      style={{ color: cfg.color }}
                      data-testid={`slider-arm-${key}`} />
                  </div>

                  <button onClick={() => updateJoint(key, stepSize)}
                    className="h-6 w-6 md:h-5 md:w-5 shrink-0 rounded border border-white/10 flex items-center justify-center text-xs md:text-[10px] bg-white/5 hover:bg-white/10 hover:border-white/20 active:scale-90 transition-all font-semibold cursor-pointer text-foreground select-none"
                    data-testid={`btn-arm-${key}-inc`}>+</button>
                  
                  {/* Desktop value editor / viewer */}
                  <div className="hidden md:block w-10 text-right">
                    {editingJoint === key ? (
                       <input type="number" min={0} max={180} value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(key)}
                        onKeyDown={e => { if (e.key === "Enter") commitEdit(key); if (e.key === "Escape") setEditingJoint(null); }}
                        className="w-10 text-right font-mono text-[10px] border border-primary rounded px-0.5 py-0.5 bg-background focus:outline-none"
                        autoFocus data-testid={`input-arm-${key}-direct`} />
                    ) : (
                      <button onClick={() => startEdit(key, value)}
                        className={`w-10 text-right text-xs font-mono font-bold tabular-nums hover:underline cursor-text shrink-0 ${cfg.accentClass}`}
                        data-testid={`btn-arm-${key}-value`}>{value}°</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <button
        className="arm-reset-bottom w-full mt-1 text-xs gap-1.5 h-7 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-all flex items-center justify-center cursor-pointer shadow-md active:scale-98"
        onClick={handleResetArm}
        data-testid="btn-arm-reset-bottom"
      >
        <RotateCcw className="w-3 h-3" />
        Reset Arm to Home
      </button>
    </div>
  );
});


// ─── Main Dashboard ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { theme, setTheme } = useTheme();

  const [isRecording, setIsRecording] = useState(false);
  const handleCapturePhoto = useCallback(() => {
    console.log(`${LOG} Capturing photo...`);
  }, []);
  const handleRecordVideo = useCallback(() => {
    setIsRecording(prev => !prev);
    console.log(`${LOG} Toggling recording...`);
  }, []);

  // ── Live telemetry from Firebase
  const [liveTelemetry, setLiveTelemetry] = useState<{
    distance?: number; solar?: number; motor_temp?: number; rssi?: number;
    batteryPercent?: number; batteryVoltage?: number;
  }>({});

  const distance  = liveTelemetry.distance;
  const solar     = liveTelemetry.solar;
  const motorTemp = liveTelemetry.motor_temp;
  const rssi      = liveTelemetry.rssi;

  // ── System configuration settings (dynamic Firebase bindings)
  const [maxSpeed, setMaxSpeedState] = useState<number>(80); // Default speed limit
  const [rebooting, setRebooting] = useState(false);

  const handleMaxSpeedChange = useCallback(async (speed: number) => {
    setMaxSpeedState(speed);
    await setMaxSpeed(speed);
  }, []);

  const handleReboot = useCallback(async () => {
    setRebooting(true);
    await triggerReboot();
    setTimeout(() => {
      setRebooting(false);
    }, 4000);
  }, []);

  // ── Rover heartbeat / Firebase connection
  const [roverOnline, setRoverOnline] = useState(false);
  const [fbStatus] = useState<"ready" | "not-configured">(
    firebaseConfigured ? "ready" : "not-configured"
  );

  useEffect(() => {
    if (!firebaseConfigured) return;
    const unsub = subscribeTelemetry(
      data => setLiveTelemetry(prev => ({ ...prev, ...data })),
      online => setRoverOnline(online)
    );
    return unsub;
  }, []);

  // ── Control Mode
  const [controlMode, setControlModeState] = useState<ControlMode>("manual");
  const setControlMode = useCallback(async (mode: ControlMode) => {
    setControlModeState(mode);
    await setFirebaseControlMode(mode);
  }, []);

  // ── D-Pad
  const [activeDirection, setActiveDirection] = useState<Direction | null>(null);

  const handleDirectionPress = useCallback((dir: Direction) => {
    setActiveDirection(dir);
    const fbDir = dir.toUpperCase() as DriveDirection;
    console.log(`${LOG} Drive: ${fbDir}`);
    setDriveDirection(fbDir);
  }, []);

  const handleDirectionRelease = useCallback(() => {
    setActiveDirection(null);
    console.log(`${LOG} Drive: STOP`);
    setDriveDirection("STOP");
  }, []);

  const handleStop = useCallback(() => {
    setActiveDirection(null);
    console.log(`${LOG} Drive: STOP (manual)`);
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
      let fbDir: DriveDirection;
      switch (key) {
        case "PageUp":
        case "ArrowUp":
        case "w":
        case "W":
          dir = "forward";
          fbDir = "FORWARD";
          break;
        case "PageDown":
        case "ArrowDown":
        case "s":
        case "S":
          dir = "backward";
          fbDir = "BACKWARD";
          break;
        case "Home":
        case "ArrowLeft":
        case "a":
        case "A":
          dir = "left";
          fbDir = "LEFT";
          break;
        case "End":
        case "ArrowRight":
        case "d":
        case "D":
          dir = "right";
          fbDir = "RIGHT";
          break;
        case " ":
          dir = "stop";
          fbDir = "STOP";
          break;
        default:
          return;
      }

      setActiveDirection(dir);
      console.log(`${LOG} Keyboard Drive: ${fbDir}`);
      setDriveDirection(fbDir);
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
          setActiveDirection(null);
          console.log(`${LOG} Keyboard Drive: STOP`);
          setDriveDirection("STOP");
        } else {
          // Transition to the next remaining active key
          const remainingKeys = Array.from(activeKeysRef.current);
          const nextKey = remainingKeys[remainingKeys.length - 1];
          let dir: Direction;
          let fbDir: DriveDirection;
          switch (nextKey) {
            case "PageUp":
            case "ArrowUp":
            case "w":
            case "W":
              dir = "forward";
              fbDir = "FORWARD";
              break;
            case "PageDown":
            case "ArrowDown":
            case "s":
            case "S":
              dir = "backward";
              fbDir = "BACKWARD";
              break;
            case "Home":
            case "ArrowLeft":
            case "a":
            case "A":
              dir = "left";
              fbDir = "LEFT";
              break;
            case "End":
            case "ArrowRight":
            case "d":
            case "D":
              dir = "right";
              fbDir = "RIGHT";
              break;
            case " ":
              dir = "stop";
              fbDir = "STOP";
              break;
            default:
              return;
          }
          setActiveDirection(dir);
          setDriveDirection(fbDir);
        }
      }
    };

    const handleBlur = () => {
      if (activeKeysRef.current.size > 0) {
        activeKeysRef.current.clear();
        setActiveDirection(null);
        console.log(`${LOG} Keyboard Drive: STOP (window blur)`);
        setDriveDirection("STOP");
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
  const [joints, setJoints] = useState<ArmAngles>(DEFAULT_JOINTS);
  const resetAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateJoint = useCallback((joint: keyof ArmAngles, delta: number) => {
    setJoints(prev => {
      const next = { ...prev, [joint]: Math.max(0, Math.min(180, prev[joint] + delta)) };
      console.log(`${LOG} Arm: ${joint} → ${next[joint]}°`);
      setArmAngles(next);
      return next;
    });
  }, []);

  const setJointAngle = useCallback((joint: keyof ArmAngles, raw: number) => {
    const val = Math.max(0, Math.min(180, raw));
    setJoints(prev => {
      const next = { ...prev, [joint]: val };
      setArmAngles(next);
      return next;
    });
  }, []);

  const animateJointsTo = useCallback((target: ArmAngles, label: string) => {
    if (resetAnimRef.current) clearInterval(resetAnimRef.current);
    console.log(`${LOG} Arm → ${label}`);
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
        setArmAngles(next); // final write to Firebase
      }
    }, 16);
  }, [joints]);

  const handleResetArm = useCallback(() => animateJointsTo(DEFAULT_JOINTS, "Home (reset)"), [animateJointsTo]);
  const applyPreset = useCallback((p: typeof ARM_PRESETS[0]) => animateJointsTo(p.joints, `Preset: ${p.name}`), [animateJointsTo]);

  const [stepSize, setStepSize] = useState<1 | 5 | 15>(5);
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
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<LogMessage[]>([
    { id: 1, sender: "user", text: "Move forward 2 meters and scan for obstacles", action: "FORWARD → SCAN", time: "10:42:15 AM", status: "ok" },
    { id: 2, sender: "system", text: "ARES-01: Position updated (+2.0m). Executing YOLOv8 environment scan.", time: "10:42:16 AM", status: "ok" },
    { id: 3, sender: "user", text: "Rotate base 45 degrees left", action: "ROTATE → LEFT", time: "10:40:02 AM", status: "ok" },
    { id: 4, sender: "system", text: "ARES-01: Base rotated 45° CCW. Servo torque nominal.", time: "10:40:03 AM", status: "ok" },
  ]);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const getSystemResponse = (action: string, commandText: string): string => {
    const upper = action.toUpperCase();
    if (upper.includes("FORWARD")) return "ARES-01: Initiating forward propulsion. Speed set to nominal.";
    if (upper.includes("BACKWARD")) return "ARES-01: Reversing drivetrain. Rear sonar alert check enabled.";
    if (upper.includes("LEFT")) return "ARES-01: Executing counter-clockwise turn. Monitoring yaw rates.";
    if (upper.includes("RIGHT")) return "ARES-01: Executing clockwise turn. Monitoring yaw rates.";
    if (upper.includes("STOP")) return "ARES-01: Emergency stop command processed. Drivetrain locked.";
    if (upper.includes("ARM") || upper.includes("PICK") || upper.includes("DROP")) return "ARES-01: Actuating robotic arm servos. Maintaining payload stability.";
    if (upper.includes("SCAN")) return "ARES-01: Running environmental scan via camera. Parsing object data.";
    return `ARES-01: Command "${commandText}" received. Action: ${action || "UNKNOWN"}. Status: Nominal.`;
  };

  const handleSendCommand = useCallback(async () => {
    if (!command.trim()) return;
    const cmdText = command;
    setCommand("");

    // Auto detect language: Bengali characters reside in range \u0980 to \u09FF
    const isBengali = /[\u0980-\u09FF]/.test(cmdText);
    const detectedLang = isBengali ? "bn" : "en";

    const result = parseCommand(cmdText);
    const label = ACTION_LABELS[result.action];
    console.log(`${LOG} AI Command [Auto-Detect: ${detectedLang}]: "${cmdText}" → ${result.action} (${result.confidence})`);

    const userMsg: LogMessage = {
      id: Date.now(),
      sender: "user",
      text: cmdText,
      action: `${result.action} — ${label}`,
      time: new Date().toLocaleTimeString(),
      status: result.action === "UNKNOWN" ? "warn" : "ok",
    };

    setHistory(prev => [userMsg, ...prev].slice(0, 10));
    setIsProcessing(true);

    try {
      const isDriveAction = ["FORWARD", "BACKWARD", "LEFT", "RIGHT", "STOP"].includes(result.action);
      if (isDriveAction) {
        await setDriveDirection(result.action as DriveDirection);
      } else {
        await sendAutonomousCommand({
          command: result.action,
          raw: cmdText,
          language: detectedLang,
          timestamp: Date.now(),
        });
      }

      // Simulate system response after 800ms
      setTimeout(() => {
        const sysMsg: LogMessage = {
          id: Date.now() + 1,
          sender: "system",
          text: getSystemResponse(result.action, cmdText),
          time: new Date().toLocaleTimeString(),
          status: "ok",
        };
        setHistory(prev => [sysMsg, ...prev].slice(0, 10));
        setIsProcessing(false);
      }, 800);

    } catch (err) {
      console.warn("[ARES-01] Error sending command:", err);
      setIsProcessing(false);
    }
  }, [command]);

  // ── Voice
  const [isListening, setIsListening] = useState(false);
  const [voiceLanguage, setVoiceLanguageState] = useState("bn-BD");
  const setVoiceLanguage = useCallback(async (lang: string) => {
    setVoiceLanguageState(lang);
    await setFirebaseLanguage(lang);
  }, []);
  const recognitionRef = useRef<any | null>(null);
  const isVoiceProcessingRef = useRef(false);
  const shouldListenRef = useRef(false);

  const parseAndRouteVoiceCommand = useCallback(async (command: string) => {
    console.log("ARES-01 NLP Parsing Command: ", command);
    const lower = command.toLowerCase();

    // Auto detect language: Bengali characters reside in range \u0980 to \u09FF
    const isBengali = /[\u0980-\u09FF]/.test(command);
    const detectedLang = isBengali ? "bn" : "en";

    // Map command result to history log
    let mappedAction: ParsedCommand = "UNKNOWN";
    let statusOk = false;

    // Case 1: FORWARD COMMAND
    if (lower.includes("সামনে যাও") || lower.includes("go forward") || lower.includes("সামনে")) {
      await setDriveDirection("FORWARD");
      mappedAction = "FORWARD";
      statusOk = true;
    }
    // Case 2: BACKWARD COMMAND
    else if (lower.includes("পেছনে যাও") || lower.includes("go backward") || lower.includes("পিছনে যাও")) {
      await setDriveDirection("BACKWARD");
      mappedAction = "BACKWARD";
      statusOk = true;
    }
    // Case 3: AUTONOMOUS MACRO (PICK BALL)
    else if (lower.includes("হাত তোলো") || lower.includes("pick ball") || lower.includes("বল তোলো")) {
      await sendAutonomousCommand({
        command: "PICK_BALL",
        action: "PICK_BALL",
        raw: command,
        language: detectedLang,
        timestamp: Date.now()
      });
      mappedAction = "PICK_BALL";
      statusOk = true;
    }
    // Case 4: EMERGENCY STOP MAPPING
    else if (lower.includes("থামো") || lower.includes("stop") || lower.includes("ব্রেক")) {
      await setDriveDirection("STOP");
      mappedAction = "STOP";
      statusOk = true;
    }
    // Fallback case: General NLP ingestion for unstructured entries
    else {
      await sendAutonomousCommand({
        command: "UNSTRUCTURED_DIRECTIVE",
        action: "UNSTRUCTURED_DIRECTIVE",
        raw: command,
        language: detectedLang,
        timestamp: Date.now()
      });
      mappedAction = "UNKNOWN";
      statusOk = false;
    }

    const label = ACTION_LABELS[mappedAction] || "Direct Command";

    // Add to history log for visual dialogue bubbles
    const userMsg: LogMessage = {
      id: Date.now(),
      sender: "user",
      text: command,
      action: `${mappedAction} — ${label}`,
      time: new Date().toLocaleTimeString(),
      status: statusOk ? "ok" : "warn",
    };
    setHistory(prev => [userMsg, ...prev].slice(0, 10));
    setIsProcessing(true);

    // Simulate system response after 800ms
    setTimeout(() => {
      const sysMsg: LogMessage = {
        id: Date.now() + 1,
        sender: "system",
        text: getSystemResponse(mappedAction, command),
        time: new Date().toLocaleTimeString(),
        status: "ok",
      };
      setHistory(prev => [sysMsg, ...prev].slice(0, 10));
      setIsProcessing(false);
    }, 800);

  }, []);

  useEffect(() => {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = false; // Disable infinite background loops
      recognition.interimResults = false; // Set to false to prevent half-sentence processing
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        if (isVoiceProcessingRef.current) return; // Guard clause against double processing
        
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        
        // Sanitize input data
        const commandText = finalTranscript.trim().toLowerCase();
        if (!commandText) return;

        // Render processed transcript preview in UI
        const previewBox = document.getElementById('voice-transcript-preview');
        if (previewBox) {
          previewBox.innerText = `Executing: "${finalTranscript}"`;
        }

        // Activate 2-Second Cooldown Anti-Duplicate Lock
        isVoiceProcessingRef.current = true;

        // Execute NLP Mapping and Firebase Node Synchronization
        parseAndRouteVoiceCommand(commandText);

        // Release lock safely after cooldown expiration
        setTimeout(() => {
          isVoiceProcessingRef.current = false;
          if (previewBox) {
            previewBox.innerText = "Click button to speak";
          }
        }, COOLDOWN_TIME);
      };

      recognition.onerror = (err: any) => {
        console.warn(`${LOG} Speech recognition error:`, err);
        isVoiceProcessingRef.current = false;
        if (err.error === 'not-allowed' || err.error === 'service-not-allowed') {
          shouldListenRef.current = false;
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        if (shouldListenRef.current) {
          try {
            recognition.start();
          } catch (e) {
            console.error(`${LOG} Auto-reconnect failed:`, e);
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
  }, [parseAndRouteVoiceCommand]);

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
      } catch (e) {
        shouldListenRef.current = false;
        console.error("Speech recognition start failed:", e);
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

  // ── Camera Stream
  const [roverIp, setRoverIp] = useState("");
  const [streamSrc, setStreamSrc] = useState<string | null>(null);
  const [streamError, setStreamError] = useState(false);

  const handleConnectCamera = useCallback(() => {
    if (!roverIp.trim()) return;
    
    let url = roverIp.trim();
    let finalUrl = "";
    
    if (url.startsWith("http://") || url.startsWith("https://")) {
      // Rule 1: Starts with protocol, use exactly as inputted
      finalUrl = url;
    } else if (url.includes("/")) {
      // Rule 2: Contains a slash (custom path), prepend http:// but keep path intact
      finalUrl = `http://${url}`;
    } else {
      // Default: Plain host/IP, prepend http:// and append /stream
      finalUrl = `http://${url}/stream`;
    }
    
    // Cache bust to prevent shared image cache pool accumulation
    const separator = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${separator}cb=${Date.now()}`;
    
    console.log(`${LOG} Connecting camera stream: ${finalUrl}`);
    setStreamError(false);
    setStreamSrc(finalUrl);
  }, [roverIp]);

  const handleDisconnectCamera = useCallback(() => {
    setStreamSrc(null);
    setStreamError(false);
    console.log(`${LOG} Camera stream disconnected`);
  }, []);

  // ── Settings Panel state
  const [showSettings, setShowSettings] = useState(false);
  const [roverConnectionStatus, setRoverConnectionStatus] = useState<RoverConnectionStatus>("disconnected");
  const [ping, setPing] = useState<number | null>(null);
  const [wsUrl, setWsUrl] = useState("");

  // ── Network RTT Ping checker (Runs every 3 seconds to measure Firebase latency, fallback to simulation if not configured)
  useEffect(() => {
    let active = true;
    let timerId: ReturnType<typeof setInterval> | null = null;

    const performPingCheck = async () => {
      if (!active) return;
      const startTime = Date.now();
      if (firebaseConfigured) {
        try {
          // Race the Firebase node set write with a 2.5s safety timeout
          await Promise.race([
            writePingRTT(startTime),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2500))
          ]);
          if (active) {
            const rtt = Date.now() - startTime;
            setPing(rtt);
          }
        } catch (err) {
          console.warn("[ARES-01] Firebase RTT check failed:", err);
          if (active) {
            setPing(null);
          }
        }
      } else {
        // Fallback simulation: random latency between 20-55ms
        if (active) {
          const simPing = Math.floor(18 + Math.random() * 32);
          setPing(simPing);
        }
      }
    };

    // Run first check immediately, then every 3 seconds
    performPingCheck();
    timerId = setInterval(performPingCheck, 3000);

    return () => {
      active = false;
      if (timerId) clearInterval(timerId);
    };
  }, []);

  const handleConnectWs = useCallback(() => {
    console.log(`${LOG} Connecting WebSocket → ${wsUrl || "<no url>"}`);
    setRoverConnectionStatus("connecting");
    setTimeout(() => {
      setRoverConnectionStatus("connected");
      console.log(`${LOG} WebSocket connected`);
    }, 2000);
  }, [wsUrl]);

  const handleDisconnectWs = useCallback(() => {
    setRoverConnectionStatus("disconnected");
    console.log(`${LOG} WebSocket disconnected`);
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen md:h-dvh w-screen bg-background text-foreground flex flex-col font-sans overflow-y-auto md:overflow-hidden justify-between">
      
      {/* Header */}
      <Header
        roverOnline={roverOnline}
        fbStatus={fbStatus}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        theme={theme}
        setTheme={setTheme}
        ping={ping}
      />

      {/* Settings / Connection Panel */}
      <SettingsPanel
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        fbStatus={fbStatus}
        roverOnline={roverOnline}
        roverIp={roverIp}
        setRoverIp={setRoverIp}
        streamSrc={streamSrc}
        streamError={streamError}
        handleConnectCamera={handleConnectCamera}
        handleDisconnectCamera={handleDisconnectCamera}
        wsUrl={wsUrl}
        setWsUrl={setWsUrl}
        roverConnectionStatus={roverConnectionStatus}
        handleConnectWs={handleConnectWs}
        handleDisconnectWs={handleDisconnectWs}
        ping={ping}
        rebooting={rebooting}
        handleReboot={handleReboot}
        rssi={rssi}
      />

      {/* Camera View Section (Top - Max 48dvh Viewport Height Budget) */}
      {/* Camera View Section (Top - Max 48dvh Viewport Height Budget) */}
      <div className="w-full gemini-bg flex justify-center items-center shrink-0 border-b border-border/40 relative overflow-hidden py-1 sm:py-1.5 z-10">
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
            0% { left: -50%; }
            100% { left: 100%; }
          }
          .animate-progress-glow {
            position: absolute;
            height: 100%;
            animation: progressGlow 1.2s linear infinite;
          }
          .mjpeg-gpu-layer {
            transform: translate3d(0, 0, 0);
            backface-visibility: hidden;
            will-change: transform;
            image-rendering: pixelated;
            image-rendering: crisp-edges;
            rendering-intent: relative-colorimetric;
          }
          @media (min-width: 1024px) {
            .desktop-camera-feed {
               max-height: 55vh !important;
               aspect-ratio: 16/9 !important;
               object-fit: contain !important;
            }
            button, a, input[type="range"], .dpad-button, .arm-slider-control-row button, .joint-slider {
               user-select: none !important;
               -webkit-user-select: none !important;
            }
          }
          @media (max-width: 768px) {
            /* 1. Macro Layout Re-stacking: Centered vertical column stack */
            .your-main-control-container { 
               display: flex !important;
               flex-direction: column !important; /* Revert to vertical stack */
               justify-content: flex-start !important;
               align-items: center !important;
               width: 100% !important;
               overflow: hidden !important;
               gap: 6px !important;
               padding-top: 2px !important;
               padding-bottom: 2px !important;
            }
            .drive-control-section {
               width: 100% !important;
               display: flex !important;
               justify-content: center !important;
               align-items: center !important;
            }
            .arm-control-section {
               width: 100% !important;
               max-width: 450px !important;
               display: flex !important;
               justify-content: center !important;
               align-items: center !important;
            }

            /* 2. Micro Layout Refactoring: Side-by-side canvas and sliders inside Arm Control */
            .arm-controls-wrapper {
               gap: 4px !important;
               width: 100% !important;
            }
            .arm-canvas-sliders-flex {
               display: flex !important;
               flex-direction: row !important; /* Horizontal side-by-side row configuration */
               align-items: center !important;
               justify-content: space-between !important;
               width: 100% !important;
               gap: 8px !important;
               padding: 4px !important;
            }
            .arm-canvas-wrapper {
               width: 120px !important;
               height: 74px !important;
               flex-shrink: 0 !important;
            }
            .arm-canvas-wrapper canvas {
               width: 120px !important;
               height: 74px !important;
            }
            .arm-sliders-container {
               flex: 1 !important;
               width: auto !important;
               display: flex !important;
               flex-direction: column !important;
               gap: 2px !important;
               margin-top: 0px !important;
            }

            /* 3. Slider Row Adjustments (tight horizontal matching) */
            .arm-slider-row {
               display: flex !important;
               flex-direction: row !important; /* Labels and sliders match tightly on right side */
               align-items: center !important;
               justify-content: space-between !important;
               width: 100% !important;
               padding: 1.5px 0 !important;
               border-bottom: 0 !important;
               gap: 4px !important;
            }
            .arm-slider-label-row {
               width: 62px !important; /* Fixed tight label/value column */
               display: flex !important;
               justify-content: space-between !important;
               align-items: center !important;
               flex-shrink: 0 !important;
            }
            .arm-slider-label-row span {
               font-size: 8.5px !important;
            }
            .arm-slider-control-row {
               display: flex !important;
               align-items: center !important;
               gap: 4px !important;
               flex: 1 !important;
            }
            .arm-slider-control-row button {
               width: 16px !important;
               height: 16px !important;
               font-size: 8px !important;
               padding: 0 !important;
               display: flex !important;
               align-items: center !important;
               justify-content: center !important;
            }
            .joint-slider {
               height: 6px !important;
               flex: 1 !important;
            }

            /* Additional scaling and scroll prevention */
            .arm-presets-grid {
               gap: 2px !important;
            }
            .arm-presets-grid button {
               font-size: 8px !important;
               padding: 2px 1px !important;
            }
            .arm-reset-bottom {
               margin-top: 2px !important;
               height: 20px !important;
               font-size: 9px !important;
               padding: 0 !important;
            }

            /* Disable body scroll completely for the app feel */
            body, html { overflow: hidden !important; touch-action: none; }

            /* 4. Touch Interactions and Bounding Boxes */
            button, a, input[type="range"] {
               touch-action: manipulation !important;
            }
            .arm-slider-control-row button, .arm-presets-grid button, .arm-reset-bottom, .dpad-button {
               position: relative;
            }
            /* Expand touch targets to 48x48px */
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
            /* Visual feedback on active/hover for touch */
            button:active, .dpad-button:active {
               transform: scale(0.95);
               opacity: 0.8;
               transition: all 0.05s ease-out;
            }
          }
        `}</style>

        {/* Ambient Auroras */}
        <div className="absolute -top-10 -left-10 w-72 h-72 rounded-full bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 blur-[80px] pointer-events-none float-blob-1" />
        <div className="absolute -bottom-16 -right-16 w-80 h-80 rounded-full bg-gradient-to-br from-blue-500/20 via-teal-500/20 to-indigo-500/20 blur-[90px] pointer-events-none float-blob-2" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] rounded-full bg-gradient-to-tr from-purple-600/5 via-blue-600/5 to-teal-500/5 blur-[100px] pointer-events-none animate-pulse" style={{ animationDuration: "8s" }} />

        {/* Central Widescreen Camera Frame */}
        <div className="desktop-camera-feed w-full max-w-none md:max-w-[94vw] aspect-video md:aspect-auto max-h-[50vh] md:max-h-[48dvh] h-auto md:h-[48dvh] relative overflow-hidden z-10 shadow-2xl border border-white/5 rounded-lg">
          <CameraView
            streamSrc={streamSrc}
            streamError={streamError}
            rssi={rssi}
            solar={solar}
            distance={distance}
            setStreamError={setStreamError}
          />
          <CameraOverlay 
            onCapturePhoto={handleCapturePhoto} 
            onRecordVideo={handleRecordVideo} 
            isRecording={isRecording} 
          />
        </div>
      </div>

      {/* Interactive Control Section (Middle - Max 42dvh Viewport Height Budget) */}
      <div className="flex-1 flex flex-col min-h-0 md:max-h-[42dvh] md:overflow-hidden bg-background z-10">
        
        {/* 2. MODE SELECTOR TABS */}
        <div className="shrink-0 px-4 pt-4 md:pt-2.5 pb-2 bg-transparent z-10">
          <div className="relative flex rounded-xl bg-muted/80 p-1 gap-0.5 max-w-xl mx-auto border border-border/50">
            {CONTROL_TABS.map(tab => (
              <button key={tab.id} onClick={() => setControlMode(tab.id)}
                className={`relative flex flex-1 items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg z-10 transition-colors duration-150 select-none ${
                  controlMode === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-${tab.id}`}>
                {controlMode === tab.id && (
                  <motion.div layoutId="tab-pill" className="absolute inset-0 bg-background border border-border/30 rounded-lg shadow-sm"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                )}
                <tab.icon className="w-3.5 h-3.5 relative z-10 shrink-0" />
                <span className="relative z-10">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. INTERACTIVE CONTROL AREA */}
        <div className="flex-1 min-h-0 md:overflow-hidden relative">
          <AnimatePresence mode="wait" initial={false}>

            {/* ── MANUAL CONTROL ── */}
            {controlMode === "manual" && (
              <motion.div key="manual"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="px-4 py-3 md:h-full md:overflow-hidden flex items-center justify-center">
                <div className="your-main-control-container flex flex-col md:flex-row items-center justify-center gap-6 md:gap-8 w-full max-w-5xl mx-auto py-4 px-2">
                  {/* LEFT: Drive D-Pad */}
                  <div className="drive-control-section shrink-0 w-[240px] h-[240px] bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3 backdrop-blur-md shadow-lg relative">
                    <DPad
                      activeDirection={activeDirection}
                      onPress={handleDirectionPress}
                      onRelease={handleDirectionRelease}
                      onStop={handleStop}
                    />
                  </div>

                  {/* RIGHT: 5DOF Arm */}
                  <div className="arm-control-section shrink-0 w-full max-w-[480px] flex flex-col items-center justify-center">
                    <ArmControls
                      joints={joints}
                      setJointAngle={setJointAngle}
                      updateJoint={updateJoint}
                      stepSize={stepSize}
                      setStepSize={setStepSize}
                      applyPreset={applyPreset}
                      handleResetArm={handleResetArm}
                      editingJoint={editingJoint}
                      setEditingJoint={setEditingJoint}
                      editValue={editValue}
                      setEditValue={setEditValue}
                      commitEdit={commitEdit}
                      startEdit={startEdit}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── AI DIRECTIVE ── */}
            {controlMode === "ai" && (
              <motion.div key="ai"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="p-3 md:overflow-hidden md:h-full flex flex-col justify-center animate-none">
                <div className="max-w-2xl w-full mx-auto flex flex-col gap-1.5 animate-none">
                  <div className="text-center">
                    <div className="text-xs sm:text-sm font-semibold">Autonomous Directive</div>
                    <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                      Auto-detect language (English/Bengali) → Firebase <code className="font-mono text-[10px] bg-muted px-1 rounded">ares01/autonomous/action</code>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <input ref={commandInputRef} type="text" inputMode="text" autoComplete="off"
                      placeholder="Type command for ARES-01 (e.g., 'Take a 360-degree scan' or 'সামনের দিকে ৫ মিটার যাও')..."
                      value={command}
                      onChange={e => setCommand(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !isProcessing && handleSendCommand()}
                      onClick={() => commandInputRef.current?.focus()}
                      disabled={isProcessing}
                      className="cmd-input flex-1 h-9 rounded-lg border border-input bg-background px-4 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/65 focus:outline-none focus:ring-2 focus:ring-primary/45 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="input-ai-cmd" />
                    <Button onClick={handleSendCommand} data-testid="btn-ai-send" disabled={isProcessing || !command.trim()}
                      className="h-9 px-4 active:scale-95 transition-transform shrink-0">
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-1 justify-center max-h-[48px] overflow-y-auto">
                    {["go forward", "turn left", "pick ball", "scan area", "stop", "arm home",
                      "সামনে যাও", "বামে যাও", "বল তোলো", "থামো"].map(chip => (
                      <button key={chip} onClick={() => setCommand(chip)}
                        className="text-[9px] px-2.5 py-1 rounded-full border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-all font-medium cursor-pointer">
                        {chip}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col min-h-0">
                    <div className="flex justify-between items-center mb-1">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Command Log</div>
                      <div className="flex items-center justify-between h-4">
                        {isProcessing ? (
                          <div className="flex items-center gap-1 text-[9px] font-mono text-primary font-semibold tracking-wider animate-pulse">
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
                    <div className="space-y-1.5 max-h-[80px] overflow-y-auto pr-1">
                      <AnimatePresence initial={false}>
                        {history.map(cmd => {
                          const isUser = cmd.sender === "user";
                          return (
                            <motion.div
                              key={cmd.id}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                              className={`flex flex-col ${isUser ? "items-end" : "items-start"} w-full`}
                            >
                              <div
                                className={`max-w-[90%] rounded-xl px-3 py-2 text-[10px] sm:text-[11px] leading-normal shadow-md border ${
                                  isUser
                                    ? "bg-primary/10 border-primary/20 rounded-tr-none text-right shadow-primary/5 text-foreground"
                                    : "bg-muted/80 border-border rounded-tl-none text-left text-foreground"
                                }`}
                              >
                                <div className="flex items-center gap-3 mb-0.5 justify-between">
                                  <span className={`text-[8px] font-bold tracking-wider uppercase ${isUser ? "text-primary" : "text-muted-foreground flex items-center gap-0.5"}`}>
                                    {!isUser && <Bot className="w-2 h-2" />}
                                    {isUser ? "Operator" : "ARES-01"}
                                  </span>
                                  <span className="text-[7.5px] text-muted-foreground font-mono">{cmd.time}</span>
                                </div>
                                <div className={`break-words ${isUser ? "text-right" : "text-left"}`}>{cmd.text}</div>
                                {isUser && cmd.action && (
                                  <div className="mt-1 flex justify-end">
                                    <span className="text-[7.5px] font-mono bg-primary/25 text-primary px-1 py-0.5 rounded leading-none">
                                      {cmd.action}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── VOICE COMMAND ── */}
            {controlMode === "voice" && (
              <motion.div key="voice"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="md:h-full flex items-center justify-center p-3 md:overflow-hidden">

                <div className="flex flex-col items-center px-5 pt-4 pb-2 gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-xl relative overflow-hidden select-none">
                  <div className="flex items-center justify-between w-full border-b border-slate-100 dark:border-slate-800 pb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">Voice Link</span>
                    <select
                      id="voice-lang"
                      value={voiceLanguage}
                      onChange={e => setVoiceLanguage(e.target.value)}
                      className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer text-slate-800 dark:text-slate-200 font-medium"
                    >
                      <option value="bn-BD">বাংলা (BD)</option>
                      <option value="en-US">English (US)</option>
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
                      className={`relative z-10 w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 shadow-lg cursor-pointer ${
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
                      {isListening ? "Listening..." : "Click button to speak"}
                    </p>
                  </div>
                </div>

              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>


    </div>
  );
}
