# Treasure Grid

A tile-reveal game on a 5×5 grid with a candy look. Tiles hide Diamond Relics or Trap Spiders. Each safe tile grows your bag, and you can cash out at any point or keep digging. It is a frontend prototype: no backend, no accounts, and no real money. Diamonds and Credits are virtual and have no cash value.

Live demo: https://maurya-sachin.github.io/treasure-grid/

## Run it

The game is static HTML and ES modules with no build step. Browsers block modules on `file://`, so serve the folder over http:

```sh
python3 dev-server.py   # http://localhost:8080, sends no-store so edits show on reload
```

Any static server works too. To run the tests:

```sh
node --test
```

## How it plays

You start with 1000 Diamonds, 100 Credits and Level 0. Pick a stake, then tap tiles. A spider ends the round and you lose the stake. Leave asks for a confirmation, then moves the bag to your balance.

| Level | Spiders |
|---|---|
| 0 | 1 |
| 1 | 3 |
| 2 | 5 |
| 3 | 8 |
| 4 | 12 |
| 5 | 16 |

- Stakes are 10, 50, 100 and 250 Diamonds. Level 0 locks the stake to 10.
- Cash out at 1.5× or more on your highest unlocked level to unlock the next one. You get 25 Credits for it.
- Replaying a lower level never unlocks anything.
- Every profitable cash out pays 10 Credits.
- If you go broke, you can claim a one-time rescue of 500 Diamonds.
- Sonar costs Credits: 40 marks one safe tile (picking it is free), and 15 counts the spiders in a row.

The multiplier for `n` safe picks is `floor(0.97 / P(n) × 100) / 100`, where `P(n)` is the chance of `n` safe picks in a row. That gives a 97% return to player and a cap of ×1000.

Only the wallet is saved, in `localStorage`. A round in progress is not saved, so reloading mid-round refunds the stake.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup, styles and the SVG icon sprite |
| `ui.js` | Rendering, input and dialogs |
| `game.js` | Game rules as pure functions with no DOM |
| `game.test.js` | Tests for `game.js` |
| `fx.js` | Sound effects, haptics and confetti |
| `music.js` | The looping home-screen music |
| `dev-server.py` | Local server with caching turned off |

Confetti comes from canvas-confetti, loaded from jsDelivr with an integrity hash. The font is Fredoka from Google Fonts.

## Browser notes

- Sound is synthesised with the Web Audio API and starts after the first tap.
- Haptics use `navigator.vibrate`, which works on Android Chrome after the first tap.
- Safari has no `vibrate`, so on iOS the game tries a hidden `<input type="checkbox" switch>` (Safari 17.4 and later). I have not tested this on a real iPhone.
- Tested in Chrome and in the iOS Simulator. Not tested in Firefox.
- Animations respect `prefers-reduced-motion`.

## Docs

The design spec and the implementation plan are in `docs/superpowers/`.
