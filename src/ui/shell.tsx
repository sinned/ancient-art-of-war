import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Settings } from '../core/storage';
import { fmtTime } from '../core/util';

export const STEP = 1 / 30;
export const SettingsCtx = createContext<{ settings: Settings; update: (p: Partial<Settings>) => void; reduced: boolean }>(null as any);
export const useSettings = () => useContext(SettingsCtx);

/** Fixed-timestep simulation loop decoupled from rendering. Pause simply stops feeding time to the simulation. */
export function useGameCanvas(o: { step: (dt: number) => void; draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void; paused: boolean; speed: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ref = useRef(o); ref.current = o;
  const [, setTick] = useState(0);
  useEffect(() => {
    const cv = canvasRef.current!, ctx = cv.getContext('2d')!;
    let raf = 0, last = performance.now(), acc = 0, lastTick = 0, w = 0, h = 0, dpr = 1;
    const resize = () => {
      const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(50, r.width); h = Math.max(50, r.height);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    const ro = new ResizeObserver(resize); ro.observe(cv); resize();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const c = ref.current;
      if (!c.paused) { acc += dt * c.speed; let n = 0; while (acc >= STEP && n++ < 12) { c.step(STEP); acc -= STEP; } if (n >= 12) acc = 0; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      c.draw(ctx, w, h, now / 1000);
      if (now - lastTick > 160) { lastTick = now; setTick((x) => x + 1); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return canvasRef;
}
export const canvasPoint = (e: { clientX: number; clientY: number }, cv: HTMLCanvasElement) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

export function TopBar(p: { scenario: string; objective: string; time: number; paused: boolean; setPaused: (v: boolean) => void; speed: number; setSpeed: (v: number) => void; onMenu: () => void; onHelp: () => void; locked?: string }) {
  const { settings, update } = useSettings();
  return (
    <header className="topbar">
      <button className="btn ghost" onClick={p.onMenu} title="Menu (Esc)" aria-label="Menu">☰</button>
      <div className="scn"><span className="scn-name">{p.scenario}</span></div>
      <div className="objective" title="Current objective"><span className="obj-mark">◆</span><span><b>Objective</b> {p.objective}</span></div>
      <div className="clock" title="Campaign time">{fmtTime(p.time)}</div>
      <div className="seg" role="group" aria-label="Time controls">
        <button className={'btn' + (p.paused ? ' on' : '')} onClick={() => p.setPaused(!p.paused)} title="Pause / resume (Space)" aria-pressed={p.paused}>{p.paused ? '▶ Resume' : '❚❚ Pause'}</button>
        {[1, 2, 4].map((s) => <button key={s} className={'btn' + (p.speed === s && !p.paused ? ' on' : '')} onClick={() => { p.setSpeed(s); p.setPaused(false); }} title={`Speed ${s}×`}>{s}×</button>)}
      </div>
      <button className="btn ghost" onClick={() => update({ muted: !settings.muted })} title={settings.muted ? 'Sound is off — click to enable' : 'Mute sound'} aria-pressed={settings.muted}>{settings.muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
      <button className="btn ghost" onClick={p.onHelp} title="Controls and rules">? Guide</button>
    </header>
  );
}
export function Bar(p: { v: number; max?: number; color: string; label?: string; title?: string }) {
  const f = Math.max(0, Math.min(1, p.v / (p.max ?? 100)));
  return <div className="bar" title={p.title}><div className="bar-fill" style={{ width: `${f * 100}%`, background: p.color }} />{p.label && <span className="bar-label">{p.label}</span>}</div>;
}
export function Modal(p: { title: string; children: React.ReactNode; onClose?: () => void; wide?: boolean }) {
  return (
    <div className="modal-back" onClick={p.onClose}>
      <div className={'modal' + (p.wide ? ' wide' : '')} role="dialog" aria-label={p.title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{p.title}</h2>{p.onClose && <button className="btn ghost" onClick={p.onClose} aria-label="Close">✕</button>}</div>
        <div className="modal-body">{p.children}</div>
      </div>
    </div>
  );
}
export interface CoachStep { text: React.ReactNode; wait?: string; button?: string }
export function Coach(p: { steps: CoachStep[]; index: number; onNext: () => void; onSkip: () => void }) {
  const s = p.steps[p.index];
  if (!s) return null;
  return (
    <div className="coach" role="status">
      <div className="coach-n">Lesson {p.index + 1} of {p.steps.length}</div>
      <div className="coach-t">{s.text}</div>
      <div className="coach-b">
        {s.button && <button className="btn primary" onClick={p.onNext}>{s.button}</button>}
        {!s.button && <span className="coach-wait">Waiting for you…</span>}
        <button className="btn ghost small" onClick={p.onSkip}>Skip lessons</button>
      </div>
    </div>
  );
}
export interface ToastMsg { text: string; bad?: boolean; id: number }
export function useToast() {
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const n = useRef(0);
  const say = (text: string, bad = false) => { const id = ++n.current; setToast({ text, bad, id }); setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), bad ? 3600 : 2000); };
  return { toast, say };
}
export const Toast = ({ t }: { t: ToastMsg | null }) => (t ? <div className={'toast' + (t.bad ? ' bad' : '')} role="status">{t.bad ? '✕ ' : '✓ '}{t.text}</div> : null);

export function PauseMenu(p: { onResume: () => void; onRestart: () => void; onQuit: () => void; onHelp: () => void }) {
  const { settings, update, reduced } = useSettings();
  return (
    <Modal title="Campaign Paused" onClose={p.onResume}>
      <div className="menu-col">
        <button className="btn primary big" onClick={p.onResume}>Resume</button>
        <button className="btn big" onClick={p.onHelp}>Controls &amp; rules</button>
        <button className="btn big" onClick={() => update({ muted: !settings.muted })}>{settings.muted ? 'Sound: off' : 'Sound: on'}</button>
        <button className="btn big" onClick={() => update({ reducedMotion: !reduced })}>Reduced motion: {reduced ? 'on' : 'off'}</button>
        <button className="btn big" onClick={p.onRestart}>Restart scenario</button>
        <button className="btn big" onClick={p.onQuit}>Return to main menu</button>
      </div>
    </Modal>
  );
}
