// Home-screen music: an 8-bar loop synthesised with Web Audio, so there is no audio file to
// load. Notes are queued a little ahead of the clock by a timer, which keeps the loop steady
// even when the main thread is busy. Like fx.js, nothing here may ever throw into the game.

import { audioContext } from './fx.js';

const EIGHTH = 0.3125; // seconds per eighth note, 96 BPM
const LOOKAHEAD = 1.2;
const TICK_MS = 300;
const LEVEL = 0.5;
const FADE_IN = 1.5;
const FADE_OUT = 0.6;

const FREQ = {
  C: 523.25, D: 587.33, E: 659.25, G: 783.99, A: 880,
  c: 261.63, d: 293.66, e: 329.63, g: 392, a: 440,
};

// One entry per bar: bass root, pad chord, and eight melody steps ('.' is a rest).
const BARS = [
  { bass: 130.81, pad: [FREQ.c, FREQ.e, FREQ.g], tune: 'E . G . E . D .' },
  { bass: 110, pad: [220, FREQ.c, FREQ.e], tune: 'C . E . A . G E' },
  { bass: 87.31, pad: [174.61, 220, FREQ.c], tune: 'A . G . E . D .' },
  { bass: 98, pad: [196, 246.94, FREQ.d], tune: 'D . G . A . G .' },
  { bass: 130.81, pad: [FREQ.c, FREQ.e, FREQ.g], tune: 'G . E . G . A .' },
  { bass: 110, pad: [220, FREQ.c, FREQ.e], tune: 'A . G . E . C .' },
  { bass: 87.31, pad: [174.61, 220, FREQ.c], tune: 'A G E G A . G .' },
  { bass: 98, pad: [196, 246.94, FREQ.d], tune: 'D E G . D . C .' },
].map((bar) => ({ ...bar, tune: bar.tune.split(' ') }));

const STEPS_PER_BAR = 8;

let enabled = true;
let wanted = false;
let timer = null;
let master = null;
let nextTime = 0;
let step = 0;

function note(ctx, { freq, type, start, dur, vol, attack = 0.01 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(vol, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

function playStep(ctx, index, time) {
  const bar = BARS[Math.floor(index / STEPS_PER_BAR) % BARS.length];
  const pos = index % STEPS_PER_BAR;
  const token = bar.tune[pos];
  if (token !== '.') note(ctx, { freq: FREQ[token], type: 'sine', start: time, dur: 0.55, vol: 0.16 });
  if (pos % 4 === 0) note(ctx, { freq: bar.bass, type: 'sine', start: time, dur: 1.1, vol: 0.28 });
  if (pos === 0) {
    bar.pad.forEach((freq) => note(ctx, {
      freq, type: 'triangle', start: time, dur: EIGHTH * STEPS_PER_BAR, vol: 0.07, attack: 0.5,
    }));
  }
}

function schedule(ctx) {
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    playStep(ctx, step, nextTime);
    nextTime += EIGHTH;
    step += 1;
  }
}

function ensureMaster(ctx) {
  if (master) return;
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
}

function fadeTo(ctx, level, seconds) {
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(level, ctx.currentTime + seconds);
}

function start() {
  if (timer !== null) return;
  const ctx = audioContext();
  if (!ctx) return;
  ensureMaster(ctx);
  nextTime = ctx.currentTime + 0.1;
  step = 0;
  fadeTo(ctx, LEVEL, FADE_IN);
  schedule(ctx);
  timer = setInterval(() => schedule(ctx), TICK_MS);
}

function stop() {
  if (timer === null) return;
  const ctx = audioContext();
  clearInterval(timer);
  timer = null;
  if (ctx) fadeTo(ctx, 0, FADE_OUT);
}

// Browsers keep audio locked until a tap, and creating the context earlier only logs a warning.
const userHasTapped = () => navigator.userActivation?.hasBeenActive !== false;

export function syncMusic() {
  try {
    const shouldPlay = enabled && wanted && !document.hidden && userHasTapped();
    if (shouldPlay) start();
    else stop();
  } catch { /* music is optional */ }
}

export function setMusicEnabled(on) {
  enabled = on;
  syncMusic();
}

export function setMusicWanted(on) {
  wanted = on;
  syncMusic();
}

document.addEventListener('visibilitychange', syncMusic);
