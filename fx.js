// Sound, haptics and confetti. Every export is safe to call when the platform
// feature is missing or blocked: failures are swallowed on purpose, because an
// effect must never break the game.

let soundOn = true;
let hapticsOn = true;
let ctx = null;

export const setSound = (on) => { soundOn = on; };
export const setHaptics = (on) => { hapticsOn = on; };

const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// iOS Safari has no vibrate(), but toggling a native <input switch> (Safari 17.4+) ticks the
// Taptic Engine. We detect iOS by user agent because the attribute has no feature test.
const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const hapticsSupported = () => canVibrate() || isIOS();

let tickLabel = null;
function iosTick() {
  if (!tickLabel) {
    tickLabel = document.createElement('label');
    tickLabel.setAttribute('aria-hidden', 'true');
    tickLabel.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    tickLabel.append(input);
    document.body.append(tickLabel);
  }
  tickLabel.click();
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function attempt(fn) {
  try { fn(); } catch { /* effects are optional */ }
}

function audio() {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (Ctor) ctx = new Ctor();
  return ctx;
}

// Shared with music.js so both play through one context.
export const audioContext = audio;

// Browsers keep audio suspended until a user gesture; call this from one.
export function unlockAudio() {
  attempt(() => {
    const c = audio();
    if (c && c.state === 'suspended') c.resume();
  });
}

// The audio context, or null while sound is off or the browser still blocks it.
function runningAudio() {
  const c = audio();
  return soundOn && c && c.state === 'running' ? c : null;
}

function tone({ freq, to = freq, dur = 0.12, type = 'sine', vol = 0.18, delay = 0 }) {
  const c = runningAudio();
  if (!c) return;
  const start = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.12, delay = 0, freq = 1200 }) {
  const c = runningAudio();
  if (!c) return;
  const length = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  gain.gain.value = vol;
  src.buffer = buffer;
  src.connect(filter).connect(gain).connect(c.destination);
  src.start(c.currentTime + delay);
}

const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
const arpeggio = (notes, gap, opts) => notes.forEach((freq, i) => tone({ freq, delay: i * gap, ...opts }));

// Glassy bell: a pure tone plus a quiet inharmonic partial that dies fast.
const bell = (freq, delay = 0, vol = 0.16) => {
  tone({ freq, dur: 0.38, vol, delay });
  tone({ freq: freq * 2.76, dur: 0.16, vol: vol * 0.35, delay });
};

// Rising sparkle run over a pentatonic scale, the "sweet" sound of a candy-game reward.
const SPARKLE = [783.99, 987.77, 1174.66, 1318.51, 1567.98, 1975.53, 2349.32];
const sparkle = (count, gap = 0.055, vol = 0.1) =>
  SPARKLE.slice(0, count).forEach((freq, i) => bell(freq, i * gap, vol));

// Each sound is wrapped once so callers never need a try/catch.
const raw = {
  entry: () => { noise({ dur: 0.28, vol: 0.06, freq: 3200 }); sparkle(4, 0.06, 0.08); },
  // A bubbly "blip": quick upward sine slide.
  tap: () => tone({ freq: 380, to: 760, dur: 0.07, type: 'sine', vol: 0.12 }),
  // Pitch climbs a scale step per safe pick, so a streak sounds like momentum.
  safe: (step = 0) => {
    const freq = NOTES[step % NOTES.length] * (1 + Math.floor(step / NOTES.length));
    bell(freq, 0, 0.2);
    // From the 4th pick a shimmer rides on top: the streak is getting valuable.
    if (step >= 3) tone({ freq: freq * 3, dur: 0.14, type: 'sine', vol: 0.04, delay: 0.09 });
  },
  reveal: (order = 0) => tone({ freq: 240 - order * 9, to: 130, dur: 0.12, type: 'sine', vol: 0.08, delay: order * 0.07 }),
  // Cartoon "wah-wah" slide down rather than a horror growl.
  spider: () => {
    tone({ freq: 330, to: 90, dur: 0.5, type: 'triangle', vol: 0.2 });
    tone({ freq: 220, to: 60, dur: 0.5, type: 'sawtooth', vol: 0.08, delay: 0.05 });
    noise({ dur: 0.25, vol: 0.1, freq: 700 });
  },
  cashout: () => { sparkle(6, 0.06, 0.12); bell(2637, 0.4, 0.08); },
  win: () => {
    sparkle(7, 0.07, 0.14);
    arpeggio([523.25, 659.25, 783.99, 1046.5], 0.12, { dur: 0.4, type: 'triangle', vol: 0.1, delay: 0.45 });
    bell(2093, 0.95, 0.12);
  },
  left: () => arpeggio([880, 659.25], 0.1, { dur: 0.25, type: 'sine', vol: 0.12 }),
  unlock: () => {
    noise({ dur: 0.15, vol: 0.08, freq: 3600 });
    sparkle(7, 0.065, 0.11);
    arpeggio([523.25, 659.25, 783.99, 1046.5], 0.1, { dur: 0.45, type: 'triangle', vol: 0.09, delay: 0.5 });
  },
  sonar: () => { tone({ freq: 1200, to: 900, dur: 0.5, vol: 0.14 }); tone({ freq: 1200, to: 900, dur: 0.5, vol: 0.05, delay: 0.18 }); },
  error: () => tone({ freq: 220, to: 150, dur: 0.2, type: 'triangle', vol: 0.14 }),
};

export const sfx = Object.fromEntries(
  Object.entries(raw).map(([name, fn]) => [name, (...args) => attempt(() => fn(...args))]),
);

// Chrome logs an error for vibrate() before the first tap, so wait for one.
const hasUserTapped = () => navigator.userActivation?.hasBeenActive !== false;

export function buzz(pattern) {
  if (!hapticsOn || !hasUserTapped()) return;
  if (canVibrate()) attempt(() => navigator.vibrate(pattern));
  else if (isIOS()) attempt(iosTick);
}

function confettiCount(base) {
  const small = typeof innerWidth === 'number' && innerWidth < 600;
  return small ? Math.round(base * 0.5) : base;
}

// tier: 'small' for a modest cash out, 'big' for a win.
export function celebrate(tier) {
  if (prefersReducedMotion() || typeof globalThis.confetti !== 'function') return;
  attempt(() => {
    const colors = ['#ff5fb8', '#ffd43b', '#5fd34b', '#3d9bff', '#9157f0', '#ff8a2b'];
    if (tier === 'small') {
      globalThis.confetti({ particleCount: confettiCount(60), spread: 70, origin: { y: 0.7 }, colors });
      return;
    }
    globalThis.confetti({ particleCount: confettiCount(140), spread: 100, origin: { y: 0.65 }, colors });
    setTimeout(() => {
      globalThis.confetti({ particleCount: confettiCount(60), angle: 60, spread: 60, origin: { x: 0, y: 0.8 }, colors });
      globalThis.confetti({ particleCount: confettiCount(60), angle: 120, spread: 60, origin: { x: 1, y: 0.8 }, colors });
    }, 250);
  });
}
