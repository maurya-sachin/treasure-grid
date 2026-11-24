// Pure game logic. No DOM, no side effects: every action returns a new session.

export const GRID = 25;
export const COLS = 5;
export const LEVELS = [1, 3, 5, 8, 12, 16]; // spiders per level 0..5
export const STAKES = [10, 50, 100, 250];
export const START_DIAMONDS = 1000;
export const START_CREDITS = 100;
export const SCAN_SAFE_COST = 40;
export const SCAN_ROW_COST = 15;
export const WIN_REWARD = 10;
export const UNLOCK_REWARD = 25;
export const RESCUE_DIAMONDS = 500;
export const UNLOCK_MULTIPLIER = 1.5;
export const MAX_MULTIPLIER = 1000;
const EDGE = 0.97;
const MAX_SAVED = 1e9;

export function multiplier(spiders, picks) {
  if (picks <= 0) return 1;
  const safe = GRID - spiders;
  let survive = 1;
  for (let i = 0; i < picks; i += 1) survive *= (safe - i) / (GRID - i);
  // The epsilon absorbs float error just below an exact cent boundary.
  return Math.floor((EDGE / survive) * 100 + 1e-9) / 100;
}

export function maxPicks(spiders) {
  const safe = GRID - spiders;
  let picks = 0;
  while (picks < safe && multiplier(spiders, picks + 1) <= MAX_MULTIPLIER) picks += 1;
  return picks;
}

const defaultFill = (arr) => globalThis.crypto.getRandomValues(arr);

// Uniform integer in [0, max). Rejection sampling avoids modulo bias.
export function randomInt(max, fill = defaultFill) {
  const range = 2 ** 32;
  const limit = range - (range % max);
  const buf = new Uint32Array(1);
  let value = fill(buf)[0];
  while (value >= limit) value = fill(buf)[0];
  return value % max;
}

export function placeSpiders(count, random) {
  if (!Number.isInteger(count) || count < 1 || count >= GRID) {
    throw new RangeError(`spider count must be 1..${GRID - 1}`);
  }
  const tiles = Array.from({ length: GRID }, (_, i) => i);
  for (let i = GRID - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles.slice(0, count).sort((a, b) => a - b);
}

export function newSession() {
  return { diamonds: START_DIAMONDS, credits: START_CREDITS, unlocked: 0, rescueUsed: false, round: null };
}

const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_SAVED;

export function sanitizeSaved(raw) {
  const base = newSession();
  if (raw === null || typeof raw !== 'object') return base;
  return {
    ...base,
    diamonds: isCount(raw.diamonds) ? raw.diamonds : base.diamonds,
    credits: isCount(raw.credits) ? raw.credits : base.credits,
    unlocked: Number.isInteger(raw.unlocked) && raw.unlocked >= 0 && raw.unlocked < LEVELS.length
      ? raw.unlocked : base.unlocked,
    rescueUsed: raw.rescueUsed === true,
  };
}

const fail = (session, reason) => ({ session, outcome: 'error', reason });
const ignored = (session) => ({ session, outcome: 'ignored' });
const isPlaying = (session) => session.round !== null && session.round.status === 'playing';

// Bag in whole Diamonds. Integer cents keep the product free of float drift.
export function bagValue(round) {
  const cents = Math.round(multiplier(round.spiders.length, round.picks) * 100);
  return Math.floor((round.stake * cents) / 100);
}

export function isBroke(session) {
  return !isPlaying(session) && session.diamonds < STAKES[0];
}

const isLevel = (level) => Number.isInteger(level) && level >= 0 && level < LEVELS.length;
const isAllowedStake = (level, stake) => STAKES.includes(stake) && (level !== 0 || stake === STAKES[0]);

function stakeError(session, level, stake) {
  if (!isLevel(level)) return 'level';
  if (level > session.unlocked) return 'locked';
  if (!isAllowedStake(level, stake)) return 'stake';
  if (stake > session.diamonds) return 'balance';
  return null;
}

export function beginRound(session, { level, stake, random = randomInt }) {
  if (isPlaying(session)) return fail(session, 'active');
  const reason = stakeError(session, level, stake);
  if (reason) return fail(session, reason);
  const round = {
    level, stake, status: 'playing', picks: 0, payout: 0,
    spiders: placeSpiders(LEVELS[level], random),
    revealed: [], marked: [], scans: {},
  };
  return { session: { ...session, diamonds: session.diamonds - stake, round }, outcome: 'started' };
}

const isSafeTile = (round, index) => !round.spiders.includes(index);
const revealedSafe = (round) => round.revealed.filter((i) => isSafeTile(round, i)).length;

// Pays out the bag and applies the Credit and unlock rewards.
function settle(session, status) {
  const { round } = session;
  const payout = bagValue(round);
  const mult = multiplier(round.spiders.length, round.picks);
  const profitable = payout > round.stake;
  const unlocks = profitable && mult >= UNLOCK_MULTIPLIER
    && round.level === session.unlocked && session.unlocked < LEVELS.length - 1;
  const credits = session.credits + (profitable ? WIN_REWARD : 0) + (unlocks ? UNLOCK_REWARD : 0);
  return {
    session: {
      ...session,
      diamonds: session.diamonds + payout,
      credits,
      unlocked: unlocks ? session.unlocked + 1 : session.unlocked,
      round: { ...round, status, payout },
    },
    payout,
    unlocked: unlocks,
  };
}

function isPickable(session, index) {
  if (!isPlaying(session)) return false;
  if (!Number.isInteger(index) || index < 0 || index >= GRID) return false;
  return !session.round.revealed.includes(index);
}

function revealSafe(session, index) {
  const { round } = session;
  const free = round.marked.includes(index);
  const next = {
    ...round,
    revealed: [...round.revealed, index],
    picks: free ? round.picks : round.picks + 1,
  };
  const updated = { ...session, round: next };
  const done = revealedSafe(next) === GRID - next.spiders.length || next.picks >= maxPicks(next.spiders.length);
  if (done) return { ...settle(updated, 'won'), outcome: 'won' };
  return { session: updated, outcome: free ? 'safe-free' : 'safe' };
}

export function pick(session, index) {
  if (!isPickable(session, index)) return ignored(session);
  const { round } = session;
  if (isSafeTile(round, index)) return revealSafe(session, index);
  const lost = { ...round, revealed: [...round.revealed, index], status: 'lost', payout: 0 };
  return { session: { ...session, round: lost }, outcome: 'spider', payout: 0 };
}

export function leave(session) {
  if (!isPlaying(session)) return ignored(session);
  return { ...settle(session, 'left'), outcome: 'left' };
}

export function sonarSafe(session, random = randomInt) {
  if (session.round === null) return fail(session, 'no-round');
  if (!isPlaying(session)) return ignored(session);
  if (session.credits < SCAN_SAFE_COST) return fail(session, 'credits');
  const { round } = session;
  const open = Array.from({ length: GRID }, (_, i) => i)
    .filter((i) => isSafeTile(round, i) && !round.revealed.includes(i) && !round.marked.includes(i));
  if (open.length === 0) return fail(session, 'nothing');
  const index = open[random(open.length)];
  const next = { ...round, marked: [...round.marked, index] };
  return { session: { ...session, credits: session.credits - SCAN_SAFE_COST, round: next }, outcome: 'sonar', index };
}

export function sonarRow(session, row) {
  if (session.round === null) return fail(session, 'no-round');
  if (!isPlaying(session)) return ignored(session);
  if (!Number.isInteger(row) || row < 0 || row >= GRID / COLS) return fail(session, 'row');
  if (session.credits < SCAN_ROW_COST) return fail(session, 'credits');
  const { round } = session;
  if (row in round.scans) return fail(session, 'scanned');
  const count = round.spiders.filter((i) => Math.floor(i / COLS) === row).length;
  const next = { ...round, scans: { ...round.scans, [row]: count } };
  return { session: { ...session, credits: session.credits - SCAN_ROW_COST, round: next }, outcome: 'scan', count };
}

export function claimRescue(session) {
  if (!isBroke(session) || session.rescueUsed) return ignored(session);
  return {
    session: { ...session, diamonds: session.diamonds + RESCUE_DIAMONDS, rescueUsed: true },
    outcome: 'rescued',
  };
}
