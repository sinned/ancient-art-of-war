/** Small synthesised sound set. The AudioContext is created only after a user gesture. */
let ctx: AudioContext | null = null;
let muted = false;
let last: Record<string, number> = {};
export function setMuted(m: boolean) { muted = m; }
export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
  try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { ctx = null; }
}
function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur: number, vol: number, freq: number, q = 1, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(ctx.destination); s.start(t);
}
export type Sfx = 'click' | 'order' | 'deny' | 'arrow' | 'clash' | 'cannon' | 'splash' | 'hit' | 'horn' | 'win' | 'lose' | 'board' | 'capture';
export function sfx(name: Sfx) {
  if (muted || !ctx) return;
  const now = performance.now();
  const gap = name === 'arrow' || name === 'clash' || name === 'hit' || name === 'splash' ? 70 : 40;
  if (now - (last[name] || 0) < gap) return;
  last[name] = now;
  switch (name) {
    case 'click': tone(660, 0.05, 'triangle', 0.06); break;
    case 'order': tone(392, 0.08, 'triangle', 0.08); tone(587, 0.12, 'triangle', 0.08, 0, 0.07); break;
    case 'deny': tone(160, 0.14, 'square', 0.04, -40); break;
    case 'arrow': noise(0.12, 0.05, 2600, 2); break;
    case 'clash': noise(0.06, 0.07, 4200, 6); tone(1400 + Math.random() * 500, 0.07, 'square', 0.015); break;
    case 'hit': noise(0.15, 0.1, 500, 1); break;
    case 'cannon': noise(0.5, 0.3, 160, 0.7); tone(70, 0.4, 'sine', 0.25, -35); break;
    case 'splash': noise(0.3, 0.05, 1200, 0.8); break;
    case 'horn': tone(196, 0.5, 'sawtooth', 0.05); tone(294, 0.6, 'sawtooth', 0.05, 0, 0.25); break;
    case 'board': noise(0.25, 0.1, 900, 1); tone(220, 0.2, 'sawtooth', 0.04); break;
    case 'capture': [392, 494, 587].forEach((f, i) => tone(f, 0.18, 'triangle', 0.08, 0, i * 0.1)); break;
    case 'win': [392, 494, 587, 784].forEach((f, i) => tone(f, 0.35, 'triangle', 0.09, 0, i * 0.16)); break;
    case 'lose': [330, 294, 247, 196].forEach((f, i) => tone(f, 0.4, 'sine', 0.09, 0, i * 0.2)); break;
  }
}
