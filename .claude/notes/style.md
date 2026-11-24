# Style notes: treasure-grid

- Static HTML plus ES modules, no build. Serve over http (modules are blocked on file://).
- `game.js` is pure and immutable (no DOM), tested with `node --test`. Everything else calls it.
- `fx.js` never throws: every effect is a no-op when audio, vibrate or confetti is missing.
- Design tokens (colours, spacing, radii) live once as CSS custom properties on `:root` in `index.html`.
- Animate only `transform` and `opacity`. Honour `prefers-reduced-motion`.
- Virtual currency only. Rounds are never persisted; only the wallet is.

## Progress (2026-11-24)
- Done: game.js (21 tests), fx.js, index.html, ui.js (written, awaiting browser verification).
- Confetti is jsDelivr canvas-confetti 1.9.3 with SRI (plan/spec still say cdnjs; cdnjs 404'd).
- No commits yet. Deploy (GitHub Pages via `gh`) needs explicit OK for repo name, visibility and push.
- Left: browser verify (375/768/1024/1440, light/dark, keyboard, 145% text, axe), review pass, deploy.

## Verification (2026-11-24)
- Verified in Chrome (built-in browser): 320/375/768/1024/1440, light+dark, no overflow, axe clean (home+game, both themes), keyboard round (arrows/Enter/L/Esc), broke+rescue, corrupt storage, reload refund, contrast script all pass.
- Lint complexity <= 8 enforced with a throwaway eslint config; keep helpers small.
- Not tested: Firefox, Safari/iOS, real haptics, real audio output, confetti on a win, unlock animation, 145% text beyond the one 375 shot.

## Polish pass (2026-11-24)
- Added: risk meter (`renderRisk`), gain popup + sparkles on safe picks, flip-reveal and glow, ambient motes, reset confirm dialog, dialog stagger, rising pick pitch with shimmer from the 4th pick, spider reveal sounds, unlock toast + confetti.
- `gainLabel`: "Free" only for sonar-marked picks, `+N` when the bag moves, else the multiplier.
- `spiderCount(n)` handles singular/plural in labels.
- Gate: `node --test` (21 pass), eslint complexity 8 via scratchpad config, contrast script.
- Tested: Chrome pane at 375 wide, real clicks, no new console errors, no overflow, risk/gain/sparks present.
- Not tested: Firefox, Safari, iOS, real haptics/audio, device frame rate, confetti and unlock visuals, win/cap path in UI, reset dialog, 145% text, axe and keyboard re-run after polish.
- Tooling: `humanizer-blader` plugin installed at user scope.

## Candy theme and progressive levels (2026-11-24)
- Levels are earned: `currentLevel()` is `session.unlocked`. Superseded for replay: see "Hybrid levels".
- Superseded: there is now ONE candy theme (see "Single theme and SVG icons"). No `prefers-color-scheme` branches.
- Sounds are global (bell and sparkle synthesis in `fx.js`), not theme-gated.
- Tested: Chrome pane, light, 375 round with real clicks, cash out at x1.52, Level 1 unlock (credits +35, toast, path advanced), dark home, no overflow at 336/375/768/1024/1440, lint, 21 tests, contrast script.
- Not tested: Firefox, Safari/iOS, real audio/haptics, loss path and spider tile in light, win/cap path, reset dialog, 145% text, keyboard and axe re-run after the candy changes, levels 2 to 5 tile colours.

## Single theme and SVG icons (2026-11-24)
- One candy theme in `:root` tokens, `<meta name="color-scheme" content="light">`. The Browser pane forces dark emulation and the old dark theme had no candy styling, so it looked flat; a single theme removes that mismatch.
- Icons are an SVG `<symbol>` sprite in `index.html`, used via `icon(name)` in `ui.js` (`<use href="#i-name">`). Names are fixed strings, never user input. No emoji in UI.
- `body[data-view]` is set by `showView`; the game view hides the hero art.
- PWA-style meta (`apple-mobile-web-app-capable`, `black-translucent` status bar, `viewport-fit=cover`, safe-area padding) for a standalone feel on iOS. No manifest or icons yet.
- No Lottie: no verified JSON assets. Same feel via CSS/SVG animation. Add lottie-web only if real files are supplied. Font is Fredoka (Google Fonts) with `ui-rounded` fallback.
- iOS Simulator: `navigator.vibrate` is unsupported in iOS Safari, so haptics never fire there; audio needs a first tap. Cold-Safari `open_url` can time out: `xcrun simctl launch <udid> com.apple.mobilesafari`, wait 5 s, then `xcrun simctl openurl`. A real device needs the Mac's LAN IP or a deployment.
- Tested: Chrome pane 375 home (dark emulation), trail renders, no stalled animations.
- Not tested: full round and dialogs after the overhaul, 768/1024/1440, contrast of new colours, axe, keyboard, 145% text, Firefox, Safari/iOS round, real audio/haptics, levels 2 to 5 tile colours.
- WebKit fix: grid items with `aspect-ratio` blew the `1fr` tracks past the board in iOS Safari (tiles overflowed the tray, covered the buttons). Board tracks are `minmax(0,1fr)` and tiles fill their cell; the board itself holds the square. Stakes are a 4-column grid so none hide behind the sticky Play bar.
- Tested in iOS Simulator (iPhone 17 Pro, Safari): home, board, leave dialog at 402pt. Always load with a fresh `?v=` since Safari caches CSS.

## Less on-screen text (2026-11-24)
- Rules live in the `?` HUD button's `#help-dialog`; the always-visible legend is gone. `#tip` is a one-line hint shown only until the first pick of a round.
- Reset progress moved into the help dialog (the home footer wasted ~10% of the screen). It confirms via `#reset-dialog`.
- Level path: 40px nodes, number-only labels, connector between node centres, ring 3px+2px. The old 50px nodes in ~51px slots touched and the ring clipped.
- Tested: Chrome pane 375 home and help dialog. Not tested: iOS Simulator for this change, first-pick hint in a round, reset flow end to end, axe, keyboard, contrast script (still stale: needs a rewrite for the single `:root` block).

## Music and dev server (2026-11-24)
- `music.js`: 8-bar Web Audio loop (sine melody, bass, triangle pad) with a lookahead scheduler. Plays on the home view only (`showView` calls `setMusicWanted`), fades out in a round, pauses when the tab is hidden, starts on the first tap. The Sound button mutes it too; there is no separate music toggle (the HUD is full at 375px).
- `dev-server.py` sends `Cache-Control: no-store`. `python -m http.server` let Safari serve stale ES modules, and a `?v=` on the page URL does not bust imported modules.
- Tested: Chrome pane (context running, no console errors), iOS Simulator home. Not tested: actually hearing it, loudness against the sfx, hand-off between music and win/loss sounds.

## Settings dialog (2026-11-24)
- HUD has `?` and a gear. The gear opens `#settings-dialog`: switches for Music, Sound effects and Haptics (`#pref-music|sound|haptics`), plus Reset. Four HUD icon buttons did not fit at 375px.
- Prefs are `{music, sound, haptics}` under `treasure-grid:prefs`; `PREF_SETTERS` in `ui.js` maps each to its setter. Music no longer follows the sound pref. Haptics switch is disabled where `navigator.vibrate` is missing.
- Level path size comes from one `--node` token on `.levels` (36px); the connector derives from it. The current node ring is static (the old `breathe` scale made it look off-centre).
- Tested: Chrome pane 375, dialog, music toggle persisted, level path with 2 unlocked. Not tested: iOS Simulator for this change, keyboard/focus in the dialog, axe, other widths, hearing music off/on.

## Hybrid levels, iOS haptics, deploy (2026-11-24)
- Hybrid levels: Play defaults to the top unlocked level; cleared/current nodes are buttons (`aria-pressed`) that pick a level to replay (`selectedLevel`, `playLevel()`). Locked nodes stay inert. Unlock and the +25 reward still come only from the top level (`game.js` enforces, tested). Level 0 locks the stake to 10 for whichever level 0 is played.
- `.game` fills the page and centres (`flex: 1; align-content: center`) so tall phones have no dead space under the board.
- iOS haptics: `fx.js` `buzz()` clicks a hidden `<input type="checkbox" switch>` (Safari 17.4+) when `vibrate` is missing and the UA is iOS. UNTESTED on a real iPhone; the Simulator cannot produce haptics.
- Contrast script (scratchpad, not in repo) was rewritten for the single `:root` block; all text pairs >= 4.5, graphics >= 3.
- Claude Artifact copy exists (private; Share in claude.ai to make public). It is a static snapshot, republish after changes.
- Tested: Chrome pane 375, level pick/replay/leave with real wallet state, no console errors, lint, 21 tests. Not tested: Firefox, Safari beyond the earlier Simulator pass, real haptics/audio, text at 145%, axe re-run, widths other than 375 after this change.
