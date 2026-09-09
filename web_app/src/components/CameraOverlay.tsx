import React, { useState, useEffect, useCallback } from "react";
import { Camera, Video, RotateCw } from "lucide-react";

interface CameraOverlayProps {
  onCapturePhoto: () => void;
  onRecordVideo: () => void;
  onRotate: () => void;
  rotation: number;
  isRecording?: boolean;
}

export const CameraOverlay = React.memo(function CameraOverlay({
  onCapturePhoto,
  onRecordVideo,
  onRotate,
  rotation,
  isRecording = false,
}: CameraOverlayProps) {
  const [flash, setFlash] = useState(false);
  const [recTime, setRecTime] = useState(0);

  // Shutter Flash Animation
  const handleCapture = useCallback(() => {
    onCapturePhoto();
    setFlash(true);
    setTimeout(() => setFlash(false), 200);
  }, [onCapturePhoto]);

  // Recording Timer
  useEffect(() => {
    let interval: number;
    if (isRecording) {
      interval = window.setInterval(() => {
        setRecTime(prev => prev + 1);
      }, 1000);
    } else {
      setRecTime(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <>
      {/* Full-screen Flash Overlay */}
      <div 
        className="fixed inset-0 bg-white z-[100] pointer-events-none transition-opacity duration-200 ease-out"
        style={{ opacity: flash ? 0.8 : 0 }}
      />

      <div className="flex items-center gap-3 px-4 py-2 z-30 pointer-events-auto backdrop-blur-xl bg-slate-950/75 border border-slate-700/60 shadow-2xl shadow-cyan-950/40 rounded-2xl">
        
        {/* Snapshot Button */}
        <button
          onClick={handleCapture}
          title="Capture Frame"
          className="group relative flex items-center justify-center w-10 h-10 rounded-full bg-slate-800/50 border border-slate-600/50 hover:bg-cyan-500/20 hover:border-cyan-400/60 hover:shadow-[0_0_12px_rgba(6,182,212,0.5)] active:scale-95 transition-all duration-200"
        >
          <Camera className="w-[18px] h-[18px] text-cyan-400 group-hover:text-cyan-300 transition-colors" />
        </button>

        <div className="w-[1px] h-6 bg-slate-800" />

        {/* Record Video Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRecordVideo}
            title={isRecording ? "Stop Recording" : "Record Video"}
            className={`group relative flex items-center justify-center w-10 h-10 rounded-full border transition-all duration-300 active:scale-95 ${
              isRecording 
                ? "bg-rose-500/20 border-rose-500 shadow-[0_0_15px_rgba(225,29,72,0.5)]" 
                : "bg-slate-800/50 border-slate-600/50 hover:bg-rose-500/10 hover:border-rose-400/50"
            }`}
          >
            {isRecording ? (
              <>
                {/* Animated Pulsing Ring */}
                <span className="absolute inset-0 rounded-full border border-rose-500 animate-ping opacity-75"></span>
                <div className="w-3 h-3 bg-rose-500 rounded-sm" />
              </>
            ) : (
              <Video className="w-[18px] h-[18px] text-rose-400 group-hover:text-rose-300 transition-colors" />
            )}
          </button>

          {isRecording && (
            <div className="font-mono text-xs font-bold text-rose-400 tracking-wider">
              {formatTime(recTime)}
            </div>
          )}
        </div>

        <div className="w-[1px] h-6 bg-slate-800" />

        {/* Rotate Button */}
        <button
          onClick={onRotate}
          title="Rotate Camera"
          className="group relative flex items-center gap-2 h-10 pl-3 pr-2 rounded-full bg-slate-800/50 border border-slate-600/50 hover:bg-emerald-500/20 hover:border-emerald-400/60 hover:shadow-[0_0_12px_rgba(16,185,129,0.4)] active:scale-95 transition-all duration-200"
        >
          <RotateCw className="w-[18px] h-[18px] text-emerald-400 group-active:rotate-180 transition-transform duration-500 ease-out" />
          <span className="text-[10px] font-mono font-bold tracking-widest bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full border border-emerald-500/30">
            {rotation}°
          </span>
        </button>

      </div>
    </>
  );
});
