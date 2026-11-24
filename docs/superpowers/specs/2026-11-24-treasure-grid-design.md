# Treasure Grid: design and build plan

Frontend-only prototype of a Mines-style tile-reveal game with arcade polish (Candy Crush / Clash of Clans feel). Static HTML, no build step, deployed to GitHub Pages for testing.

## Goals

- A complete playable loop: stake, pick tiles, cash out or hit a spider, with Levels 0 to 5.
- Feedback on every action: animation, synthesized sound, haptics.
- Every state handled: idle, playing, win, lose, leave, error, empty balance.
- Built fast: four files, no dependencies except one pinned confetti script.

## Non-goals

- No backend, accounts, or real money. Diamonds and Credits are virtual, never purchasable or redeemable.
- No multiplayer, no server-side fairness. Mine placement is client-side and cheatable (prototype).
- No React or build tooling.

## Rules and math

Grid is 5x5 (25 tiles). Level sets the spider count.

| Level | Spiders | Note |
|---|---|---|
| 0 | 1 | Guided tutorial, stake locked to the smallest value |
| 1 | 3 | Matches sheet tab MINE 3 |
| 2 | 5 | Matches sheet tab MINE 5 |
| 3 | 8 | Matches sheet tab MINE 8 |
| 4 | 12 | Extra, same formula |
| 5 | 16 | Extra, same formula |

- P(n) = probability of surviving n picks = product over i in 0..n-1 of (safe - i) / (25 - i), where safe = 25 - spiders.
- multiplier(n) = floor(0.97 / P(n) * 100) / 100. This is the sheet's formula (3% edge, rounded down).
- maxPicks(spiders) = largest n with multiplier(n) at most 1000, and at most safe. Reaching it auto cashes out as a win. This removes the sheet's invalid rows (division by zero, negative P) and the million-times payouts.
- Bag = stake x multiplier(picks). Cash out pays the bag. A spider pays 0.
- Leave button = cash out the current bag, behind a confirm. With 0 picks it refunds the stake.
- Stakes: 10, 50, 100, 250 Diamonds. Start with 1000 Diamonds and 100 Credits.
- Unlock next level: cash out at 1.5x or more once on the current level.

## Sonar Scan (Credit sink)

- Reveal safe tile (40 Credits): marks one unrevealed safe tile as safe. Picking it is free and does not advance the multiplier.
- Scan row (15 Credits): shows the spider count for a chosen row. Information only.
- Credits come from a +10 reward per winning cash out and +25 on level unlock.
- Disabled with a reason when Credits are short, no round is active, or no safe tile is left.

## Screens and states

Home (balance, level select, locked levels) -> Stake picker -> Board -> Result overlay (win, lose, left).

| State | Behavior |
|---|---|
| Idle | Level and stake chosen, Start enabled |
| Playing | Tiles, bag, next multiplier, Leave, Sonar |
| Win (cash out, auto cap, board cleared) | Confetti, coin burst, count-up, fanfare |
| Lose (spider) | Board shake, red flash, other spiders revealed, low thud |
| Left | Soft slide-out, bag counts into balance, short chime |
| Error | Toast plus buzz, state never corrupts (storage blocked, audio blocked, vibrate unsupported) |
| Broke | Balance below the smallest stake: one-time 500 Diamond rescue prompt |
| Reduced motion | `prefers-reduced-motion` swaps shake and confetti for a fade |

## Feedback matrix

| Action | Animation | Sound | Haptic |
|---|---|---|---|
| Entry (load, start round) | Tiles flip in with stagger | Whoosh | Short tick |
| Tile select | Press scale, flip | Ping, pitch rises with multiplier | 10 ms |
| Safe reveal | Diamond pop, bag count-up | Sparkle | 15 ms |
| Spider | Shake, red flash, spider scuttle | Low thud | 80, 40, 120 ms pattern |
| Cash out win | Confetti, coin burst | Coin arpeggio | 30, 30, 60 ms |
| Leave | Slide-out, bag to balance | Soft chime | 20 ms |
| Level unlock | Lock-break, glow | Fanfare | 60 ms |
| Sonar | Radar sweep over tiles | Sonar ping | 20 ms |
| Error | Toast slide, shake | Buzz | 50 ms |

- Sounds are synthesized with Web Audio (oscillators and noise), so no assets, licenses, or loading. Swap in Kenney CC0 files later if wanted.
- Haptics use `navigator.vibrate` with feature detection. iOS Safari does not support it, so iPhone gets sound only. Sound and haptics each have a toggle, remembered in localStorage inside try/catch.
- Confetti: `canvas-confetti` 1.9.3 from jsDelivr, pinned with SRI.

## Architecture

```
index.html     markup, CSS tokens (dark default, light via prefers-color-scheme)
game.js        pure logic: multiplier, maxPicks, placeSpiders, scanRow, round reducer
fx.js          sound, haptics, confetti, reduced-motion check
ui.js          render, event wiring, animations, persistence
game.test.js   node --test, checks multiplier against sheet rows
```

- `game.js` has no DOM access, so it is unit-tested in Node.
- Spiders placed with `crypto.getRandomValues` and Fisher-Yates.
- Round state machine: `idle -> playing -> won | lost | left`. Invalid transitions are ignored, so double taps and repeated cash outs are safe.
- Persisted: balance, credits, unlocked level, toggles. Storage failure falls back to memory.

## Laptop and mobile

One layout, mobile-first, scaling up. The board is a square sized by `min(100vw - gutters, 100dvh - header and footer, 560px)`, so it never scrolls the page.

Mobile:
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` and `env(safe-area-inset-*)` padding for notches.
- `100dvh`, not `100vh`, so iOS Safari's collapsing toolbar does not clip the Leave button.
- Pointer events with `touch-action: manipulation` (no double-tap zoom, no 300 ms delay). `overscroll-behavior: none` stops pull-to-refresh mid-round.
- Touch targets at least 44 px: tiles, Leave, Sonar, stake chips, toggles.
- No hover-only UI. Hover styles are an extra on top of tap states.
- Audio starts on the first tap (iOS and Android block it before a gesture). Until then the sound toggle shows as muted.
- Portrait is the design target. Landscape on a phone moves the controls beside the board.
- Fewer confetti particles on small screens, and animations use only `transform` and `opacity` to stay at 60 fps on mid-range phones.

Laptop:
- Mouse hover and focus states.
- Keyboard play: arrow keys move across the grid, Enter or Space picks, `L` leaves, `S` opens Sonar. Visible focus ring.
- Board and panels centered, max width about 960 px.

## Device testing

- Emulated: Chrome and Firefox at 375, 768, 1024, 1440, light and dark.
- iPhone Safari: iOS Simulator on this Mac (layout, safe areas, audio unlock, `dvh`).
- Android: Chrome device emulation only, unless you have a phone to try the live URL on.
- Not covered without real hardware: haptics (Android only, cannot be felt in an emulator), real speaker audio, and real-device frame rate. I will list these as untested in the final report, and the GitHub Pages URL lets you check them on your own phone.

## Edge cases to test

- Cash out with 0 picks, double-tap on a tile, double cash out, Leave during an animation.
- Sonar with 0 Credits, with every safe tile already revealed, on a revealed tile.
- Stake larger than balance, balance below minimum stake.
- Reaching maxPicks, clearing the whole board.
- Storage, audio, and vibrate unavailable.

## Build pipeline (agents, gated)

1. developer: `game.js` and `game.test.js` test-first. Gate: `node --test` green, multipliers match the sheet for the first 10 rows of each tab.
2. developer: `index.html`, `ui.js`, `fx.js`. Gate: runs locally, no console errors.
3. test-runner: full gate (tests, lint if configured). Failures go back to step 1 or 2, at most 3 rounds, then stop and report.
4. ui-verifier: Chrome and Firefox at 375, 768, 1024, 1440, light and dark, keyboard only, text at 145%, axe clean, no horizontal overflow. Touch targets at least 44 px. Plus iPhone Safari in the iOS Simulator (see "Device testing").
5. reviewer-code, then fix confirmed findings.
6. Deploy to GitHub Pages only after your explicit OK, then verify the live URL.

`/loop` fits the retry in step 3, not the whole pipeline.

## Approaches considered

- One `index.html`: fastest to write, logic untestable.
- Static HTML plus ES modules (chosen): same speed, testable logic, no build.
- Vite + React/TS: slower, and you asked for HTML.
- Hosting: GitHub Pages primary, Netlify drag-and-drop fallback. Apps Script dropped, since it is awkward for static assets.

## Calls I made (change any)

- Levels 4 and 5 use 12 and 16 spiders; level 0 uses 1.
- 1000x multiplier cap, stakes, Credit prices and rewards, 1.5x unlock rule.
- Leave and cash out are one action.
- Synthesized sounds instead of sourced files.
