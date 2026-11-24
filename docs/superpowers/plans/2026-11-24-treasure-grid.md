# Treasure Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, in-session). Steps use checkbox syntax. Commits only when the user asks (global rule), so there are no commit steps.

**Goal:** A playable, animated Mines-style tile-reveal game (Levels 0 to 5) with sound, haptics and confetti, running on laptop and mobile browsers.

**Architecture:** Pure logic in `game.js` (session reducer, no DOM) tested with `node --test`. `fx.js` owns sound, haptics and confetti. `ui.js` renders and animates. `index.html` holds markup and CSS tokens.

**Tech Stack:** Static HTML, ES modules, Web Audio, `navigator.vibrate`, `canvas-confetti` 1.9.3 (jsDelivr, pinned with SRI). Node 18+ for tests only.

**Spec:** `docs/superpowers/specs/2026-11-24-treasure-grid-design.md`

## Global Constraints

- 5x5 grid; spiders per level 0..5 = 1, 3, 5, 8, 12, 16.
- `multiplier(n) = floor(0.97 / P(n) * 100) / 100`, P(n) = product over i<n of (safe - i)/(25 - i).
- Multiplier cap 1000; `maxPicks` auto-wins at the cap.
- Stakes 10, 50, 100, 250; start 1000 Diamonds, 100 Credits; Sonar safe 40, row 15; +10 Credits per profitable cash out, +25 on unlock; unlock at 1.5x or more on the current level; one-time rescue +500.
- Leave = cash out, behind a confirm. Level 0 stake locked to 10.
- Virtual currency only. No assets besides the pinned confetti script.
- Touch targets at least 44 px, `100dvh`, safe-area insets, `prefers-reduced-motion`, dark default with light variant.
- Keys: arrows move, Enter/Space pick, `L` leave, `S` safe-reveal.

## Review Focus

- Double-tap the same tile, or tap after the round ended: ignored, no double payout (Task 1).
- Corrupt or negative localStorage values: fall back to defaults (Task 1, `sanitizeSaved`).
- Stake above balance, or balance below the minimum stake: error toast, rescue or restart offered (Tasks 1, 4).
- Reload mid-round: the stake is refunded because rounds are never persisted (Task 4).
- Audio, vibrate, confetti CDN or storage unavailable: the game still plays (Tasks 2, 4).

---

### Task 1: Game logic

**Files:** Create `package.json`, `game.js`, `game.test.js`.

**Interfaces:**
- Produces from `game.js`: constants (`LEVELS`, `STAKES`, `SCAN_COST`, ...), `multiplier(spiders, picks)`, `maxPicks(spiders)`, `randomInt(max, fill?)`, `placeSpiders(count, randomIntFn)`, `newSession()`, `beginRound(session, {level, stake, random})`, `pick(session, index)`, `leave(session)`, `sonarSafe(session, random)`, `sonarRow(session, row)`, `bagValue(round)`, `isBroke(session)`, `claimRescue(session)`, `sanitizeSaved(raw)`. Each action returns `{session, outcome, ...}` where outcome is one of `safe`, `safe-free`, `spider`, `won`, `left`, `ignored`, or `{error}` reasons.

- [ ] Write failing tests: multiplier matches sheet rows 1-10 for 3, 5 and 8 spiders; `maxPicks` keeps the top multiplier at or below 1000 and no more than the safe count; `placeSpiders` returns exactly N unique indices in 0..24; double pick ignored; pick after end ignored; spider pays 0; leave with 0 picks refunds the stake; cap and cleared board win; sonar safe never reveals a spider tile and never advances picks; sonar rejected with too few Credits; row scan once per row; unlock only at 1.5x or more on the current level; rescue only when broke and once; `sanitizeSaved` rejects NaN, negatives, strings.
- [ ] Run `node --test`; expect FAIL (module missing).
- [ ] Implement `game.js` so all tests pass. State is immutable; round state is JSON-safe arrays.
- [ ] Run `node --test`; expect all PASS.

### Task 2: Effects

**Files:** Create `fx.js`.

**Interfaces:**
- Consumes: nothing from `game.js`.
- Produces: `unlockAudio()`, `setSound(on)`, `setHaptics(on)`, `hapticsSupported()`, `prefersReducedMotion()`, `sfx` with `entry, tap, safe(step), spider, cashout, win, left, unlock, sonar, error`, `buzz(pattern)`, `celebrate(tier)` where tier is `small` or `big`.

- [ ] Implement with Web Audio oscillators and noise; every call is a no-op when audio, vibrate or `window.confetti` is missing, and wrapped so it never throws.
- [ ] Verify in the browser: each sound plays after a first tap, no console errors with sound off.

### Task 3: Markup and styles

**Files:** Create `index.html`.

- [ ] Header (balance, credits, sound and haptics toggles), home (level cards, stake chips, Start), game (status row, board with row-scan column, Leave and Sonar buttons), dialogs (result, leave confirm), toast region, tutorial tip.
- [ ] CSS tokens on `:root`, light override in `prefers-color-scheme`, keyframes for flip-in, pop, shake, flash, radar, toast, slide-out; reduced-motion block.
- [ ] Check contrast numerically: text 4.5:1, graphics 3:1, in both themes.

### Task 4: UI wiring

**Files:** Create `ui.js`.

**Interfaces:** Consumes everything from `game.js` and `fx.js`.

- [ ] Load and save the wallet in `localStorage` (try/catch, `sanitizeSaved`), never the round.
- [ ] Render home, board, status and actions from the session; rebuild the board per round with staggered flip-in.
- [ ] Wire tile clicks, keyboard, Leave confirm, Sonar buttons, row scan, result dialog, rescue and restart.
- [ ] Round-end sequences: spider (shake, flash, reveal spiders), win (confetti big), leave (slide-out, coin burst, confetti small if profit), unlock (lock-break). Input ignored while a sequence runs.
- [ ] Every function at cyclomatic complexity 8 or less.

### Task 5: Verify and review

- [ ] `node --test` green.
- [ ] Browser at 375, 768, 1024, 1440 px, light and dark: no console errors, no horizontal overflow, text at 145%, keyboard-only round, axe clean.
- [ ] iPhone Safari in the iOS Simulator: layout, safe areas, audio after first tap.
- [ ] Code-quality pass, then reviewer pass; fix confirmed findings.

### Task 6: Deploy (gated)

- [ ] Only after explicit OK: enable GitHub Pages, then check the live URL including a hard reload.
