<div align="center">

# Simulateur Ondes & Murs
## Wave & Wall Simulator

**Visualiseur + simulateur de propagation, réflexion et transmission des ondes à travers un mur.**

**Physique exacte Chapitre 1 + ITU-R P.2040-4 (ETU 2025). Web / PWA → Tauri Windows → Capacitor APK, une seule base de code.**

One codebase, zero runtime dependencies — the same `dist/` serves the PWA, Tauri (`frontendDist`) and Capacitor (`webDir`).

<br/>

![Status](https://img.shields.io/badge/Status-Phase%201%20green-107c41?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20PWA-0078d4?style=for-the-badge&logo=pwa&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Physics](https://img.shields.io/badge/Physics-ITU--R%20P.2040--4-ff6b35?style=for-the-badge)
![Verify](https://img.shields.io/badge/Verify-32%2F32%20passing-107c41?style=for-the-badge)
![Lang](https://img.shields.io/badge/Lang-FR%20%7C%20EN-1f6feb?style=for-the-badge)

</div>

---

## App Preview

**Live demo : https://waves-pearl.vercel.app/**

![QR code — live demo](public/qr-code.png)

> Pas de screenshot commité pour l'instant — lancez `npm run dev` → https://waves-pearl.vercel.app/

L'UI affiche 3 canvas :

- **Scène rayons** — incident / réfléchi / transmis, angles exacts clampés, DPR corrigé (`css × dpr`)
- **R/T vs θ** — courbes TE / TM / moyenne, marqueur θB en TM seul, ligne θ-critique masquée si NaN
- **|E(z)|** — champ interne exact `A·e^−jγz + C·e^+jγz`, version vectorielle en TM

```
θi ──→ air │ mur (d, ε′, σ) │ air ──→ T
           │  |E(z)| exact  │
           └────────────────┘
         R = |r|²   T + R + absorbé = 1
```

## Quick Start

```bash
git clone https://github.com/FYI88/ONDSIMETU.git
cd ONDSIMETU
npm install
npm run dev      # → https://waves-pearl.vercel.app/
```

---

## Key Features (TL;DR)

- Moteur physique pur `src/physics/` : Snell, Fresnel TE/TM complexes, lame unique ITU éq. 43–44, récursion N-couches ITU §2.2.2.1, matériaux Table 3 `ε′=a·fᵇ`, `σ=c·fᵈ`.
- Tout est modifiable : θi (0–89°, slider ou drag sur la courbe), polarisation TE / TM / moyenne, épaisseur (1–100 cm), matériau ITU (13 + custom, picker visuel live-ε′) ou ε′/σ perso, fréquence (0.5–40 GHz log + warning hors plage ITU), langue FR/EN, thème sombre/clair, presets scénarios (Wi-Fi/5G/Brewster auto), état persisté, raccourcis L/T/Espace.
- `npm run verify` : **37/37 checks verts** — triple accord récursion = ABCD = résolution directe à 1e-16 + pseudo-Brewster + wall-loss + continuité champ.
- Zéro dépendance runtime (Vite + TS vanilla) — `src/physics/` sans DOM, réutilisable Tauri/Capacitor tel quel.
- Warnings honnêtes : hors-plage ITU + tanδ > 0.5 empilés, θt/θB étiquetés « ≈ sans pertes » dès que σ ≠ 0.

---

## Planned Features

- **Phase 2 — PWA honnête** : enregistrer le SW, icônes 192/512 + maskable, `start_url: "./"`, meta apple-touch.
- **Phase 3 — UI multi-slabs** (moteur `multilayerSlab()` déjà prêt), fréquence 0.1–100 GHz (slider log déjà en place sur 0.5–40), épaisseur au mm.
- **Phase 4 — perf + a11y restant** : mémo sweep, rAF stop en pause, aria labels canvas complétés (raccourcis, `lang`, reduced-motion déjà faits).
- **V3 — Chapitre 2** : milieu dispersif plasma `k²=(ω²−ωp²)/c²` (non implémenté).

See `HANDOFF.md` for the dated journal, key decisions and known defects.

---

## Physics Engine

| Module | Technical Specification |
|--------|-------------------------|
| `src/physics/complex.ts` | Complexes en convention `exp(jωt)` pure, sans DOM. |
| `src/physics/materials.ts` | Table 3 ITU : `ε′=a·fᵇ`, `σ=c·fᵈ` + matériaux (béton, brique, verre, bois…). |
| `src/physics/fresnel.ts` | Fresnel complexes §2.2.1 + `rInterfaceSnell` sans angles en `√(ε−sin²θ0)` — fixe le bug N≥2 qui passait θ0 de l'air à toutes les interfaces. |
| `src/physics/slab.ts` | Lame unique (43–44) + récursion N-couches (39–42) + `slabInternal` champ exact, continuité E (TE) / E-tan + D-normal (TM) à 1e-9. |
| `src/physics/index.ts` | Façade publique + `multilayerSlab()` (V2 multi-slabs, moteur prêt, UI à venir). |
| `scripts/abcd.ts` | 2e méthode indépendante : matrices ABCD ITU Att.1, forme générale A≠D (ITU 60a `2A` n'est exact que si A=D) + flip TM `S11 = −R_E` documenté. |
| `scripts/direct.ts` | 3e méthode : système linéaire E-tan/H-tan direct, référence de phase du T explicite. |
| `src/i18n.ts` + `src/main.ts` | UI FR/EN + 3 canvas premium (scène texturée + HUD, R/T vs θ interactif, \|E(z)\| Lin/dB). |
| `src/textures.ts` | Textures procédurales seedées par matériau (13 + custom). |

> **Convention de signe TM** : le code suit ITU éq. 31b
> (`r_TM=(n₂cosθ₁−n₁cosθ₂)/(n₂cosθ₁+n₁cosθ₂)`), qui vaut
> `−r_Chapitre1` à incidence normale. C'est le « apparent sign change »
> signalé par l'ITU §2.2.1 : pure convention d'orientation du champ E,
> sans effet physique (`R=|r|²` identique). Les courbes `r∥(θi)` du cours
> sont donc miroir des nôtres ; puissances et phases relatives cohérentes
> partout (champ interne exact inclus).

---

## Verification Report

`npm run verify` — esbuild bundle `scripts/verify.ts` → node. Ne jamais chaîner esbuild+node avec `;` sous PowerShell (stale bundle si esbuild échoue) — utiliser `if ($?)` ou le script npm (`&&`).

All 37 physics checks are **green** (`build` + `verify`) :

| Check | Assessment | Status |
|-------|------------|--------|
| Incidence normale air→béton | `R=((1−n)/(1+n))²`, `n=√ε′` | ✅ Pass |
| Brewster TM interface seule | `R≈0` à θB (le mur ajoute des Fabry-Perot) | ✅ Pass |
| Conservation | `R+T+absorbé = 1` (barres UI) | ✅ Pass |
| `d→0` | `T→1`, `R→0` | ✅ Pass |
| Triple accord N=2,3 + pertes TE+TM | récursion = ABCD = direct à **1e-16** | ✅ Pass |
| Champ interne | continuité à **1e-9**, `\|E(z)\|` TM vectoriel | ✅ Pass |
| `rInterfaceSnell` = `rInterface` | Δ TE 2.8e-16, TM 0 | ✅ Pass |
| N=0 / N=1 / N=2 identique | `N=1 = singleSlab`, `N=2 = 1×double` à ~2e-15 | ✅ Pass |

---

## Development & Build Guide

### Prerequisites

- [Node.js](https://nodejs.org/) v18+

### 1. Repository Setup

```bash
git clone https://github.com/FYI88/ONDSIMETU.git
cd ONDSIMETU
npm install
```

### 2. Launch Dev Server

```bash
npm run dev
# → https://waves-pearl.vercel.app/
```

### 3. Physics Checks

```bash
npm run verify
# → 37/37 checks verts (à relancer après chaque changement moteur)
```

### 4. Production Build

```bash
npm run build
# → tsc + vite build → dist/
```

### 5. Cross-platform (rappel — une seule base de code)

- **PWA** : `public/manifest.webmanifest` + `public/sw.js` déjà inclus (SW à enregistrer au bootstrap en HTTPS — Phase 2).
- **Windows (Tauri)** : `npm run build` → pointer `tauri.conf.json > frontendDist` vers `dist/`. Moteur `src/physics/` sans DOM, réutilisable côté Rust/commands.
- **APK (Capacitor)** : même `dist/` comme `webDir`. Aucun import Node-only dans `src/physics/`.

---

## Repository Structure

```text
./
├── index.html               # titre FR/EN, meta PWA, mount #app
├── package.json             # dev / build / verify (esbuild + node)
├── tsconfig.json
├── HANDOFF.md               # mémoire du projet : état, décisions, journal daté
├── src/
│   ├── physics/             # moteur pur (complex, materials, fresnel, slab, index)
│   ├── i18n.ts              # FR/EN
│   ├── main.ts              # UI premium + 3 canvas (scène texturée/HUD, R/T vs θ interactif, |E(z)| Lin/dB)
│   ├── textures.ts          # textures procédurales seedées par matériau
│   └── style.css
├── scripts/
│   ├── verify.ts            # 37 checks (npm run verify, bundlé par esbuild)
│   ├── abcd.ts              # 2e méthode : matrices ABCD (ITU Att.1, A≠D)
│   └── direct.ts            # 3e méthode : système E-tan/H-tan direct
└── public/                  # manifest PWA + service worker (Phase 2 : l'enregistrer)
```

---

## Physics Refs

Sources locales (dossier parent, hors repo git) :

- `chapitre-1-.pdf` : Snell, Fresnel normal/oblique, Brewster, critique, énergies.
- `chapitre-2.pdf` : plasma, `k²=(ω²−ωp²)/c²` (non implémenté, V3).
- `ETU 2025.pdf` = ITU-R P.2040-4 : §2.2.1 Fresnel complexe, §2.2.2 lame unique (43–44) + récursion N-couches (39–42), Table 3 matériaux, Att.1 ABCD.

---

## License

Pas de fichier `LICENSE` pour l'instant — tous droits réservés par défaut.

Ajoutez `LICENSE` (MIT, PolyForm Noncommercial comme My Vault, etc.) si vous voulez open-sourcer.
