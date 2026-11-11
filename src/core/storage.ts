/** Storage wrapper that silently degrades to memory when localStorage is unavailable. */
const mem = new Map<string, string>();
const KEY = 'bnb.';
export function load<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(KEY + k);
    if (v != null) return JSON.parse(v) as T;
  } catch { /* unavailable */ }
  const m = mem.get(k);
  return m != null ? (JSON.parse(m) as T) : fallback;
}
export function save(k: string, v: unknown) {
  const s = JSON.stringify(v);
  mem.set(k, s);
  try { localStorage.setItem(KEY + k, s); } catch { /* unavailable */ }
}
export function remove(k: string) {
  mem.delete(k);
  try { localStorage.removeItem(KEY + k); } catch { /* unavailable */ }
}
export type Settings = { muted: boolean; reducedMotion: boolean | null; tutorialDone: { land?: boolean; sea?: boolean } };
export type Progress = { land?: { wins: number; best: number }; sea?: { wins: number; best: number } };
export const loadSettings = (): Settings => ({ muted: false, reducedMotion: null, tutorialDone: {}, ...load<Partial<Settings>>('settings', {}) });
export const loadProgress = (): Progress => load<Progress>('progress', {});
