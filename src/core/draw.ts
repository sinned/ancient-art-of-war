import { Rng, rand, TAU } from './util';

export interface View { scale: number; ox: number; oy: number }
export function fitView(cw: number, ch: number, W: number, H: number, pad = 10): View {
  const scale = Math.min((cw - pad * 2) / W, (ch - pad * 2) / H);
  return { scale, ox: (cw - W * scale) / 2, oy: (ch - H * scale) / 2 };
}
export const toWorld = (v: View, px: number, py: number) => ({ x: (px - v.ox) / v.scale, y: (py - v.oy) / v.scale });

export const INK = '#3d2f22', PAPER = '#eadfc3', IVORY = '#f6efdc', BRASS = '#b8934a';
export const SERIF = '"Cormorant Garamond", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

export function paperGrain(ctx: CanvasRenderingContext2D, w: number, h: number, r: Rng, n = 2600, dark = '#5b4630', light = '#fff8e2') {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.03 + rand(r) * 0.05;
    ctx.fillStyle = rand(r) < 0.6 ? dark : light;
    const s = 0.5 + rand(r) * 1.6;
    ctx.fillRect(rand(r) * w, rand(r) * h, s, s);
  }
  for (let i = 0; i < 26; i++) {
    const x = rand(r) * w, y = rand(r) * h, rad = 60 + rand(r) * 180;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rand(r) < 0.5 ? 'rgba(120,90,50,0.07)' : 'rgba(255,250,225,0.09)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.globalAlpha = 1;
}
export function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, color = '60,40,20', a = 0.28) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(1, `rgba(${color},${a})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
/** Atlas frame: double rule with graticule ticks. */
export function atlasFrame(ctx: CanvasRenderingContext2D, w: number, h: number, ink = INK, pale = PAPER) {
  ctx.save();
  ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.lineWidth = 1; ctx.strokeRect(12, 12, w - 24, h - 24);
  for (let x = 12, i = 0; x < w - 12; x += 32, i++) {
    ctx.fillStyle = i % 2 ? ink : pale;
    ctx.fillRect(x, 5, Math.min(32, w - 12 - x), 7); ctx.fillRect(x, h - 12, Math.min(32, w - 12 - x), 7);
  }
  for (let y = 12, i = 0; y < h - 12; y += 32, i++) {
    ctx.fillStyle = i % 2 ? ink : pale;
    ctx.fillRect(5, y, 7, Math.min(32, h - 12 - y)); ctx.fillRect(w - 12, y, 7, Math.min(32, h - 12 - y));
  }
  ctx.lineWidth = 3; ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.restore();
}
export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, o: { color?: string; halo?: string; italic?: boolean; bold?: boolean; align?: CanvasTextAlign; spacing?: number } = {}) {
  ctx.save();
  ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '600 '}${size}px ${SERIF}`;
  ctx.textAlign = o.align ?? 'center'; ctx.textBaseline = 'middle';
  if (o.spacing) (ctx as any).letterSpacing = `${o.spacing}px`;
  if (o.halo !== '') { ctx.strokeStyle = o.halo ?? 'rgba(240,230,200,0.85)'; ctx.lineWidth = Math.max(2.5, size * 0.28); ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); }
  ctx.fillStyle = o.color ?? INK; ctx.fillText(text, x, y);
  ctx.restore();
}
/** A fluttering flag on a pole whose base is at (x, y). shape: 0 = swallowtail (player), 1 = square with diamond (enemy). */
export function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, trim: string, t: number, shape: 0 | 1, dir = 1) {
  const fw = h * 0.72, fh = h * 0.42, top = y - h;
  ctx.save();
  ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = Math.max(1.2, h * 0.07); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, top - 2); ctx.stroke();
  ctx.fillStyle = BRASS; ctx.beginPath(); ctx.arc(x, top - 3, h * 0.07 + 0.8, 0, TAU); ctx.fill();
  const wv = (u: number) => Math.sin(t * 5 - u * 4) * fh * 0.14 * u;
  ctx.beginPath(); ctx.moveTo(x, top);
  for (let i = 1; i <= 6; i++) ctx.lineTo(x + dir * (fw * i) / 6, top + wv(i / 6));
  if (shape === 0) ctx.lineTo(x + dir * fw * 0.72, top + fh / 2 + wv(0.72));
  for (let i = 6; i >= 0; i--) ctx.lineTo(x + dir * (fw * i) / 6, top + fh + wv(i / 6));
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,10,0.7)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = trim;
  const cx = x + dir * fw * 0.36, cy = top + fh / 2 + wv(0.36), r = fh * 0.24;
  ctx.beginPath();
  if (shape === 0) ctx.arc(cx, cy, r, 0, TAU);
  else { ctx.moveTo(cx, cy - r * 1.2); ctx.lineTo(cx + r * 1.2, cy); ctx.lineTo(cx, cy + r * 1.2); ctx.lineTo(cx - r * 1.2, cy); }
  ctx.fill();
  ctx.restore();
}
export function dashedPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], color: string, width: number, dash: number[], offset = 0) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineDashOffset = offset; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y); ctx.stroke();
  ctx.restore();
}
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
