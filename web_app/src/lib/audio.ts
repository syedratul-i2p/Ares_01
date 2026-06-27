export const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

export function playBootChime() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  osc1.type = 'sine';
  osc2.type = 'triangle';
  
  // High-tech chord sweep
  osc1.frequency.setValueAtTime(440, audioCtx.currentTime); 
  osc1.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 1.5); 
  
  osc2.frequency.setValueAtTime(554.37, audioCtx.currentTime); 
  osc2.frequency.exponentialRampToValueAtTime(1108.73, audioCtx.currentTime + 1.5); 

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, audioCtx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 2);

  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.1);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  osc1.start();
  osc2.start();
  osc1.stop(audioCtx.currentTime + 2);
  osc2.stop(audioCtx.currentTime + 2);
}

export function playClickSound() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = 'square';
  // Sharp mechanical click drop
  osc.frequency.setValueAtTime(800, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.05);

  gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + 0.05);
}
