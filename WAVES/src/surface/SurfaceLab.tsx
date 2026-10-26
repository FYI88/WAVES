import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { MATERIALS, type PolMode } from "../physics";
import { DEFAULT_PROFILE, PROFILE_IDS, profileRms, profileSlices, sampleProfile, type ProfileId, type ProfileParams } from "./profiles";
import { METAL, SURFACE_MATERIAL_IDS, surfaceEta, surfaceTint, type SurfaceMaterialId } from "./materials";
import { emtSolve, emtValidity } from "./emt";
import { lambdaCm, littrowDeg, propagatingOrders } from "./grating";
import { detailPaths } from "./detailPaths";
import { wallAt, type WallSpec } from "./rcwaJobs";
import { rcwaPoint, rcwaSweep } from "./rcwaClient";
import type { RcwaResult, RcwaSweep } from "./rcwa";
import {
  SWEEP_ANGLE_MAX,
  SWEEP_F_MAX,
  SWEEP_F_MIN,
  SWEEP_PAD,
  drawOrderSweep,
  drawSurfaceDetail,
  sweepValue,
  type DetailOrder,
  type DetailParams,
  type LabPalette,
} from "./surfaceDetail";
import { LAB_MAX_BELOW, labFromHash, loadLab, saveLab, setLabSnapshot, type LabLayer, type LabMode, type LabState, type SweepAxis } from "./labState";
import { downloadText } from "../dom";
import type { SceneSurface } from "./sceneOverlay";
import { LAB_SCENARIOS, type LabScenario } from "./scenarios";
import { NO_INCLUSIONS, inclusionValidity, type InclusionKind, type Inclusions } from "../media/mixing";
import { FOG_PRESETS, NO_FOG, fogDbPerKm, withFog, type Fog, type FogPreset } from "../media/fog";
import { waterPermittivity } from "../media/water";
import { LAB_TEXT, MATERIAL_NAMES, PROFILE_NAMES, fillTpl } from "./labText";
import "./surfaceLab.css";

/* ════════════════════════════════════════════════════════════════════════
   Surface lab: profiled wall face + flat layers, bubbles, fog.
   Fast mode (EMT) runs inline; rigorous mode (RCWA) runs in the worker.
   Frequency and angle are shared with the main simulator through props.
   ════════════════════════════════════════════════════════════════════════ */

type Tab = "surface" | "layers" | "medium" | "wave" | "calc";
type Mode = LabMode;
type BelowLayer = LabLayer;

export interface SurfaceLabProps {
  freq: number;
  angle: number;
  pol: PolMode;
  lang: "fr" | "en";
  pal: LabPalette;
  playing: boolean;
  fmtNum: (v: number, digits?: number) => string;
  onFreq: (f: number) => void;
  onAngle: (a: number) => void;
  /** profile and order directions for the main cross-section (null: nothing to draw) */
  onSceneSurface?: (surface: SceneSurface | null) => void;
}

const TABS: Tab[] = ["surface", "layers", "medium", "wave", "calc"];
const MAX_BELOW = LAB_MAX_BELOW;
const SWEEP_MAX = SWEEP_ANGLE_MAX;
const SWEEP_ANGLES = Array.from({ length: 35 }, (_, i) => i * 2.5);
/** 41 log-spaced frequencies, 0.5 to 40 GHz */
const SWEEP_FREQS = Array.from({ length: 41 }, (_, i) => Number((SWEEP_F_MIN * Math.pow(SWEEP_F_MAX / SWEEP_F_MIN, i / 40)).toFixed(4)));
const SWEEP_HARMONICS = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6));

function materialRange(id: SurfaceMaterialId): { fMin: number; fMax: number } | null {
  if (id === "custom") return null;
  if (id === "metal") return { fMin: METAL.fMin, fMax: METAL.fMax };
  return { fMin: MATERIALS[id].fMin, fMax: MATERIALS[id].fMax };
}

function fitCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* ───────── small controls ───────── */

interface RangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: number;
  log?: boolean;
  accent?: string;
  fmtNum: (v: number, digits?: number) => string;
  onChange: (v: number) => void;
  hint?: ReactNode;
}

function Range({ label, value, min, max, step = 0.01, unit = "", digits = 2, log = false, accent, fmtNum, onChange, hint }: RangeProps) {
  const v = clamp(value, min, max);
  const pos = log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v;
  return (
    <label className="sl-range" style={accent ? ({ "--sl-accent": accent } as CSSProperties) : undefined}>
      <span className="sl-range-head">
        <span>{label}</span>
        <b className="sl-mono">
          {fmtNum(value, digits)}
          {unit && <small> {unit}</small>}
        </b>
      </span>
      <input
        type="range"
        min={log ? 0 : min}
        max={log ? 1000 : max}
        step={log ? 1 : step}
        value={pos}
        aria-label={label}
        onChange={(e) => {
          const p = Number(e.target.value);
          const raw = log ? min * Math.pow(max / min, p / 1000) : p;
          onChange(clamp(snap(raw, step), min, max));
        }}
      />
      {hint && <span className="sl-note">{hint}</span>}
    </label>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="sl-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "is-on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MaterialSelect({ value, lang, onChange, label }: { value: SurfaceMaterialId; lang: "fr" | "en"; onChange: (id: SurfaceMaterialId) => void; label: string }) {
  return (
    <select className="sl-select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as SurfaceMaterialId)}>
      {SURFACE_MATERIAL_IDS.map((id) => (
        <option key={id} value={id}>
          {MATERIAL_NAMES[id][lang]}
        </option>
      ))}
    </select>
  );
}

function ProfileThumb({ profile, id }: { profile: ProfileParams; id: ProfileId }) {
  const pts = sampleProfile({ ...profile, id }, 40);
  const points = [0, 1].flatMap((k) => pts.map((p) => `${((k + p.u) * 32).toFixed(1)},${(18 - p.s * 14).toFixed(1)}`)).join(" ");
  return (
    <svg viewBox="0 0 64 20" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

/* ───────── panel ───────── */

export function SurfaceLab({ freq, angle, pol, lang, pal, playing, fmtNum, onFreq, onAngle, onSceneSurface }: SurfaceLabProps) {
  const t = LAB_TEXT[lang];
  const matName = (id: SurfaceMaterialId) => MATERIAL_NAMES[id][lang];
  const pct = (v: number) => fmtNum(v * 100, v * 100 < 10 ? 2 : 1);

  // share link > saved state > defaults (read once)
  const init = useMemo(() => loadLab(), []);
  const [tab, setTab] = useState<Tab>("surface");
  const [profile, setProfile] = useState<ProfileParams>(init.profile);
  const [material, setMaterial] = useState<SurfaceMaterialId>(init.material);
  const [customEps, setCustomEps] = useState(init.customEps);
  const [customSigma, setCustomSigma] = useState(init.customSigma);
  const [below, setBelow] = useState<BelowLayer[]>(init.below);
  const [inclusions, setInclusions] = useState<Inclusions>(init.inclusions);
  const [incTarget, setIncTarget] = useState(init.incTarget);
  const [fog, setFog] = useState<Fog>(init.fog);
  const [mode, setMode] = useState<Mode>(init.mode);
  const [harmonics, setHarmonics] = useState(init.harmonics);
  const [slices, setSlices] = useState(init.slices);
  const [axis, setAxis] = useState<SweepAxis>(init.axis);
  const [showInMain, setShowInMain] = useState(init.showInMain);
  const [mainEfficiencies, setMainEfficiencies] = useState(init.mainEfficiencies);
  const [scenario, setScenario] = useState<string | null>(null);

  const [point, setPoint] = useState<{ key: string; result: RcwaResult; ms: number } | null>(null);
  const [sweep, setSweep] = useState<{ key: string; axis: SweepAxis; sweep: RcwaSweep } | null>(null);
  const [pointBusy, setPointBusy] = useState(false);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchProfile = (patch: Partial<ProfileParams>) => {
    setProfile((p) => ({ ...p, ...patch }));
    setScenario(null);
  };
  const patchBelow = (i: number, patch: Partial<BelowLayer>) => {
    setBelow((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
    setScenario(null);
  };
  const addBelow = () => {
    setBelow((ls) => (ls.length >= MAX_BELOW ? ls : [...ls, { material: "plasterboard", cm: 1.3, customEps: 4, customSigma: 0.05 }]));
    setScenario(null);
  };
  const removeBelow = (i: number) => {
    setBelow((ls) => ls.filter((_, k) => k !== i));
    setIncTarget((tg) => (tg === i ? -1 : tg > i ? tg - 1 : tg));
    setScenario(null);
  };

  const applyScenario = (s: LabScenario) => {
    setProfile({ ...s.profile });
    setMaterial(s.material);
    setBelow(s.below.map((l) => ({ material: l.material, cm: l.cm, customEps: 4, customSigma: 0.05 })));
    setInclusions(NO_INCLUSIONS);
    setIncTarget(-1);
    setMode("rigorous");
    setScenario(s.id);
    onFreq(s.fGHz);
    onAngle(Math.round(s.thetaDeg * 10) / 10);
  };

  const applyLab = (s: LabState) => {
    setProfile(s.profile);
    setMaterial(s.material);
    setCustomEps(s.customEps);
    setCustomSigma(s.customSigma);
    setBelow(s.below);
    setInclusions(s.inclusions);
    setIncTarget(s.incTarget);
    setFog(s.fog);
    setMode(s.mode);
    setHarmonics(s.harmonics);
    setSlices(s.slices);
    setAxis(s.axis);
    setShowInMain(s.showInMain);
    setMainEfficiencies(s.mainEfficiencies);
    setScenario(null);
  };

  // saved locally and exposed to the share link (share codec v2)
  useEffect(() => {
    const s: LabState = { profile, material, customEps, customSigma, below, inclusions, incTarget, fog, mode, harmonics, slices, axis, showInMain, mainEfficiencies };
    setLabSnapshot(s);
    const timer = window.setTimeout(() => saveLab(s), 250);
    return () => window.clearTimeout(timer);
  }, [profile, material, customEps, customSigma, below, inclusions, incTarget, fog, mode, harmonics, slices, axis, showInMain, mainEfficiencies]);

  // a pasted share link replaces the lab setup, as it does for the main simulator
  useEffect(() => {
    const onHash = () => {
      const s = labFromHash(window.location.hash);
      if (s) applyLab(s);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // applyLab only calls state setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────── physics ───────── */

  const target = incTarget < below.length ? incTarget : -1;
  const hasBubbles = inclusions.fraction > 0;

  const spec: WallSpec = useMemo(
    () => ({
      profile,
      material,
      customEps,
      customSigma,
      below,
      inclusions: hasBubbles ? inclusions : undefined,
      inclusionTarget: hasBubbles ? target : undefined,
    }),
    [profile, material, customEps, customSigma, below, inclusions, hasBubbles, target],
  );

  const wall = useMemo(() => wallAt(spec, freq), [spec, freq]);
  const emt = useMemo(() => emtSolve(profile, wall.eta, wall.below, freq, angle, pol, slices), [profile, wall, freq, angle, pol, slices]);
  const validity = profile.id === "flat" ? "ok" : emtValidity(profile.period, freq, angle, wall.eta);

  const geomOrders = useMemo(
    () => (profile.id === "flat" ? [{ m: 0, angleDeg: angle }] : propagatingOrders(freq, angle, profile.period).map((o) => ({ m: o.m, angleDeg: o.angleDeg }))),
    [profile.id, profile.period, freq, angle],
  );

  // the axis variable is swept, the other one is held at its current value
  const sweepHeld = axis === "angle" ? freq : angle;
  const fastSweep = useMemo<RcwaSweep>(() => {
    const xs = axis === "angle" ? SWEEP_ANGLES : SWEEP_FREQS;
    const fixedWall = axis === "angle" ? wallAt(spec, sweepHeld) : null;
    const R0: number[] = [];
    const T0: number[] = [];
    const A: number[] = [];
    for (const x of xs) {
      const f = axis === "angle" ? sweepHeld : x;
      const a = axis === "angle" ? x : sweepHeld;
      // frequency sweep: re-evaluate the ITU-R dispersion at every point
      const w = fixedWall ?? wallAt(spec, f);
      const r = emtSolve(profile, w.eta, w.below, f, a, pol, slices);
      R0.push(r.R);
      T0.push(r.T);
      A.push(r.A);
    }
    return { x: xs, R0, T0, R: R0, T: T0, A, orderR: { 0: R0 }, orderT: { 0: T0 } };
  }, [axis, sweepHeld, spec, profile, pol, slices]);

  const pointKey = JSON.stringify([spec, freq, angle, pol, harmonics, slices]);
  const sweepKey = JSON.stringify([axis, spec, sweepHeld, pol, slices]);

  useEffect(() => {
    if (mode !== "rigorous") {
      setPointBusy(false);
      return;
    }
    let alive = true;
    setPointBusy(true);
    const timer = window.setTimeout(() => {
      const t0 = performance.now();
      rcwaPoint({ kind: "point", wall: spec, pol, harmonics, slices, fGHz: freq, thetaDeg: angle })
        .then((result) => {
          if (!alive) return;
          setPoint({ key: pointKey, result, ms: performance.now() - t0 });
          setError(null);
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (alive) setPointBusy(false);
        });
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // pointKey captures spec, freq, angle, pol, harmonics and slices
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pointKey]);

  useEffect(() => {
    if (mode !== "rigorous") {
      setSweepBusy(false);
      return;
    }
    let alive = true;
    setSweepBusy(true);
    const timer = window.setTimeout(() => {
      const sweepHarmonics = Math.min(harmonics, SWEEP_HARMONICS);
      const request =
        axis === "angle"
          ? rcwaSweep({ kind: "angle", wall: spec, pol, harmonics: sweepHarmonics, slices, fGHz: sweepHeld, angles: SWEEP_ANGLES })
          : rcwaSweep({ kind: "freq", wall: spec, pol, harmonics: sweepHarmonics, slices, thetaDeg: sweepHeld, freqs: SWEEP_FREQS });
      request
        .then((result) => {
          if (alive) setSweep({ key: sweepKey, axis, sweep: result });
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (alive) setSweepBusy(false);
        });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sweepKey, harmonics]);

  const rigorous = mode === "rigorous" ? point?.result ?? null : null;
  const stale = mode === "rigorous" && (!point || point.key !== pointKey);
  const R = rigorous ? rigorous.R : emt.R;
  const T = rigorous ? rigorous.T : emt.T;
  const A = rigorous ? rigorous.A : emt.A;
  const link = withFog(R, T, fog, freq);
  // never show an angle sweep on the frequency axis (or the reverse) while the new one runs
  const shownSweep = mode === "rigorous" ? (sweep && sweep.axis === axis ? sweep.sweep : null) : fastSweep;

  // main cross-section overlay: directions by default, lab-wall efficiencies on request
  useEffect(() => {
    if (!onSceneSurface) return;
    if (!showInMain || profile.id === "flat") {
      onSceneSurface(null);
      return;
    }
    const eff = mainEfficiencies && rigorous !== null && !stale;
    onSceneSurface({
      profile,
      orders:
        eff && rigorous
          ? rigorous.orders.map((o) => ({ m: o.m, angleDeg: o.angleDeg, R: o.R, T: o.T }))
          : geomOrders.map((o) => ({ m: o.m, angleDeg: o.angleDeg, R: NaN, T: NaN })),
      efficiencies: eff,
      calc: { mode, harmonics, slices },
    });
  }, [onSceneSurface, showInMain, mainEfficiencies, profile, rigorous, stale, geomOrders, mode, harmonics, slices]);
  useEffect(() => () => onSceneSurface?.(null), [onSceneSurface]);

  const hostEta =
    target < 0
      ? surfaceEta(material, freq, customEps, customSigma)
      : surfaceEta(below[target].material, freq, below[target].customEps, below[target].customSigma);
  const mixedEta = target < 0 ? wall.eta : wall.below[target]?.eta ?? hostEta;
  const mixValidity = inclusionValidity(hostEta, inclusions, freq);
  const water = waterPermittivity(freq, inclusions.tempC);
  const littrow = littrowDeg(freq, profile.period, -1);
  const range = materialRange(material);
  const outOfRange = range ? freq < range.fMin || freq > range.fMax : false;

  /* ───────── drawing ───────── */

  const detailOrders: DetailOrder[] = useMemo(
    () => (rigorous && !stale ? rigorous.orders : geomOrders.map((o) => ({ m: o.m, angleDeg: o.angleDeg, R: NaN, T: NaN }))),
    [rigorous, stale, geomOrders],
  );

  const paths = useMemo(() => detailPaths(profile, wall.eta, wall.below, freq, angle, pol, slices), [profile, wall, freq, angle, pol, slices]);

  const detail: DetailParams = useMemo(
    () => ({
      paths,
      profile,
      tint: surfaceTint(material),
      materialName: MATERIAL_NAMES[material][lang],
      below: below.map((l) => ({ tint: surfaceTint(l.material), cm: l.cm, name: MATERIAL_NAMES[l.material][lang] })),
      thetaDeg: angle,
      frequency: freq,
      pol,
      orders: detailOrders,
      rigorous: Boolean(rigorous) && !stale,
      slices: tab === "calc" && profile.id !== "flat" ? profileSlices(profile, slices) : null,
      bubbles: hasBubbles ? { fraction: inclusions.fraction, water: inclusions.kind === "water", diameterMm: inclusions.diameterMm, target } : null,
      fog: fog.lwc,
      lang,
      normals: tab === "surface",
    }),
    [paths, profile, material, below, angle, freq, pol, detailOrders, rigorous, stale, tab, slices, hasBubbles, inclusions, target, fog.lwc, lang],
  );

  const detailRef = useRef<HTMLCanvasElement>(null);
  const sweepRef = useRef<HTMLCanvasElement>(null);
  // own clock: advances only while the detail canvas animates, so pausing freezes the waves
  // and a change of parameters does not make the phase jump
  const detailClock = useRef({ t: 0, last: null as number | null });

  useEffect(() => {
    const canvas = detailRef.current;
    if (!canvas) return;
    const clock = detailClock.current;
    const motion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let raf = 0;
    const draw = () => {
      const { ctx, w, h } = fitCanvas(canvas);
      if (ctx) drawSurfaceDetail(ctx, w, h, clock.t, detail, pal, fmtNum);
    };
    const running = () => playing && !(motion && motion.matches) && !document.hidden;
    const loop = () => {
      raf = 0;
      if (!running()) {
        clock.last = null;
        return;
      }
      const now = performance.now();
      if (clock.last !== null) clock.t += Math.min(0.1, (now - clock.last) / 1000);
      clock.last = now;
      draw();
      raf = requestAnimationFrame(loop);
    };
    const restart = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clock.last = null;
      if (running()) loop();
      else draw();
    };
    restart();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => draw()) : null;
    ro?.observe(canvas);
    document.addEventListener("visibilitychange", restart);
    motion?.addEventListener?.("change", restart);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      clock.last = null;
      ro?.disconnect();
      document.removeEventListener("visibilitychange", restart);
      motion?.removeEventListener?.("change", restart);
    };
  }, [detail, pal, playing, fmtNum]);

  useEffect(() => {
    const canvas = sweepRef.current;
    if (!canvas) return;
    const draw = () => {
      const { ctx, w, h } = fitCanvas(canvas);
      if (ctx) drawOrderSweep(ctx, w, h, shownSweep, axis, axis === "angle" ? angle : freq, pal, lang, fmtNum);
    };
    draw();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => draw()) : null;
    ro?.observe(canvas);
    return () => ro?.disconnect();
  }, [shownSweep, axis, angle, freq, pal, lang, fmtNum]);

  // click / drag on the sweep chart sets θ or f, depending on the axis
  const sweepFromPointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = clamp((e.clientX - r.left - SWEEP_PAD.l) / Math.max(1, r.width - SWEEP_PAD.l - SWEEP_PAD.r), 0, 1);
    const v = sweepValue(axis, frac);
    if (axis === "angle") onAngle(clamp(Math.round(v * 2) / 2, 0, SWEEP_MAX));
    else onFreq(clamp(Number(v.toFixed(v < 10 ? 2 : 1)), SWEEP_F_MIN, SWEEP_F_MAX));
  };

  const downloadSweepCsv = () => {
    const s = shownSweep;
    if (!s) return;
    const sep = lang === "fr" ? ";" : ",";
    const cell = (v: number) => {
      const out = Number.isFinite(v) ? v.toPrecision(6) : "";
      return lang === "fr" ? out.replace(".", ",") : out;
    };
    const ms = Object.keys(s.orderR)
      .map(Number)
      .filter((m) => m !== 0)
      .sort((a, b) => a - b);
    const head = [axis === "angle" ? "angle_deg" : "freq_GHz", "R0", "T0", "R", "T", "A", ...ms.flatMap((m) => [`R_${m}`, `T_${m}`])].join(sep);
    const rows = s.x.map((x, i) =>
      [x, s.R0[i], s.T0[i], s.R[i], s.T[i], s.A[i], ...ms.flatMap((m) => [s.orderR[m][i], s.orderT[m][i]])].map(cell).join(sep),
    );
    const held = axis === "angle" ? `${freq}GHz` : `${angle}deg`;
    downloadText([head, ...rows].join("\n"), `waves-lab-${axis}-${profile.id}-${pol}-${mode}-${held}.csv`);
  };

  /* ───────── tabs ───────── */

  const surfaceTab = (
    <div className="sl-panel">
      <div className="sl-group">
        <div className="sl-label">{t.scenarios}</div>
        <div className="sl-chips">
          {LAB_SCENARIOS.map((s) => (
            <button key={s.id} type="button" className={`sl-btn sl-scenario ${scenario === s.id ? "is-on" : ""}`} onClick={() => applyScenario(s)}>
              {s.name[lang]}
              <small>{s.note[lang]}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="sl-group">
        <div className="sl-label">{t.profile}</div>
        <div className="sl-profiles" role="radiogroup" aria-label={t.profile}>
          {PROFILE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={profile.id === id}
              className={`sl-profile ${profile.id === id ? "is-on" : ""}`}
              onClick={() => patchProfile({ id })}
            >
              <ProfileThumb profile={profile} id={id} />
              {PROFILE_NAMES[id][lang]}
            </button>
          ))}
        </div>
      </div>
      <div className="sl-group">
        {profile.id !== "flat" && (
          <Range label={t.period} value={profile.period} min={0.2} max={30} step={0.01} log unit="cm" accent="var(--sl-inc)" fmtNum={fmtNum}
            onChange={(v) => patchProfile({ period: v })} />
        )}
        <Range label={profile.id === "flat" ? t.slabDepth : t.depth} value={profile.depth} min={0.05} max={15} step={0.01} log unit="cm"
          accent="var(--sl-abs)" fmtNum={fmtNum} onChange={(v) => patchProfile({ depth: v })} />
        {profile.id === "square" && (
          <Range label={t.fill} value={profile.fill} min={0.05} max={0.95} step={0.01} fmtNum={fmtNum} onChange={(v) => patchProfile({ fill: v })} />
        )}
        {profile.id === "trapezoid" && (
          <>
            <Range label={t.base} value={profile.fill} min={0.05} max={1} step={0.01} fmtNum={fmtNum} onChange={(v) => patchProfile({ fill: v })} />
            <Range label={t.top} value={profile.top} min={0} max={1} step={0.01} fmtNum={fmtNum} onChange={(v) => patchProfile({ top: v })} />
          </>
        )}
        {profile.id === "steps" && (
          <Range label={t.steps} value={profile.steps} min={2} max={12} step={1} digits={0} fmtNum={fmtNum} onChange={(v) => patchProfile({ steps: v })} />
        )}
        {profile.id === "rough" && (
          <>
            <Range label={t.corr} value={profile.corr} min={0.05} max={10} step={0.01} log unit="cm" fmtNum={fmtNum} onChange={(v) => patchProfile({ corr: v })} />
            <Range label={t.seed} value={profile.seed} min={1} max={99} step={1} digits={0} fmtNum={fmtNum} onChange={(v) => patchProfile({ seed: v })} />
          </>
        )}
        {profile.id !== "flat" && (
          <p className="sl-note sl-mono">
            {t.rms} {fmtNum(profileRms(profile), 2)} cm · λ₀/Λ {fmtNum(lambdaCm(freq) / profile.period, 2)}
          </p>
        )}
      </div>
      <div className="sl-group">
        <label className="sl-check">
          <input type="checkbox" checked={showInMain} onChange={(e) => setShowInMain(e.target.checked)} />
          <span>{t.showInMain}</span>
        </label>
        <label className="sl-check">
          <input type="checkbox" checked={mainEfficiencies} disabled={!showInMain} onChange={(e) => setMainEfficiencies(e.target.checked)} />
          <span>{t.mainEfficiencies}</span>
        </label>
        <p className="sl-note">{showInMain && mainEfficiencies ? t.mainEffNote : t.showInMainNote}</p>
      </div>
      <div className="sl-group">
        <div className="sl-label">
          {t.material}
          <span className="sl-swatch" style={{ "--tint": surfaceTint(material) } as CSSProperties} />
        </div>
        <MaterialSelect value={material} lang={lang} label={t.material} onChange={(id) => { setMaterial(id); setScenario(null); }} />
        {material === "custom" && (
          <>
            <Range label={t.epsCustom} value={customEps} min={1} max={30} step={0.01} fmtNum={fmtNum} onChange={setCustomEps} />
            <Range label={t.sigmaCustom} value={customSigma} min={0.0001} max={10} step={0.0001} log digits={4} unit="S/m" fmtNum={fmtNum} onChange={setCustomSigma} />
          </>
        )}
        <p className="sl-note sl-mono">
          η = {fmtNum(wall.eta.re, 2)} − j{fmtNum(-wall.eta.im, wall.eta.im < -100 ? 0 : 3)}
        </p>
        {outOfRange && range && (
          <p className="sl-note is-warn">{fillTpl(t.outOfRange, { a: fmtNum(range.fMin, 1), b: fmtNum(range.fMax, 0) })}</p>
        )}
      </div>
    </div>
  );

  const layersTab = (
    <div className="sl-panel">
      <div className="sl-group">
        <div className="sl-label">
          {t.layersTitle}
          <span className="sl-mono">{below.length}/{MAX_BELOW}</span>
        </div>
        {below.length === 0 && <p className="sl-note">{t.noLayers}</p>}
        <ol className="sl-layers">
          {below.map((l, i) => {
            const r = materialRange(l.material);
            const out = r ? freq < r.fMin || freq > r.fMax : false;
            return (
              <li key={i} className="sl-layer" style={{ "--tint": surfaceTint(l.material) } as CSSProperties}>
                <div className="sl-layer-head">
                  <span>{i + 1}</span>
                  <MaterialSelect value={l.material} lang={lang} label={fillTpl(t.layerN, { n: String(i + 1) })} onChange={(id) => patchBelow(i, { material: id })} />
                  <button type="button" className="sl-btn is-danger" onClick={() => removeBelow(i)}>
                    {t.removeLayer}
                  </button>
                </div>
                <Range label={t.thickness} value={l.cm} min={0.1} max={60} step={0.01} log unit="cm" accent="var(--sl-abs)" fmtNum={fmtNum}
                  onChange={(v) => patchBelow(i, { cm: v })} />
                {l.material === "custom" && (
                  <>
                    <Range label={t.epsCustom} value={l.customEps} min={1} max={30} step={0.01} fmtNum={fmtNum} onChange={(v) => patchBelow(i, { customEps: v })} />
                    <Range label={t.sigmaCustom} value={l.customSigma} min={0.0001} max={10} step={0.0001} log digits={4} unit="S/m" fmtNum={fmtNum}
                      onChange={(v) => patchBelow(i, { customSigma: v })} />
                  </>
                )}
                {out && r && <p className="sl-note is-warn">{fillTpl(t.outOfRange, { a: fmtNum(r.fMin, 1), b: fmtNum(r.fMax, 0) })}</p>}
              </li>
            );
          })}
        </ol>
        <button type="button" className="sl-btn" onClick={addBelow} disabled={below.length >= MAX_BELOW}>
          {below.length >= MAX_BELOW ? t.maxLayers : `+ ${t.addLayer}`}
        </button>
      </div>
    </div>
  );

  const mediumTab = (
    <div className="sl-panel">
      <div className="sl-group">
        <div className="sl-label">
          {t.bubbles}
          {hasBubbles && <span className={`sl-badge is-${mixValidity}`}>{t.mixValidity} · {t.valid[mixValidity]}</span>}
        </div>
        <Seg<InclusionKind>
          label={t.bubbleKind}
          value={inclusions.kind}
          onChange={(kind) => setInclusions((v) => ({ ...v, kind }))}
          options={[
            { value: "air", label: t.air },
            { value: "water", label: t.water },
          ]}
        />
        <select className="sl-select" aria-label={t.target} value={target} onChange={(e) => setIncTarget(Number(e.target.value))}>
          <option value={-1}>
            {t.target} · {t.targetProfile} ({matName(material)})
          </option>
          {below.map((l, i) => (
            <option key={i} value={i}>
              {t.target} · {fillTpl(t.layerN, { n: String(i + 1) })} ({matName(l.material)})
            </option>
          ))}
        </select>
        <Range label={t.fraction} value={inclusions.fraction} min={0} max={0.6} step={0.01} fmtNum={fmtNum}
          onChange={(v) => setInclusions((x) => ({ ...x, fraction: v }))} />
        <Range label={t.diameter} value={inclusions.diameterMm} min={0.1} max={30} step={0.1} log digits={1} unit="mm" fmtNum={fmtNum}
          onChange={(v) => setInclusions((x) => ({ ...x, diameterMm: v }))} />
        {inclusions.kind === "water" && (
          <Range label={t.waterTemp} value={inclusions.tempC} min={0} max={40} step={0.5} digits={1} unit="°C" fmtNum={fmtNum}
            onChange={(v) => setInclusions((x) => ({ ...x, tempC: v }))} />
        )}
        <dl className="sl-kv sl-mono">
          {inclusions.kind === "water" && (
            <>
              <dt>{t.waterEps}</dt>
              <dd>{fmtNum(water.re, 1)} − j{fmtNum(-water.im, 1)}</dd>
            </>
          )}
          <dt>{t.effEps}</dt>
          <dd>{fmtNum(mixedEta.re, 2)} − j{fmtNum(-mixedEta.im, mixedEta.im < -100 ? 0 : 3)}</dd>
        </dl>
        <p className="sl-note">{t.mixNote}</p>
      </div>
      <div className="sl-group">
        <div className="sl-label">{t.fog}</div>
        <div className="sl-chips">
          {(Object.keys(FOG_PRESETS) as FogPreset[]).map((k) => (
            <button key={k} type="button" className={`sl-btn ${fog.lwc === FOG_PRESETS[k] ? "is-on" : ""}`} onClick={() => setFog((f) => ({ ...f, lwc: FOG_PRESETS[k] }))}>
              {t.fogPresets[k]}
            </button>
          ))}
        </div>
        <Range label={t.lwc} value={fog.lwc} min={0} max={1} step={0.005} digits={3} unit="g/m³" fmtNum={fmtNum} onChange={(v) => setFog((f) => ({ ...f, lwc: v }))} />
        <Range label={t.fogTemp} value={fog.tempC} min={-8} max={30} step={0.5} digits={1} unit="°C" fmtNum={fmtNum} onChange={(v) => setFog((f) => ({ ...f, tempC: v }))} />
        <Range label={t.toWall} value={fog.toWallM} min={1} max={2000} step={1} log digits={0} unit="m" fmtNum={fmtNum} onChange={(v) => setFog((f) => ({ ...f, toWallM: v }))} />
        <Range label={t.fromWall} value={fog.fromWallM} min={1} max={2000} step={1} log digits={0} unit="m" fmtNum={fmtNum} onChange={(v) => setFog((f) => ({ ...f, fromWallM: v }))} />
        <dl className="sl-kv sl-mono">
          <dt>{t.fogRate}</dt>
          <dd>{fmtNum(fogDbPerKm(freq, fog.lwc, fog.tempC), 3)} dB/km</dd>
          <dt>{t.fogLoss}</dt>
          <dd>{fmtNum(link.lossDb, 3)} dB</dd>
        </dl>
        <p className="sl-note">{t.fogNote}</p>
      </div>
    </div>
  );

  const waveTab = (
    <div className="sl-panel">
      <div className="sl-group">
        <Range label={t.frequency} value={freq} min={0.5} max={40} step={0.01} log unit="GHz" accent="var(--sl-inc)" fmtNum={fmtNum} onChange={onFreq}
          hint={<span className="sl-mono">{t.wavelength} λ₀ = {fmtNum(lambdaCm(freq), 2)} cm</span>} />
        <Range label={t.angle} value={angle} min={0} max={89} step={0.5} digits={1} unit="°" accent="var(--sl-ref)" fmtNum={fmtNum} onChange={onAngle} />
        <div className="sl-chips">
          <button type="button" className="sl-btn" disabled={!Number.isFinite(littrow) || profile.id === "flat"} onClick={() => onAngle(Math.round(littrow * 10) / 10)}>
            {Number.isFinite(littrow) ? `${t.littrow} · ${fmtNum(littrow, 1)}°` : t.noLittrow}
          </button>
        </div>
      </div>
      <div className="sl-group">
        <div className="sl-label">
          {t.polarization}
          <span className="sl-badge">{pol === "AVG" ? t.avg : pol}</span>
        </div>
        <p className="sl-note">{t.polNote}</p>
      </div>
      <div className="sl-group">
        <div className="sl-label">
          {t.orders}
          <span className="sl-mono">{geomOrders.length}</span>
        </div>
        {geomOrders.length <= 1 ? (
          <p className="sl-note">{t.onlySpecular}</p>
        ) : (
          <div className="sl-chips">
            {geomOrders.map((o) => (
              <span key={o.m} className={`sl-badge ${o.m === 0 ? "is-ok" : ""}`}>
                <span className="sl-mono">
                  {o.m > 0 ? "+" : ""}
                  {o.m} · {fmtNum(o.angleDeg, 1)}°
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const tableOrders = rigorous ? rigorous.orders : geomOrders.map((o) => ({ ...o, R: NaN, T: NaN }));
  const calcTab = (
    <div className="sl-panel">
      <div className="sl-group">
        <div className="sl-label">{t.mode}</div>
        <Seg<Mode>
          label={t.mode}
          value={mode}
          onChange={setMode}
          options={[
            { value: "fast", label: t.fast },
            { value: "rigorous", label: t.rigorous },
          ]}
        />
        <p className="sl-note">{mode === "fast" ? t.fastHint : t.rigorousHint}</p>
        <div className="sl-chips">
          <span className={`sl-badge is-${validity}`}>{t.validity} · {t.valid[validity]}</span>
          {mode === "rigorous" && (pointBusy || sweepBusy) && <span className="sl-badge is-busy">{t.computing}</span>}
          {mode === "rigorous" && point && !pointBusy && <span className="sl-badge sl-mono">{fillTpl(t.elapsed, { ms: fmtNum(point.ms, 0) })}</span>}
        </div>
        {mode === "rigorous" && error && <p className="sl-note is-error">{t.error} : {error}</p>}
      </div>
      <div className="sl-group">
        {mode === "rigorous" && (
          <Range label={t.harmonics} value={harmonics} min={2} max={20} step={1} digits={0} fmtNum={fmtNum} onChange={setHarmonics} />
        )}
        <Range label={t.slices} value={slices} min={4} max={40} step={1} digits={0} fmtNum={fmtNum} onChange={setSlices} />
      </div>
      <div className="sl-group">
        {rigorous && (
          <div className="sl-readout">
            <div style={{ "--tone": "var(--sl-ref)" } as CSSProperties}>
              <span>{t.specularR}</span>
              <b className="sl-mono">{pct(rigorous.R0)} %</b>
            </div>
            <div style={{ "--tone": "var(--sl-tra)" } as CSSProperties}>
              <span>{t.specularT}</span>
              <b className="sl-mono">{pct(rigorous.T0)} %</b>
            </div>
            <div style={{ "--tone": "var(--sl-inc)" } as CSSProperties}>
              <span>±M</span>
              <b className="sl-mono">{rigorous.harmonics}</b>
            </div>
          </div>
        )}
        <table className="sl-table sl-mono">
          <thead>
            <tr>
              <th>{t.order}</th>
              <th>{t.angleCol}</th>
              <th>R</th>
              <th>T</th>
            </tr>
          </thead>
          <tbody>
            {tableOrders.map((o) => (
              <tr key={o.m} className={o.m === 0 ? "is-spec" : ""}>
                <td>
                  {o.m > 0 ? "+" : ""}
                  {o.m}
                </td>
                <td>{fmtNum(o.angleDeg, 1)}°</td>
                <td>{Number.isFinite(o.R) ? `${pct(o.R)} %` : o.m === 0 && !rigorous ? `${pct(emt.R)} %` : "—"}</td>
                <td>{Number.isFinite(o.T) ? `${pct(o.T)} %` : o.m === 0 && !rigorous ? `${pct(emt.T)} %` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rigorous && rigorous.orders.length > 0 && (
          <div className="sl-bars" aria-label={t.efficiency}>
            <div className="sl-bar-row sl-bar-head">
              <span>{t.order}</span>
              <span>R</span>
              <span>T</span>
            </div>
            {rigorous.orders.map((o) => (
              <div key={o.m} className={`sl-bar-row ${o.m === 0 ? "is-spec" : ""}`}>
                <span className="sl-mono">
                  {o.m > 0 ? "+" : ""}
                  {o.m}
                </span>
                <span className="sl-bar" title={`R ${pct(o.R)} %`}>
                  <i style={{ width: `${clamp(o.R, 0, 1) * 100}%`, background: "var(--sl-ref)" }} />
                </span>
                <span className="sl-bar" title={`T ${pct(o.T)} %`}>
                  <i style={{ width: `${clamp(o.T, 0, 1) * 100}%`, background: "var(--sl-tra)" }} />
                </span>
              </div>
            ))}
          </div>
        )}
        {fog.lwc > 0 && (
          <dl className="sl-kv sl-mono">
            <dt>{t.link} · R</dt>
            <dd>{pct(link.R)} %</dd>
            <dt>{t.link} · T</dt>
            <dd>{pct(link.T)} %</dd>
            <dt>{t.fogLoss}</dt>
            <dd>{fmtNum(link.lossDb, 3)} dB</dd>
          </dl>
        )}
      </div>
    </div>
  );

  const panels: Record<Tab, ReactNode> = { surface: surfaceTab, layers: layersTab, medium: mediumTab, wave: waveTab, calc: calcTab };

  return (
    <section className="om-card sl-lab" aria-label={t.title}>
      <header className="sl-head">
        <div>
          <h2>{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>
        <div className="sl-kpis">
          <span className="sl-kpi" style={{ "--tone": "var(--sl-ref)" } as CSSProperties}>
            <i />R <b className="sl-mono">{pct(R)}</b><small>%</small>
          </span>
          <span className="sl-kpi" style={{ "--tone": "var(--sl-tra)" } as CSSProperties}>
            <i />T <b className="sl-mono">{pct(T)}</b><small>%</small>
          </span>
          <span className="sl-kpi" style={{ "--tone": "var(--sl-abs)" } as CSSProperties}>
            <i />A <b className="sl-mono">{pct(Math.max(0, A))}</b><small>%</small>
          </span>
          <span className={`sl-badge ${stale || pointBusy ? "is-busy" : ""}`}>{mode === "fast" ? t.fast : t.rigorous}</span>
        </div>
      </header>

      <div className="sl-body">
        <div className="sl-views">
          <div className="sl-view">
            <canvas ref={detailRef} className="sl-detail" role="img" aria-label={t.detailTitle} />
          </div>
          <div className="sl-view">
            <div className="sl-view-head">
              <div>
                <h3>{axis === "angle" ? t.sweepTitle : t.sweepTitleFreq}</h3>
                <span>{axis === "angle" ? t.sweepHint : t.sweepHintFreq}</span>
              </div>
              <div className="sl-view-tools">
                <Seg<SweepAxis>
                  label={t.sweepAxis}
                  value={axis}
                  onChange={setAxis}
                  options={[
                    { value: "angle", label: t.axisAngle },
                    { value: "freq", label: t.axisFreq },
                  ]}
                />
                <button type="button" className="sl-btn sl-btn-sm" title={t.csvTitle} aria-label={t.csvTitle} disabled={!shownSweep} onClick={downloadSweepCsv}>
                  CSV
                </button>
              </div>
              <div className="sl-legend">
                {/* swatches use the canvas palette so they match the curves */}
                <span><i style={{ "--tone": pal.ref } as CSSProperties} />R₀</span>
                <span><i style={{ "--tone": pal.tra } as CSSProperties} />T₀</span>
                <span><i className="is-dash" style={{ "--tone": pal.abs } as CSSProperties} />A</span>
                {mode === "rigorous" && <span><i className="is-dash" style={{ "--tone": pal.inc } as CSSProperties} />m ≠ 0</span>}
              </div>
            </div>
            <canvas
              ref={sweepRef}
              className="sl-sweep"
              role="img"
              aria-label={t.sweepTitle}
              onPointerDown={sweepFromPointer}
              onPointerMove={(e) => {
                if (e.buttons === 1) sweepFromPointer(e);
              }}
            />
          </div>
        </div>

        <div className="sl-side">
          <div className="sl-tabs" role="tablist" aria-label={t.title}>
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>
                {t.tabs[k]}
              </button>
            ))}
          </div>
          <div role="tabpanel">{panels[tab]}</div>
        </div>
      </div>
    </section>
  );
}

export default SurfaceLab;
