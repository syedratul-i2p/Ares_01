import React, { useEffect, useState } from "react";
import { X, Minus, Square } from "lucide-react";

export function TitleBar() {
  const handleMinimize = () => {
    console.log("Web mode: Minimize window action disabled.");
  };

  const handleMaximize = () => {
    console.log("Web mode: Maximize window action disabled.");
  };

  const handleClose = () => {
    console.log("Web mode: Close window action disabled.");
  };

  return (
    <div
      data-tauri-drag-region
      className="fixed top-0 left-0 right-0 h-10 bg-slate-900/80 backdrop-blur-md flex justify-between items-center z-[100] select-none border-b border-slate-800"
    >
      <div 
        data-tauri-drag-region 
        className="flex items-center pl-4 text-xs font-semibold text-slate-300 tracking-widest w-full h-full pointer-events-none"
      >
        ARES-01 ROVER MISSION CONTROL
      </div>

      <div className="flex h-full pointer-events-auto">
        <button
          className="h-full px-4 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors flex items-center justify-center cursor-pointer"
          onClick={handleMinimize}
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          className="h-full px-4 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors flex items-center justify-center cursor-pointer"
          onClick={handleMaximize}
          title="Maximize"
        >
          <Square size={12} />
        </button>
        <button
          className="h-full px-4 text-slate-400 hover:bg-red-600 hover:text-white transition-colors flex items-center justify-center cursor-pointer"
          onClick={handleClose}
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
