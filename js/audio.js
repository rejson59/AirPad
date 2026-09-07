// Synthesized SFX — no assets, works offline. Needs a user gesture to unlock.

let ctx = null;
let master = null;
let engineOsc = null, engineGain = null, engineFilter = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() { ac(); }

function envGain(duration, peak = 0.2, attack = 0.008) {
  const c = ac(); if (!c) return null;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(peak, c.currentTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  g.connect(master);
  return g;
}

export function beep(freq = 440, dur = 0.12, type = 'square', peak = 0.12) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = envGain(dur, peak);
  o.connect(g); o.start(); o.stop(c.currentTime + dur + 0.02);
}

export function countdownTone(n) {
  if (n <= 0) {
    beep(880, 0.35, 'sawtooth', 0.16);
    beep(1320, 0.35, 'triangle', 0.08);
  } else beep(420 + n * 40, 0.16, 'square', 0.14);
}

export function boost() {
  const c = ac(); if (!c) return;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(180, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(640, c.currentTime + 0.28);
  const g = envGain(0.32, 0.1);
  o.connect(g); o.start(); o.stop(c.currentTime + 0.34);
}

export function explosion() {
  const c = ac(); if (!c) return;
  const buffer = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource(); src.buffer = buffer;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
  const g = envGain(0.4, 0.28, 0.002);
  src.connect(f); f.connect(g); src.start();
}

export function collect() { beep(920, 0.08, 'triangle', 0.1); setTimeout(() => beep(1240, 0.1, 'triangle', 0.1), 70); }
export function goal() { beep(392, 0.18, 'square', 0.12); setTimeout(() => beep(523, 0.18, 'square', 0.12), 140); setTimeout(() => beep(784, 0.4, 'triangle', 0.14), 280); }
export function hit() { beep(140, 0.16, 'sawtooth', 0.14); }
export function lapBell() { beep(660, 0.12, 'triangle', 0.1); setTimeout(() => beep(990, 0.18, 'triangle', 0.1), 90); }

export function setEngine(speed01) {
  const c = ac(); if (!c) return;
  if (!engineOsc) {
    engineOsc = c.createOscillator();
    engineOsc.type = 'sawtooth';
    engineGain = c.createGain(); engineGain.gain.value = 0;
    engineFilter = c.createBiquadFilter(); engineFilter.type = 'lowpass';
    engineOsc.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(master);
    engineOsc.start();
  }
  const v = Math.max(0, Math.min(1, speed01));
  engineOsc.frequency.setTargetAtTime(55 + v * 140, c.currentTime, 0.08);
  engineFilter.frequency.setTargetAtTime(400 + v * 1800, c.currentTime, 0.08);
  engineGain.gain.setTargetAtTime(v > 0.02 ? 0.04 + v * 0.05 : 0, c.currentTime, 0.08);
}

export function stopEngine() {
  if (!engineGain || !ctx) return;
  engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
}
