import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Settings } from '../core/storage';
import { fmtTime } from '../core/util';
import { Cam, panBy, resetCam, zoomAt } from '../core/camera';

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

/** Pointer data the game handlers need; clicks are delivered on release so a drag can pan instead. */
export interface Tap { clientX: number; clientY: number; button: number; pointerType: string }

/**
 * Map input: wheel / pinch zoom, drag to pan (one finger, left or middle mouse), tap or click to act.
 * Right-click acts immediately. Returns props to spread on the canvas.
 */
export function useMapInput(canvasRef: React.RefObject<HTMLCanvasElement | null>, cam: Cam, h: { tap: (e: Tap) => void; hover: (e: Tap) => void; leave: () => void }) {
  const hr = useRef(h); hr.current = h;
  const g = useRef({ pts: new Map<number, { x: number; y: number }>(), start: null as (Tap & { x: number; y: number }) | null, drag: false, pinch: 0, mid: { x: 0, y: 0 } });
  useEffect(() => {
    const cv = canvasRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = canvasPoint(e, cv), d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(cam, Math.exp(-clampN(d, -120, 120) * (e.ctrlKey ? 0.01 : 0.0025)), p.x, p.y);
    };
    cv.addEventListener('wheel', wheel, { passive: false });
    return () => cv.removeEventListener('wheel', wheel);
  }, []);
  const pinchState = () => { const [a, b] = [...g.current.pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };
  const tapOf = (e: React.PointerEvent): Tap => ({ clientX: e.clientX, clientY: e.clientY, button: e.button, pointerType: e.pointerType });
  return {
    onPointerDown: (e: React.PointerEvent) => {
      const s = g.current, p = canvasPoint(e, canvasRef.current!);
      if (e.button === 2) { hr.current.tap(tapOf(e)); return; }
      try { canvasRef.current!.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      s.pts.set(e.pointerId, p);
      if (s.pts.size === 2) { s.start = null; const q = pinchState(); s.pinch = q.d; s.mid = q.m; }
      else if (s.pts.size === 1) { s.start = { ...tapOf(e), ...p }; s.drag = e.button === 1; s.pinch = 0; }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = g.current, p = canvasPoint(e, canvasRef.current!), prev = s.pts.get(e.pointerId);
      if (!prev) { hr.current.hover(tapOf(e)); return; }
      if (s.pts.size >= 2) {
        s.pts.set(e.pointerId, p);
        const q = pinchState();
        if (s.pinch > 0) zoomAt(cam, q.d / s.pinch, q.m.x, q.m.y);
        panBy(cam, q.m.x - s.mid.x, q.m.y - s.mid.y);
        s.pinch = q.d; s.mid = q.m; return;
      }
      s.pts.set(e.pointerId, p);
      if (s.start && !s.drag && Math.hypot(p.x - s.start.x, p.y - s.start.y) > (e.pointerType === 'mouse' ? 5 : 10)) {
        s.drag = true; panBy(cam, p.x - s.start.x, p.y - s.start.y); return;
      }
      if (s.drag) panBy(cam, p.x - prev.x, p.y - prev.y);
      else hr.current.hover(tapOf(e));
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = g.current;
      if (!s.pts.delete(e.pointerId)) return;
      if (s.pts.size === 0) { if (s.start && !s.drag) hr.current.tap(s.start); s.start = null; s.drag = false; s.pinch = 0; }
      else { s.start = null; s.pinch = 0; const q = s.pts.size === 1 ? null : pinchState(); if (q) { s.pinch = q.d; s.mid = q.m; } else s.drag = true; }
    },
    onPointerCancel: (e: React.PointerEvent) => { const s = g.current; s.pts.delete(e.pointerId); if (!s.pts.size) { s.start = null; s.drag = false; } },
    onPointerLeave: () => { if (!g.current.pts.size) hr.current.leave(); },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** On-screen zoom buttons (also: + / − / 0 keys). */
export function ZoomControls({ cam }: { cam: Cam }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') zoomAt(cam, 1.25); else if (e.key === '-' || e.key === '_') zoomAt(cam, 0.8); else if (e.key === '0') resetCam(cam);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [cam]);
  return (
    <div className="zoom">
      <button className="btn" title="Zoom in (+, mouse wheel, pinch)" aria-label="Zoom in" onClick={() => zoomAt(cam, 1.4)}>+</button>
      <button className="btn" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomAt(cam, 1 / 1.4)}>−</button>
      <button className="btn" title="Show whole map (0)" aria-label="Reset zoom" onClick={() => resetCam(cam)} disabled={cam.z <= 1.001}>⤢</button>
    </div>
  );
}
