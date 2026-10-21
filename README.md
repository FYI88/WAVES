<div align="center">

# WaveS 
## Wave & Wall Simulator

**Propagation, réflexion et transmission des ondes EM à travers des parois multicouches.**
**EM wave propagation, reflection and transmission through multilayer walls.**

**Physique exacte ITU-R P.2040 · React + Vite + TypeScript · zéro dépendance runtime.**

**Live demo : https://waves-pearl.vercel.app/**

![QR code — live demo](public/qr-code.png)

![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Physics](https://img.shields.io/badge/Physics-ITU--R%20P.2040-ff6b35?style=for-the-badge)
![Tests](https://img.shields.io/badge/Tests-16%2F16%20passing-107c41?style=for-the-badge)
![Lang](https://img.shields.io/badge/Lang-FR%20%7C%20EN-1f6feb?style=for-the-badge)

Réalisé par **CHETAINE YOUNES** · ENSA GSR1

</div>

---

## Quick Start

```bash
git clone https://github.com/FYI88/WAVES.git
cd WAVES
npm install
npm run dev      # → http://localhost:5173
```

| Script          | Action                                              |
|-----------------|-----------------------------------------------------|
| `npm run dev`   | Dev server + hot reload                             |
| `npm run build` | Typecheck (`tsc`) + production build → `dist/`     |
| `npm test`      | Physics + share-codec regression suite (vitest)     |
| `npm run preview` | Serve the production build locally                |
| `npm start`     | Dev server, opens the browser                       |

---

## Features

- **Multilayer walls** — up to 6 layers, air gaps included; add, duplicate, reorder, remove; 8 ITU-R materials (concrete, brick, plasterboard, wood, glass, chipboard, plywood, marble) + fully custom media (ε′/σ or n/κ).
- **Full wave control** — frequency 0.5–40 GHz (log slider), incidence 0–89° (slider or drag directly on the R/T curve), polarization TE / TM / average.
- **Live views** — cross-section scene (field, crests, or both, with internal reflections and labels), R/T-vs-angle chart with Brewster marker, |E(z)| field profile (Lin/dB), energy budget bar (R + T + A = 100 %).
- **Scenarios** — one-click presets: Wi-Fi 2.4 GHz cavity brick, Wi-Fi 5 GHz stud partition, 5G 3.5 GHz plastered concrete, 5G 28 GHz double glazing, Brewster glass TM.
- **Share & export** — PNG snapshot of the scene, CSV export of both charts (Excel-ready, `;`-separated in FR), copy-link sharing (`#s=` URL encodes the exact setup), θ → θB Brewster jump (TM).
- **Present mode** — decluttered projector view with its own control bar, auto fullscreen (P to enter, Esc to exit).
- **Comfort** — FR/EN toggle (L), dark/light theme (T), Space play/pause, ←→ incidence angle, ↑↓ layer select, V section/spatial view, 1/2/3 curves/crests/both, P present, `?` shortcuts overlay, persistent state (localStorage), responsive layout (3-column desktop at 80 % default scale, stacked phone/tablet untouched).

---

## Physics Engine

`src/physics.ts` — pure, DOM-free, reusable as-is (PWA, Tauri, Capacitor):

- Complex arithmetic in `exp(jωt)` convention; η = ε′ − j·17.98·σ/f (ITU-R P.2040 eq. 9b); Table 3 materials as ε′ = a·fᵇ, σ = c·fᵈ.
- Complex Fresnel (§2.2.1), single lossy slab (§3.4), stable N-layer transfer recursion (air | L1…LN | air), exact tangential |E(z)| field solver, pseudo-Brewster search, 0–90° angular sweep.
- Honest warnings: out-of-ITU-range extrapolation + tan δ > 0.5 flagged in the UI.

### Regression lock (`npm test`)

| Check | Result |
|-------|--------|
| Glazing TE 5 GHz 35° | R = 0.865404 · T = 0.101251 · A = 0.0333447 |
| Cavity brick AVG 2.4 GHz 0° | R = 0.186401 · T = 0.220373 · A = 0.593226 |
| Concrete TM 68.5° (near-Brewster) | R = 0.00223008 · T = 0.00287356 · A = 0.994896 |
| R + T + A = 1, per-layer absorption sums, bounds | 5 configs |
| Recursion = closed-form slab, stack field = direct solver, AVG = mean(TE, TM) | cross-path |
| 181-point sweep finite + bounded, Brewster = TM minimum | sweep sanity |

> `src/physics.ts` must never change without updating these numbers deliberately. Any silent drift fails the suite.

---

## Repository Structure

```text
./
├── index.html            # title, splash boot screen, mount #root
├── package.json          # dev / build / test scripts
├── src/
│   ├── main.tsx          # React root + crash boundary wiring
│   ├── App.tsx           # entire UI (state, views, charts, i18n, persistence)
│   ├── physics.ts        # pure engine (see above — do not alter lightly)
│   ├── physics.test.ts   # regression lock (vitest)
│   ├── share.ts          # share-link codec (pure, tested)
│   ├── share.test.ts     # codec round-trip + rejection tests
│   ├── waveRays.ts       # cross-section canvas renderer
│   ├── spatialScene.ts   # spatial-view canvas renderer
│   ├── materialSurfaces.ts # procedural wall textures shared by both renderers
│   └── styles.css        # theming + responsive (desktop ≥1040px, stacked ≤1039px)
├── public/
│   ├── logo.png          # app icon / favicon
│   └── qr-code.png       # QR to the live demo
└── dist/                 # production build (gitignored)
```

Local physics references (parent folder, outside git): `chapitre-1-.pdf` (Snell, Fresnel, Brewster), `chapitre-2.pdf` (dispersive plasma, planned V3), `ETU 2025.pdf` (= ITU-R P.2040-4).

---

## Roadmap

- **Phase 2 — done** — shortcuts overlay (`?`) with the full key map, angle/view/display/present keys, fullscreen present mode.
- **Phase 3** — PWA manifest/icons/offline, bundled fonts (Inter Tight + JetBrains Mono), Tauri `.exe`, Capacitor APK.
- **V3** — Chapitre 2 dispersive plasma, k² = (ω² − ωp²)/c² (not implemented).

---

## License

No `LICENSE` file yet — all rights reserved by default.
