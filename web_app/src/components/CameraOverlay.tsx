import React, { useState, useEffect, useCallback } from "react";
import { Camera, Video } from "lucide-react";

interface CameraOverlayProps {
  onCapturePhoto: () => void;
  onRecordVideo: () => void;
  isRecording?: boolean;
}

export const CameraOverlay = React.memo(function CameraOverlay({
  onCapturePhoto,
  onRecordVideo,
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

      <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center p-1 z-30 pointer-events-auto bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-full shadow-[0_8px_20px_rgba(0,0,0,0.4)] transition-all duration-300 ${isRecording ? 'pl-1 pr-3' : 'px-1'}`}>
        
        {/* Capture Photo Button */}
        <button
          onClick={handleCapture}
          className="group relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-white/10 transition-colors duration-200 cursor-pointer shrink-0"
          title="Capture Photo"
        >
          <Camera className="w-[15px] h-[15px] text-cyan-400 group-active:scale-90 transition-transform duration-200" />
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-white/10 mx-0.5 shrink-0" />

        {/* Record Video Button */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onRecordVideo}
            className={`group relative flex items-center justify-center w-9 h-9 rounded-full transition-colors duration-200 cursor-pointer shrink-0 ${
              isRecording ? "bg-rose-500/10" : "hover:bg-white/10"
            }`}
            title={isRecording ? "Stop Recording" : "Record Video"}
          >
            {isRecording ? (
              <div className="w-3 h-3 bg-rose-500 rounded-sm group-active:scale-90 transition-transform duration-200" />
            ) : (
              <Video className="w-[15px] h-[15px] text-rose-400 group-active:scale-90 transition-transform duration-200" />
            )}
            
            {/* Active Recording Blip */}
            {isRecording && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
            )}
          </button>

          {/* Recording Timer */}
          {isRecording && (
            <div className="font-mono text-[10px] font-semibold text-rose-400 animate-in fade-in slide-in-from-left-2 duration-300">
              {formatTime(recTime)}
            </div>
          )}
        </div>

      </div>
    </>
  );
});
