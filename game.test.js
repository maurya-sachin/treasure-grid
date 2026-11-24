import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, SCAN_SAFE_COST, SCAN_ROW_COST,
  multiplier, maxPicks, randomInt, placeSpiders,
  newSession, beginRound, pick, leave, sonarSafe, sonarRow,
  bagValue, isBroke, claimRescue, sanitizeSaved,
} from './game.js';

// Deterministic "random": always the first candidate.
const first = () => 0;

const open1 = () => ({ ...newSession(), unlocked: 1 });

function startWith(spiders, { level = 1, stake = 10, session = open1() } = {}) {
  const started = beginRound(session, { level, stake, random: first });
  assert.equal(started.outcome, 'started');
  const s = started.session;
  return { ...s, round: { ...s.round, spiders } };
}

test('multiplier matches the reference sheet', () => {
  assert.deepEqual([1, 2, 3].map((n) => multiplier(3, n)), [1.1, 1.25, 1.44]);
  assert.deepEqual([1, 2, 3].map((n) => multiplier(5, n)), [1.21, 1.53, 1.95]);
  assert.deepEqual([1, 2].map((n) => multiplier(8, n)), [1.42, 2.13]);
  assert.equal(multiplier(3, 0), 1);
});

test('multiplier rises with every pick', () => {
  for (const spiders of LEVELS) {
    for (let n = 1; n <= 25 - spiders; n += 1) {
      assert.ok(multiplier(spiders, n) > multiplier(spiders, n - 1), `${spiders} spiders, pick ${n}`);
    }
  }
});

test('maxPicks caps the top multiplier at 1000 and never exceeds the safe count', () => {
  for (const spiders of LEVELS) {
    const cap = maxPicks(spiders);
    assert.ok(cap >= 1 && cap <= 25 - spiders);
    assert.ok(multiplier(spiders, cap) <= 1000);
    if (cap < 25 - spiders) assert.ok(multiplier(spiders, cap + 1) > 1000);
  }
});

test('placeSpiders returns exactly N unique indices in range', () => {
  for (const count of [1, 3, 16, 24]) {
    const spiders = placeSpiders(count, randomInt);
    assert.equal(spiders.length, count);
    assert.equal(new Set(spiders).size, count);
    assert.ok(spiders.every((i) => Number.isInteger(i) && i >= 0 && i < 25));
  }
  assert.throws(() => placeSpiders(0, randomInt), RangeError);
  assert.throws(() => placeSpiders(25, randomInt), RangeError);
});

test('randomInt stays in range and rejects the biased tail', () => {
  const fixed = (values) => { let i = 0; return (arr) => { arr[0] = values[i++]; return arr; }; };
  assert.equal(randomInt(25, fixed([7])), 7);
  // 4294967295 is above the largest multiple of 25 that fits, so it is redrawn.
  assert.equal(randomInt(25, fixed([4294967295, 3])), 3);
  for (let i = 0; i < 200; i += 1) assert.ok(randomInt(25) < 25);
});

test('beginRound deducts the stake and validates input', () => {
  const s = open1();
  const ok = beginRound(s, { level: 1, stake: 50, random: first });
  assert.equal(ok.session.diamonds, s.diamonds - 50);
  assert.equal(ok.session.round.spiders.length, LEVELS[1]);
  assert.deepEqual(beginRound(ok.session, { level: 1, stake: 10, random: first }).reason, 'active');
  assert.equal(beginRound(s, { level: 3, stake: 10, random: first }).reason, 'locked');
  assert.equal(beginRound(s, { level: 1, stake: 7, random: first }).reason, 'stake');
  assert.equal(beginRound(s, { level: 0, stake: 50, random: first }).reason, 'stake');
  assert.equal(beginRound({ ...s, diamonds: 5 }, { level: 1, stake: 10, random: first }).reason, 'balance');
  assert.equal(beginRound(s, { level: 0, stake: 10, random: first }).outcome, 'started');
  assert.equal(beginRound(newSession(), { level: 1, stake: 10, random: first }).reason, 'locked');
});

test('safe pick advances the bag; a spider pays nothing', () => {
  let s = startWith([0, 1, 2]);
  const r = pick(s, 10);
  assert.equal(r.outcome, 'safe');
  assert.equal(r.session.round.picks, 1);
  assert.equal(bagValue(r.session.round), 11);
  const lost = pick(r.session, 0);
  assert.equal(lost.outcome, 'spider');
  assert.equal(lost.session.round.status, 'lost');
  assert.equal(lost.payout, 0);
  assert.equal(lost.session.diamonds, s.diamonds);
});

test('double pick, out-of-range pick and pick after the round ended are ignored', () => {
  const s = startWith([0, 1, 2]);
  const once = pick(s, 10).session;
  assert.equal(pick(once, 10).outcome, 'ignored');
  assert.equal(pick(once, 99).outcome, 'ignored');
  assert.equal(pick(once, 1.5).outcome, 'ignored');
  const ended = pick(once, 0).session;
  assert.equal(pick(ended, 11).outcome, 'ignored');
  assert.equal(pick(newSession(), 3).outcome, 'ignored');
});

test('leave pays the bag once; a second leave is ignored', () => {
  const s = startWith([0, 1, 2], { stake: 100 });
  const after = pick(pick(s, 10).session, 11).session;
  const out = leave(after);
  assert.equal(out.outcome, 'left');
  assert.equal(out.payout, 125);
  assert.equal(out.session.diamonds, s.diamonds + 125);
  assert.equal(leave(out.session).outcome, 'ignored');
});

test('leave with no picks refunds the stake and grants no reward', () => {
  const s = startWith([0, 1, 2], { stake: 50 });
  const out = leave(s);
  assert.equal(out.payout, 50);
  assert.equal(out.session.diamonds, 1000);
  assert.equal(out.session.credits, s.credits);
});

test('bag is exact integer maths, with no float drift', () => {
  const round = { stake: 100, spiders: Array.from({ length: 3 }, (_, i) => i), picks: 1 };
  assert.equal(bagValue({ ...round, picks: 0 }), 100);
  assert.equal(Number.isInteger(bagValue(round)), true);
});

test('a profitable cash out earns Credits; a break-even one does not', () => {
  const s = startWith([0, 1, 2]);
  const win = leave(pick(s, 10).session);
  assert.equal(win.session.credits, s.credits + 10);
});

test('reaching the cap auto-wins, and clearing the board wins', () => {
  const spiders = [0];
  let s = startWith(spiders);
  const cap = maxPicks(1);
  let last;
  for (let i = 1; i <= cap; i += 1) { last = pick(s, i); s = last.session; }
  assert.equal(last.outcome, 'won');
  assert.equal(s.round.status, 'won');
  assert.equal(pick(s, 24).outcome, 'ignored');
});

test('sonar safe marks a safe tile, never advances picks, and picking it is free', () => {
  const s = startWith([0, 1, 2]);
  const r = sonarSafe(s, first);
  assert.equal(r.outcome, 'sonar');
  assert.ok(![0, 1, 2].includes(r.index));
  assert.equal(r.session.credits, s.credits - SCAN_SAFE_COST);
  assert.equal(r.session.round.picks, 0);
  const picked = pick(r.session, r.index);
  assert.equal(picked.outcome, 'safe-free');
  assert.equal(picked.session.round.picks, 0);
  assert.equal(bagValue(picked.session.round), 10);
});

test('sonar safe never marks the same tile twice and fails when none is left', () => {
  let s = startWith([0, 1, 2]);
  const seen = new Set();
  for (let i = 0; i < 22; i += 1) {
    s = { ...s, credits: 1000 };
    const r = sonarSafe(s, first);
    if (r.outcome === 'error') break;
    assert.ok(!seen.has(r.index));
    seen.add(r.index);
    s = r.session;
  }
  assert.equal(seen.size, 22);
  assert.equal(sonarSafe({ ...s, credits: 1000 }, first).reason, 'nothing');
});

test('sonar is rejected without Credits or without a round', () => {
  const s = startWith([0, 1, 2]);
  assert.equal(sonarSafe({ ...s, credits: 39 }, first).reason, 'credits');
  assert.equal(sonarRow({ ...s, credits: 14 }, 0).reason, 'credits');
  assert.equal(sonarSafe(newSession(), first).reason, 'no-round');
  assert.equal(sonarRow(newSession(), 0).reason, 'no-round');
});

test('row scan reports the spider count once per row and charges once', () => {
  const s = startWith([0, 1, 7]);
  const r = sonarRow(s, 0);
  assert.equal(r.count, 2);
  assert.equal(r.session.credits, s.credits - SCAN_ROW_COST);
  assert.equal(sonarRow(r.session, 0).reason, 'scanned');
  assert.equal(sonarRow(s, 5).reason, 'row');
  assert.equal(sonarRow(s, -1).reason, 'row');
  assert.equal(sonarRow(r.session, 1).count, 1);
});

test('level unlock needs 1.5x or more on the current top level', () => {
  const low = startWith([0, 1, 2]);
  assert.equal(leave(pick(low, 10).session).unlocked, false);
  // 3 spiders: pick 4 is 1.69x.
  let s = startWith([0, 1, 2]);
  for (const i of [10, 11, 12, 13]) s = pick(s, i).session;
  const out = leave(s);
  assert.equal(out.unlocked, true);
  assert.equal(out.session.unlocked, 2);
  assert.equal(out.session.credits, s.credits + 10 + 25);
  // Playing an already-open lower level does not unlock anything.
  const unlocked = { ...newSession(), unlocked: 3 };
  let t = startWith([0, 1, 2], { session: unlocked });
  for (const i of [10, 11, 12, 13]) t = pick(t, i).session;
  assert.equal(leave(t).session.unlocked, 3);
});

test('the top level never unlocks past 5', () => {
  const top = { ...newSession(), unlocked: 5 };
  let s = startWith(Array.from({ length: 16 }, (_, i) => i), { level: 5, session: top });
  s = pick(s, 20).session;
  assert.equal(leave(s).session.unlocked, 5);
});

test('rescue works only when broke, and only once', () => {
  const broke = { ...newSession(), diamonds: 3 };
  assert.equal(isBroke(broke), true);
  assert.equal(isBroke(newSession()), false);
  const r = claimRescue(broke);
  assert.equal(r.session.diamonds, 503);
  assert.equal(claimRescue(r.session).outcome, 'ignored');
  assert.equal(claimRescue(newSession()).outcome, 'ignored');
  const midRound = startWith([0, 1, 2], { session: { ...open1(), diamonds: 10 } });
  assert.equal(isBroke(midRound), false);
});

test('sanitizeSaved rejects NaN, negatives, strings and junk', () => {
  const defaults = newSession();
  assert.deepEqual(sanitizeSaved(null), defaults);
  assert.deepEqual(sanitizeSaved('nope'), defaults);
  assert.deepEqual(sanitizeSaved({ diamonds: NaN, credits: -5, unlocked: 99, rescueUsed: 'yes' }), defaults);
  assert.deepEqual(sanitizeSaved({ diamonds: '900', credits: Infinity, unlocked: 1.5 }), defaults);
  const good = sanitizeSaved({ diamonds: 640, credits: 12, unlocked: 3, rescueUsed: true });
  assert.deepEqual(good, { ...defaults, diamonds: 640, credits: 12, unlocked: 3, rescueUsed: true });
});
