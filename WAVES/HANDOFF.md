# WaveS - Android packaging handoff

Last updated: 2026-10-24
Repository (working copy): `C:\Users\WDAGUtilityAccount\Documents\Default Project`
Upstream: `https://github.com/FYI88/WAVES.git`
Branch: `main`
Head at handoff: `6b0c395` (docs) - release tag `v1.0.0-debug.1` points at `3f7a656`

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

### Perf levers for Phase 1

Apply only if the release baseline misses the contract, in this order:

1. One-way adaptive DPR: 2 -> 1.75 -> 1.5 -> 1.25 -> 1 after a 2 s warm-up when p95 is above 22 ms.
2. Mobile shadow tier: disable canvas `shadowBlur` on coarse pointers.
3. Static-layer cache: render the wall/scene background to an offscreen canvas and redraw only when parameters change.
4. Reduce spatial detail (grid density, sample counts) without changing physics.

Do not change the physics or the chart semantics.

## 4. Current build state

### Repository

- Head: `6b0c395` (docs after Phase 2).
- Recent commits: `6b0c395` handoff CI record, `3f7a656` Phase 2 (debug CI), `c835e4e` Phase 1 (Capacitor + bundled fonts).
- Phases 0–2 are committed, pushed and CI-verified. The debug APK is published as pre-release `v1.0.0-debug.1`.
- `HANDOFF.md` is tracked in the repository and updated at the end of every phase.

### Test and build status

- `npm test`: 16/16 passing.
- `npm run build`: green (`tsc --noEmit && vite build`).
- GitHub Actions `Android debug APK`: green on `3f7a656` (run `40091642446`, 2.1 min, 5.98 MB artifact).
- Production output: approximately 3.1 MB across 96 files, including KaTeX fonts and the bundled Inter Tight / JetBrains Mono subsets.

### Releases

- **`v1.0.0-debug.1`** (pre-release, tag on `3f7a656`) — asset `WaveS-1.0.0-debug.apk`, 6.4 MB. Public download (no login): <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.1>
- Debug-signed. Uninstall a previous debug build before installing this one; each CI run uses a different debug key.
- Verified the asset is publicly downloadable without authentication.

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

### What Phase 2 does not include

- No release/signed workflow yet (Phase 4).
- No native file/share/status-bar/back-button integration yet (Phase 3).
- No adaptive DPR yet.
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
- [ ] Add adaptive DPR only if the Phase 0 baseline demands it.

### Phase 2 - Debug CI

Status: done. First run `40091642446` is green; artifact `waves-debug-apk` is 5.98 MB, published as the `v1.0.0-debug.1` pre-release.

- [x] Add `.github/workflows/android-debug.yml`.
- [x] Node 22, JDK 21, Android SDK 36.
- [x] Steps: `npm ci`, `npm test`, `npm run build`, `npx cap sync android`, `./gradlew assembleDebug`, upload the APK artifact.
- [x] Trigger on push and pull request (plus manual `workflow_dispatch`; docs-only pushes are skipped via `paths-ignore`).
- [x] Confirm the first run uploads `waves-debug-apk`.
- [ ] Install the APK on the M20 and verify the native shell.

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
- No real-device measurement yet; the APK has not been installed on the M20.

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

1. Install `WaveS-1.0.0-debug.apk` from <https://github.com/FYI88/WAVES/releases/tag/v1.0.0-debug.1> on the M20 (uninstall any older debug build first).
2. Verify Phases 0–2 on the device: layout, HUD, WebView version, baseline FPS, APK cold/warm start and PSS.
3. Start Phase 3 native integration: PNG/CSV share, status bar, back button, splash.
4. Start Phase 4 once the device check is clean: signed release workflow and branded icons/splash.
