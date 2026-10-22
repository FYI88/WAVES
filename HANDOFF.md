# WaveS - Android packaging handoff

Last updated: 2026-10-22
Repository: `C:\Users\HP\Documents\ONDE APP SCHOOL\astra Onde_Mur_Wave_Wall_Simulator (2)`
Branch: `main`
Head at handoff: `0946a9d` - `Set browser tab title to just WaveS`

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

Current `dist` baseline: 2.6 MB, 66 files. The web Canvas is roughly 0.5 to 1.1 megapixels at DPR 2 on this phone, so 60 fps is realistic but not guaranteed on the Mali-G71 MP2.

### Perf HUD

Hidden by default. Enable with either:

- five taps within 900 ms on the version line at the bottom of the About card, or
- `?perf=1`, or
- `localStorage.setItem("waves:perf", "1")`.

The HUD shows fps, p95 frame time, DPR, canvas buffer size and `live`/`idle`. It is `pointer-events: none`, so it never blocks input. It is kept in release builds on purpose.

The About card version line shows the app version plus the Android and Chrome/WebView versions parsed from the user agent. Record the phone's WebView version before trusting FPS numbers: Android 10 is end-of-life and an old WebView can dominate results.

### Perf levers for Phase 1

Apply only if the release baseline misses the contract, in this order:

1. One-way adaptive DPR: 2 -> 1.75 -> 1.5 -> 1.25 -> 1 after a 2 s warm-up when p95 is above 22 ms.
2. Mobile shadow tier: disable canvas `shadowBlur` on coarse pointers.
3. Static-layer cache: render the wall/scene background to an offscreen canvas and redraw only when parameters change.
4. Reduce spatial detail (grid density, sample counts) without changing physics.

Do not change the physics or the chart semantics.

## 4. Current build state

### Repository

- Head: `0946a9d`.
- Recent commits: `b22fd91` title/English description, `197d8f9` About card redesign, `409ed37` About panel.
- Before Phase 0, the only uncommitted file was `src/styles.css` (About-card refinement).
- Phase 0 is now implemented in the working tree but not committed.
- `HANDOFF.md` is new.

### Test and build status

- `npm test`: 16/16 passing.
- `npm run build`: green (`tsc --noEmit && vite build`).
- Production output: approximately 2.6 MB across 66 files, including KaTeX fonts.

### Phase 0 changes in the working tree

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

### What Phase 0 does not include

- No Capacitor install, no `android/` directory, no CI workflow yet.
- No Fontsource imports yet.
- No native file/share/status-bar/back-button integration yet.
- No adaptive DPR yet.

## 5. Roadmap

### Phase 0 - Web baseline and mobile hardening

Status: implemented locally, awaiting commit and real-device check.

- [x] vh fallbacks for dvh.
- [x] Safe-area insets ungated from the phone-only media query.
- [x] Short-landscape present layout.
- [x] Coarse-pointer hit targets.
- [x] Hidden perf HUD and build info.
- [x] App version define.
- [x] Tests and production build green.
- [ ] Commit Phase 0, including the About CSS refinement and this handoff file.
- [ ] Verify on the M20: layout, HUD, WebView version, baseline FPS.

### Phase 1 - Capacitor wrap

Status: not started.

- Install Capacitor 8 packages.
- Create `capacitor.config.ts`.
- Bundle fonts with Fontsource and remove the Google Fonts effect.
- Run `npx cap add android`.
- Commit `android/`.
- Sync and confirm the web app still passes `npm test` and `npm run build`.
- Add adaptive DPR only if the Phase 0 baseline demands it.

### Phase 2 - Debug CI

Status: not started.

- Add `.github/workflows/android-debug.yml`.
- Node 22, JDK 21, Android SDK 36.
- Steps: `npm ci`, `npm test`, `npm run build`, `npx cap sync android`, `./gradlew assembleDebug`, upload the APK artifact.
- Trigger on push and pull request.

### Phase 3 - Native features

Status: not started.

- PNG and CSV exports go through `@capacitor/filesystem` and `@capacitor/share` on native, while keeping the web download path.
- Status bar colour `#061018`, dark content.
- Immersive mode while presenting.
- Android back button closes overlays first, then leaves present mode.
- Splash screen with the existing logo.
- Do not call native plugins on web without a guard.

### Phase 4 - Signed release

Status: not started.

- Add the release workflow on tags matching `v*`.
- Generate the keystore, base64-encode it and store it in GitHub Secrets.
- Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- Build `assembleRelease`, run `apksigner verify`, create the GitHub Release, upload the APK.
- Add adaptive icons and splash assets.
- Add `THIRD_PARTY_NOTICES.md`.
- Run the full performance acceptance on the M20.

## 6. Android packaging details

### Versions

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

### Planned config

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

### Planned workflow shape

```yaml
# debug
- uses: actions/setup-node@v4
  with: { node-version: 22, cache: npm }
- uses: actions/setup-java@v4
  with: { distribution: temurin, java-version: 21 }
- uses: android-actions/setup-android@v3
- run: npm ci
- run: npm test
- run: npm run build
- run: npx cap sync android
- run: cd android && ./gradlew assembleDebug
- uses: actions/upload-artifact@v4
  with: { name: waves-debug, path: android/app/build/outputs/apk/debug/app-debug.apk }
```

The release workflow mirrors this with `assembleRelease`, `apksigner verify` and `softprops/action-gh-release`. Pin action versions before shipping.

## 7. Environment

- OS: Windows, PowerShell 5.1.
- Node: v24.11.0. `package.json` asks for `22.x`, so npm prints an engine warning. CI must use 22.
- Java: 8 only. Capacitor 8 needs 21. Local Android builds are therefore unavailable.
- Android SDK, `adb`, `ANDROID_HOME`: not installed.
- GitHub CLI: installed but not authenticated.
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

1. Open the web build over the Vercel HTTPS URL. Enable the HUD with `?perf=1`.
2. Let the intro finish, then play for 30 seconds. Record median FPS, p95 and the worst repeated frame.
3. Drag the frequency slider and orbit for 10 seconds. Note dropped frames.
4. Pause for 10 seconds. Confirm the HUD says `idle` and no canvas draws occur.
5. Open About and check the Android/WebView version. Write it into the handoff journal.
6. Rotate to landscape and open Present. Confirm the deck scrolls horizontally and the scene is not clipped.
7. Install the debug APK, repeat steps 2 to 6. Uninstall before installing a later debug build.
8. Install the release APK and repeat. Release numbers are the contract numbers.
9. Check cold start, warm start and PSS after five minutes.

## 10. Risks

- 60 fps at DPR 2 is not guaranteed on the Mali-G71 MP2. Adaptive DPR is the insurance policy.
- Headless Chrome reports 26 to 29 fps, so local browser FPS numbers are not meaningful. Only the phone counts.
- Debug builds are slower and re-signed. Do not compare them to release.
- Android 10 is end-of-life; an outdated WebView can dominate performance and rendering.
- Bundling fonts changes text metrics. Re-check the desktop and phone layouts after Fontsource.
- Moving the APK to the phone needs USB or a cloud drive. The GitHub draft-release page may require a login on the phone.
- The desktop layout uses CSS `zoom: 0.8` above 1040 px and compensates with `125dvh`. Do not remove those rules.
- `HANDOFF.md` is the project memory. Update the journal after each phase.

## 11. Open questions

- Adaptive DPR is recommended, but confirm the exact downgrade threshold during the Phase 1 device test.
- The short-landscape present layout fits, but the annotations are cramped at 360 px height. Decide whether to hide the brand row in short landscape.
- Decide who holds the release keystore and where the offline backup lives.
- Decide whether v1 should include a changelog file or rely on GitHub Release notes.

## 12. File map

- `src/App.tsx`: all UI, canvas orchestration, exports, present mode, About/help overlays, perf instrumentation.
- `src/styles.css`: complete visual system, responsive breakpoints, safe-area rules, HUD styles.
- `src/perf.ts`: frame ring buffer and `readPerf`.
- `src/PerfHud.tsx`: hidden diagnostic overlay.
- `src/vite-env.d.ts`: `__APP_VERSION__` declaration.
- `src/physics.ts`: transfer-matrix physics. Do not change.
- `src/waveRays.ts`: 2D cross-section renderer.
- `src/spatialScene.ts`: spatial renderer.
- `src/materialSurfaces.ts`: procedural material textures.
- `src/share.ts`: URL state encoding/decoding.
- `src/main.tsx`: React entry point. Fontsource imports go here in Phase 1.
- `vite.config.ts`: relative base and version define.
- `package.json`: scripts, dependencies, version.
- `index.html`: viewport, theme colour, splash styling.
- `public/logo.png`: 1254x1254 source for icons and splash.
- `dist/`: production output, regenerated by `npm run build`.
- `.gitignore`: must ignore Android build outputs and keystores while tracking `gradle-wrapper.jar`.
- `HANDOFF.md`: this file.

Planned:

- `capacitor.config.ts`
- `android/`
- `.github/workflows/android-debug.yml`
- `.github/workflows/android-release.yml`
- `THIRD_PARTY_NOTICES.md`

## 13. Journal

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

1. Commit Phase 0, including the About-card CSS refinement and this handoff file.
2. Verify Phase 0 on the M20 and record the WebView version and baseline FPS.
3. Start Phase 1: Capacitor install, config, Fontsource, `android/`.
4. Add the debug CI workflow and get the first APK artifact.
