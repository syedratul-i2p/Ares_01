import React, { useEffect, useState } from "react";
import { playBootChime } from "@/lib/audio";

interface BootLoaderProps {
  onComplete: () => void;
}

export function BootLoader({ onComplete }: BootLoaderProps) {
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Animate progress smoothly over 3.5 seconds (3500ms)
    // We update progress frequently for a smooth CSS width change, or we could just use a CSS transition.
    // CSS transition is smoother, so we'll just set it to 100% immediately and let CSS handle the 3.5s duration.
    const progressTimer = setTimeout(() => {
      setProgress(100);
    }, 50);

    const fadeOutTimer = setTimeout(() => {
      setIsFadingOut(true);
    }, 3500);

    const completeTimer = setTimeout(() => {
      onComplete();
    }, 4000); // 3.5s + 500ms fade transition

    return () => {
      clearTimeout(progressTimer);
      clearTimeout(fadeOutTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div
      data-tauri-drag-region
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black transition-opacity duration-500 ease-in-out ${
        isFadingOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex flex-col items-center gap-6">
        <img 
          src="/logo.png" 
          alt="ARES-01 Logo" 
          className="w-32 h-auto drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] animate-pulse" 
        />
        
        <h1 className="text-3xl md:text-4xl font-bold tracking-[0.3em] text-white/90 font-mono drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
          ARES-01
        </h1>
        
        <div className="w-64 h-[3px] bg-slate-800 rounded-full overflow-hidden mt-4 relative shadow-[0_0_10px_rgba(255,255,255,0.3)]">
          <div 
            className="h-full bg-white drop-shadow-[0_0_5px_rgba(255,255,255,0.8)]"
            style={{ 
              width: `${progress}%`,
              transition: 'width 3.45s cubic-bezier(0.4, 0, 0.2, 1)' 
            }}
          />
        </div>
      </div>
    </div>
  );
}
