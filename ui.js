// Rendering, input and animation. All rules live in game.js; this file only
// turns a session into DOM and turns events into game actions.
import {
  COLS, GRID, LEVELS, STAKES, SCAN_ROW_COST,
  multiplier, maxPicks, newSession, sanitizeSaved, beginRound, pick, leave,
  sonarSafe, sonarRow, bagValue, isBroke, claimRescue,
} from './game.js';
import {
  setSound, setHaptics, hapticsSupported, prefersReducedMotion, unlockAudio, sfx, buzz, celebrate,
} from './fx.js';
import { setMusicEnabled, setMusicWanted, syncMusic } from './music.js';

const WALLET_KEY = 'treasure-grid:wallet';
const PREFS_KEY = 'treasure-grid:prefs';
const ROWS = GRID / COLS;
const MOVES = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
const ERROR_COPY = {
  active: 'A round is already running.',
  locked: 'That level is still locked.',
  stake: 'Pick a valid stake for this level.',
  balance: 'Not enough Diamonds for that stake.',
  credits: 'Not enough Credits. A profitable cash out earns more.',
  nothing: 'No safe tiles left to reveal.',
  scanned: 'That row is already scanned.',
  row: 'That row cannot be scanned.',
  'no-round': 'Start a round first.',
};
const FIRST_PICK_HINT = 'Tap a tile. Dodge the spiders.';

const $ = (id) => document.getElementById(id);
// Icons come from the sprite in index.html. Only fixed names are passed in, never user input.
const icon = (name) => `<svg class="ico" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const el = {
  board: $('board'), scanCol: $('scan-col'), home: $('home'), game: $('game'),
  levels: $('levels'), stakes: $('stakes'),
};

let session = newSession();
let selection = { stake: STAKES[0] };
// Unlocks are earned only on the top level. Play defaults to it; a cleared level can be picked to replay.
const currentLevel = () => session.unlocked;
let selectedLevel = null;
const playLevel = () => Math.min(selectedLevel ?? currentLevel(), currentLevel());
let busy = false;
let pendingUnlock = null;

// ---------- storage (every access guarded: it can throw or be blocked) ----------

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage is optional */ }
}

// A round is never persisted, so a stake in play is refunded on reload.
function save() {
  const { diamonds, credits, unlocked, rescueUsed, round } = session;
  const playing = round !== null && round.status === 'playing';
  writeStore(WALLET_KEY, { diamonds: playing ? diamonds + round.stake : diamonds, credits, unlocked, rescueUsed });
}

const adopt = (next) => { session = next; save(); };

// ---------- small DOM helpers ----------

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, prefersReducedMotion() ? 0 : ms); });

function announce(text) {
  $('announce').textContent = text;
}

function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth; // restart the CSS animation
  node.classList.add(cls);
  node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
}

function countTo(node, to, ms = 380) {
  const from = Number(node.dataset.v ?? to);
  node.dataset.v = String(to);
  if (from === to || prefersReducedMotion()) {
    node.textContent = String(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    node.textContent = String(Math.round(from + (to - from) * t));
    if (t < 1 && Number(node.dataset.v) === to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function toast(message, kind = 'ok') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  $('toasts').append(node);
  if (kind === 'error') { sfx.error(); buzz(50); }
  setTimeout(() => {
    node.classList.add('out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, 2600);
}

const toastError = (reason) => toast(ERROR_COPY[reason] ?? 'Something went wrong.', 'error');

function openDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}

const closeDialog = (id) => $(id).close();

// ---------- wallet and stats ----------

function renderWallet() {
  const pairs = [['diamonds', session.diamonds], ['credits', session.credits]];
  for (const [id, value] of pairs) {
    const node = $(id);
    const changed = node.dataset.v !== undefined && Number(node.dataset.v) !== value;
    countTo(node, value);
    if (changed) replay($(`${id}-chip`), 'bump');
  }
}

// Odds that the next unmarked tile hides a spider. Only safe tiles are ever
// in `revealed` while a round is live, so every spider is still hidden.
function renderRisk(round) {
  const hidden = GRID - round.revealed.length;
  const pct = Math.round((round.spiders.length / hidden) * 100);
  $('risk').textContent = `Next tile: ${pct}% spider risk`;
  const fill = $('risk-fill');
  fill.style.transform = `scaleX(${pct / 100})`;
  fill.dataset.level = pct < 25 ? 'low' : pct < 50 ? 'mid' : 'high';
}

function renderStats() {
  const { round } = session;
  if (round === null) return;
  renderRisk(round);
  const spiders = round.spiders.length;
  const cap = maxPicks(spiders);
  $('stake-info').textContent = String(round.stake);
  const bag = $('bag');
  const before = Number(bag.dataset.v ?? 0);
  countTo(bag, bagValue(round));
  if (bagValue(round) !== before) replay($('bag-stat'), 'bump');
  $('next').textContent = round.picks < cap ? `×${multiplier(spiders, round.picks + 1).toFixed(2)}` : 'Max';
  $('picks').textContent = String(round.picks);
}

// ---------- home ----------

function topMultiplier(level) {
  return multiplier(LEVELS[level], maxPicks(LEVELS[level]));
}

const levelStatus = (level) => {
  if (level < currentLevel()) return 'done';
  return level === currentLevel() ? 'current' : 'locked';
};
const STATUS_ICON = { done: 'check', current: 'star', locked: 'lock' };
const STATUS_TEXT = { done: 'cleared', current: 'current level', locked: 'locked' };

function levelNode(level) {
  const status = levelStatus(level);
  const item = document.createElement('li');
  item.className = `level ${status}`;
  item.dataset.level = String(level);
  item.style.setProperty('--i', String(level));
  if (status === 'current') item.setAttribute('aria-current', 'step');
  const picked = level === playLevel();
  if (picked) item.classList.add('picked');
  const locked = status === 'locked';
  const node = document.createElement(locked ? 'span' : 'button');
  node.className = 'node';
  node.innerHTML = icon(STATUS_ICON[status]);
  node.setAttribute('aria-label',
    `Level ${level}: ${spiderCount(LEVELS[level])}, up to ×${topMultiplier(level)} (${STATUS_TEXT[status]})`);
  if (locked) node.setAttribute('role', 'img');
  else { node.type = 'button'; node.setAttribute('aria-pressed', String(picked)); }
  const name = document.createElement('span');
  name.className = 'name';
  name.setAttribute('aria-hidden', 'true');
  name.textContent = String(level);
  item.append(node, name);
  return item;
}

function stakeChip(stake) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'stake';
  chip.dataset.stake = String(stake);
  chip.innerHTML = `${icon('gem')}<span>${stake}</span>`;
  chip.setAttribute('aria-pressed', String(selection.stake === stake));
  chip.disabled = stake > session.diamonds || (playLevel() === 0 && stake !== STAKES[0]);
  return chip;
}

function normalizeSelection() {
  const affordable = STAKES.filter((s) => s <= session.diamonds);
  let { stake } = selection;
  if (playLevel() === 0) stake = STAKES[0];
  else if (!affordable.includes(stake)) stake = affordable.at(-1) ?? STAKES[0];
  selection = { stake };
}

function renderHome() {
  normalizeSelection();
  el.levels.replaceChildren(...LEVELS.map((_, level) => levelNode(level)));
  const level = playLevel();
  $('start-btn').textContent = `Play Level ${level}`;
  $('level-detail').textContent =
    `Level ${level}: ${spiderCount(LEVELS[level])} · up to ×${topMultiplier(level)}${level < currentLevel() ? ' · replay' : ''}`;
  $('level-note').textContent = level < currentLevel()
    ? `Replay for fun. Level ${currentLevel()} is where you earn the next unlock.`
    : 'Cash out 1.5× or more to climb to the next level.';
  el.stakes.replaceChildren(...STAKES.map(stakeChip));
  playPendingUnlock();
}

function playPendingUnlock() {
  if (pendingUnlock === null) return;
  const level = pendingUnlock;
  const card = el.levels.querySelector(`[data-level="${level}"]`);
  pendingUnlock = null;
  if (!card) return;
  card.classList.add('unlock-anim');
  sfx.unlock();
  buzz([40, 30, 80]);
  celebrate('small');
  toast(`Level ${level} unlocked! Ready when you are.`, 'ok');
}

function showView(name) {
  document.body.dataset.view = name;
  el.home.hidden = name !== 'home';
  el.game.hidden = name !== 'game';
  setMusicWanted(name === 'home');
}

function showHome() {
  showView('home');
  renderHome();
  if (isBroke(session)) showBroke();
}

function onLevelClick(event) {
  const node = event.target.closest('button.node');
  if (!node) return;
  const level = Number(node.closest('.level').dataset.level);
  selectedLevel = level === currentLevel() ? null : level;
  sfx.tap();
  buzz(10);
  renderHome();
}

function onStakeClick(event) {
  const chip = event.target.closest('.stake');
  if (!chip || chip.disabled) return;
  selection = { ...selection, stake: Number(chip.dataset.stake) };
  sfx.tap();
  buzz(10);
  renderHome();
}

// ---------- board ----------

const tileAt = (index) => el.board.children[index];

function tileLabel(index, state) {
  return `Row ${Math.floor(index / COLS) + 1}, column ${(index % COLS) + 1}, ${state}`;
}

function setTile(index, kind) {
  const tile = tileAt(index);
  tile.classList.remove('marked');
  tile.classList.add(kind);
  tile.setAttribute('aria-disabled', 'true');
  tile.querySelector('.face').innerHTML = icon(kind === 'spider' ? 'spider' : 'gem');
  tile.setAttribute('aria-label', tileLabel(index, kind === 'spider' ? 'spider' : 'diamond'));
}

function markTile(index) {
  const tile = tileAt(index);
  tile.classList.add('marked');
  tile.querySelector('.face').innerHTML = icon('spark');
  tile.setAttribute('aria-label', tileLabel(index, 'sonar says safe'));
}

function buildTile(index) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile entering';
  tile.dataset.i = String(index);
  tile.style.setProperty('--i', String(index));
  tile.tabIndex = index === 0 ? 0 : -1;
  tile.setAttribute('aria-label', tileLabel(index, 'hidden'));
  tile.innerHTML = '<span class="face" aria-hidden="true"></span>';
  tile.addEventListener('animationend', () => tile.classList.remove('entering'), { once: true });
  return tile;
}

function buildScan(row) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'scan';
  btn.dataset.row = String(row);
  btn.innerHTML = icon('bolt');
  btn.setAttribute('aria-label', `Scan row ${row + 1} for spiders, ${SCAN_ROW_COST} Credits`);
  return btn;
}

function buildBoard() {
  el.board.className = 'board';
  el.board.replaceChildren(...Array.from({ length: GRID }, (_, i) => buildTile(i)));
  el.scanCol.replaceChildren(...Array.from({ length: ROWS }, (_, r) => buildScan(r)));
}

function neighbour(index, key) {
  const move = MOVES[key];
  if (!move) return null;
  const row = Math.floor(index / COLS) + move[0];
  const col = (index % COLS) + move[1];
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
  return row * COLS + col;
}

function focusTile(index) {
  for (const tile of el.board.children) tile.tabIndex = -1;
  const target = tileAt(index);
  target.tabIndex = 0;
  target.focus({ preventScroll: true });
}

function onBoardKey(event) {
  const tile = event.target.closest('.tile');
  if (!tile) return;
  const next = neighbour(Number(tile.dataset.i), event.key);
  if (next === null) return;
  event.preventDefault();
  focusTile(next);
}

// ---------- round flow ----------

function startRound() {
  if (busy) return;
  const result = beginRound(session, { level: playLevel(), stake: selection.stake });
  if (result.outcome === 'error') {
    toastError(result.reason);
    if (isBroke(session)) showBroke();
    return;
  }
  adopt(result.session);
  renderWallet();
  $('bag').dataset.v = String(result.session.round.stake);
  el.game.dataset.level = String(result.session.round.level);
  $('tip').textContent = FIRST_PICK_HINT;
  $('tip').hidden = false;
  showView('game');
  buildBoard();
  renderStats();
  syncActions();
  sfx.entry();
  buzz(15);
  announce(`Round started. Level ${result.session.round.level}, stake ${selection.stake}.`);
  focusTile(0);
}

const isPlaying = () => session.round !== null && session.round.status === 'playing';

function syncActions() {
  const playing = isPlaying() && !busy;
  $('leave-btn').disabled = !playing;
  $('sonar-btn').disabled = !playing;
}

function onTile(index) {
  if (busy) return;
  $('tip').hidden = true;
  const result = pick(session, index);
  if (result.outcome === 'ignored') return;
  const before = session;
  adopt(result.session);
  if (result.outcome === 'spider') {
    endLost(index);
    return;
  }
  setTile(index, 'safe');
  popGain(index, gainLabel(result.outcome, before.round, session.round));
  sparkle(index);
  sfx.safe(Math.max(0, session.round.picks - 1));
  buzz(15 + Math.min(session.round.picks, 6) * 4); // a longer streak feels heavier
  renderStats();
  announce(`Diamond. Bag ${bagValue(session.round)}.`);
  if (result.outcome === 'won') endCashout(result, before, 'won');
}

// Whole-Diamond gain when the bag moved; otherwise the multiplier, since at small
// stakes a 1.01x pick rounds to the same bag. Sonar-marked tiles never move it.
const spiderCount = (n) => `${n} ${n === 1 ? 'spider' : 'spiders'}`;

function gainLabel(outcome, before, after) {
  if (outcome === 'safe-free') return 'Free';
  const gain = bagValue(after) - bagValue(before);
  return gain > 0 ? `+${gain}` : `×${multiplier(after.spiders.length, after.picks).toFixed(2)}`;
}

function popGain(index, label) {
  const node = document.createElement('span');
  node.className = 'gain';
  node.setAttribute('aria-hidden', 'true');
  node.textContent = label;
  node.addEventListener('animationend', () => node.remove(), { once: true });
  tileAt(index).append(node);
}

// Web Animations API: a short radial burst of dots from the tile centre.
function sparkle(index) {
  if (prefersReducedMotion()) return;
  const box = tileAt(index).getBoundingClientRect();
  const count = 7;
  for (let i = 0; i < count; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'spark';
    dot.style.left = `${box.left + box.width / 2}px`;
    dot.style.top = `${box.top + box.height / 2}px`;
    document.body.append(dot);
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = 28 + Math.random() * 22;
    const to = `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0)`;
    dot.animate(
      [{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }, { transform: to, opacity: 0 }],
      { duration: 500, easing: 'ease-out', fill: 'forwards' },
    ).onfinish = () => dot.remove();
  }
}

function onBoardClick(event) {
  const tile = event.target.closest('.tile');
  if (!tile) return;
  unlockAudio();
  if (tile.getAttribute('aria-disabled') === 'true') return;
  if (!tile.classList.contains('marked')) { sfx.tap(); buzz(10); }
  onTile(Number(tile.dataset.i));
}

function revealRemainingSpiders() {
  const { round } = session;
  round.spiders.filter((i) => !round.revealed.includes(i)).forEach((index, order) => {
    const tile = tileAt(index);
    tile.classList.add('shown');
    tile.style.animationDelay = `${order * 70}ms`;
    sfx.reveal(order);
    tile.querySelector('.face').innerHTML = icon('spider');
    tile.setAttribute('aria-label', tileLabel(index, 'spider, not found'));
  });
}

function lockBoard() {
  busy = true;
  el.board.querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-disabled', 'true'));
  syncActions();
}

async function endLost(index) {
  lockBoard();
  setTile(index, 'spider');
  replay(el.board, 'shake');
  replay($('flash'), 'go');
  sfx.spider();
  buzz([80, 40, 120]);
  announce('A spider! Round over.');
  await sleep(500);
  revealRemainingSpiders();
  await sleep(900);
  showResult({ kind: 'lost', round: session.round, payout: 0, credits: 0, unlocked: false });
}

function burstCoins(count) {
  if (prefersReducedMotion()) return;
  const from = $('bag-stat').getBoundingClientRect();
  const to = $('diamonds-chip').getBoundingClientRect();
  for (let i = 0; i < count; i += 1) {
    const coin = document.createElement('span');
    coin.className = 'coin';
    coin.innerHTML = icon('gem');
    coin.style.left = `${from.left + from.width / 2}px`;
    coin.style.top = `${from.top + from.height / 2}px`;
    document.body.append(coin);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const spread = (Math.random() - 0.5) * 120;
    coin.animate(
      [
        { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
        { transform: `translate(${spread}px, -50px) scale(1.1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0.9 },
      ],
      { duration: 800 + i * 40, delay: i * 50, easing: 'ease-in', fill: 'forwards' },
    ).onfinish = () => coin.remove();
  }
}

async function endCashout(result, before, kind) {
  lockBoard();
  const profit = result.payout > before.round.stake;
  revealRemainingSpiders();
  if (kind === 'won') { sfx.win(); buzz([30, 30, 60]); celebrate('big'); } else { sfx.cashout(); buzz(20); }
  if (kind === 'left' && profit) celebrate('small');
  await sleep(700);
  el.board.classList.add('leaving');
  burstCoins(Math.min(12, 4 + Math.floor(result.payout / 40)));
  await sleep(850);
  renderWallet();
  if (result.unlocked) pendingUnlock = session.unlocked;
  showResult({
    kind, round: session.round, payout: result.payout,
    credits: session.credits - before.credits, unlocked: result.unlocked,
  });
}

// ---------- result and leave ----------

function resultCopy({ kind, round, payout }) {
  if (kind === 'lost') {
    return { title: 'A spider got you!', amount: `−${round.stake}`, tone: 'lose', sub: 'Stake lost. Try Sonar to scout safer tiles.' };
  }
  if (kind === 'won') {
    return { title: 'Board cleared!', amount: `+${payout}`, tone: 'win', sub: 'You reached the top multiplier.' };
  }
  if (round.picks === 0) {
    return { title: 'Stake returned', amount: `${payout}`, tone: 'win', sub: 'No tiles dug, nothing lost.' };
  }
  return { title: 'Cashed out!', amount: `+${payout}`, tone: 'win', sub: `Stake ${round.stake} · profit ${payout - round.stake}` };
}

function rewardLine({ credits, unlocked }) {
  const parts = [];
  if (credits > 0) parts.push(`+${credits} Credits`);
  if (unlocked) parts.push(`Level ${session.unlocked} unlocked!`);
  return parts.join(' · ');
}

function showResult(summary) {
  const copy = resultCopy(summary);
  $('result-title').textContent = copy.title;
  $('result-big').className = `big ${copy.tone}`;
  $('result-amount').textContent = copy.amount;
  $('result-sub').textContent = [copy.sub, rewardLine(summary)].filter(Boolean).join(' · ');
  busy = false;
  renderWallet();
  announce(`${copy.title} ${copy.amount} Diamonds`);
  openDialog('result-dialog');
}

function onLeave() {
  if (busy || !isPlaying()) return;
  $('leave-amount').textContent = String(bagValue(session.round));
  openDialog('leave-dialog');
}

function confirmLeave() {
  closeDialog('leave-dialog');
  const before = session;
  const result = leave(session);
  if (result.outcome !== 'left') return;
  adopt(result.session);
  endCashout(result, before, 'left');
}

function afterResult(next) {
  closeDialog('result-dialog');
  el.board.classList.remove('leaving');
  next();
}

function playAgain() {
  afterResult(() => {
    if (isBroke(session)) { showHome(); return; }
    normalizeSelection();
    startRound();
  });
}

// ---------- sonar ----------

function onSonar() {
  if (busy || !isPlaying()) return;
  const result = sonarSafe(session);
  if (result.outcome !== 'sonar') {
    if (result.outcome === 'error') toastError(result.reason);
    return;
  }
  adopt(result.session);
  renderWallet();
  markTile(result.index);
  replay($('radar'), 'go');
  sfx.sonar();
  buzz(20);
  announce('Sonar marked a safe tile. Picking it is free.');
}

function onScan(event) {
  const btn = event.target.closest('.scan');
  if (!btn || busy || !isPlaying()) return;
  unlockAudio();
  const row = Number(btn.dataset.row);
  const result = sonarRow(session, row);
  if (result.outcome !== 'scan') {
    if (result.outcome === 'error') toastError(result.reason);
    return;
  }
  adopt(result.session);
  renderWallet();
  btn.textContent = String(result.count);
  btn.classList.add('done');
  btn.setAttribute('aria-disabled', 'true');
  btn.setAttribute('aria-label', `Row ${row + 1} has ${spiderCount(result.count)}`);
  sfx.sonar();
  buzz(20);
  announce(`Row ${row + 1} has ${spiderCount(result.count)}.`);
}

// ---------- broke, reset, preferences ----------

function showBroke() {
  const text = $('broke-text');
  const action = $('broke-action');
  if (session.rescueUsed) {
    text.textContent = 'The one-time rescue is used. Start over with a fresh wallet.';
    action.textContent = 'Start over';
  } else {
    text.textContent = 'You have fewer Diamonds than the smallest stake. Claim a one-time 500 Diamond rescue.';
    action.textContent = 'Claim 500 Diamonds';
  }
  openDialog('broke-dialog');
}

function onBrokeAction() {
  closeDialog('broke-dialog');
  if (session.rescueUsed) {
    resetProgress();
    return;
  }
  const result = claimRescue(session);
  if (result.outcome === 'rescued') {
    adopt(result.session);
    renderWallet();
    renderHome();
    toast('Rescue claimed: +500 Diamonds', 'ok');
  }
}

function resetProgress() {
  adopt(newSession());
  selection = { stake: STAKES[0] };
  renderWallet();
  showHome();
}

function onResetClick() {
  closeDialog('settings-dialog');
  openDialog('reset-dialog');
}

function confirmReset() {
  closeDialog('reset-dialog');
  resetProgress();
  toast('Progress reset', 'ok');
}

// Decorative drifting sparkles. Transform and opacity only; hidden under reduced motion by CSS.
function buildAmbient() {
  const layer = $('ambient');
  const motes = Array.from({ length: 14 }, (_, i) => {
    const mote = document.createElement('span');
    mote.style.setProperty('--x', `${(i * 71) % 100}%`);
    mote.style.setProperty('--s', `${4 + (i % 4) * 2}px`);
    mote.style.setProperty('--d', `${14 + (i % 5) * 4}s`);
    mote.style.setProperty('--delay', `${-(i * 1.7)}s`);
    return mote;
  });
  layer.replaceChildren(...motes);
}

const PREF_SETTERS = { music: setMusicEnabled, sound: setSound, haptics: setHaptics };
const PREF_NAMES = Object.keys(PREF_SETTERS);

function applyPref(name, on) {
  PREF_SETTERS[name](on);
  $(`pref-${name}`).checked = on;
}

function currentPrefs() {
  return Object.fromEntries(PREF_NAMES.map((name) => [name, $(`pref-${name}`).checked]));
}

function onPrefChange(name) {
  const on = $(`pref-${name}`).checked;
  unlockAudio();
  applyPref(name, on);
  writeStore(PREFS_KEY, currentPrefs());
  if (on) { sfx.tap(); buzz(10); }
}

function initPrefs() {
  const saved = readStore(PREFS_KEY) ?? {};
  PREF_NAMES.forEach((name) => {
    applyPref(name, saved[name] !== false);
    $(`pref-${name}`).addEventListener('change', () => onPrefChange(name));
  });
  if (!hapticsSupported()) {
    $('pref-haptics').disabled = true;
    $('haptics-note').hidden = false;
  }
}

// ---------- global keys ----------

function onGlobalKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
  if (el.game.hidden) return;
  const key = event.key.toLowerCase();
  if (key === 'l') onLeave();
  if (key === 's') onSonar();
}

// ---------- init ----------

// Audio unlocks on a tap, which is also when the home music is allowed to begin.
function onFirstGesture() {
  unlockAudio();
  syncMusic();
}

function init() {
  session = sanitizeSaved(readStore(WALLET_KEY));
  initPrefs();
  renderWallet();
  document.addEventListener('pointerdown', onFirstGesture, { passive: true });
  document.addEventListener('keydown', onFirstGesture);
  document.addEventListener('keydown', onGlobalKey);
  el.stakes.addEventListener('click', onStakeClick);
  el.board.addEventListener('click', onBoardClick);
  el.board.addEventListener('keydown', onBoardKey);
  el.scanCol.addEventListener('click', onScan);
  $('start-btn').addEventListener('click', startRound);
  el.levels.addEventListener('click', onLevelClick);
  $('leave-btn').addEventListener('click', onLeave);
  $('sonar-btn').addEventListener('click', onSonar);
  $('leave-confirm').addEventListener('click', confirmLeave);
  $('leave-cancel').addEventListener('click', () => closeDialog('leave-dialog'));
  $('again-btn').addEventListener('click', playAgain);
  $('home-btn').addEventListener('click', () => afterResult(showHome));
  $('broke-action').addEventListener('click', onBrokeAction);
  $('reset-confirm').addEventListener('click', confirmReset);
  $('reset-cancel').addEventListener('click', () => closeDialog('reset-dialog'));
  buildAmbient();
  $('reset-btn').addEventListener('click', onResetClick);
  $('help-btn').addEventListener('click', () => openDialog('help-dialog'));
  $('help-close').addEventListener('click', () => closeDialog('help-dialog'));
  $('settings-btn').addEventListener('click', () => openDialog('settings-dialog'));
  $('settings-close').addEventListener('click', () => closeDialog('settings-dialog'));
  $('result-dialog').addEventListener('cancel', (e) => e.preventDefault());
  showHome();
}

init();
