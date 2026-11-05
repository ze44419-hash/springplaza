/** Tiny WebAudio chimes — no audio files to ship. Browsers require a user gesture first, so we unlock on first tap. */
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

function tone(freq: number, start: number, dur: number, gain = 0.18) {
  const c = getCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export type ChimeKind = 'newOrder' | 'ready' | 'error';

export function playChime(kind: ChimeKind) {
  try {
    if (kind === 'newOrder') { tone(660, 0, 0.18); tone(880, 0.16, 0.18); tone(1100, 0.32, 0.3); }
    if (kind === 'ready')    { tone(880, 0, 0.16); tone(1320, 0.14, 0.34); }
    if (kind === 'error')    { tone(240, 0, 0.3, 0.22); }
    if ('vibrate' in navigator) navigator.vibrate?.(kind === 'error' ? [120] : [80, 60, 80]);
  } catch { /* audio is best-effort */ }
}
