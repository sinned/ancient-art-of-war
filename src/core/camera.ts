import { View, fitView } from './draw';
import { clamp } from './util';

/** Zoom/pan state layered over the fit-to-screen view. z = 1 shows the whole world; (cx, cy) is the world point at screen centre. */
export interface Cam { key: string; z: number; cx: number; cy: number; maxZ: number; cw: number; ch: number; fit: View; W: number; H: number; pad: number }

export const newCam = (): Cam => ({ key: '', z: 1, cx: 0, cy: 0, maxZ: 4, cw: 1, ch: 1, fit: { scale: 1, ox: 0, oy: 0 }, W: 1, H: 1, pad: 12 });

/** Keep the view on the world: when zoomed in, edges may not pull further in than the padding. */
function clampCam(c: Cam) {
  c.z = clamp(c.z, 1, c.maxZ);
  const s = c.fit.scale * c.z, m = c.pad / s;
  const hw = c.cw / 2 / s, hh = c.ch / 2 / s;
  c.cx = c.W + 2 * m <= hw * 2 ? c.W / 2 : clamp(c.cx, hw - m, c.W + m - hw);
  c.cy = c.H + 2 * m <= hh * 2 ? c.H / 2 : clamp(c.cy, hh - m, c.H + m - hh);
}

/** Recompute the view for this frame. A new `key` (e.g. switching map ↔ battle) resets the zoom. */
export function camView(c: Cam, key: string, cw: number, ch: number, W: number, H: number, maxZ: number, pad = 12): View {
  if (c.key !== key) { c.key = key; c.z = 1; c.cx = W / 2; c.cy = H / 2; }
  Object.assign(c, { cw, ch, W, H, maxZ, pad, fit: fitView(cw, ch, W, H, pad) });
  clampCam(c);
  const s = c.fit.scale * c.z;
  return { scale: s, ox: cw / 2 - c.cx * s, oy: ch / 2 - c.cy * s };
}

/** Zoom by factor f, keeping the world point under screen (px, py) fixed. */
export function zoomAt(c: Cam, f: number, px = c.cw / 2, py = c.ch / 2) {
  const s0 = c.fit.scale * c.z, wx = c.cx + (px - c.cw / 2) / s0, wy = c.cy + (py - c.ch / 2) / s0;
  c.z = clamp(c.z * f, 1, c.maxZ);
  const s1 = c.fit.scale * c.z;
  c.cx = wx - (px - c.cw / 2) / s1; c.cy = wy - (py - c.ch / 2) / s1;
  clampCam(c);
}

/** Pan by a screen-space drag delta. */
export function panBy(c: Cam, dx: number, dy: number) {
  const s = c.fit.scale * c.z;
  c.cx -= dx / s; c.cy -= dy / s;
  clampCam(c);
}

export const resetCam = (c: Cam) => { c.z = 1; c.cx = c.W / 2; c.cy = c.H / 2; };
