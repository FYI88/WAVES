# WaveS - Android packaging handoff

Last updated: 2026-10-24
Repository (working copy): `C:\Users\WDAGUtilityAccount\Documents\Default Project`
Upstream: `https://github.com/FYI88/WAVES.git`
Branch: `main`
Head at handoff: `a4ef410` (Phase 2.4.3, launcher icon and splash) - latest release tag `v1.0.0-debug.8` points at `a4ef410`

## 1. Mission

Ship WaveS as an offline Android APK through Capacitor, then publish the first signed APK as a GitHub Release.

The web app is already complete: a multilingual (FR/EN) multilayer electromagnetic wave simulator with a canvas renderer, physics tests, PNG/CSV exports, present mode, a shortcuts overlay and an About card.

The Android work must not rewrite the UI or change the physics. It wraps the existing Vite build, removes runtime network dependencies, adds native export/share behaviour and delivers a smooth 60 fps experience on the target phone.

## 2. Locked decisions

- Capacitor, not Tauri or a native rewrite.
- Package ID: `io.github.fyi88.waves`.
- App name: `WaveS`.
- GitHub Releases only for v1. No Play Store submission yet.
- GitHub Actions builds the APK. Local Android builds are not available on this machine today.
- Signing secrets go into GitHub Settings, never into the repository.
- Verify Phase 0 on the real Samsung Galaxy M20 before starting Phase 1.
- Bundle the fonts with Fontsource. Remove the Google Fonts runtime import.
- Commit the generated `android/` directory.
- Debug APKs from different workflow runs are signed differently, so uninstall the previous debug build before installing a new one.
- Release build uses `assembleRelease` and `apksigner verify`.
- Version `1.0.0`, versionCode `1` for the first release.
- Local commits are allowed. Pushing needs an explicit go-ahead.
- No mobile-first rewrite. Existing responsive rules stay.
- Physics stays untouched. All 16 tests must stay green.

## 3. Performance contract

Measured on the release APK, on the Galaxy M20, offline, with the perf HUD enabled.

| Area | Target |
| --- | --- |
| Playback | 60 fps target; median at least 55 fps |
| Frame time | p95 at most 22 ms |
| Long frames | No repeated frames above 33 ms |
| Slider/orbit drag | At most 2 dropped frames; no interaction above 100 ms |
| Cold start | Interactive in at most 3 s |
| Warm start | Interactive in at most 1.5 s |
| Idle | No canvas draws while paused |
| Memory | Under 200 MB PSS; no growth over 5 minutes |
| APK size | At most 10 MB |
| Offline | Same numbers as online |

Current `dist` baseline after bundling fonts: 3.1 MB, 96 files (was 2.6 MB, 66 files). The extra weight is the Latin + Greek WOFF/WOFF2 subsets of Inter Tight and JetBrains Mono. The web Canvas is roughly 0.5 to 1.1 megapixels at DPR 2 on this phone, so 60 fps is realistic but not guaranteed on the Mali-G71 MP2.

### Perf HUD

Hidden by default. Enable with either:

- five taps within 900 ms on the version line at the bottom of the About card, or
- `?perf=1`, or
- `localStorage.setItem("waves:perf", "1")`.

The HUD shows fps, p95 frame time, DPR, canvas buffer size and `live`/`idle`. It is `pointer-events: none`, so it never blocks input. It is kept in release builds on purpose.

The About card version line shows the app version plus the Android and Chrome/WebView versions parsed from the user agent. Record the phone's WebView version before trusting FPS numbers: Android 10 is end-of-life and an old WebView can dominate results.

### Perf levers (applied in order)

1. Adaptive DPR (done in `51b238f`): 2 -> 1.75 -> 1.5 -> 1.25 -> 1 after a 3 s warm-up when p95 is above 22 ms. Coarse pointers start at 1.5; the choice is persisted in `localStorage["waves:dprCap"]`.
2. Mobile shadow tier (done in `51b238f`): canvas `shadowBlur` is off on coarse pointers, and CSS `backdrop-filter` is disabled there too.
3. Scenery layer (done in `8ac3fe8`): the section view is split across two stacked canvases. The scenery (grid, slabs, tiles, labels, ruler, dishes, pills) is painted once per parameter change at up to 2.5x device pixels; the animated layer (waves, flares, dust, source rings) repaints every frame at the adaptive DPR. This is what made the text crisp again after the DPR ladder bottomed out at 1.0.
4. Cheaper animated pass (done in `8ac3fe8`): wave gradients are cached per segment instead of recreated every frame, wavefronts and particle trails use solid strokes instead of per-item gradients, `rgba()` strings are memoised, and the crest polygon no longer copies/reverses an array per frame.
5. Reduce spatial detail without changing physics. Partly done: coarser crest sampling (4 px), every second wavefront and no particle halos in the 2D low-power tier. Next candidates: draw the internal-reflection waves with fewer fronts, or drop their fronts entirely on coarse pointers.

Do not change the physics or the chart semantics.

## 4. Current build state

### Repository

- Head: `a4ef410` (Phase 2.4.3, app emblem as launcher icon and splash).
- Recent commits: `a4ef410` launcher icon + splash, `cfd5b71` Phase 3 plugin note, `35d6e7f` Phase 2.4.2 docs, `e4b1a8b` canvas selection + emoji glyph + touch-hover repaints, `8741636` bordered GitHub button.
- Phases 0–2.4.3 are committed and pushed. The current debug APK is pre-release `v1.0.0-debug.8`.
- `HANDOFF.md` is tracked in the repository and updated at the end of every phase.

### Test and build status

- `npm test`: 16/16 passing.
- `npm run build`: green (`tsc --noEmit && vite build`).
- GitHub Actions `Android debug APK`: green on `3f7a656` (run `40091642446`, 2.1 min, 5.98 MB artifact).
- GitHub Actions `Android debug APK`: green on `51b238f` (run `40098152879`, 5.98 MB artifact); this run also compiled the immersive `MainActivity` and the new theme items.
- GitHub Actions `Android debug APK`: green on `8ac3fe8` (run [`40107959365`](https://github.com/FYI88/WAVES/actions/runs/40107959365), artifact `waves-debug-apk` 6,272,620 bytes zipped / 6,761,946 bytes APK).
- GitHub Actions `Android debug APK`: green on `1776c4f` (run [`40111884605`](https://github.com/FYI88/WAVES/actions/runs/40111884605), artifact 6,273,599 bytes zipped / 6,762,622 bytes APK).
- GitHub Actions `Android debug APK`: green on `00e9bf3` (run [`40114195190`](https://github.com/FYI88/WAVES/actions/runs/40114195190), artifact `waves-debug-apk` 5,288,051 bytes zipped / 5,768,915 bytes APK).
- GitHub Actions `Android debug APK`: green on `8741636` (run [`40115210963`](https://github.com/FYI88/WAVES/actions/runs/40115210963), artifact `waves-debug-apk` 5,288,093 bytes zipped / 5,768,947 bytes APK).
- GitHub Actions `Android debug APK`: green on `e4b1a8b` (run [`40117554972`](https://github.com/FYI88/WAVES/actions/runs/40117554972), artifact `waves-debug-apk` 5,288,057 bytes zipped / 5,768,927 bytes APK).
- GitHub Actions `Android debug APK`: green on `a4ef410` (run [`40149614351`](https://github.com/FYI88/WAVES/actions/runs/40149614351), artifact `waves-debug-apk` 5,573,773 bytes zipped / 6,010,168 bytes APK).
- Production output: 1,897,330 bytes across 35 files. Dropping KaTeX removed ~1.2 MB and 61 files (was ~3.1 MB / 96 files).

### Releases

- **`v1.0.0-debug.1`** (pre-release, tag on `3f7a656`) — asset `WaveS-1.0.0-debug.apk`, 6.4 MB. Public download (no login): <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.1>
- **`v1.0.0-debug.2`** (pre-release, tag on `51b238f`) — asset `WaveS-1.0.0-debug.2.apk`, 6.4 MB. Public download (no login): <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.2>
- **`v1.0.0-debug.3`** (pre-release, tag on `8ac3fe8`) — asset `WaveS-1.0.0-debug.3.apk`, 6,761,946 bytes. Public download (no login): <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.3>
- **`v1.0.0-debug.4`** (pre-release, tag on `1776c4f`) — asset `WaveS-1.0.0-debug.4.apk`, 6,762,622 bytes. Public download (no login): <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.4>
- **`v1.0.0-debug.5`** (pre-release, tag on `00e9bf3`) — asset `WaveS-1.0.0-debug.5.apk`, 5,768,915 bytes, SHA-256 `B6B1CB30110B6331E049824CA2FB0BE5CE45B5546FB663EC0859B793060D8113`. Public download (no login): <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.5>
- **`v1.0.0-debug.6`** (pre-release, tag on `8741636`) — asset `WaveS-1.0.0-debug.6.apk`, 5,768,947 bytes, SHA-256 `BA41D2BFF832CEF97AB0ECDDB03D263FB638AB97B41D6098402487475C555363`. Public download (no login): <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.6>
- **`v1.0.0-debug.7`** (pre-release, tag on `e4b1a8b`) — asset `WaveS-1.0.0-debug.7.apk`, 5,768,927 bytes, SHA-256 `5AF7EB700BCA441B3532660ACBFBDB08EB719CBBCE77201B7D31FEEBC9857899`. Public download (no login): <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.7>
- **`v1.0.0-debug.8`** (pre-release, tag on `a4ef410`) — asset `WaveS-1.0.0-debug.8.apk`, 6,010,168 bytes, SHA-256 `C0B4B90ABA5591593576DD06CEF30FECBA751BD241C90BCB95C3BCAC4F0526E0`. Public download (no login): <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.8>
- Debug-signed. Uninstall a previous debug build before installing this one; each CI run uses a different debug key.
- Verified each asset is publicly downloadable without authentication (debug.5–debug.8: HTTP 206 on a range GET, HEAD 200 with the right `Content-Length`, and a full unauthenticated download matched the local SHA-256).

### Phase 0 changes (committed as `d3614b6`)

- Added `vh` fallbacks before every `dvh` declaration, including the app frame, controls, present scene, help sheet and About sheet.
- Moved safe-area insets out of the phone-only block into the base `.om-top` and `.om-layout` rules, so notched phones work in both orientations. Phone bottom padding remains `max(24px, env(safe-area-inset-bottom))`.
- Added safe-area padding to the help/About backdrop.
- Added a short-landscape present layout: the deck becomes a horizontally scrollable single row and the scene is `calc(100dvh - 210px)` with a 120 px minimum.
- Added coarse-pointer 40 px targets for the About close button, scene toolbar buttons, scene toggles, camera control and its range. The About ID block reserves space so the larger close button does not overlap text.
- Added `src/perf.ts`, `src/PerfHud.tsx` and `src/vite-env.d.ts`.
- Instrumented the RayScene requestAnimationFrame loop with `recordFrame`.
- Added the About build-info line and the five-tap HUD toggle.
- Added `version: 1.0.0` to `package.json` and `__APP_VERSION__` to the Vite config.
- Added `.om-perf` and `.om-about-build` styles.

### Phase 1 changes (committed as `c835e4e`)

- Installed `@capacitor/core`, `@capacitor/android` `8.5.3` and `@capacitor/cli` `8.5.3` (dev).
- Installed `@fontsource/inter-tight` and `@fontsource/jetbrains-mono` `5.3.0`.
- Added `capacitor.config.ts` with `appId: io.github.fyi88.waves`, `appName: WaveS`, `webDir: dist`, `server.androidScheme: https`.
- `src/main.tsx` now imports the bundled font subsets (Latin + Greek) instead of relying on a network font.
- Removed the `om-fonts` effect in `src/App.tsx` that injected the Google Fonts `<link>` at runtime.
- Ran `npx cap add android`, then `npx cap sync android`; generated `android/` is committed-ready, with `gradle-wrapper.jar` tracked and copied web assets ignored.
- Set `versionName "1.0.0"` in `android/app/build.gradle` to match `package.json` (versionCode stays `1`).
- Root `.gitignore` now also ignores keystores and Android build folders as belt-and-braces.

### Phase 2 changes (committed as `3f7a656`, CI green)

- Added `.github/workflows/android-debug.yml`: checkout, Node 22 with npm cache, Temurin JDK 21, `android-actions/setup-android@v4` (SDK 36 platform + build-tools 36.0.0, licences accepted), `gradle/actions/setup-gradle@v6` (wrapper validation + cache), `npm ci`, `npm test`, `npm run build`, `npx cap sync android`, `./gradlew assembleDebug`, APK summary and artifact upload (`waves-debug-apk`, 14 days).
- Added `apksigner verify` and a hard **10 MiB APK budget** check; the job fails if the debug APK grows past it.
- Runs on pushes to `main`, pull requests and manual dispatch; docs-only pushes are skipped with `paths-ignore: ["**.md"]`, and superseded runs are cancelled by `concurrency`. Timeout is 45 minutes for the cold Gradle download.
- Marked `android/gradlew` executable in the Git index (`100755`) so Linux runners can invoke it without a `chmod`.
- Gradle wrapper now fetches `gradle-8.14.3-bin.zip` (not `-all`) with a pinned `distributionSha256Sum`.
- `android/gradle.properties`: heap raised to 2048 MB + 512 MB metaspace, `org.gradle.caching=true`.
- `android/app/build.gradle` reads `versionName` from `package.json`, so the app version has one source of truth (`versionCode` stays manual).
- `tsconfig.json` now typechecks `capacitor.config.ts`; added `.nvmrc` (22) and an Android/APK section to `README.md`.

### Phase 2.1 changes (device feedback, committed as `51b238f`)

The first installed APK reported Android 10 / WebView 155, roughly 12–15 fps, no visible HUD and a visible status bar. Fixes:

- Adaptive DPR in `src/App.tsx`: coarse pointers start at cap 1.5 instead of 2; p95 above 22 ms steps 1.75 -> 1.5 -> 1.25 -> 1; the choice persists in `localStorage["waves:dprCap"]`. Only the main scene canvas is affected; the chart canvases keep DPR 2.
- Mobile shadow tier: every `shadowBlur` in `waveRays.ts` and `spatialScene.ts` is gated by a new `shadows` option, set to false on coarse pointers. `shadowOffsetY` is gated too so no sharp offset shadows remain.
- Low-power 2D detail: crest sampling every 3.2 px instead of 1.5 px, every second wavefront, no particle halos. Physics untouched.
- CSS: `backdrop-filter` is disabled under `@media (pointer: coarse)`; the tinted surfaces remain, the per-frame blur does not.
- Immersive fullscreen: `MainActivity.java` now calls `WindowCompat.setDecorFitsSystemWindows(false)`, hides the system bars with `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`, uses `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`, and re-applies on window focus. `styles.xml` sets the status/navigation bar and window background to `#061018`.
- Discoverability: the About card now has a visible **Performance HUD** checkbox. The five-tap gesture on the build line still works.

### Phase 2.2 changes (device feedback, committed as `8ac3fe8`)

debug.2 on the M20 reported 29–34 fps, p95 33.4 ms, DPR bottomed out at 1.00 with a 450x499 buffer on a 1080 px panel, and the user said text and graphics looked soft. That ruled out fill rate as the bottleneck: the per-frame cost was JS and canvas path work, so lowering resolution further could only make it blurrier without reaching 60 fps.

- The section view is now two stacked canvases in `src/App.tsx`: `om-canvas-backdrop` paints the scenery once per parameter/theme/selection change at up to 2.5x device pixels (`useCanvasSize(backdropRef, 2.5)`), while the interactive canvas paints only the moving parts every frame at the adaptive DPR.
- `src/waveRays.ts` was split into `rayGeometry`, `drawRayBackdrop`, `drawRayWaves`, `drawRayForeground` and a public `drawWaveRays` wrapper. `RayOptions.layer: "static" | "animated"` selects a pass; omitting it still paints everything in order, so the web fallback and the tests are unchanged. Both passes derive every coordinate from the same `rayGeometry`, so the layers stay pixel-aligned.
- Dust motes and the absorbed-energy bloom moved to the animated pass (they follow the clock); the slab fills, tiles, grid, labels, ruler, dishes, meters and pills stay static.
- Animated-pass micro-optimisations: per-segment wave gradients are cached per context (`linearOn`), wavefronts and particle trails use solid strokes instead of one gradient per item, `rgba()` strings are memoised, and the crest ribbon is built without copying and reversing an array every frame.
- Crest sampling in low-power went from 3.2 px to 4 px; the source rings moved to the animated layer so they no longer force a scenery repaint.
- PNG export now composites scenery over waves, taking the sharper scenery canvas as the output size.
- The About build line now includes a `__BUILD_SHA__` commit stamp (from `git rev-parse --short HEAD` in `vite.config.ts`, `"dev"` outside a checkout), so the installed build can be identified on the phone.

Desktop benchmark at 450x499, low-power, shadows off: full scene at 1.0x 5.4 ms -> animated pass at 1.0x 3.9 ms, 1.25x 4.1 ms, 1.5x 4.6 ms; static pass at 2.5x 8.75 ms but only on change. A single-pass vs stacked comparison measured a mean difference of 0.79 per channel with 6,989 of 504,900 pixels over 40 — pure text/edge antialiasing, no missing or shifted geometry.

### Phase 2.3 changes (device feedback, committed as `1776c4f`)

The About card ("info" button) scrolled on the phone, and once scrolled the absolutely positioned close button left the screen. Tapping outside it to dismiss was also unreliable.

- `.om-about` no longer has `max-height`/`overflow: auto` in portrait: the card shows all of itself at once.
- New `@media (max-width: 420px)` block compacts the card instead of scrolling it: 38 px logo, 19 px title, 11 px tagline, two-column facts grid, 6 px mail rows, tighter model block, 34 px repo button, 24 px build and HUD rows. Measured 566.5 px tall at 360x640, leaving ~37 px of tappable backdrop above and below.
- `useFitToViewport` in `src/App.tsx` measures the card and applies a `transform: scale()` only if it still cannot fit (floor 0.62, so text stays legible). At 320x568 it scales to 0.854 and the whole card fits with the close button in view.
- Short landscape (`max-height: 520px`) is the one case that may still scroll, because scaling would make the type unreadable; the head is sticky there so the close button stays on screen.
- The backdrop now closes on `pointerdown` (first contact) as well as `click`, and only when the event target is the backdrop itself, so a scroll gesture outside the card dismisses it immediately. Tapping inside the card still does nothing.
- Verified in a 320x568 iframe: card fully inside, no scroll, close visible, 3 KaTeX equations rendered, inside tap keeps it open, outside tap closes, close button closes.

### Phase 2.4 changes (design feedback, committed as `00e9bf3`)

The user rejected the About card as out of proportion — awkward spacing and a large decorative block — and asked for the model block to be removed.

- Removed the `.om-model` block, all three KaTeX equations and the model note, plus the `modelLabel`, `modelNote`, `schoolLabel`, `emailSchool` and `emailPersonal` i18n keys. `katex` is uninstalled; production output fell to 1,897,330 bytes / 35 files.
- Rebuilt the card as one ruled column: head (logo, kicker, title, tagline, close), then author, contact and footer sections separated by hairlines. No inner boxes, no decorative tags, one accent hairline at the top.
- Card width is `min(430px, 100%)` on desktop (was 560 px) and sized by its content; measured 430x360.9 px at 800x656.
- Head is a three-column grid (`auto minmax(0, 1fr) auto`) so the close button sits in the flow instead of being absolutely positioned — it can no longer scroll or overlap the title.
- Contact rows are plain `mailto:` links with an icon, the address and no "Institutional/Personal" tags; `CONTACT_EMAILS` is now a plain string array. Both addresses fit on one line at 320 px.
- Footer combines the repository link, the build line and the HUD checkbox in one meta strip; the build line is left-aligned 9.5 px mono (9 px under 480 px).
- **Specificity fix:** `.om button { font: inherit; color: inherit; }` (0,1,1) outranked `.om-about-build` and `.om-about-close` (0,1,0), so the build line rendered at 15 px body ink instead of 9.5 px mono grey. The About rules are now `.om-about .om-about-build` / `.om-about .om-about-close` (0,2,0). This was the main reason the card looked lopsided.
- Phone layout is one `max-width: 480px` step driven by a `--about-pad` custom property (16 px); nothing is hidden and no section changes shape. Measured 361.1 px tall at both 320x568 and 360x640, leaving 103.5 px and 139.5 px of tappable backdrop above and below, no scroll, close visible.
- Short landscape: `min-width: 620px and max-height: 520px` becomes a two-column grid (232 px head panel + body) measured 660x254.9 px at 780x360 with no scroll. Narrower short landscape falls back to a scroll with a sticky head, ordered after the two-column rule so it cannot override it.
- `useFitToViewport` no longer waits on the KaTeX import: one 250 ms re-measure plus `document.fonts.ready`.
- Verified: 16/16 tests, `tsc --noEmit`, `npm run build`, `npx cap sync android`; inside tap keeps the card open, outside `pointerdown` closes it, the close button closes it; a simulated 40 px coarse close keeps the card at 361.1 px. The shipped APK contains the `00e9bf3` stamp, the section markup, the specificity-fixed rules and the landscape breakpoint, and no KaTeX assets or references.

### Phase 2.4.1 changes (design follow-up, committed as `8741636`)

The plain repository row lost the bordered button the user liked, including its hover tint and press scale.

- Restored `.om-about-repo` as the bordered button: 40 px tall, 10 px radius, 1 px `--om-line-2` border, transparent background, 16 px GitHub icon, centred label.
- Restored its effects: hover fills with 6% accent and shifts the border to 45% accent; `:active` scales to 0.995. The `↗` arrow that came with the plain row is gone.
- Phones keep the 34 px height and 11.5 px label under 480 px, so the card grows only 6 px: 367.1 px tall at both 320x568 and 360x640, leaving 100.5 px and 136.5 px of backdrop above and below.
- Short landscape is 660x266.9 px at 780x360 with no scroll and 46.5 px strips; the footer is pushed to the bottom of the right column, so the 40 px button still fits.
- Re-verified: 16/16 tests, `tsc --noEmit`, `npm run build`, `npx cap sync android`; no scroll at 320x568, 360x640 or 780x360; close visible; inside tap keeps it open, outside `pointerdown` and the close button dismiss; a simulated 40 px coarse close keeps the card at 367.1 px with a two-line tagline. The shipped APK contains the `8741636` stamp, the 40 px and 34 px button rules, and the hover/press effects, with no `om-about-arrow` markup and no KaTeX references.

### Phase 2.4.2 changes (device regressions, committed as `e4b1a8b`)

Three regressions reported after debug.6. None of them came from the About card work: `git diff 1776c4f..HEAD` touches only `App.tsx` (About markup), `styles.css` (About rules), `package.json` and the lockfile. `waveRays.ts`, `spatialScene.ts`, `physics.ts`, `materialSurfaces.ts`, `capacitor.config.ts` and `android/` were untouched.

1. **Material tiles in the canvas stopped selecting layers.** Introduced by the Phase 2.2 two-canvas split (`8ac3fe8`), not by the About work. The animated pass calls `drawWaveRays(..., { layer: "animated" })`, which paints only the moving waves and returns empty `rects`/`tiles`; the frame loop assigned that empty result to `layout.current`, wiping the hit geometry the static pass had just published. `hit()` therefore always found nothing.
   - The animated pass no longer writes `layout.current` in section view; the static pass owns the tiles and slabs, and its return value is assigned there.
   - The spatial view still rebuilds geometry every frame, because its camera moves every frame.
2. **Emoji in the incident-wave label.** `polGlyph` drew `E ⊙` for TE and `E ↕` for TM. Android has no text glyph for those code points in the bundled font, so WebView fell back to the colour emoji font. It now draws plain `TE` / `TM` / `TE+TM`, matching the header readout.
3. **Touch lag and freezes.** `onPointerMove` called `setHover(hit(event))` unconditionally. On a phone every finger move (including the moves that precede a tap) changed hover state, which repainted the whole scenery canvas at 2.5x device pixels and re-rendered the App tree. Taps therefore competed with repeated full-resolution repaints and often felt frozen or got lost.
   - Hover updates are skipped on coarse pointers; the static layer now repaints only when the setup, theme, selection or annotations actually change.
   - `sceneParams` is memoised on `[res, sim, t]`; before this, every App render created a fresh object and forced a full scenery repaint on unrelated state changes.
   - Verified with synthetic pointer events at desktop size (789.6x412.4, 3 layers, 150 px tiles) and compact phone size (349.6 px wide, 100.5 px tiles): clicking tiles 0, 1 and 2 selects the matching layer. A `fillText` probe during a theme repaint captured `INCIDENT` + `TE` and no `⊙`/`↕`; no other canvas label uses those glyphs. `tsc --noEmit` clean, 16/16 tests, build green.

### Phase 2.4.3 changes (launcher icon and splash, committed as `a4ef410`)

The installed app still showed the stock Capacitor launcher icon and the stock Capacitor X splash. Both now use the app's own emblem (`public/logo.png`), which is also the circular logo in the header and About card.

- Measured the artwork bounds in `logo.png` (1254x1254): x 170..1079, y 216..1102, i.e. 910x887 centred at (624.5, 659). Every icon is cut from a 956 px square centred on that artwork, so the emblem is optically centred rather than canvas-centred.
- Legacy icons per density (mdpi 48, hdpi 72, xhdpi 96, xxhdpi 144, xxxhdpi 192): `ic_launcher.png` is a white rounded square (20% corner radius) with the emblem at 80% of the tile; `ic_launcher_round.png` is a white circle with the emblem at 72% of the diameter. Transparent outside the shape.
- Adaptive foreground per density (108, 162, 216, 324, 432): white full-bleed with the emblem at 60% of the canvas, inside the 66/108 dp safe zone. The adaptive background stays `#FFFFFF`, so every mask shape (circle, squircle, rounded square) reads as a white tile with the emblem.
- Verified the 432 px foreground through a 72/108 circular mask: the wave and the network dots are fully inside, no clipping, ~3 dp of margin.
- Splash: the 11 stock `splash.png` bitmaps were deleted. `drawable/splash.xml` is a layer-list with a white background and `@drawable/splash_logo` centred at intrinsic size (560 px in `drawable-xxxhdpi`, ~367 px on the M20), so the emblem cannot stretch on a 19.5:9 screen. `AppTheme.NoActionBarLaunch` still points at `@drawable/splash`.
- All XML is well-formed; `tsc --noEmit` clean, 16/16 tests, build green. This pulls the Phase 4 "adaptive icons and splash assets" item forward.
- CI run [`40149614351`](https://github.com/FYI88/WAVES/actions/runs/40149614351) green; artifact 5,573,773 bytes zipped / 6,010,168 bytes APK. The APK contains the 15 regenerated `ic_launcher*` bitmaps (the 432 px foreground matches the generated file byte-for-byte), `drawable/splash.xml`, `drawable-xxxhdpi-v4/splash_logo.png`, and none of the old `splash.png` bitmaps. The APK grew 241 KB from the higher-quality icons and is still 6.01 MB, well under the 10 MiB guard.
- Published **`v1.0.0-debug.8`** on `a4ef410` with `WaveS-1.0.0-debug.8.apk` (6,010,168 bytes); range GET 206, HEAD 200, and a full unauthenticated download matched SHA-256 `C0B4B90A…526E0`.

### What Phase 2.3 does not include

- The keyboard shortcuts sheet (`.om-help`) still scrolls; it is desktop-only and its content is a key list.

### What Phase 2.2 does not include

- The spatial 3D view is still a single canvas at the adaptive DPR; it was not part of the reported problem.
- If p95 is still above 22 ms at DPR 1.0, the next lever is drawing the internal-reflection waves with fewer or no wavefronts on coarse pointers.

### What Phase 2 does not include

- No release/signed workflow yet (Phase 4).
- No native file/share/back-button integration yet (Phase 3); status bar and immersive mode are already done.
- No local Gradle build: this machine has no JDK 21 and no Android SDK.

## 5. Roadmap

### Phase 0 - Web baseline and mobile hardening

Status: committed (`d3614b6`), awaiting real-device check.

- [x] vh fallbacks for dvh.
- [x] Safe-area insets ungated from the phone-only media query.
- [x] Short-landscape present layout.
- [x] Coarse-pointer hit targets.
- [x] Hidden perf HUD and build info.
- [x] App version define.
- [x] Tests and production build green.
- [x] Commit Phase 0, including the About CSS refinement and this handoff file.
- [ ] Verify on the M20: layout, HUD, WebView version, baseline FPS.

### Phase 1 - Capacitor wrap

Status: committed and pushed (`c835e4e`), awaiting real-device smoke test.

- [x] Install Capacitor 8 packages.
- [x] Create `capacitor.config.ts`.
- [x] Bundle fonts with Fontsource and remove the Google Fonts effect.
- [x] Run `npx cap add android`.
- [x] Commit `android/`.
- [x] Sync and confirm the web app still passes `npm test` and `npm run build`.
- [x] Add adaptive DPR (done in `51b238f` after the debug.1 device report).

### Phase 2 - Debug CI

Status: done. Runs `40091642446`, `40098152879`, `40107959365`, `40111884605`, `40114195190`, `40115210963`, `40117554972` and `40149614351` are green; artifact `waves-debug-apk` is 5.3–6.3 MB zipped, published as `v1.0.0-debug.1` through `v1.0.0-debug.8`.

- [x] Add `.github/workflows/android-debug.yml`.
- [x] Node 22, JDK 21, Android SDK 36.
- [x] Steps: `npm ci`, `npm test`, `npm run build`, `npx cap sync android`, `./gradlew assembleDebug`, upload the APK artifact.
- [x] Trigger on push and pull request (plus manual `workflow_dispatch`; docs-only pushes are skipped via `paths-ignore`).
- [x] Confirm the first run uploads `waves-debug-apk`.
- [ ] Install the APK on the M20 and verify the native shell.

### Phase 3 - Native features

Status: partially done ahead of schedule in `51b238f` (immersive fullscreen + dark system bars). Exports, back button and splash remain.

- [ ] PNG and CSV exports go through `@capacitor/filesystem` and `@capacitor/share` on native, while keeping the web download path.
- [x] Status bar colour `#061018`, dark content.
- [x] Immersive mode (always on; bars hidden, swipe from an edge to reveal them).
- [ ] Android back button closes overlays first, then leaves present mode.
- [ ] Splash screen with the existing logo.
- [ ] Do not call native plugins on web without a guard.

### Phase 4 - Signed release

Status: not started.

- Add the release workflow on tags matching `v*`.
- Generate the keystore, base64-encode it and store it in GitHub Secrets.
- Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- Build `assembleRelease`, run `apksigner verify`, create the GitHub Release, upload the APK.
- [x] Adaptive icons and splash assets (done ahead of the release workflow in `a4ef410`).
- Add `THIRD_PARTY_NOTICES.md`.
- Run the full performance acceptance on the M20.

## 6. Android packaging details

### Versions

Planned for Phase 3 — only `@capacitor/core`, `@capacitor/android` and `@capacitor/cli` are installed today; the rest are pinned targets, not dependencies yet.

- `@capacitor/core`, `@capacitor/android`, `@capacitor/cli`: `8.5.3`.
- `@capacitor/filesystem`: `8.1.5`.
- `@capacitor/share`: `8.0.3`.
- `@capacitor/app`: `8.1.2`.
- `@capacitor/status-bar`: `8.0.4`.
- `@capacitor/splash-screen`: `8.0.2`.
- `@capacitor/assets`: `3.0.5`.
- `@fontsource/inter-tight`: `5.3.0`.
- `@fontsource/jetbrains-mono`: `5.3.0`.

Capacitor 8 requires Node 22+, JDK 21, Android SDK 36 and minSdk 24.

### Config (implemented)

`capacitor.config.ts`:

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.fyi88.waves",
  appName: "WaveS",
  webDir: "dist",
  server: { androidScheme: "https" },
};

export default config;
```

### Debug workflow (implemented)

`.github/workflows/android-debug.yml` is the source of truth. It uses current action majors: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-java@v6`, `android-actions/setup-android@v4` (installs SDK 36 platform + build-tools and accepts licences), `gradle/actions/setup-gradle@v6` (wrapper validation + cache), `actions/upload-artifact@v7`.

It runs `npm ci`, `npm test`, `npm run build`, `npx cap sync android`, `./gradlew assembleDebug`, then `apksigner verify`, a 10 MB size guard and the artifact upload.

The release workflow mirrors this with `assembleRelease`, `apksigner verify` and `softprops/action-gh-release`. Action majors must be re-checked before shipping.

## 7. Environment

- OS: Windows, PowerShell 5.1.
- Working copy: `C:\Users\WDAGUtilityAccount\Documents\Default Project`, a fresh `git clone` of `main`.
- Node: not preinstalled. Portable **Node v22.23.4** was installed at `%LOCALAPPDATA%\tools\node-v22.23.4-win-x64`; prepend it to `PATH` (`$env:PATH = "$env:LOCALAPPDATA\tools\node-v22.23.4-win-x64;$env:PATH"`) and call `npm.cmd`/`npx.cmd`, because the PowerShell execution policy blocks `npm.ps1`.
- Git: not preinstalled. **MinGit 2.56.0** is at `%LOCALAPPDATA%\tools\mingit\cmd\git.exe`; prepend that `cmd` folder to `PATH`. The repo uses `core.autocrlf=false` so the LF working tree matches upstream.
- Java: none. JDK 21 is still missing, so local Gradle/Android builds are impossible.
- Android SDK, `adb`, `ANDROID_HOME`: not installed.
- GitHub CLI: not installed. Pushing needs a PAT or a configured credential helper.
- Phone: Samsung Galaxy M20, Android 10 / One UI 2.0, Exynos 7904, Mali-G71 MP2, 3 GB RAM, 60 Hz 1080x2340.
- The user reports the phone is up to date, sideloading is open and performance is fine. Do not block on a WebView gate; record the version instead.

## 8. Commands

```powershell
npm ci
npm test
npm run build
npm run dev
npm run preview
```

Local Android build is not possible until JDK 21 and the Android SDK are installed. Use CI.

Useful checks:

```powershell
git status --short
git log --oneline -5
Select-String -Path src\styles.css -Pattern "dvh"
```

## 9. Verification on the M20

1. Open the web build over the Vercel HTTPS URL, or the debug APK. Enable the HUD with `?perf=1`, the five-tap gesture on the About build line, or the **Performance HUD** checkbox in About.
2. Let the intro finish, then play for 30 seconds. Record median FPS, p95, the DPR shown by the HUD and the worst repeated frame.
3. Drag the frequency slider and orbit for 10 seconds. Note dropped frames.
4. Pause for 10 seconds. Confirm the HUD says `idle` and no canvas draws occur.
5. Open About and check the Android/WebView version. Write it into the handoff journal.
6. Confirm the status and navigation bars are hidden; swipe from an edge to reveal them temporarily, then let them hide again.
7. Rotate to landscape and open Present. Confirm the deck scrolls horizontally and the scene is not clipped.
8. Install the debug APK, repeat steps 2 to 7. Uninstall before installing a later debug build.
9. Install the release APK and repeat. Release numbers are the contract numbers.
10. Check cold start, warm start and PSS after five minutes.

## 10. Risks

- 60 fps at DPR 2 is not guaranteed on the Mali-G71 MP2. Adaptive DPR starts at 1.5 on touch and steps down to 1; the scenery layer now stays sharp at 2.5x regardless of that ladder, so a low DPR only softens the moving waves.
- debug.2 measured p95 33.4 ms at DPR 1.00, i.e. the animated pass alone was too slow. debug.3 cuts its per-frame work roughly in half on desktop; the phone number is still unknown. If p95 is still above 22 ms, the next lever is fewer/no internal-reflection wavefronts on coarse pointers.
- The scenery canvas is repainted on every parameter, theme, hover or selection change. Dragging a slider therefore repaints 2.5x scenery each step; watch for stutter while dragging on the phone.
- Headless Chrome reports 26 to 29 fps, so local browser FPS numbers are not meaningful. Only the phone counts.
- Debug builds are slower and re-signed. Do not compare them to release.
- Android 10 is end-of-life; an outdated WebView can dominate performance and rendering.
- Bundling fonts changes text metrics. Re-check the desktop and phone layouts after Fontsource.
- Moving the APK to the phone needs USB or a cloud drive. The GitHub draft-release page may require a login on the phone.
- The desktop layout uses CSS `zoom: 0.8` above 1040 px and compensates with `125dvh`. Do not remove those rules.
- `HANDOFF.md` is the project memory. Update the journal after each phase.

## 11. Open questions

- Confirm the adaptive DPR thresholds (22 ms down, 14 ms up, 3 s settle) against debug.3 on the M20.
- The short-landscape present layout fits, but the annotations are cramped at 360 px height. Decide whether to hide the brand row in short landscape.
- Decide who holds the release keystore and where the offline backup lives.
- Decide whether v1 should include a changelog file or rely on GitHub Release notes.

## 12. File map

- `src/App.tsx`: all UI, canvas orchestration, exports, present mode, About/help overlays, perf instrumentation. The section view uses two stacked canvases: `om-canvas-backdrop` for the sharp, rarely repainted scenery and the interactive canvas for the animated pass.
- `src/styles.css`: complete visual system, responsive breakpoints, safe-area rules, HUD styles.
- `src/perf.ts`: frame ring buffer and `readPerf`.
- `src/PerfHud.tsx`: hidden diagnostic overlay.
- `src/vite-env.d.ts`: `__APP_VERSION__` declaration.
- `src/physics.ts`: transfer-matrix physics. Do not change.
- `src/waveRays.ts`: 2D cross-section renderer. Split into `rayGeometry`, `drawRayBackdrop` (scenery), `drawRayWaves` (animated), `drawRayForeground` (instruments/labels) and the `drawWaveRays` wrapper; `layer` selects one pass.
- `src/spatialScene.ts`: spatial renderer.
- `src/materialSurfaces.ts`: procedural material textures.
- `src/share.ts`: URL state encoding/decoding.
- `src/main.tsx`: React entry point. Imports the bundled Inter Tight / JetBrains Mono subsets.
- `vite.config.ts`: relative base and version define.
- `capacitor.config.ts`: Capacitor app id, name, web dir, Android scheme.
- `package.json`: scripts, dependencies, version.
- `index.html`: viewport, theme colour, splash styling.
- `public/logo.png`: 1254x1254 source for icons and splash.
- `android/`: generated Capacitor Android project. `gradle-wrapper.jar` is tracked; copied web assets and `capacitor.config.json` are ignored.
- `.github/workflows/android-debug.yml`: debug APK CI (Node 22, JDK 21, SDK 36, artifact upload).
- `dist/`: production output, regenerated by `npm run build`.
- `.gitignore`: must ignore Android build outputs and keystores while tracking `gradle-wrapper.jar`.
- `.nvmrc`: Node 22 for local version managers.
- `HANDOFF.md`: this file.

Planned:

- `.github/workflows/android-release.yml`
- `THIRD_PARTY_NOTICES.md`

## 13. Journal

### 2026-10-24

- Cloned `FYI88/WAVES` at `e47c85c` into the current sandbox (the 2026-10-22 working copy is gone).
- Installed portable Node v22.23.4 and MinGit 2.56.0 under `%LOCALAPPDATA%\tools`; no system installs available.
- `npm ci` then `npm test`: 16/16. `npm run build`: green.
- Phase 1: installed Capacitor 8.5.3 (core/android/cli) and Fontsource 5.3.0.
- Added `capacitor.config.ts`; replaced the runtime Google Fonts `<link>` with Latin + Greek Fontsource imports in `src/main.tsx` and deleted the `om-fonts` effect from `src/App.tsx`.
- `npx cap add android` + `npx cap sync android`: `android/` generated, 53 trackable files including the Gradle wrapper jar.
- Set `versionName "1.0.0"`; added keystore/Android build rules to `.gitignore`.
- Production output grew to 3.1 MB / 96 files, still under the 10 MB APK budget.
- Pushed Phase 1 to `origin/main` as `c835e4e` after verifying the remote head.
- `npm test` 16/16 and `npm run build` green after the changes. No local Gradle build (no JDK 21 / Android SDK).
- Phase 2: added `.github/workflows/android-debug.yml` (Node 22 + npm cache, Temurin 21, Android SDK 36, Gradle cache, tests, build, `cap sync`, `assembleDebug`, artifact).
- Marked `android/gradlew` executable in the index (`100755`), since the file was created on Windows.
- Review pass before the first push: moved all actions to current 2026 majors (checkout v7, setup-node v7, setup-java v6, setup-android v4, setup-gradle v6, upload-artifact v7), let setup-android install SDK packages and accept licences, enabled Gradle wrapper validation, added `apksigner verify` + a 10 MiB size guard, pinned the Gradle wrapper checksum and switched to the `-bin` distribution, raised the Gradle heap, derived `versionName` from `package.json`, typechecked `capacitor.config.ts`, added `.nvmrc`, and documented the Android/APK flow in `README.md`.
- Pushed Phase 2 as `3f7a656` once the PAT gained the Workflows permission.
- First CI run [`40091642446`](https://github.com/FYI88/WAVES/actions/runs/40091642446) is fully green in 2.1 min: wrapper validation, all tests/build steps, `apksigner verify` and the 10 MB guard passed. Artifact `waves-debug-apk` is 5.98 MB (14-day retention).
- Published **`v1.0.0-debug.1`** as a GitHub pre-release on `3f7a656` with `WaveS-1.0.0-debug.apk` (6,759,318 bytes), so the phone can download it without a GitHub login. Confirmed an unauthenticated download returns HTTP 206.
- The user installed debug.1 on the M20: Android 10, WebView 155, versionName 1.0.0. Reported roughly 12–15 fps, a visible status bar and no FPS counter.
- Phase 2.1: adaptive DPR (coarse start 1.5, step down to 1 when p95 > 22 ms, persisted), mobile shadow tier (canvas `shadowBlur` + CSS `backdrop-filter` off on coarse pointers), low-power 2D detail (coarser crest sampling, alternate wavefronts, no particle halos), immersive `MainActivity` (hidden bars, edge-to-edge, short-edge cutout, re-applied on focus), dark `#061018` system bars, and a visible Performance HUD checkbox in About.
- `npm test` 16/16 and `npm run build` green. Pushed as `51b238f`.
- CI run [`40098152879`](https://github.com/FYI88/WAVES/actions/runs/40098152879) is green: the new Java and theme compile, tests/build/`apksigner`/size guard pass. Artifact 5.98 MB.
- Published **`v1.0.0-debug.2`** on `51b238f` with `WaveS-1.0.0-debug.2.apk` (6,760,842 bytes); unauthenticated download returns HTTP 206.
- The user installed debug.2: the HUD checkbox works, but the scene ran at 29–34 fps with p95 33.4 ms at DPR 1.00 in a 450x499 buffer on a 1080 px panel, and text/graphics looked soft.
- Diagnosed it as per-frame canvas work, not fill rate: at DPR 1.00 the cost cannot be the pixel count, and lowering resolution further was the direct cause of the blur.
- Phase 2.2: split the section view into a scenery canvas at up to 2.5x device pixels (repainted only on parameter/theme/hover/selection change) and an animated canvas at the adaptive DPR. `waveRays.ts` gained `rayGeometry`, `drawRayBackdrop`, `drawRayWaves`, `drawRayForeground` and a `layer` option; `App.tsx` wires the second canvas and composites both for PNG export.
- Animated-pass micro-optimisations: cached per-segment gradients, solid wavefront/particle strokes, memoised `rgba()`, no array copy/reverse in the crest polygon, 4 px crest sampling in low-power.
- Added a `__BUILD_SHA__` commit stamp to the About build line so the installed build is identifiable.
- Verified with the browser harness: single-pass vs stacked mean difference 0.79 per channel, 6,989/504,900 pixels over 40 — text/edge antialiasing only. Desktop benchmark at 450x499 low-power: full 5.4 ms -> animated 3.9 ms at 1.0x, 4.6 ms at 1.5x; static 8.75 ms at 2.5x but only on change.
- `npm test` 16/16, `npm run build` green, `npx cap sync android` green. Pushed as `8ac3fe8`.
- CI run [`40107959365`](https://github.com/FYI88/WAVES/actions/runs/40107959365) is green.
- Published **`v1.0.0-debug.3`** on `8ac3fe8` with `WaveS-1.0.0-debug.3.apk` (6,761,946 bytes); unauthenticated range GET returns HTTP 206.
- User feedback on debug.3: the About card scrolled on the phone and the close button scrolled out of view; tapping outside did not reliably dismiss it.
- Phase 2.3: removed the portrait `max-height`/`overflow: auto` from `.om-about`, added a `max-width: 420px` compaction (38 px logo, 19 px title, two-column facts, tighter equations, 24 px build/HUD rows), made the backdrop dismiss on `pointerdown` at the backdrop itself, kept a scroll plus sticky head only in short landscape, and added `useFitToViewport` to scale the card (floor 0.62) when it still cannot fit.
- Measured: 566.5 px tall at 360x640 with no scroll and ~37 px of backdrop above and below; at 320x568 it scales to 0.854 and still fits, close visible, all three equations rendered. Inside tap keeps it open, outside tap and the close button both dismiss.
- `npm test` 16/16 and `npm run build` green. Pushed as `1776c4f`.
- CI run [`40111884605`](https://github.com/FYI88/WAVES/actions/runs/40111884605) is green.
- Published **`v1.0.0-debug.4`** on `1776c4f` with `WaveS-1.0.0-debug.4.apk` (6,762,622 bytes); unauthenticated range GET returns HTTP 206 and the APK contains the `1776c4f` stamp plus the compact About CSS.
- No post-fix device measurement yet.
- User feedback on debug.4: the About card still looked out of proportion, and the ITU-R model block took too much space; asked for the model block to be removed.
- Phase 2.4: removed `.om-model`, the three KaTeX equations, the model note and the `modelLabel` / `modelNote` / `schoolLabel` / `emailSchool` / `emailPersonal` keys; uninstalled `katex`; rebuilt the card as one ruled column (430 px desktop width, in-flow close button, plain contact rows, footer meta strip) and fixed the `.om button` specificity clash that rendered the build line at 15 px.
- Measured 361.1 px at 320x568 and 360x640, 660x254.9 px in short landscape, no scroll; inside tap keeps the card open, outside `pointerdown` and the close button dismiss. `npm test` 16/16, `npm run build` and `npx cap sync android` green. Pushed as `00e9bf3`.
- CI run [`40114195190`](https://github.com/FYI88/WAVES/actions/runs/40114195190) green; artifact 5,288,051 bytes zipped / 5,768,915 bytes APK. Production output 1,897,330 bytes / 35 files, down from ~3.1 MB / 96.
- Published **`v1.0.0-debug.5`** on `00e9bf3` with `WaveS-1.0.0-debug.5.apk` (5,768,915 bytes); range GET 206, HEAD 200 with the right length, and a full unauthenticated download matched SHA-256 `B6B1CB30…D8113`.
- User feedback on debug.5: the plain repository row lost the old bordered GitHub button and its hover/press effects.
- Phase 2.4.1: restored the 40 px bordered `.om-about-repo` button (10 px radius, accent-tinted hover fill, accent border on hover, 0.995 press scale), removed the `↗` arrow, and kept the 34 px phone height. Card is 367.1 px at 320x568 and 360x640, 660x266.9 px in short landscape, still no scroll. Tests/build/sync green. Pushed as `8741636`.
- CI run [`40115210963`](https://github.com/FYI88/WAVES/actions/runs/40115210963) green; artifact 5,288,093 bytes zipped / 5,768,947 bytes APK. The APK contains the `8741636` stamp and the restored button rules.
- Published **`v1.0.0-debug.6`** on `8741636` with `WaveS-1.0.0-debug.6.apk` (5,768,947 bytes); range GET 206, HEAD 200, and a full unauthenticated download matched SHA-256 `BA41D2BF…555363`.
- User feedback on debug.6: material tiles in the canvas no longer select layers, the incident-wave label shows an emoji-like glyph, and the scene is laggy and freezes.
- Phase 2.4.2: traced all three. The tile regression came from `8ac3fe8` (Phase 2.2), not the About work: the animated pass returned empty `rects`/`tiles` and overwrote `layout.current` every frame, so `hit()` never matched. The glyph was `E ⊙` / `E ↕` falling back to Android's colour emoji font. The lag came from `setHover` on every pointer move repainting the 2.5x scenery layer, plus a new `sceneParams` object on every App render forcing the same repaint.
- Fixes: static pass owns `layout.current` in section view; animated pass only paints; hover skipped on coarse pointers; `sceneParams` memoised on `[res, sim, t]`; incident pill draws plain `TE`/`TM`/`TE+TM`.
- Verified: tiles 0/1/2 select correctly at 789.6x412.4 and at 349.6 px compact width; `fillText` probe captured `INCIDENT` + `TE`, no `⊙`/`↕`; `tsc --noEmit`, 16/16 tests, build green. Pushed as `e4b1a8b`.
- CI run [`40117554972`](https://github.com/FYI88/WAVES/actions/runs/40117554972) green; artifact 5,288,057 bytes zipped / 5,768,927 bytes APK. The APK contains the `e4b1a8b` stamp, two `layout.current` assignments, the coarse-pointer hover guard and plain `TE+TM`, with no `⊙`/`↕` code points.
- Published **`v1.0.0-debug.7`** on `e4b1a8b` with `WaveS-1.0.0-debug.7.apk` (5,768,927 bytes); range GET 206, HEAD 200, and a full unauthenticated download matched SHA-256 `5AF7EB70…57899`.
- User asked for the app's own emblem as the launcher icon before installing.
- Phase 2.4.3: measured the artwork in `public/logo.png` (910x887 at 624.5, 659), cut every icon from a 956 px square centred on it, and regenerated all 15 `ic_launcher*` bitmaps: white rounded-square legacy icons at 48–192 px, white circular round icons, and adaptive foregrounds at 108–432 px with the emblem at 60% (inside the 66/108 dp safe zone). Checked the 432 px foreground through a 72/108 circular mask: no clipping.
- Replaced the stock Capacitor X splash: deleted the 11 `splash.png` bitmaps, added `drawable/splash.xml` (white layer-list with `@drawable/splash_logo` centred at intrinsic size) and a 560 px `drawable-xxxhdpi/splash_logo.png`. The emblem shows at ~368 px on the M20 and cannot stretch on 19.5:9.
- `tsc --noEmit`, 16/16 tests and the production build are green. Pushed as `a4ef410`.
- CI run [`40149614351`](https://github.com/FYI88/WAVES/actions/runs/40149614351) green; artifact 5,573,773 bytes zipped / 6,010,168 bytes APK. Verified the APK contains the regenerated icon bitmaps, the splash layer-list and the splash logo, and no stock splash bitmaps.
- Published **`v1.0.0-debug.8`** on `a4ef410` with `WaveS-1.0.0-debug.8.apk` (6,010,168 bytes); range GET 206, HEAD 200, and a full unauthenticated download matched SHA-256 `C0B4B90A…526E0`.

### 2026-10-22

- Closed the device gate: the user confirmed the M20 is updated, sideloading is open and performance is acceptable.
- Finalised the performance contract and the Phase 1 downgrade ladder.
- Audited the CSS and render loop. Found the DPR cap at `src/App.tsx:868`, the RayScene rAF loop around `src/App.tsx:1180`, and the dvh/safe-area locations in `src/styles.css`.
- Implemented Phase 0 in the working tree.
- `npm test`: 16/16. `npm run build`: green.
- Captured headless screenshots at 412x869 and 780x360. No horizontal overflow. Present landscape fits with a 58 px deck and a 150 px scene.
- Confirmed the About build line, the five-tap HUD toggle and the 40 px coarse-pointer close button.
- No real-device measurement yet.

## 14. Next actions

1. Install `WaveS-1.0.0-debug.8.apk` from <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.8> on the M20 (uninstall debug.7 or any earlier debug build first).
2. Confirm the launcher icon and the launch splash both show the blue wave emblem, and that the icon is not clipped by the launcher's mask.
3. Tap the three material tiles drawn inside the canvas and confirm each selects the matching layer in the list below; tap the slabs themselves as well.
4. Confirm the incident-wave label reads `INCIDENT` with a plain `TE` underneath and no emoji-like symbol.
5. Check the build line shows `a4ef410`, tick **Performance HUD**, play for 30 s and report fps, p95, DPR, buffer size, and whether text/graphics look sharp. Note whether the freeze still happens and what you were doing at the time (dragging, rotating the spatial view, opening About).
6. If p95 is still above 22 ms at DPR 1, cut the internal-reflection wavefronts on coarse pointers (perf lever 5) and re-measure.
7. Then Phase 3 native integration: PNG/CSV share, back button, splash plugin; Phase 4: signed release.
