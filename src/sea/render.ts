import { TAU, Vec, Rng, rand, inPoly, clamp, angNorm } from '../core/util';
import { BRASS, INK, IVORY, View, atlasFrame, dashedPath, label, makeCanvas, paperGrain, vignette } from '../core/draw';
import { CLASS, ISLANDS, PORTS, SEA, SHOALS, SHOT, ShipClass, Side, SIDE_COLOR, SIDE_TRIM } from './data';
import { SeaState, Ship, Squadron, flagship, shipsOf } from './sim';
import { ARENA, SeaBattle, Unit, arcTarget, reloadTime, shipOf } from './battle';

const poly = (ctx: CanvasRenderingContext2D, p: Vec[]) => { ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); };

/** Paint a region of the chart. zoom = 1 for the strategic chart, 5 for a tactical arena. */
function paintChart(ctx: CanvasRenderingContext2D, rx: number, ry: number, rw: number, rh: number, k: number, zoom: number) {
  const r: Rng = { seed: 31 + Math.round(rx + ry * 7) }, z = 1 / zoom, zs = 1 / Math.sqrt(zoom);
  ctx.save(); ctx.scale(k, k); ctx.translate(-rx, -ry);
  const g = ctx.createLinearGradient(rx, ry, rx + rw * 0.3, ry + rh);
  g.addColorStop(0, '#2d6f82'); g.addColorStop(0.5, '#25627a'); g.addColorStop(1, '#1d5068');
  ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
  for (let i = 0; i < 40; i++) {
    const x = rx + rand(r) * rw, y = ry + rand(r) * rh, rad = (60 + rand(r) * 160) * zs, gg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    gg.addColorStop(0, rand(r) < 0.5 ? 'rgba(80,160,170,0.16)' : 'rgba(10,40,70,0.16)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gg; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.lineJoin = 'round';
  // coastal shelf bands
  for (const [w, a] of [[58, 0.07], [38, 0.09], [20, 0.12]] as [number, number][]) for (const i of ISLANDS) { poly(ctx, i.poly); ctx.strokeStyle = `rgba(150,215,205,${a})`; ctx.lineWidth = w; ctx.stroke(); }
  // shoals
  for (const s of SHOALS) {
    poly(ctx, s.poly); ctx.fillStyle = 'rgba(126,196,182,0.55)'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(240,235,200,0.7)';
    const xs = s.poly.map((p) => p.x), ys = s.poly.map((p) => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const step = 9 * zs;
    for (let y = y0, j = 0; y < y1; y += step, j++) for (let x = x0 + (j % 2) * step * 0.5; x < x1; x += step) { ctx.beginPath(); ctx.arc(x, y, 0.9 * zs, 0, TAU); ctx.fill(); }
    ctx.restore();
    poly(ctx, s.poly); ctx.strokeStyle = 'rgba(240,235,200,0.85)'; ctx.lineWidth = 1.4 * z; ctx.setLineDash([5 * zs, 4 * zs]); ctx.stroke(); ctx.setLineDash([]);
  }
  // engraved wave marks
  ctx.strokeStyle = 'rgba(200,230,230,0.22)'; ctx.lineWidth = 0.9 * z;
  const nw = Math.round((rw * rh) / (1500 * z));
  for (let i = 0; i < nw; i++) { const x = rx + rand(r) * rw, y = ry + rand(r) * rh, s = (3 + rand(r) * 3) * zs; ctx.beginPath(); ctx.moveTo(x - s * 2, y); ctx.quadraticCurveTo(x - s, y - s, x, y); ctx.quadraticCurveTo(x + s, y - s, x + s * 2, y); ctx.stroke(); }
  // land
  for (const isl of ISLANDS) {
    poly(ctx, isl.poly); ctx.strokeStyle = 'rgba(235,245,235,0.55)'; ctx.lineWidth = 7 * zs; ctx.stroke();
    ctx.strokeStyle = 'rgba(20,45,60,0.5)'; ctx.lineWidth = 15 * zs; ctx.setLineDash([0.8 * zs, 2.6 * zs]); ctx.stroke(); ctx.setLineDash([]);
    poly(ctx, isl.poly); ctx.fillStyle = '#e3d4a8'; ctx.fill();
    ctx.save(); ctx.clip();
    const xs = isl.poly.map((p) => p.x), ys = isl.poly.map((p) => p.y), x0 = Math.max(rx, Math.min(...xs)), x1 = Math.min(rx + rw, Math.max(...xs)), y0 = Math.max(ry, Math.min(...ys)), y1 = Math.min(ry + rh, Math.max(...ys));
    if (x1 > x0 && y1 > y0) {
      const n = Math.round(((x1 - x0) * (y1 - y0)) / (2400 * z));
      for (let i = 0; i < n; i++) { const x = x0 + rand(r) * (x1 - x0), y = y0 + rand(r) * (y1 - y0), rad = (26 + rand(r) * 50) * zs, gg = ctx.createRadialGradient(x, y, 0, x, y, rad); gg.addColorStop(0, rand(r) < 0.7 ? 'rgba(150,172,105,0.5)' : 'rgba(205,180,110,0.45)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gg; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
      poly(ctx, isl.poly); ctx.strokeStyle = 'rgba(120,95,55,0.35)'; ctx.lineWidth = 16 * zs; ctx.stroke();
      ctx.strokeStyle = 'rgba(245,235,200,0.6)'; ctx.lineWidth = 6 * zs; ctx.stroke();
      const m = Math.round(((x1 - x0) * (y1 - y0)) / (1100 * z));
      for (let i = 0; i < m; i++) {
        const p = { x: x0 + rand(r) * (x1 - x0), y: y0 + rand(r) * (y1 - y0) }, s = (0.7 + rand(r) * 0.5) * zs, kind = rand(r);
        if (!inPoly(p, isl.poly) || !inPoly({ x: p.x, y: p.y + 12 * zs }, isl.poly) || !inPoly({ x: p.x + 10 * zs, y: p.y }, isl.poly) || !inPoly({ x: p.x - 10 * zs, y: p.y }, isl.poly)) continue;
        if (kind < 0.6) { ctx.fillStyle = '#5a4028'; ctx.fillRect(p.x - 0.6 * s, p.y - 2 * s, 1.2 * s, 4 * s); ctx.beginPath(); ctx.arc(p.x, p.y - 5 * s, 4.2 * s, 0, TAU); ctx.fillStyle = '#5f7a48'; ctx.fill(); ctx.strokeStyle = 'rgba(40,35,20,0.55)'; ctx.lineWidth = 0.6 * s; ctx.stroke(); }
        else { ctx.strokeStyle = 'rgba(110,85,50,0.7)'; ctx.lineWidth = 0.9 * s; ctx.beginPath(); ctx.moveTo(p.x - 8 * s, p.y); ctx.quadraticCurveTo(p.x, p.y - 11 * s, p.x + 8 * s, p.y); ctx.moveTo(p.x + 1 * s, p.y - 4 * s); ctx.lineTo(p.x + 4 * s, p.y); ctx.moveTo(p.x + 3.5 * s, p.y - 3 * s); ctx.lineTo(p.x + 6 * s, p.y); ctx.stroke(); }
      }
    }
    ctx.restore();
    poly(ctx, isl.poly); ctx.strokeStyle = '#2c2218'; ctx.lineWidth = 1.5 * zs; ctx.stroke();
    if (isl.name && isl.label) label(ctx, isl.name, isl.label.x, isl.label.y, 17 * zs, { italic: true, spacing: 2 * zs, color: '#4a3b2a' });
  }
  for (const s of SHOALS) if (s.name) label(ctx, s.name, s.label.x, s.label.y, 11 * zs, { italic: true, color: '#e9f1e2', halo: 'rgba(20,60,75,0.6)', spacing: 1 * zs });
  // ports
  PORTS.forEach((p, i) => {
    const dx = p.x - p.land.x, dy = p.y - p.land.y, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d, s = zs;
    ctx.strokeStyle = '#4f3620'; ctx.lineWidth = 5 * s; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(p.land.x + ux * d * 0.35, p.land.y + uy * d * 0.35); ctx.lineTo(p.x - ux * 8, p.y - uy * 8); ctx.stroke();
    ctx.strokeStyle = '#ab8552'; ctx.lineWidth = 3 * s; ctx.stroke();
    for (const [ox, oy, w] of [[-12, -4, 10], [2, -9, 11], [13, -2, 9], [-3, 5, 10]]) {
      const hx = p.land.x - ux * 6 + ox * s, hy = p.land.y - uy * 6 + oy * s, ww = w * s;
      ctx.fillStyle = '#efe5c8'; ctx.strokeStyle = INK; ctx.lineWidth = 0.8 * s; ctx.fillRect(hx - ww / 2, hy - ww * 0.6, ww, ww * 0.6); ctx.strokeRect(hx - ww / 2, hy - ww * 0.6, ww, ww * 0.6);
      ctx.beginPath(); ctx.moveTo(hx - ww / 2 - s, hy - ww * 0.6); ctx.lineTo(hx, hy - ww * 1.15); ctx.lineTo(hx + ww / 2 + s, hy - ww * 0.6); ctx.closePath(); ctx.fillStyle = i === 1 ? '#4b4f5c' : i === 0 ? '#a5553f' : '#7b8a5c'; ctx.fill(); ctx.stroke();
    }
    label(ctx, p.name, p.land.x + (i === 0 ? -40 : i === 1 ? 44 : 0) * zs * (zoom > 1 ? 0 : 1), p.land.y + (i === 2 ? -30 : 28) * zs, 15 * zs, { bold: true, color: i === 0 ? '#6e1f26' : i === 1 ? '#1d2028' : '#3d4a2a' });
  });
  ctx.restore();
}

let chartC: HTMLCanvasElement | null = null;
export function seaChartCanvas(): HTMLCanvasElement {
  if (chartC) return chartC;
  const c = makeCanvas(SEA.w * 2, SEA.h * 2), ctx = c.getContext('2d')!;
  paintChart(ctx, 0, 0, SEA.w, SEA.h, 2, 1);
  ctx.scale(2, 2);
  // rhumb lines from the rose
  ctx.strokeStyle = 'rgba(230,220,180,0.12)'; ctx.lineWidth = 0.8;
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; ctx.beginPath(); ctx.moveTo(470, 660); ctx.lineTo(470 + Math.cos(a) * 2200, 660 + Math.sin(a) * 2200); ctx.stroke(); }
  ctx.fillStyle = 'rgba(240,230,200,0.9)'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.fillRect(SEA.w / 2 - 125, 26, 250, 44); ctx.strokeRect(SEA.w / 2 - 125, 26, 250, 44); ctx.lineWidth = 0.6; ctx.strokeRect(SEA.w / 2 - 121, 30, 242, 36);
  label(ctx, 'THE NARROW SEA', SEA.w / 2, 44, 18, { bold: true, spacing: 3, halo: '' });
  label(ctx, 'with its channel, shoals and havens', SEA.w / 2, 60, 11, { italic: true, halo: '' });
  paperGrain(ctx, SEA.w, SEA.h, { seed: 9 }, 3500, '#0d2a38', '#d8f0ee');
  atlasFrame(ctx, SEA.w, SEA.h, '#2c2218', '#e3d4a8');
  vignette(ctx, SEA.w, SEA.h, '5,20,35', 0.35);
  chartC = c;
  return c;
}
const arenaCache = new WeakMap<SeaBattle, HTMLCanvasElement>();
function arenaCanvas(b: SeaBattle): HTMLCanvasElement {
  let c = arenaCache.get(b);
  if (c) return c;
  const K = 1.25; c = makeCanvas(ARENA.w * K, ARENA.h * K);
  const ctx = c.getContext('2d')!;
  paintChart(ctx, b.ox, b.oy, ARENA.w / SEA.tacScale, ARENA.h / SEA.tacScale, SEA.tacScale * K, SEA.tacScale);
  ctx.scale(K, K);
  paperGrain(ctx, ARENA.w, ARENA.h, { seed: 4 }, 2500, '#0d2a38', '#d8f0ee');
  ctx.strokeStyle = 'rgba(240,230,200,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.strokeRect(6, 6, ARENA.w - 12, ARENA.h - 12); ctx.setLineDash([]);
  vignette(ctx, ARENA.w, ARENA.h, '5,20,35', 0.3);
  arenaCache.set(b, c);
  return c;
}

/** ---------- ships ---------- */
export function drawShip(ctx: CanvasRenderingContext2D, cls: ShipClass, side: Side, x: number, y: number, heading: number, o: { scale?: number; sail?: number; rig?: number; hull?: number; wind?: number; t?: number; flash?: number; id?: number; prize?: boolean } = {}) {
  const C = CLASS[cls], L = C.len, B = L * 0.31, sail = o.sail ?? 1, rig = o.rig ?? 100, t = o.t ?? 0;
  ctx.save(); ctx.translate(x, y); ctx.rotate(heading); ctx.scale(o.scale ?? 1, o.scale ?? 1);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const hull = () => { ctx.beginPath(); ctx.moveTo(L / 2, 0); ctx.quadraticCurveTo(L * 0.3, -B / 2, 0, -B / 2); ctx.lineTo(-L * 0.4, -B * 0.42); ctx.quadraticCurveTo(-L * 0.52, 0, -L * 0.4, B * 0.42); ctx.lineTo(0, B / 2); ctx.quadraticCurveTo(L * 0.3, B / 2, L / 2, 0); ctx.closePath(); };
  ctx.save(); ctx.translate(2, 3); hull(); ctx.fillStyle = 'rgba(5,20,30,0.35)'; ctx.fill(); ctx.restore();
  ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(L / 2 - 2, 0); ctx.lineTo(L * 0.68, 0); ctx.stroke();
  hull(); ctx.fillStyle = side === 0 ? '#5d4028' : '#24211f'; ctx.fill(); ctx.strokeStyle = '#150e08'; ctx.lineWidth = 1; ctx.stroke();
  ctx.save(); ctx.scale(0.86, 0.72); hull(); ctx.fillStyle = side === 0 ? '#bb9763' : '#8f7650'; ctx.fill(); ctx.restore();
  ctx.save(); ctx.scale(0.93, 0.86); hull(); ctx.strokeStyle = side === 0 ? SIDE_TRIM[0] : SIDE_TRIM[1]; ctx.lineWidth = cls === 'flag' ? 1.8 : 1.1; ctx.stroke(); ctx.restore();
  ctx.fillStyle = SIDE_COLOR[side] === '#22262e' ? '#c9a24a' : SIDE_COLOR[side]; ctx.fillRect(-L * 0.44, -B * 0.3, L * 0.07, B * 0.6);
  // gun ports
  const n = Math.round(C.guns / 2.4);
  for (let i = 0; i < n; i++) { const gx = -L * 0.3 + (i / (n - 1)) * L * 0.56; ctx.fillStyle = o.flash && o.flash > 0.15 ? '#ffd27a' : '#15100b'; ctx.fillRect(gx - 0.8, -B / 2 + 0.6, 1.6, 1.6); ctx.fillRect(gx - 0.8, B / 2 - 2.2, 1.6, 1.6); }
  // damage scars
  const dmg = 1 - (o.hull ?? 1);
  for (let i = 0; i < Math.floor(dmg * 7); i++) { const a = (i * 2.4 + (o.id ?? 0)) % TAU; ctx.fillStyle = 'rgba(15,10,5,0.75)'; ctx.beginPath(); ctx.arc(Math.cos(a) * L * 0.28, Math.sin(a * 1.7) * B * 0.28, 1.6 + (i % 3) * 0.6, 0, TAU); ctx.fill(); }
  // masts, yards and sails
  const masts = [[L * 0.24, 0.82], [0, 1], [-L * 0.25, 0.76]];
  const lost = rig < 28 ? 2 : rig < 55 ? 1 : 0;
  masts.forEach(([mx, sz], i) => {
    const w = B * 2.05 * sz, gone = (lost >= 1 && i === 2) || (lost >= 2 && i === 0);
    if (gone) { ctx.fillStyle = '#3a2b1c'; ctx.beginPath(); ctx.arc(mx, 0, 1.6, 0, TAU); ctx.fill(); ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx - 5, B * 0.7); ctx.stroke(); return; }
    const billow = sail === 0 ? 0 : (sail === 1 ? 4.5 : 8) * sz + Math.sin(t * 3 + i + (o.id ?? 0)) * 0.6;
    if (sail > 0) {
      ctx.beginPath(); ctx.moveTo(mx, -w / 2); ctx.quadraticCurveTo(mx + billow * 2, 0, mx, w / 2); ctx.quadraticCurveTo(mx + billow * 0.5, 0, mx, -w / 2); ctx.closePath();
      ctx.fillStyle = o.prize ? '#d9d2c0' : '#f4ecd6'; ctx.fill(); ctx.strokeStyle = 'rgba(90,70,40,0.7)'; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.strokeStyle = 'rgba(150,130,90,0.5)'; ctx.beginPath(); ctx.moveTo(mx + billow * 0.4, -w * 0.25); ctx.quadraticCurveTo(mx + billow * 1.1, -w * 0.12, mx + billow * 0.9, 0); ctx.moveTo(mx + billow * 0.4, w * 0.25); ctx.quadraticCurveTo(mx + billow * 1.1, w * 0.12, mx + billow * 0.9, 0); ctx.stroke();
      const holes = Math.floor((100 - rig) / 14);
      for (let hI = 0; hI < holes; hI++) { if ((hI + i) % 3 !== 0 && holes < 4) continue; ctx.fillStyle = 'rgba(30,60,75,0.85)'; ctx.beginPath(); ctx.arc(mx + billow * 0.6, (((hI * 37 + i * 17) % 20) / 20 - 0.5) * w * 0.7, 1.3, 0, TAU); ctx.fill(); }
    }
    ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = sail === 0 ? 2.6 : 1.4; ctx.beginPath(); ctx.moveTo(mx, -w / 2); ctx.lineTo(mx, w / 2); ctx.stroke();
    if (sail === 0) { ctx.strokeStyle = '#efe6cc'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(mx, -w / 2 + 1); ctx.lineTo(mx, w / 2 - 1); ctx.stroke(); }
    ctx.fillStyle = '#2a1d12'; ctx.beginPath(); ctx.arc(mx, 0, 1.5, 0, TAU); ctx.fill();
  });
  // ensign streaming downwind
  const wa = (o.wind ?? heading + Math.PI) - heading, fl = cls === 'flag' ? 17 : 13;
  ctx.save(); ctx.translate(-L * 0.46, 0); ctx.rotate(wa + Math.sin(t * 6 + (o.id ?? 0)) * 0.12);
  ctx.beginPath();
  if (side === 0) { ctx.moveTo(0, -3); ctx.lineTo(fl, -2.5); ctx.lineTo(fl - 4, 0); ctx.lineTo(fl, 2.5); ctx.lineTo(0, 3); }
  else { ctx.moveTo(0, -3.5); ctx.lineTo(fl - 3, -3.5); ctx.lineTo(fl - 3, 3.5); ctx.lineTo(0, 3.5); }
  ctx.closePath(); ctx.fillStyle = SIDE_COLOR[side]; ctx.fill(); ctx.strokeStyle = SIDE_TRIM[side]; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  ctx.restore();
}
function sideRing(ctx: CanvasRenderingContext2D, side: Side, x: number, y: number, r: number, sel: boolean, t: number) {
  ctx.save();
  ctx.strokeStyle = side === 0 ? (sel ? IVORY : 'rgba(246,239,220,0.55)') : sel ? '#e7c66a' : 'rgba(201,162,74,0.6)'; ctx.lineWidth = sel ? 2.4 : 1.3;
  if (sel) { ctx.setLineDash([7, 5]); ctx.lineDashOffset = -t * 10; }
  ctx.beginPath();
  if (side === 0) ctx.arc(x, y, r, 0, TAU); else { ctx.moveTo(x, y - r * 1.12); ctx.lineTo(x + r * 1.12, y); ctx.lineTo(x, y + r * 1.12); ctx.lineTo(x - r * 1.12, y); ctx.closePath(); }
  ctx.fillStyle = side === 0 ? 'rgba(178,58,58,0.16)' : 'rgba(10,10,15,0.2)'; ctx.fill(); ctx.stroke();
  ctx.restore();
}
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#2c2218'; ctx.lineWidth = 0.8; ctx.stroke();
}
const COMPASS_PTS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
export const windFromName = (windTo: number) => COMPASS_PTS[((Math.round(angNorm(windTo + Math.PI) / (TAU / 8)) % 8) + 8) % 8];

/** Compass rose with the wind arrow; drawn in screen space. */
export function drawCompass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, windTo: number, heading: number | null) {
  ctx.save(); ctx.translate(x, y); const k = r / 44; ctx.scale(k, k); r = 44;
  ctx.fillStyle = 'rgba(16,40,54,0.78)'; ctx.beginPath(); ctx.arc(0, 0, r + 16, 0, TAU); ctx.fill();
  ctx.strokeStyle = BRASS; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 14, 0, TAU); ctx.stroke(); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r + 9, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.stroke();
  for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU, l = i % 4 === 0 ? 6 : 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * (r + 9), Math.sin(a) * (r + 9)); ctx.lineTo(Math.cos(a) * (r + 9 - l), Math.sin(a) * (r + 9 - l)); ctx.stroke(); }
  for (let i = 0; i < 8; i++) {
    const len = i % 2 ? r * 0.55 : r * 0.92;
    ctx.save(); ctx.rotate((i * TAU) / 8);
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(r * 0.13, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fillStyle = '#e9dcbd'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(-r * 0.13, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fillStyle = i === 0 ? '#b23a3a' : '#8a7654'; ctx.fill();
    ctx.restore();
  }
  label(ctx, 'N', 0, -r - 1, 12, { bold: true, color: IVORY, halo: 'rgba(16,40,54,0.9)' });
  if (heading != null) { ctx.save(); ctx.rotate(heading); ctx.strokeStyle = '#e7646a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-r * 0.2, 0); ctx.lineTo(r * 0.7, 0); ctx.stroke(); ctx.fillStyle = '#e7646a'; ctx.beginPath(); ctx.moveTo(r * 0.85, 0); ctx.lineTo(r * 0.62, -5); ctx.lineTo(r * 0.62, 5); ctx.fill(); ctx.restore(); }
  // wind arrow: flies with the wind
  ctx.save(); ctx.rotate(windTo);
  ctx.strokeStyle = '#f6efdc'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-r * 0.95, 0); ctx.lineTo(r * 0.78, 0); ctx.stroke();
  ctx.fillStyle = '#f6efdc'; ctx.beginPath(); ctx.moveTo(r * 1.02, 0); ctx.lineTo(r * 0.68, -8); ctx.lineTo(r * 0.68, 8); ctx.closePath(); ctx.fill();
  ctx.lineWidth = 2; for (const fx of [-0.95, -0.78, -0.61]) { ctx.beginPath(); ctx.moveTo(r * fx, 0); ctx.lineTo(r * (fx - 0.16), -7); ctx.moveTo(r * fx, 0); ctx.lineTo(r * (fx - 0.16), 7); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = 'rgba(16,40,54,0.85)'; ctx.strokeStyle = BRASS; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(-52, r + 20, 104, 20, 4); ctx.fill(); ctx.stroke();
  label(ctx, `WIND from ${windFromName(windTo)}`, 0, r + 30.5, 12, { bold: true, color: IVORY, halo: '', spacing: 1 });
  ctx.restore();
}
function windStreaks(ctx: CanvasRenderingContext2D, W: number, H: number, windTo: number, t: number, len: number) {
  ctx.strokeStyle = 'rgba(235,245,245,0.16)'; ctx.lineWidth = len / 22; ctx.lineCap = 'round';
  const dx = Math.cos(windTo), dy = Math.sin(windTo);
  for (let i = 0; i < 36; i++) {
    const ph = (t * 0.09 + i * 0.137) % 1, bx = ((i * 263.3) % W), by = ((i * 419.7) % H);
    const x = (((bx + dx * ph * W * 0.6) % W) + W) % W, y = (((by + dy * ph * H * 0.6) % H) + H) % H;
    ctx.globalAlpha = Math.sin(ph * Math.PI); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * len, y + dy * len); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** ---------- strategic chart ---------- */
export interface SeaUI { selected: number | null; hover: number | null; preview: Vec[] | null; badAt: Vec | null; t: number; reduced: boolean }
export function drawSea(ctx: CanvasRenderingContext2D, v: View, st: SeaState, ui: SeaUI, cw: number, ch: number) {
  const t = ui.reduced ? 0 : ui.t;
  ctx.save(); ctx.translate(v.ox, v.oy); ctx.scale(v.scale, v.scale);
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.fillRect(0, 0, SEA.w, SEA.h); ctx.shadowBlur = 0;
  ctx.drawImage(seaChartCanvas(), 0, 0, SEA.w, SEA.h);
  ctx.save(); ctx.beginPath(); ctx.rect(12, 12, SEA.w - 24, SEA.h - 24); ctx.clip();
  if (!ui.reduced) windStreaks(ctx, SEA.w, SEA.h, st.wind, t, 26);
  const sel = st.squadrons.find((q) => q.id === ui.selected);
  PORTS.forEach((p, i) => {
    const usable = p.owner === -1 || p.owner === 0;
    ctx.strokeStyle = usable ? 'rgba(246,239,220,0.8)' : 'rgba(201,162,74,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]); ctx.lineDashOffset = -t * 6; ctx.beginPath(); ctx.arc(p.x, p.y, SEA.portRange, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = i === 1 ? '#22262e' : i === 0 ? '#b23a3a' : '#5d7a4a'; ctx.strokeStyle = IVORY; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = IVORY; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5); ctx.moveTo(p.x - 3, p.y - 2.5); ctx.lineTo(p.x + 3, p.y - 2.5); ctx.stroke(); ctx.beginPath(); ctx.arc(p.x, p.y + 1, 4.2, 0.15, Math.PI - 0.15); ctx.stroke();
  });
  for (const q of st.squadrons) if (q.side === 0 && q.path.length) {
    const s = q.id === ui.selected, pts = [{ x: q.x, y: q.y }, ...q.path], end = pts[pts.length - 1];
    dashedPath(ctx, pts, s ? 'rgba(246,239,220,0.95)' : 'rgba(246,239,220,0.4)', s ? 3 : 2, [8, 7], -t * 14);
    ctx.strokeStyle = IVORY; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(end.x - 5, end.y - 5); ctx.lineTo(end.x + 5, end.y + 5); ctx.moveTo(end.x + 5, end.y - 5); ctx.lineTo(end.x - 5, end.y + 5); ctx.stroke();
  }
  if (ui.preview) dashedPath(ctx, ui.preview, 'rgba(246,239,220,0.55)', 1.8, [3, 6]);
  if (ui.badAt) { const b = ui.badAt; ctx.strokeStyle = '#ff8d7a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, TAU); ctx.moveTo(b.x - 6, b.y - 6); ctx.lineTo(b.x + 6, b.y + 6); ctx.stroke(); }
  for (const q of st.squadrons) drawSquadron(ctx, st, q, q.id === ui.selected, q.id === ui.hover, t);
  ctx.restore(); ctx.restore();
  const r = clamp(v.scale * 66, 16, 52);
  drawCompass(ctx, Math.max(v.ox + 22 * v.scale, 8) + r + 18, Math.min(v.oy + SEA.h * v.scale - 22 * v.scale, ch - 8) - r * 1.85, r, st.wind, sel ? sel.heading : null);
}
function drawSquadron(ctx: CanvasRenderingContext2D, st: SeaState, q: Squadron, sel: boolean, hover: boolean, t: number) {
  const ships = shipsOf(st, q), n = ships.length;
  ctx.save(); if (q.immune > 2) ctx.globalAlpha = 0.6;
  sideRing(ctx, q.side, q.x, q.y, 26 + n * 3, sel || hover, t);
  const moving = q.path.length > 0;
  ships.forEach((s, i) => {
    const off = (i - (n - 1) / 2) * 19, x = q.x - Math.cos(q.heading) * off, y = q.y - Math.sin(q.heading) * off;
    if (moving) { ctx.strokeStyle = 'rgba(235,245,245,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - Math.cos(q.heading - 0.35) * 16, y - Math.sin(q.heading - 0.35) * 16); ctx.lineTo(x, y); ctx.lineTo(x - Math.cos(q.heading + 0.35) * 16, y - Math.sin(q.heading + 0.35) * 16); ctx.stroke(); }
    drawShip(ctx, s.cls, s.side, x, y, q.heading, { scale: 0.5, sail: moving ? 2 : 0, rig: s.rig, hull: s.hull / CLASS[s.cls].hull, wind: st.wind, t, id: s.id, prize: s.side !== s.origSide });
  });
  if (ships.some((s) => s.cls === 'flag' && s.side === s.origSide)) star(ctx, q.x, q.y - 36 - n * 3, 8, q.side === 0 ? IVORY : '#e7c66a');
  const hp = ships.reduce((a, s) => a + s.hull / CLASS[s.cls].hull, 0) / Math.max(1, n);
  ctx.fillStyle = 'rgba(10,25,35,0.8)'; ctx.fillRect(q.x - 16, q.y + 30 + n * 3, 32, 5); ctx.fillStyle = hp > 0.6 ? '#7fa650' : hp > 0.3 ? '#d1a13c' : '#c8523f'; ctx.fillRect(q.x - 15, q.y + 31 + n * 3, 30 * hp, 3);
  if (sel || hover) label(ctx, q.name, q.x, q.y - 42 - n * 3 - (ships.some((s) => s.cls === 'flag') ? 12 : 0), 14, { bold: true, color: IVORY, halo: 'rgba(10,25,35,0.85)' });
  ctx.restore();
}

/** ---------- tactical arena ---------- */
export interface SeaBattleUI { selected: number | null; t: number; reduced: boolean }
export function drawSeaBattle(ctx: CanvasRenderingContext2D, v: View, st: SeaState, ui: SeaBattleUI, cw: number, ch: number) {
  const b = st.battle!, t = ui.reduced ? 0 : ui.t;
  ctx.save(); ctx.translate(v.ox, v.oy); ctx.scale(v.scale, v.scale);
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.fillRect(0, 0, ARENA.w, ARENA.h); ctx.shadowBlur = 0;
  ctx.drawImage(arenaCanvas(b), 0, 0, ARENA.w, ARENA.h);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, ARENA.w, ARENA.h); ctx.clip();
  if (!ui.reduced) windStreaks(ctx, ARENA.w, ARENA.h, st.wind, t * 2.5, 60);
  const sel = b.units.find((u) => u.ship === ui.selected && u.st === 'active' && shipOf(st, u).side === 0) ?? null;
  if (sel) {
    const s = shipOf(st, sel);
    // no-go zone: the wind's eye
    const up = st.wind + Math.PI;
    ctx.fillStyle = 'rgba(200,70,60,0.13)'; ctx.strokeStyle = 'rgba(240,150,130,0.6)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(sel.x, sel.y); ctx.arc(sel.x, sel.y, 130, up - 0.52, up + 0.52); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, 'NO-GO · wind’s eye', sel.x + Math.cos(up) * 146, sel.y + Math.sin(up) * 146, 11, { italic: true, color: '#ffd9cf', halo: 'rgba(10,25,35,0.7)' });
    // broadside arcs with reload
    for (const side of [0, 1] as (0 | 1)[]) {
      const beam = sel.heading + (side === 0 ? -Math.PI / 2 : Math.PI / 2), R = SEA.range * SHOT[sel.shot].range;
      const ready = sel.reload[side] <= 0, prog = 1 - sel.reload[side] / reloadTime(s), tg = arcTarget(st, b, sel, side);
      ctx.beginPath(); ctx.moveTo(sel.x, sel.y); ctx.arc(sel.x, sel.y, R, beam - SEA.arc, beam + SEA.arc); ctx.closePath();
      ctx.fillStyle = ready ? (tg ? 'rgba(225,90,60,0.22)' : 'rgba(215,175,95,0.16)') : 'rgba(200,210,215,0.07)'; ctx.fill();
      ctx.strokeStyle = ready ? (tg ? 'rgba(255,150,120,0.95)' : 'rgba(231,198,106,0.9)') : 'rgba(210,220,225,0.45)'; ctx.lineWidth = ready ? 2 : 1.2; if (!ready) ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
      if (!ready) { ctx.beginPath(); ctx.moveTo(sel.x, sel.y); ctx.arc(sel.x, sel.y, R * clamp(prog, 0, 1), beam - SEA.arc, beam + SEA.arc); ctx.closePath(); ctx.fillStyle = 'rgba(215,175,95,0.2)'; ctx.fill(); }
      label(ctx, `${side === 0 ? 'PORT' : 'STARBOARD'} ${ready ? (tg ? '· TARGET' : '· ready') : `· ${sel.reload[side].toFixed(0)}s`}`, sel.x + Math.cos(beam) * (R + 14), sel.y + Math.sin(beam) * (R + 14), 12, { bold: true, color: ready ? '#ffe9b0' : '#cfd8dc', halo: 'rgba(10,25,35,0.75)' });
    }
    // course
    const far = sel.wp ?? { x: sel.x + Math.cos(sel.course) * 170, y: sel.y + Math.sin(sel.course) * 170 };
    dashedPath(ctx, [{ x: sel.x, y: sel.y }, far], 'rgba(246,239,220,0.9)', 2.4, [9, 7], -t * 16);
    ctx.fillStyle = IVORY; ctx.beginPath(); ctx.arc(far.x, far.y, 5, 0, TAU); ctx.fill();
  }
  // wakes
  for (const u of b.units) if (u.st === 'active' && u.speed > 6) {
    const L = CLASS[shipOf(st, u).cls].len, a = clamp(u.speed / 70, 0.1, 0.7), sx = u.x - Math.cos(u.heading) * L * 0.4, sy = u.y - Math.sin(u.heading) * L * 0.4, wl = u.speed * 1.1;
    ctx.strokeStyle = `rgba(235,245,245,${a})`; ctx.lineWidth = 1.6;
    for (const off of [-0.2, 0.2]) { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(u.heading + off) * wl, sy - Math.sin(u.heading + off) * wl); ctx.stroke(); }
    ctx.setLineDash([3, 9]); ctx.lineDashOffset = t * 30; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.cos(u.heading) * wl * 0.9, sy - Math.sin(u.heading) * wl * 0.9); ctx.stroke(); ctx.setLineDash([]);
  }
  // grapples
  for (const bd of b.boardings) if (!bd.done) {
    const ua = b.units.find((u) => u.ship === bd.a)!, ut = b.units.find((u) => u.ship === bd.t)!;
    ctx.strokeStyle = '#2a1d12'; ctx.lineWidth = 1.5; for (const o of [-10, 0, 10]) { ctx.beginPath(); ctx.moveTo(ua.x + o, ua.y); ctx.lineTo(ut.x + o, ut.y); ctx.stroke(); }
  }
  for (const u of [...b.units].sort((a, c) => a.y - c.y)) drawUnit(ctx, st, b, u, u === sel, t);
  // shot, smoke and spray
  ctx.fillStyle = '#15100b'; for (const bl of b.balls) if (bl.t > 0) { const k = bl.t / bl.dur; ctx.beginPath(); ctx.arc(bl.x0 + (bl.x1 - bl.x0) * k, bl.y0 + (bl.y1 - bl.y0) * k - Math.sin(k * Math.PI) * 10, 2.2, 0, TAU); ctx.fill(); }
  for (const f of b.fx) {
    if (f.t < 0) continue; const k = f.t / f.life;
    if (f.kind === 'smoke') { ctx.fillStyle = `rgba(235,232,220,${0.55 * (1 - k)})`; ctx.beginPath(); ctx.arc(f.x, f.y, 5 + k * 16, 0, TAU); ctx.fill(); }
    else if (f.kind === 'splash') { ctx.strokeStyle = `rgba(240,250,250,${1 - k})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(f.x, f.y, 2 + k * 11, 0, TAU); ctx.stroke(); ctx.fillStyle = `rgba(240,250,250,${0.8 * (1 - k)})`; ctx.beginPath(); ctx.arc(f.x, f.y - k * 8, 2.2 * (1 - k), 0, TAU); ctx.fill(); }
    else if (f.kind === 'debris') { ctx.fillStyle = `rgba(90,60,35,${1 - k})`; ctx.fillRect(f.x, f.y, 3, 2); }
    else label(ctx, f.text!, f.x, f.y, 17, { bold: true, color: `rgba(255,236,190,${1 - k * k})`, halo: `rgba(10,25,35,${0.8 * (1 - k)})` });
  }
  // boarding duel readout
  for (const bd of b.boardings) {
    const ua = b.units.find((u) => u.ship === bd.a)!, ut = b.units.find((u) => u.ship === bd.t)!, sa = st.ships[bd.a - 1], sT = st.ships[bd.t - 1];
    const x = (ua.x + ut.x) / 2, y = Math.min(ua.y, ut.y) - 62;
    if (!bd.done) {
      ctx.fillStyle = 'rgba(16,40,54,0.88)'; ctx.strokeStyle = BRASS; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.roundRect(x - 90, y - 26, 180, 44, 5); ctx.fill(); ctx.stroke();
      label(ctx, '⚔ BOARDING ACTION ⚔', x, y - 14, 12, { bold: true, color: '#ffe9b0', halo: '' });
      const tot = sa.crew + sT.crew, wa = (160 * sa.crew) / tot, aSide = sa.side;
      ctx.fillStyle = aSide === 0 ? '#c44a4a' : '#39404d'; ctx.fillRect(x - 80, y, wa, 9); ctx.fillStyle = aSide === 0 ? '#39404d' : '#c44a4a'; ctx.fillRect(x - 80 + wa, y, 160 - wa, 9);
      ctx.strokeStyle = IVORY; ctx.lineWidth = 1; ctx.strokeRect(x - 80, y, 160, 9);
      label(ctx, `${Math.round(sa.crew)}`, x - 80 + 4, y + 4.5, 10, { bold: true, color: IVORY, halo: '', align: 'left' }); label(ctx, `${Math.round(sT.crew)}`, x + 76, y + 4.5, 10, { bold: true, color: IVORY, halo: '', align: 'right' });
      if (t) for (let i = 0; i < 3; i++) { const a = t * 9 + i * 2; ctx.strokeStyle = 'rgba(255,245,220,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 6 + (i - 1) * 14, (ua.y + ut.y) / 2 + Math.sin(a) * 6); ctx.lineTo(x - Math.cos(a) * 6 + (i - 1) * 14, (ua.y + ut.y) / 2 - Math.sin(a) * 6); ctx.stroke(); }
    }
  }
  ctx.restore(); ctx.restore();
  const r = clamp(v.scale * 60, 16, 56);
  drawCompass(ctx, Math.max(v.ox + 14 * v.scale, 8) + r + 18, Math.min(v.oy + ARENA.h * v.scale - 14 * v.scale, ch - 8) - r * 1.85, r, st.wind, sel ? sel.heading : null);
}
function drawUnit(ctx: CanvasRenderingContext2D, st: SeaState, b: SeaBattle, u: Unit, sel: boolean, t: number) {
  const s: Ship = shipOf(st, u), C = CLASS[s.cls];
  if (u.st === 'escaped') return;
  if (u.st === 'sunk') {
    const k = clamp(u.sinkT / 4, 0, 1);
    ctx.save(); ctx.strokeStyle = `rgba(235,245,245,${0.6 * (1 - k)})`; ctx.lineWidth = 1.5; for (const rr of [20, 34]) { ctx.beginPath(); ctx.arc(u.x, u.y, rr * (0.5 + k), 0, TAU); ctx.stroke(); }
    if (k < 1) { ctx.globalAlpha = 1 - k; drawShip(ctx, s.cls, s.side, u.x, u.y, u.heading + k * 0.5, { scale: 1 - k * 0.35, sail: 0, rig: 0, hull: 0, id: s.id }); }
    ctx.restore(); return;
  }
  sideRing(ctx, s.side, u.x, u.y, C.len * 0.6, sel, t);
  drawShip(ctx, s.cls, s.side, u.x, u.y, u.heading, { sail: u.grappled ? 0 : u.sail, rig: s.rig, hull: s.hull / C.hull, wind: st.wind, t, flash: u.flash, id: s.id, prize: s.side !== s.origSide });
  const hp = s.hull / C.hull;
  if (hp < 0.4 && t) for (let i = 0; i < 4; i++) { const k = (t * 0.6 + i * 0.25) % 1; ctx.fillStyle = `rgba(40,35,30,${0.5 * (1 - k)})`; ctx.beginPath(); ctx.arc(u.x + Math.cos(st.wind) * k * 40, u.y + Math.sin(st.wind) * k * 40 - k * 10, 4 + k * 10, 0, TAU); ctx.fill(); }
  if (s.cls === 'flag' && s.side === s.origSide) star(ctx, u.x, u.y - C.len * 0.6 - 16, 9, s.side === 0 ? IVORY : '#e7c66a');
  // status bars: hull, sails, crew — each with its own letter
  const bx = u.x - 24, by = u.y + C.len * 0.6 + 10;
  ctx.fillStyle = 'rgba(10,25,35,0.82)'; ctx.fillRect(bx - 10, by - 1, 60, 17);
  ([['H', hp, hp > 0.5 ? '#8fb85a' : hp > 0.25 ? '#d1a13c' : '#d0553f'], ['S', s.rig / 100, '#efe6cc'], ['C', s.crew / C.crew, '#7fb2d6']] as [string, number, string][]).forEach(([l, val, col], i) => {
    label(ctx, l, bx - 5, by + 2.5 + i * 5, 6.5, { bold: true, color: IVORY, halo: '' });
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(bx, by + 1 + i * 5, 48, 3); ctx.fillStyle = col; ctx.fillRect(bx, by + 1 + i * 5, 48 * clamp(val, 0, 1), 3);
  });
  label(ctx, s.name, u.x, by + 25, 12, { bold: true, italic: true, color: IVORY, halo: 'rgba(10,25,35,0.8)' });
}
export { flagship };
