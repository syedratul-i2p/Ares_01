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

      <div className="flex items-center gap-5 px-5 py-2.5 z-30 pointer-events-auto backdrop-blur-xl bg-zinc-950/80 border border-white/10 shadow-2xl rounded-2xl">
        
        {/* Snapshot Button */}
        <button
          onClick={handleCapture}
          title="Capture Frame"
          className="group relative flex items-center justify-center w-10 h-10 rounded-full border border-white/5 bg-white/5 hover:bg-cyan-500/20 hover:border-cyan-500/50 hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer shadow-[0_0_0_rgba(6,182,212,0)] hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]"
        >
          <Camera className="w-[18px] h-[18px] text-cyan-400 group-active:scale-90 transition-transform duration-200" />
        </button>

        <div className="w-px h-5 bg-white/10" />

        {/* Record Video Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={onRecordVideo}
            title={isRecording ? "Stop Recording" : "Record Video"}
            className={`group relative flex items-center justify-center w-10 h-10 rounded-full border transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer shadow-[0_0_0_rgba(225,29,72,0)] ${
              isRecording 
                ? "bg-rose-500/20 border-rose-500/50 shadow-[0_0_20px_rgba(225,29,72,0.4)]" 
                : "bg-white/5 border-white/5 hover:bg-rose-500/20 hover:border-rose-500/50 hover:shadow-[0_0_15px_rgba(225,29,72,0.4)]"
            }`}
          >
            {isRecording ? (
              <div className="w-3 h-3 bg-rose-500 rounded-sm group-active:scale-90 transition-transform duration-200" />
            ) : (
              <Video className="w-[18px] h-[18px] text-rose-400 group-active:scale-90 transition-transform duration-200" />
            )}
            {/* Pulsing Dot */}
            {isRecording && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
              </span>
            )}
          </button>

          {isRecording && (
            <div className="font-mono text-xs font-semibold text-rose-400 min-w-[36px]">
              {formatTime(recTime)}
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* Rotate Button */}
        <button
          onClick={onRotate}
          title="Rotate Camera"
          className="group relative flex items-center justify-center h-10 pl-3 pr-2 rounded-full border border-white/5 bg-white/5 hover:bg-emerald-500/20 hover:border-emerald-500/50 hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer shadow-[0_0_0_rgba(16,185,129,0)] hover:shadow-[0_0_15px_rgba(16,185,129,0.4)] gap-2"
        >
          <RotateCw className="w-[18px] h-[18px] text-emerald-400 group-active:rotate-90 transition-transform duration-200" />
          <span className="text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded">
            {rotation}°
          </span>
        </button>

      </div>
    </>
  );
});
