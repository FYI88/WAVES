import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { drawSpatialScene, type SceneOptions } from "./spatialScene";
import { drawWaveRays } from "./waveRays";
import { decodeShare, encodeShare, shareHashOf } from "./share";
import { SurfaceLab } from "./surface/SurfaceLab";
import { labForShare } from "./surface/labState";
import { withSurface, type SceneSurface } from "./surface/sceneOverlay";
import { loadRtView, saveRtView, useProfiledMain, type RtView } from "./surface/useProfiledMain";
import { recordFrame } from "./perf";
import { PerfHud } from "./PerfHud";
import { AIR_TINT, clamp } from "./render/util";
import { MONO, PALETTES, SANS, withAlpha, type Palette, type Theme } from "./theme";
import { DICTS, type Dict, type Lang } from "./i18n";
import { bandName, makeFmt, superscript, tpl } from "./i18n/format";
import {
  AIR_SWATCH,
  LAYER_MATS,
  MAX_LAYERS,
  TEMPLATES,
  epsSigmaOfNK,
  layerEpsSigma,
  matSwatch,
  matTint,
  mkLayer,
  newId,
  nkOf,
  type CustomMode,
  type Layer,
  type LayerMat,
  type TemplateId,
} from "./state/layers";
import { applyMove, applyResize, applyStackCommand, stackKeyCommand } from "./scene/dragStack";
import { computeResults, stackSweepKey, type LayerRes, type Results, type SimState } from "./state/results";
import { DEFAULT_STATE, presetState } from "./state/presets";
import { addMatching, isLiveMatching, matchingReference, resolveMatching, transitionMatching, type MatchingReason } from "./state/matching";
import { STORAGE_KEY, STORAGE_VERSION, defaultPersisted, loadInitial, sanitizePersisted, type Persisted } from "./state/persistence";
import { copyText, downloadText } from "./dom";
import { cssZoom, prepCanvas, useCanvasSize, type CanvasSize } from "./scene/canvas";
import { RayScene, type SceneLayer, type SceneParams } from "./scene/RayScene";
import { frameHeightRef } from "./scene/frameHeight";
import { PAD, dot, drawAxes, mixHex, pill, roundRect, strokeCurve, tooltip } from "./charts/draw";
import { AngleChart } from "./charts/AngleChart";
import { FieldChart } from "./charts/FieldChart";
import { Icon, Logo } from "./ui/icons";
import { Segmented, Slider } from "./ui/controls";
import {
  C0,
  CUSTOM_SWATCH,
  CUSTOM_TINT,
  DEG,
  MATERIALS,
  MATERIAL_IDS,
  brewsterDeg,
  complexPermittivity,
  computeStackSweep,
  k0Of,
  materialProps,
  sqrtC,
  stackFieldAbs,
  stackMode,
  sub,
  cx,
  type Cx,
  type MaterialId,
  type PolMode,
  type Sweep,
} from "./physics";

const REPO_URL = "https://github.com/FYI88/WAVES";
const CONTACT_EMAILS = [
  { labelKey: "emailSchool", address: "chetaine.younes@etu.uae.ac.ma" },
  { labelKey: "emailPersonal", address: "youneschetaine@gmail.com" },
] as const;

function Ring({ value, color }: { value: number; color: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg className="om-ring" viewBox="0 0 76 76" aria-hidden>
      <circle cx="38" cy="38" r={r} className="om-ring-track" />
      <circle
        cx="38"
        cy="38"
        r={r}
        className="om-ring-val"
        style={{ stroke: color, strokeDasharray: `${clamp(value, 0, 1) * c} ${c}` }}
      />
    </svg>
  );
}


function Eq({ tex }: { tex: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void import("katex/dist/katex.min.css");
    import("katex").then(({ default: katex }) => {
      if (!alive) return;
      setHtml(katex.renderToString(tex, { throwOnError: false, displayMode: true }));
    });
    return () => {
      alive = false;
    };
  }, [tex]);

  if (!html) return <div className="om-eq om-eq-pending" aria-hidden />;
  return <div className="om-eq" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Stat(props: { label: string; value: string; unit?: string; sub?: string; tone?: string; delay: number }) {
  return (
    <div className="om-stat om-enter" style={{ "--d": `${props.delay}ms`, "--tone": props.tone ?? "var(--om-ink)" } as CSSProperties}>
      <div className="om-stat-label">{props.label}</div>
      <div className="om-stat-value">
        <span>{props.value}</span>
        {props.unit && <small>{props.unit}</small>}
      </div>
      {props.sub && <div className="om-stat-sub">{props.sub}</div>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   App
   ════════════════════════════════════════════════════════════════════════ */

/* ── Crash guard: a render error must never leave a blank page ──────────
   Catches anything thrown below it (broken persisted state shapes, canvas
   failures, …) and offers reload + saved-state reset. Self-styled inline so
   it paints even if styles.css failed to load. */
interface BoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("[WaveS] render crash captured:", error);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const fr = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr");
    const reload = () => window.location.reload();
    const reset = () => {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem("waves:lab:v1");
        window.localStorage.removeItem("waves:rt-view");
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch {
        /* ignore */
      }
      window.location.reload();
    };
    const box: CSSProperties = {
      position: "fixed",
      inset: 0,
      zIndex: 10000,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 24,
      textAlign: "center",
      background: "#080e17",
      color: "#edf4fc",
      fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif",
    };
    const btn: CSSProperties = {
      padding: "10px 18px",
      borderRadius: 10,
      border: "1px solid #41536a",
      background: "#142131",
      color: "#edf4fc",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
    };
    return (
      <div style={box} role="alert">
        <div style={{ fontSize: 12, letterSpacing: ".3em", color: "#94a6bc" }}>WAVES</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
          {fr ? "L'application a rencontré un problème" : "The app ran into a problem"}
        </div>
        <div style={{ fontSize: 13, color: "#b4c3d5", maxWidth: 440 }}>
          {fr
            ? "Vos réglages sauvegardés sont peut-être en cause : réinitialisez-les ou rechargez simplement la page."
            : "Your saved settings may be at fault: reset them or just reload the page."}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button type="button" style={btn} onClick={reload}>
            {fr ? "Recharger" : "Reload"}
          </button>
          <button type="button" style={{ ...btn, borderColor: "#55dbf5", color: "#55dbf5" }} onClick={reset}>
            {fr ? "Réinitialiser mes réglages" : "Reset my settings"}
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  const initial = useMemo(loadInitial, []);
  const [simulation, setSimulation] = useState<{ sim: SimState; reason: MatchingReason | null }>({ sim: initial.sim, reason: null });
  const sim = simulation.sim;
  // All interactive paths commit a fully resolved stack, never an effect-delayed coating.
  const setSim = useCallback((action: SetStateAction<SimState>, imported = false) => {
    setSimulation((previous) => {
      const candidate = typeof action === "function" ? action(previous.sim) : action;
      return imported ? resolveMatching(candidate) : transitionMatching(previous.sim, candidate);
    });
  }, []);
  const [lang, setLang] = useState<Lang>(initial.lang);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [playing, setPlaying] = useState(true);
  const [sceneView, setSceneView] = useState<"main" | "lab">("main");
  const [detailHost, setDetailHost] = useState<HTMLDivElement | null>(null);
  const detailHostRef = useCallback((node: HTMLDivElement | null) => setDetailHost(node), []);
  const [fieldScale, setFieldScale] = useState<"lin" | "db">("lin");
  const [flash, setFlash] = useState(0);
  const [present, setPresent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [sceneSurface, setSceneSurface] = useState<SceneSurface | null>(null);
  const [coatingSide, setCoatingSide] = useState("before");
  const coatingStatus = simulation.reason;
  const [rtView, setRtView] = useState<RtView>(loadRtView);
  useEffect(() => saveRtView(rtView), [rtView]);
  const [perfOn, setPerfOn] = useState(() => {
    try {
      return localStorage.getItem("waves:perf") === "1" || new URLSearchParams(window.location.search).get("perf") === "1";
    } catch {
      return false;
    }
  });
  const copyTimer = useRef(0);
  const buildTaps = useRef({ count: 0, at: 0 });
  const presentRef = useRef(present);
  presentRef.current = present;
  const buildInfo = useMemo(() => {
    const ua = navigator.userAgent;
    const android = /Android\s+([\d.]+)/.exec(ua)?.[1];
    const chromium = /(?:Chrome|CriOS)\/(\d+)/.exec(ua)?.[1];
    const engine = chromium ? `${/;\s*wv\)/.test(ua) ? "WebView" : "Chrome"} ${chromium}` : "Web";
    return [`v${__APP_VERSION__}`, android ? `Android ${android}` : null, engine].filter(Boolean).join(" · ");
  }, []);
  // true only when entering present mode requested fullscreen itself, so
  // leaving never kicks the user out of a pre-existing (F11) fullscreen
  const fsByUs = useRef(false);

  const setPresentFull = useCallback((on: boolean) => {
    setPresent(on);
    try {
      if (on) {
        if (!document.fullscreenElement) {
          fsByUs.current = true;
          const p = document.documentElement.requestFullscreen() as Promise<void> | undefined;
          if (p && typeof p.catch === "function") p.catch(() => { fsByUs.current = false; });
        }
      } else if (fsByUs.current && document.fullscreenElement) {
        fsByUs.current = false;
        const p = document.exitFullscreen() as Promise<void> | undefined;
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } catch {
      /* fullscreen unavailable — present mode still works windowed */
    }
  }, []);

  const onBuildTap = () => {
    const now = performance.now();
    const taps = buildTaps.current;
    if (now - taps.at > 900) taps.count = 0;
    taps.at = now;
    taps.count += 1;
    if (taps.count < 5) return;
    taps.count = 0;
    setPerfOn((value) => {
      const next = !value;
      try {
        localStorage.setItem("waves:perf", next ? "1" : "0");
      } catch {
        /* storage unavailable: keep the session toggle */
      }
      return next;
    });
  };

  // the browser eats Esc to leave fullscreen first: sync present mode with it
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) {
        fsByUs.current = false;
        setPresent(false);
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const t = DICTS[lang];
  const fmt = useMemo(() => makeFmt(lang), [lang]);
  const pal = PALETTES[theme];

  const update = useCallback(<K extends "freq" | "angle" | "pol">(k: K, v: SimState[K]) => {
    setSim((s) => (s[k] === v ? s : { ...s, [k]: v }));
  }, []);
  const patchLayer = useCallback((patch: Partial<Layer>) => {
    setSim((s) => ({ ...s, layers: s.layers.map((l, i) => (i === s.sel ? { ...l, ...patch } : l)) }));
  }, []);
  const select = useCallback((i: number) => setSim((s) => (s.sel === i ? s : { ...s, sel: i })), []);
  const addLayer = () =>
    setSim((s) => {
      if (s.layers.length >= MAX_LAYERS) return s;
      const layers = [...s.layers];
      layers.splice(s.sel + 1, 0, mkLayer("plasterboard", 1.3));
      return { ...s, layers, sel: s.sel + 1 };
    });
  const dupLayer = (i: number) =>
    setSim((s) => {
      if (s.layers.length >= MAX_LAYERS || isLiveMatching(s.layers[i])) return s;
      const layers = [...s.layers];
      layers.splice(i + 1, 0, { ...s.layers[i], id: newId() });
      return { ...s, layers, sel: i + 1 };
    });
  const removeLayer = (i: number) =>
    setSim((s) => {
      if (s.layers.length <= 1) return s;
      const layers = s.layers.filter((_, k) => k !== i);
      return { ...s, layers, sel: clamp(s.sel > i ? s.sel - 1 : s.sel, 0, layers.length - 1) };
    });
  const moveLayer = (i: number, dir: -1 | 1) =>
    setSim((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.layers.length) return s;
      const layers = [...s.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...s, layers, sel: s.sel === i ? j : s.sel === j ? i : s.sel };
    });
  // canvas drag (src/scene/dragStack.ts): same state, same results / share / storage path as the panel
  const dragMove = useCallback((from: number, to: number) => setSim((s) => applyMove(s, from, to)), []);
  const dragResize = useCallback((i: number, cm: number) => setSim((s) => applyResize(s, i, cm)), []);
  const applyTemplate = (id: TemplateId) => {
    setSim((s) => ({ ...s, layers: TEMPLATES[id](), sel: 0 }));
    setFlash((f) => f + 1);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, sim, lang, theme }));
    } catch {
      /* storage unavailable — state simply isn't persisted */
    }
  }, [sim, lang, theme]);

  // keep the address bar shareable: the URL hash always encodes the current
  // setup, so copying the URL (or the Share button) captures this exact state
  useEffect(() => {
    try {
      window.history.replaceState(null, "", `#s=${encodeShare(sim, lang, theme)}`);
    } catch {
      /* sandboxed/file contexts — sharing still works via the copy button */
    }
  }, [sim, lang, theme]);

  // apply share-links that arrive without a reload (pasted into this tab,
  // back/forward between two shared URLs)
  useEffect(() => {
    const onHash = () => {
      const h = shareHashOf(window.location.hash);
      if (!h) return;
      const shared = decodeShare(h);
      if (!shared) return;
      const next = sanitizePersisted(
        {
          v: shared.v,
          sim: shared.sim as unknown as SimState,
          lang: shared.lang as Lang,
          theme: shared.theme as Theme,
        },
        defaultPersisted(),
      );
      setSim(next.sim, true);
      setLang(next.lang);
      setTheme(next.theme);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const shareUrl = () =>
    `${window.location.origin}${window.location.pathname}#s=${encodeShare(sim, lang, theme, labForShare())}`;

  const share = async () => {
    setCopied(await copyText(shareUrl()));
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const downloadBlob = downloadText;

  const downloadSweepCsv = () => {
    const sep = lang === "fr" ? ";" : ",";
    const head = ["angle_deg", "R_TE", "T_TE", "R_TM", "T_TM", "R_AVG", "T_AVG"].join(sep);
    const lines = sweep.ang.map((a, i) =>
      [
        fmt.num(a, 1),
        sweep.Rte[i],
        sweep.Tte[i],
        sweep.Rtm[i],
        sweep.Ttm[i],
        (sweep.Rte[i] + sweep.Rtm[i]) / 2,
        (sweep.Tte[i] + sweep.Ttm[i]) / 2,
      ]
        .map((v, k) => (k === 0 ? v : fmt.num(v as number, 6)))
        .join(sep),
    );
    downloadBlob([head, ...lines].join("\n"), `waves-sweep-${sim.freq}GHz-${sim.pol}.csv`);
  };

  const downloadFieldCsv = () => {
    // same z-domain as FieldChart (air margins around the stack), n = 1000
    const d = res.ds.reduce((a, b) => a + b, 0);
    const lam = C0 / (sim.freq * 1e9);
    const air = Math.max(0.5 * d, Math.min(1.5 * lam, 3 * d + 0.02));
    const zMin = -air;
    const zMax = d + air;
    const n = 1000;
    const f = stackFieldAbs(res.etas, res.ds, sim.freq, sim.angle * DEG, sim.pol);
    const sep = lang === "fr" ? ";" : ",";
    const head = ["z_cm", "E_lin", "E_dB"].join(sep);
    const lines: string[] = [];
    for (let i = 0; i <= n; i++) {
      const z = zMin + ((zMax - zMin) * i) / n;
      const v = f(z);
      lines.push(
        [fmt.num(z * 100, 4), fmt.num(v, 6), fmt.num(20 * Math.log10(Math.max(v, 1e-9)), 3)].join(sep),
      );
    }
    downloadBlob([head, ...lines].join("\n"), `waves-field-${sim.freq}GHz-${sim.angle}deg-${sim.pol}.csv`);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = "WaveS";
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape always works, even when a button is focused (it never
      // activates controls natively, unlike Space/arrows which do)
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key === "Escape") {
        if (showAbout) setShowAbout(false);
        else if (showHelp) setShowHelp(false);
        else setPresentFull(false);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      const stackCmd = stackKeyCommand(e, tag, (e.target as HTMLInputElement | null)?.type);
      if (stackCmd) {
        e.preventDefault();
        setSim((s) => applyStackCommand(s, stackCmd));
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "?") {
        setShowHelp((v) => !v);
      } else if (e.key === "l" || e.key === "L") {
        setLang((l) => (l === "fr" ? "en" : "fr"));
      } else if (e.key === "t" || e.key === "T") {
        setTheme((th) => (th === "dark" ? "light" : "dark"));
      } else if (e.key === "p" || e.key === "P") {
        setPresentFull(!presentRef.current);
      } else if (e.key === "v" || e.key === "V") {
        window.dispatchEvent(new CustomEvent("waves:set-view", { detail: "toggle" }));
      } else if (e.key === "1" || e.key === "2" || e.key === "3") {
        window.dispatchEvent(
          new CustomEvent("waves:set-display", { detail: e.key === "1" ? "field" : e.key === "2" ? "fronts" : "both" }),
        );
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const d = e.key === "ArrowRight" ? 0.5 : -0.5;
        setSim((s) => ({ ...s, angle: clamp(Math.round((s.angle + d) * 2) / 2, 0, 89) }));
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setSim((s) => ({ ...s, sel: clamp(s.sel + (e.key === "ArrowUp" ? -1 : 1), 0, s.layers.length - 1) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHelp, showAbout, setPresentFull]);

  const aboutOpen = useRef(showAbout);
  aboutOpen.current = showAbout;
  const helpOpen = useRef(showHelp);
  helpOpen.current = showHelp;

  // Preserve Android Back: dismiss overlays, leave presentation, then exit.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let detach: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener("backButton", () => {
      if (aboutOpen.current) { setShowAbout(false); return; }
      if (helpOpen.current) { setShowHelp(false); return; }
      if (presentRef.current) { setPresentFull(false); return; }
      void CapacitorApp.exitApp();
    }).then((handle) => {
      if (disposed) void handle.remove();
      else detach = () => handle.remove();
    });
    return () => {
      disposed = true;
      if (detach) void detach();
    };
  }, [setPresentFull]);

  const res = useMemo(() => computeResults(sim), [sim]);
  // profiled main wall (lab profile on the first layer) when the profile is drawn and the view asks for it
  const profiled = useProfiledMain(sceneSurface, sim.layers, sim.freq, sim.angle, sim.pol, rtView);
  const shown = profiled
    ? { R: profiled.R, T: profiled.T, A: Math.max(0, profiled.A) }
    : { R: res.R, T: res.T, A: res.A };
  const shownRdB = 10 * Math.log10(Math.max(shown.R, 1e-30));
  const shownTdB = 10 * Math.log10(Math.max(shown.T, 1e-30));
  const sceneSurfaceShown: SceneSurface | null = sceneSurface
    ? {
        ...sceneSurface,
        // orders are opt-in; with an RCWA result they carry the main wall's efficiencies
        orders: sceneSurface.orders && (profiled?.orders ?? sceneSurface.orders),
        rt: { source: profiled ? profiled.source : "flat", busy: profiled?.busy ?? false },
      }
    : null;
  // keyed on values: res arrays are rebuilt on every state change, so angle,
  // polarization and selection changes reuse the previous 181-point sweep
  const sweepKey = stackSweepKey(res.etas, res.ds, sim.freq);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sweep = useMemo(() => computeStackSweep(res.etas, res.ds, sim.freq), [sweepKey]);

  const selL = sim.layers[sim.sel] ?? sim.layers[0];
  const selR = res.layers[sim.sel] ?? res.layers[0];
  const selDef = selL.mat === "air" || selL.mat === "custom" ? null : MATERIALS[selL.mat];
  const matName = (m: LayerMat) => t.materials[m];

  const sceneParams: SceneParams = {
    etas: res.etas,
    ds: res.ds,
    theta: sim.angle,
    // one reflected and one transmitted beam, carrying the resultant R and T
    // (all orders, every internal reflection and absorption already in the math)
    R: shown.R,
    T: shown.T,
    layers: sim.layers.map((l, i) => ({
      mat: l.mat,
      readOnlyThickness: isLiveMatching(l),
      cm: l.thickness,
      thetaT: res.layers[i].thetaT,
      nRe: res.layers[i].nRe,
      absorbed: res.layers[i].absorbed,
      fluxIn: res.layers[i].fluxIn,
      fluxOut: i + 1 < sim.layers.length ? res.layers[i + 1].fluxIn : shown.T,
      name: l.matching ? t.arMaterial : matName(l.mat),
    })),
    sel: sim.sel,
    hover: -1,
    freq: sim.freq,
    pol: sim.pol,
    labels: { normal: t.normal, tx: "Tx", rx: "Rx", refl: t.reflShort },
  };

  const bands = useMemo(
    () => sim.layers.map((l) => ({ tint: matTint(l.mat), label: matName(l.mat).toUpperCase(), air: l.mat === "air" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim.layers, lang],
  );

  const applyPreset = (key: string) => {
    if (key === "antireflection") setRtView("flat");
    setSim(presetState(key, sim));
    setFlash((f) => f + 1);
  };

  const freqHint = (
    <>
      <span className="om-chip-mini">{bandName(sim.freq)}</span>
      λ₀ = {fmt.len(res.lambda0)}
    </>
  );

  const rangeNote =
    selL.mat === "air"
      ? t.airNote
      : selDef
        ? selR.inRange
          ? tpl(t.inRange, { a: fmt.sig(selDef.fMin), b: fmt.sig(selDef.fMax) })
          : tpl(t.outOfRange, { a: fmt.sig(selDef.fMin), b: fmt.sig(selDef.fMax) })
        : t.customRange;
  const formula =
    selL.mat === "air"
      ? "ε′ = 1 · σ = 0"
      : selDef
        ? `ε′ = ${fmt.sig(selDef.a, 4)} · σ = ${fmt.sig(selDef.c, 4)}·f^${fmt.sig(selDef.d, 4)} S/m`
        : `ε′ = ${fmt.sig(selL.eps, 4)} · σ = ${fmt.sig(selL.sigma, 3)} S/m`;

  const polLabel = sim.pol === "AVG" ? t.avg : sim.pol;

  // which model gives the R / T on screen, and the switch between flat and profiled
  const fr = lang === "fr";
  const viewTools = (
    <div className="om-view-modes" role="group" aria-label={fr ? "Scène affichée" : "Displayed scene"}>
      <button type="button" aria-pressed={sceneView === "main"} className={sceneView === "main" ? "is-on" : ""} onClick={() => setSceneView("main")}>
        Simulation
      </button>
      <button type="button" aria-pressed={sceneView === "lab"} className={sceneView === "lab" ? "is-on" : ""} onClick={() => setSceneView("lab")}>
        {fr ? "Labo de surface" : "Surface Lab"}
      </button>
    </div>
  );
  const emtWarn = profiled !== null && profiled.source === "emt" && profiled.validity === "invalid";
  const rtChip = profiled
    ? `R/T · ${fr ? "profilé" : "profiled"} · ${profiled.source === "rcwa" ? "RCWA" : profiled.busy ? "EMT…" : "EMT"}${emtWarn ? " ⚠" : ""}`
    : `R/T · ${fr ? "mur plan" : "flat wall"}`;
  const rtTitle = emtWarn
    ? fr
      ? "EMT hors validité pour cette période : passez le labo en mode rigoureux (RCWA)."
      : "EMT is not valid for this period: switch the lab to rigorous mode (RCWA)."
    : fr
      ? "Plan : empilement exact (ITU-R P.2040). Profilé : profil du labo sur la 1re couche, calcul du labo (EMT ou RCWA)."
      : "Flat: exact stack (ITU-R P.2040). Profiled: lab profile on the first layer, lab calculation (EMT or RCWA).";
  const rtTools = sceneSurface ? (
    <div className="om-view-modes" role="group" aria-label={fr ? "Valeurs R/T" : "R/T values"} title={rtTitle}>
      <button type="button" aria-pressed={rtView === "flat"} className={rtView === "flat" ? "is-on" : ""} onClick={() => setRtView("flat")}>
        {fr ? "R/T plan" : "Flat R/T"}
      </button>
      <button type="button" aria-pressed={rtView === "profiled"} className={rtView === "profiled" ? "is-on" : ""} onClick={() => setRtView("profiled")}>
        {fr ? "R/T profilé" : "Profiled R/T"}
      </button>
    </div>
  ) : null;
  const full = sim.layers.length >= MAX_LAYERS;
  const insertCoating = (slot: number) => {
    const next = addMatching(sim, slot);
    setSimulation((previous) => next.reason ? { ...previous, reason: next.reason } : transitionMatching(previous.sim, next.sim));
    if (!next.reason) setRtView("flat");
  };
  const liveCoating = isLiveMatching(selL);
  const matchRef = liveCoating ? matchingReference(sim.layers, sim.sel, sim.freq) : null;

  const setMaterial = (m: LayerMat) => {
    if (m === selL.mat) return;
    if (m === "custom") {
      const cur = layerEpsSigma(selL, sim.freq);
      patchLayer({ mat: m, matching: undefined, eps: clamp(Number(cur.epsR.toFixed(2)), 1, 30), sigma: clamp(Number(cur.sigma.toPrecision(3)), 0.0001, 10) });
    } else patchLayer({ mat: m, matching: undefined });
  };

  return (
    <div className="om" data-theme={theme} data-present={present ? "true" : "false"}>

      <header className="om-top om-enter" style={{ "--d": "0ms" } as CSSProperties}>
        <div className="om-brand">
          <Logo />
          <div className="om-brand-text">
            <span className="om-school">{t.school}</span>
            <h1>WaveS</h1>
            <p>
              {t.madeBy} <strong>{t.author}</strong>
              <span className="om-dot-sep" />
              <span className="om-brand-tag">{t.sub}</span>
            </p>
          </div>
        </div>
        <div className="om-top-actions">
          <Segmented<Lang>
            size="sm"
            ariaLabel={t.language}
            value={lang}
            onChange={setLang}
            options={[
              { value: "fr", label: "FR" },
              { value: "en", label: "EN" },
            ]}
          />
          <a
            className="om-icon-btn om-icon-link"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.repo}
            title={t.repoTitle}
          >
            {Icon.github}
          </a>
          <button
            type="button"
            className="om-icon-btn"
            aria-label={t.about}
            title={t.about}
            onClick={() => setShowAbout(true)}
          >
            {Icon.info}
          </button>
          <button
            type="button"
            className="om-icon-btn"
            aria-label={t.theme}
            title={t.theme}
            onClick={() => setTheme((th) => (th === "dark" ? "light" : "dark"))}
          >
            <span className={`om-swap ${theme === "dark" ? "is-a" : "is-b"}`}>
              <span>{Icon.moon}</span>
              <span>{Icon.sun}</span>
            </span>
          </button>
          <button
            type="button"
            className={`om-presentbtn ${copied ? "is-on" : ""}`}
            onClick={share}
            title={t.shareTitle}
          >
            {copied ? t.copied : t.share}
          </button>
          <button
            type="button"
            className={`om-presentbtn ${present ? "is-on" : ""}`}
            onClick={() => setPresentFull(!presentRef.current)}
            aria-pressed={present}
            title={present ? t.exitPresent : t.present}
          >
            {present ? t.exitPresent : t.present}
          </button>
          <button
            type="button"
            className={`om-play ${playing ? "is-playing" : ""}`}
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            <span className={`om-swap ${playing ? "is-b" : "is-a"}`}>
              <span>{Icon.play}</span>
              <span>{Icon.pause}</span>
            </span>
            <span className="om-play-label">{playing ? t.pause : t.play}</span>
          </button>
        </div>
      </header>

      <main className="om-layout" ref={frameHeightRef}>
        {/* ───────── Scene ───────── */}
        <section className="om-card om-scene om-enter" style={{ "--d": "60ms" } as CSSProperties}>
          <RayScene active={sceneView === "main"} viewTools={viewTools} params={withSurface(sceneParams, sceneSurfaceShown)} pal={pal} playing={playing} lang={lang} fmtNum={fmt.num} onSelect={select} onMove={dragMove} onResize={dragResize} tools={rtTools} />
          <div ref={detailHostRef} className="om-lab-host" hidden={sceneView !== "lab"} />
          {sceneView === "main" && <>
          <div className="om-hud om-hud-tl">
            <span className="om-hud-chip">
              <span className="om-stackdots">
                {sim.layers.map((l) => (
                  <i key={l.id} style={{ background: matSwatch(l.mat) }} />
                ))}
              </span>
              {tpl(sim.layers.length > 1 ? t.layersN : t.layer1, { n: String(sim.layers.length) })}
            </span>
            {sceneSurface && <span className="om-hud-chip om-mono" title={rtTitle}>{rtChip}</span>}
            <span className="om-hud-chip om-mono">{fmt.num(sim.freq, sim.freq < 10 ? 2 : 1)} GHz</span>
            <span className="om-hud-chip om-mono">{polLabel}</span>
          </div>
          <div className="om-hud om-hud-tr">
            <div className="om-hud-big" style={{ "--tone": "var(--om-ref)" } as CSSProperties}>
              <span className="om-hud-k">R</span>
              <span className="om-hud-v">{fmt.pct(shown.R)}<small>%</small></span>
            </div>
            <div className="om-hud-big" style={{ "--tone": "var(--om-tra)" } as CSSProperties}>
              <span className="om-hud-k">T</span>
              <span className="om-hud-v">{fmt.pct(shown.T)}<small>%</small></span>
            </div>
          </div>
          <div className="om-hud om-hud-bl">
            <span className="om-leg"><i style={{ background: "var(--om-inc)" }} />{t.incident}</span>
            <span className="om-leg"><i style={{ background: "var(--om-ref)" }} />{t.reflected}</span>
            <span className="om-leg"><i style={{ background: "var(--om-tra)" }} />{t.transmitted}</span>
            {shown.A > 0.005 && <span className="om-leg"><i style={{ background: "var(--om-abs)" }} />{t.absorbed}</span>}
          </div>
          <div className="om-hud om-hud-br"><span className="om-hint">{t.clickLayer}</span></div>
          </>}
          {!playing && <div className="om-paused-badge">{t.pause}</div>}
        </section>

        <div className="om-presentbar" aria-hidden={present ? undefined : true}>
          <div className="om-presentbar-group">
            <span className="om-presentbar-label om-mono">{fmt.num(sim.freq, 2)} GHz</span>
            <input
              type="range" className="om-range om-presentbar-range" min={0.5} max={40} step={0.1}
              value={sim.freq} aria-label={t.frequency}
              style={{ "--pf": Math.min(1, Math.max(0, (sim.freq - 0.5) / 39.5)) } as CSSProperties}
              onChange={(e) => update("freq", Number(e.target.value))} />
          </div>
          <div className="om-presentbar-group">
            <span className="om-presentbar-label om-mono">θ {fmt.num(sim.angle, 1)}°</span>
            <input
              type="range" className="om-range om-presentbar-range" min={0} max={89} step={0.5}
              value={sim.angle} aria-label={t.angle}
              style={{ "--pf": sim.angle / 89 } as CSSProperties}
              onChange={(e) => update("angle", Number(e.target.value))} />
          </div>
          <Segmented<PolMode>
            size="sm"
            ariaLabel={t.polarization}
            value={sim.pol}
            onChange={(v) => update("pol", v)}
            options={[
              { value: "TE", label: "TE" },
              { value: "TM", label: "TM" },
              { value: "AVG", label: t.avg },
            ]}
          />
          <button
            type="button"
            className={`om-play ${playing ? "is-playing" : ""}`}
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            <span className="om-play-label">{playing ? t.pause : t.play}</span>
          </button>
        </div>

        {/* ───────── Controls ───────── */}
        <aside className="om-card om-controls om-enter" style={{ "--d": "120ms" } as CSSProperties}>
          <div className="om-insp-h">
            {Icon.freq}
            {t.tabWave}
          </div>
            <div className="om-tabpanel" key="wave">
              <div className="om-group">
                <Slider label={t.frequency} icon={Icon.freq} value={sim.freq} min={0.5} max={40} step={0.01} log unit="GHz"
                  digits={2} accent="var(--om-inc)" onChange={(v) => update("freq", v)} fmtNum={fmt.num} hint={freqHint}
                  ticks={[0.5, 1, 2.4, 5, 10, 28, 40].map((v) => ({ v, label: fmt.sig(v) }))} />
              </div>
              <div className="om-group">
                <Slider label={t.angle} icon={Icon.angle} value={sim.angle} min={0} max={89} step={0.5} unit="°" digits={1}
                  accent="var(--om-ref)" onChange={(v) => update("angle", v)} fmtNum={fmt.num}
                  ticks={[
                    { v: 0, label: "0" },
                    { v: 30, label: "30" },
                    { v: 60, label: "60" },
                    { v: 89, label: "89" },
                    ...(Number.isFinite(selR.brewster) ? [{ v: Math.round(selR.brewster * 2) / 2, label: "θB", tone: "acc" as const }] : []),
                  ]} />
                {Number.isFinite(selR.brewster) && (
                  <div className="om-presets" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="om-preset"
                      title={sim.pol === "TM" ? t.brewsterJumpTitle : t.brewsterNa}
                      disabled={sim.pol !== "TM"}
                      style={sim.pol !== "TM" ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                      onClick={() => update("angle", Math.round(selR.brewster * 2) / 2)}
                    >
                      {t.brewsterJump} · {fmt.num(Math.round(selR.brewster * 2) / 2, 1)}°
                    </button>
                  </div>
                )}
              </div>
              <div className="om-group">
                <div className="om-label om-label-row">
                  {Icon.pol}
                  {t.polarization}
                </div>
                <Segmented<PolMode>
                  ariaLabel={t.polarization}
                  value={sim.pol}
                  onChange={(v) => update("pol", v)}
                  options={[
                    { value: "TE", label: "TE", sub: t.teHint },
                    { value: "TM", label: "TM", sub: t.tmHint },
                    { value: "AVG", label: t.avg, sub: t.avgHint },
                  ]}
                />
              </div>
              <div className="om-group">
                <div className="om-label om-label-row">
                  {Icon.spark}
                  {t.presets}
                </div>
                <div className="om-presets">
                  {Object.keys(t.presetNames).map((k) => (
                    <button key={k} type="button" className="om-preset" onClick={() => applyPreset(k)}>
                      {t.presetNames[k]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          <div className="om-insp-h">
            {Icon.layers}
            {t.tabStack}
            <span className="om-count">{sim.layers.length}</span>
          </div>
            <div className="om-tabpanel" key="stack">
              <div className="om-group">
                <div className="om-label om-label-row om-label-split">
                  <span>{t.stack}</span>
                  <span className="om-mono om-faint">{fmt.num(res.totalCm, res.totalCm < 10 ? 2 : 1)} cm · {sim.layers.length}/{MAX_LAYERS}</span>
                </div>
                <div className="om-strip" aria-hidden>
                  <span className="om-strip-air">{t.airShort}</span>
                  {sim.layers.map((l, i) => (
                    <span
                      key={l.id}
                      className={`om-strip-seg ${i === sim.sel ? "is-on" : ""} ${l.mat === "air" ? "is-air" : ""}`}
                      style={{ flexGrow: Math.max(0.6, Math.sqrt(l.thickness)), background: matSwatch(l.mat) }}
                      onClick={() => select(i)}
                    />
                  ))}
                  <span className="om-strip-air">{t.airShort}</span>
                </div>
                <ol className="om-layers">
                  {sim.layers.map((l, i) => {
                    const r = res.layers[i];
                    const on = i === sim.sel;
                    return (
                      <li key={l.id} className={`om-layer ${on ? "is-on" : ""}`} style={{ "--tint": matTint(l.mat) } as CSSProperties}>
                        <button type="button" className="om-layer-main" onClick={() => select(i)} aria-pressed={on}>
                          <span className="om-layer-idx">{i + 1}</span>
                          <span className="om-layer-sw" style={{ background: matSwatch(l.mat) }} />
                          <span className="om-layer-txt">
                            <b>{l.matching ? t.arMaterial : matName(l.mat)}</b>
                            <small className="om-mono">
                              {fmt.num(l.thickness, l.thickness < 1 ? 2 : 1)} cm · ε′ {fmt.num(r.epsR, 2)} · A {fmt.pct(r.absorbed)}%
                            </small>
                          </span>
                        </button>
                        <span className="om-layer-actions">
                          <button type="button" aria-label={t.moveUp} title={t.moveUp} disabled={i === 0} onClick={() => moveLayer(i, -1)}>{Icon.up}</button>
                          <button type="button" aria-label={t.moveDown} title={t.moveDown} disabled={i === sim.layers.length - 1} onClick={() => moveLayer(i, 1)}>{Icon.down}</button>
                          <button type="button" aria-label={t.duplicate} title={t.duplicate} disabled={full || isLiveMatching(l)} onClick={() => dupLayer(i)}>{Icon.copy}</button>
                          <button type="button" aria-label={t.remove} title={t.remove} disabled={sim.layers.length <= 1} onClick={() => removeLayer(i)} className="is-danger">{Icon.trash}</button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <button type="button" className="om-add" onClick={addLayer} disabled={full}>
                  {Icon.plus}
                  {full ? tpl(t.maxLayers, { n: String(MAX_LAYERS) }) : t.addLayer}
                </button>
                <div className="om-templates">
                  {(Object.keys(TEMPLATES) as TemplateId[]).map((k) => (
                    <button key={k} type="button" className="om-preset" onClick={() => applyTemplate(k)}>
                      {t.templateNames[k]}
                    </button>
                  ))}
                </div>
                <div className="om-coating-tools">
                  <div className="om-coating-row">
                    <span className="om-label">{t.arAdaptation}</span>
                    <select aria-label={t.arPosition} value={coatingSide} onChange={(e) => setCoatingSide(e.target.value)}>
                      <option value="before">{t.arBefore}</option><option value="after">{t.arAfter}</option>
                    </select>
                    <button type="button" className="om-preset" disabled={full} onClick={() => insertCoating(sim.sel + (coatingSide === "after" ? 1 : 0))}>{t.arAdd}</button>
                  </div>
                  <details><summary>{t.arDetails}</summary><p>{t.arInsertHint}</p></details>
                  {sceneSurface?.profile && sceneSurface.profile.id !== "flat" && sim.layers[0].matching && <details><summary>{t.arProfileTitle}</summary><p>{t.arProfile}</p></details>}
                  <span className="om-coating-status" role="status">{full ? tpl(t.maxLayers, { n: String(MAX_LAYERS) }) : coatingStatus ? t[coatingStatus] : null}</span>
                </div>
              </div>

              <div className="om-group om-editor" key={selL.id} style={{ "--tint": matTint(selL.mat) } as CSSProperties}>
                <div className="om-label om-label-row om-label-split">
                  <span>
                    <span className="om-layer-idx is-sm">{sim.sel + 1}</span>
                    {t.editing}
                  </span>
                  <span className="om-mono om-faint">{selL.matching ? t.arMaterial : matName(selL.mat)}</span>
                </div>
                {liveCoating && matchRef ? <div className="om-coating-tools">
                  <div className="om-hint">{t.arAuto}</div>
                  <div className="om-mono">εᵣ = {fmt.sig(selL.eps, 6)} · σ = 0 S/m</div>
                  <div className="om-mono">d = {fmt.sig(selL.thickness, 6)} cm</div>
                  <details><summary>{t.arDetails}</summary>
                    <p>{(sim.layers[sim.sel - 1] ? matName(sim.layers[sim.sel - 1].mat) : t.air)} → {(sim.layers[sim.sel + 1] ? matName(sim.layers[sim.sel + 1].mat) : t.air)}</p>
                    <p className="om-mono">n₁ = {fmt.sig(matchRef.n1, 6)} · n₂ = {fmt.sig(matchRef.n2, 6)}<br />Z₁,ref = {fmt.sig(matchRef.z1, 6)} Ω · Z₂,ref = {fmt.sig(matchRef.z2, 6)} Ω<br />nₘ = √(n₁n₂) · εᵣ,ₘ = n₁n₂<br />ηₘ,ref = √(Z₁,ref Z₂,ref)<br />d = {matchRef.design?.order}λ₀/(4nₘ)</p>
                    <p>{t.arInsertHint}</p>
                  </details>
                </div> : <>
                <div className="om-materials" role="radiogroup" aria-label={t.material}>
                  {LAYER_MATS.map((id) => {
                    const eps = id === "air" ? 1 : materialProps(id, sim.freq, selL.eps, selL.sigma).epsR;
                    const on = selL.mat === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`om-mat ${on ? "is-on" : ""} ${id === "custom" ? "is-wide" : ""}`}
                        onClick={() => setMaterial(id)}
                      >
                          <span className="om-mat-swatch" style={{ background: matSwatch(id) }} />
                        <span className="om-mat-name">{matName(id)}</span>
                        <span className="om-mat-eps">ε′ {fmt.num(eps, 2)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className={`om-collapse ${selL.mat === "custom" ? "is-open" : ""}`}>
                  <div className="om-collapse-inner">
                    <div className="om-custom">
                      <Segmented<CustomMode>
                        size="sm"
                        ariaLabel={t.epsCustom}
                        value={selL.customMode}
                        onChange={(v) => patchLayer({ customMode: v })}
                        options={[
                          { value: "eps", label: t.modeEps },
                          { value: "nk", label: t.modeNK },
                        ]}
                      />
                      {selL.customMode === "nk" ? (
                        <>
                          <Slider label="n" value={nkOf(selL.eps, selL.sigma, sim.freq).n} min={1} max={8} step={0.01} unit="" digits={3}
                            accent="var(--om-acc)" onChange={(v) => {
                              const k = nkOf(selL.eps, selL.sigma, sim.freq).k;
                              const c = epsSigmaOfNK(v, k, sim.freq);
                              patchLayer({ eps: clamp(Number(c.eps.toFixed(3)), 1, 30), sigma: Math.max(0, Number(c.sigma.toPrecision(3))) });
                            }} fmtNum={fmt.num} />
                          <Slider label="κ" value={nkOf(selL.eps, selL.sigma, sim.freq).k} min={0} max={3} step={0.001} unit="" digits={3}
                            accent="var(--om-acc)" onChange={(v) => {
                              const n = nkOf(selL.eps, selL.sigma, sim.freq).n;
                              const c = epsSigmaOfNK(n, v, sim.freq);
                              patchLayer({ eps: clamp(Number(c.eps.toFixed(3)), 1, 30), sigma: Math.max(0, Number(c.sigma.toPrecision(3))) });
                            }} fmtNum={fmt.num}
                            ticks={[
                              { v: 0, label: "0" },
                              { v: 0.01, label: "10⁻²" },
                              { v: 0.1, label: fmt.sig(0.1) },
                              { v: 1, label: "1" },
                            ]} />
                          <div className="om-hint"><span className="om-mono">ε′ {fmt.num(selL.eps, 2)} · σ {fmt.sig(selL.sigma, 3)} S/m</span></div>
                        </>
                      ) : (
                        <>
                          <Slider label={t.epsCustom} value={selL.eps} min={1} max={30} step={0.01} unit="" digits={2}
                            accent="var(--om-acc)" onChange={(v) => patchLayer({ eps: v })} fmtNum={fmt.num} />
                           {selL.sigma === 0 && <div className="om-hint">{t.arLossless}</div>}
                           <Slider label={t.sigmaCustom} value={selL.sigma} min={0.0001} max={10} step={0.0001} log unit="S/m" digits={4}
                            accent="var(--om-acc)" onChange={(v) => patchLayer({ sigma: v })} fmtNum={fmt.num}
                            ticks={[
                              { v: 0.001, label: "10⁻³" },
                              { v: 0.01, label: "10⁻²" },
                              { v: 0.1, label: fmt.sig(0.1) },
                              { v: 1, label: "1" },
                            ]} />
                          <div className="om-hint"><span className="om-mono">n {fmt.num(nkOf(selL.eps, selL.sigma, sim.freq).n, 3)} · κ {fmt.sig(nkOf(selL.eps, selL.sigma, sim.freq).k, 3)}</span></div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <Slider label={t.thickness} icon={Icon.thick} value={selL.thickness} min={0.1} max={100} step={0.01} log unit="cm"
                  digits={2} accent="var(--om-abs)" onChange={(v) => patchLayer({ thickness: v })} fmtNum={fmt.num}
                  ticks={[0.1, 0.4, 1, 5, 20, 100].map((v) => ({ v, label: fmt.sig(v) }))} />
                <div className={`om-note ${selR.inRange ? "" : "is-warn"}`}>
                  <span className="om-note-icon">{selR.inRange ? Icon.info : Icon.warn}</span>
                  <span>
                    <span className="om-mono om-formula">{formula}</span>
                    <span className="om-note-text">{rangeNote}</span>
                  </span>
                </div>
                </>}
                </div>
              </div>
          <button
            type="button"
            className="om-reset"
            onClick={() => {
              try {
                window.localStorage.removeItem(STORAGE_KEY);
                window.localStorage.removeItem("waves:lab:v1");
                window.localStorage.removeItem("waves:rt-view");
                window.history.replaceState(null, "", window.location.pathname + window.location.search);
              } catch {
                /* ignore */
              }
              window.location.reload();
            }}
          >
            {t.reset}
          </button>
        </aside>

        {/* ───────── Results ───────── */}
        <section className="om-results" key={`flash-${flash}`}>
          <div className="om-card om-hero om-enter" style={{ "--d": "180ms", "--tone": "var(--om-ref)" } as CSSProperties}>
            <Ring value={shown.R} color="var(--om-ref)" />
            <div>
              <div className="om-hero-label">{t.reflected} · R</div>
              <div className="om-hero-value">
                {fmt.pct(shown.R)}
                <small>%</small>
              </div>
              <div className="om-hero-sub om-mono">{fmt.num(shownRdB, 2)} dB</div>
            </div>
          </div>
          <div className="om-card om-hero om-enter" style={{ "--d": "230ms", "--tone": "var(--om-tra)" } as CSSProperties}>
            <Ring value={shown.T} color="var(--om-tra)" />
            <div>
              <div className="om-hero-label">{t.transmitted} · T</div>
              <div className="om-hero-value">
                {fmt.pct(shown.T)}
                <small>%</small>
              </div>
              <div className="om-hero-sub om-mono">{shownTdB < -150 ? "< −150" : fmt.num(shownTdB, 2)} dB</div>
            </div>
          </div>
          <div className="om-card om-budget om-enter" style={{ "--d": "280ms" } as CSSProperties}>
            <div className="om-budget-head">
              <span className="om-hero-label">{t.energy}</span>
              <span className="om-budget-note om-mono">{t.energyNote}</span>
            </div>
            <div className="om-bar" role="img" aria-label={`R ${fmt.pct(shown.R)}%, A ${fmt.pct(shown.A)}%, T ${fmt.pct(shown.T)}%`}>
              <span style={{ width: `${shown.R * 100}%`, background: "var(--om-ref)" }} />
              {/* profiled wall: only the total absorption is known */}
              {profiled && <span style={{ width: `${shown.A * 100}%`, background: "var(--om-abs)" }} />}
              {!profiled && res.layers.map((r, i) => (
                <span
                  key={sim.layers[i].id}
                  className="om-bar-abs"
                  title={`${i + 1} · ${matName(sim.layers[i].mat)} · ${fmt.pct(r.absorbed)} %`}
                  style={{ width: `${r.absorbed * 100}%`, "--tint": matTint(sim.layers[i].mat) } as CSSProperties}
                />
              ))}
              <span style={{ width: `${shown.T * 100}%`, background: "var(--om-tra)" }} />
            </div>
            <div className="om-budget-legend">
              <div><i style={{ background: "var(--om-ref)" }} />{t.reflected}<b>{fmt.pct(shown.R)} %</b></div>
              <div><i style={{ background: "var(--om-abs)" }} />{t.absorbed}<b>{fmt.pct(shown.A)} %</b></div>
              <div><i style={{ background: "var(--om-tra)" }} />{t.transmitted}<b>{fmt.pct(shown.T)} %</b></div>
            </div>
            {sim.layers.length > 1 && !profiled && (
              <div className="om-budget-layers">
                {res.layers.map((r, i) => (
                  <button key={sim.layers[i].id} type="button" className={i === sim.sel ? "is-on" : ""} onClick={() => select(i)}
                    style={{ "--tint": matTint(sim.layers[i].mat) } as CSSProperties}>
                    <i />
                    <span>{i + 1} · {matName(sim.layers[i].mat)}</span>
                    <b className="om-mono">{fmt.pct(r.absorbed)} %</b>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="om-stats">
            <div className="om-stats-head">
              <span className="om-layer-idx is-sm" style={{ "--tint": matTint(selL.mat) } as CSSProperties}>{sim.sel + 1}</span>
              {tpl(t.statsFor, { m: matName(selL.mat), d: fmt.num(selL.thickness, selL.thickness < 1 ? 2 : 1) })}
            </div>
            <Stat delay={320} label={t.thetaT} value={fmt.num(selR.thetaT, 1)} unit="°" tone="var(--om-tra)"
              sub={tpl(t.thetaTSub, { v: fmt.num(sim.angle, 1) })} />
            <Stat delay={350} label={t.brewster} value={Number.isFinite(selR.brewster) ? fmt.num(selR.brewster, 1) : "—"} unit="°" tone="var(--om-acc)"
              sub={selL.mat === "air" ? t.airNote : tpl(t.brewsterSub, { v: fmt.num(selR.brewsterLossless, 1) })} />
            <details className="om-more">
              <summary>{t.moreProps}</summary>
              <div className="om-more-grid">
            <Stat delay={380} label={t.epsR} value={fmt.num(selR.epsR, 3)} sub={tpl(t.epsRSub, { v: fmt.sig(selR.epsI, 3) })} />
            <Stat delay={410} label={t.sigma} value={fmt.sig(selR.sigma, 3)} unit="S/m"
              sub={selDef ? `${fmt.sig(selDef.c, 4)} · f^${fmt.sig(selDef.d, 4)}` : selL.mat === "air" ? t.airNote : t.customRange} />
            <Stat delay={440} label={t.tanD} value={fmt.sig(selR.tanD, 3)} sub={t.tanDSub} tone="var(--om-abs)" />
            <Stat delay={470} label={t.atten} value={fmt.sig(selR.alphaDbM, 3)} unit="dB/m" tone="var(--om-abs)"
              sub={tpl(t.attenSub, { v: fmt.sig(selR.lossDb, 3) })} />
              </div>
            </details>
            <Stat delay={500} label={t.tdb} value={shownTdB < -150 ? "< −150" : fmt.num(shownTdB, 2)} unit="dB" tone="var(--om-tra)"
              sub={tpl(t.tdbSub, { v: fmt.num(shownRdB, 2) })} />
            <Stat delay={530} label={t.index} value={fmt.num(selR.nRe, 3)} tone="var(--om-inc)"
              sub={tpl(t.indexSub, { a: fmt.len(selR.lambda), b: fmt.len(res.lambda0) })} />
          </div>
        </section>

        {/* ───────── Charts ───────── */}
        <section className="om-charts">
          <div className="om-card om-chart om-enter" style={{ "--d": "380ms" } as CSSProperties}>
            <div className="om-chart-head">
              <div>
                <h2>{t.chartAngle}</h2>
                <p>{t.chartAngleHint}{profiled ? (lang === "fr" ? " · mur plan" : " · flat wall") : ""}</p>
              </div>
              <div className="om-chart-legend">
                <span className="om-leg"><i style={{ background: "var(--om-ref)" }} />R</span>
                <span className="om-leg"><i style={{ background: "var(--om-tra)" }} />T</span>
                <span className="om-leg om-leg-dash"><i />{sim.pol === "AVG" ? "TE / TM" : sim.pol === "TE" ? "TM" : "TE"}</span>
                <button type="button" className="om-scene-toggle" title={t.exportCsvTitle} onClick={downloadSweepCsv}>
                  {t.exportCsv}
                </button>
              </div>
            </div>
            <div className="om-chart-body">
              <AngleChart
                sweep={sweep}
                pol={sim.pol}
                angle={sim.angle}
                brewster={Number.isFinite(selR.brewster) ? selR.brewster : -1}
                pal={pal}
                labels={{ R: "R", T: "T" }}
                onAngle={(a) => update("angle", a)}
                fmtNum={fmt.num}
              />
            </div>
          </div>
          <div className="om-card om-chart om-enter" style={{ "--d": "440ms" } as CSSProperties}>
            <div className="om-chart-head">
              <div>
                <h2>{t.chartField}</h2>
                <p>{t.chartFieldHint} · {polLabel}{profiled ? (lang === "fr" ? " · mur plan" : " · flat wall") : ""}</p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Segmented<"lin" | "db">
                  size="sm"
                  ariaLabel="Scale"
                  value={fieldScale}
                  onChange={setFieldScale}
                  options={[
                    { value: "lin", label: t.linear },
                    { value: "db", label: t.db },
                  ]}
                />
                <button type="button" className="om-scene-toggle" title={t.exportCsvTitle} onClick={downloadFieldCsv}>
                  {t.exportCsv}
                </button>
              </div>
            </div>
            <div className="om-chart-body">
              <FieldChart
                etas={res.etas}
                ds={res.ds}
                freq={sim.freq}
                angle={sim.angle}
                pol={sim.pol}
                scaleMode={fieldScale}
                pal={pal}
                bands={bands}
                labels={{ air: t.air }}
                fmtNum={fmt.num}
              />
            </div>
          </div>
        </section>
        <SurfaceLab detailTarget={sceneView === "lab" ? detailHost : null} freq={sim.freq} angle={sim.angle} pol={sim.pol} lang={lang} pal={pal} playing={playing} fmtNum={fmt.num} onFreq={(f) => update("freq", f)} onAngle={(a) => update("angle", a)} onSceneSurface={setSceneSurface} />
      </main>

      <footer className="om-foot">
        <p>{t.model}</p>
        <p className="om-kbd">{t.shortcuts}</p>
      </footer>

      {showHelp && (
        <div className="om-help-backdrop" onClick={() => setShowHelp(false)}>
          <div
            className="om-help"
            role="dialog"
            aria-modal="true"
            aria-label={t.helpTitle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="om-help-head">
              <h2>{t.helpTitle}</h2>
              <button type="button" className="om-scene-toggle" onClick={() => setShowHelp(false)} autoFocus>
                {t.helpClose}
              </button>
            </div>
            <ul>
              {(
                [
                  ["Space", t.scPlay],
                  ["← →", t.scAngle],
                  ["↑ ↓", t.scLayer],
                  ["Alt + ← →", t.scMoveLayer],
                  ["Alt + ↑ ↓", t.scThickness],
                  ["V", t.scView],
                  ["1 2 3", t.scDisplay],
                  ["P", t.present],
                  ["L", t.language],
                  ["T", t.theme],
                  ["?", t.scHelp],
                  ["Esc", t.exitPresent],
                ] as Array<[string, string]>
              ).map(([key, label]) => (
                <li key={key}>
                  <kbd>{key}</kbd>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showAbout && (
        <div className="om-help-backdrop om-about-backdrop" onClick={() => setShowAbout(false)}>
          <div
            className="om-about"
            role="dialog"
            aria-modal="true"
            aria-label={t.aboutTitle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="om-about-head">
              <span className="om-about-mark">
                <Logo />
              </span>
              <div className="om-about-id">
                <h2>WaveS</h2>
                <p>{t.tagline}</p>
              </div>
              <button
                type="button"
                className="om-about-close"
                aria-label={t.helpClose}
                title={t.helpClose}
                onClick={() => setShowAbout(false)}
                autoFocus
              >
                ×
              </button>
            </div>

            <section className="om-about-sec" aria-label={t.modelLabel}>
              <div className="om-about-sec-head">
                <span className="om-about-label">{t.modelLabel}</span>
                <span className="om-model-ref">ITU-R P.2040 § 3</span>
              </div>
              <div className="om-eqs">
                  <Eq tex={String.raw`\varepsilon_r = \varepsilon' - j\,\frac{17.98\,\sigma}{f},\qquad \eta = \frac{\eta_0}{\sqrt{\varepsilon_r}}`} />
                  <Eq tex={String.raw`n_1 \sin\theta_1 = n_2 \sin\theta_2`} />
                  <Eq tex={String.raw`r = \frac{\eta_2 \cos\theta_1 - \eta_1 \cos\theta_2}{\eta_2 \cos\theta_1 + \eta_1 \cos\theta_2}`} />
              </div>
              <details className="om-model-more">
                <summary>{lang === "fr" ? "Hypothèses du modèle" : "Model assumptions"}</summary>
                <p>{t.modelNote}</p>
              </details>
            </section>

            <section className="om-about-sec" aria-label={t.authorLabel}>
              <div className="om-about-credit">
                <div>
                  <span className="om-about-label">{t.authorLabel}</span>
                  <strong>{t.author}</strong>
                </div>
                <div>
                  <span className="om-about-label">{t.schoolLabel}</span>
                  <strong>{t.school}</strong>
                </div>
              </div>
              <div className="om-about-links">
                {CONTACT_EMAILS.map((c) => (
                  <a key={c.address} className="om-about-link" href={`mailto:${c.address}`} title={`${t.contactTitle} · ${c.address}`}>
                    {Icon.mail}
                    <span>{t[c.labelKey]}</span>
                  </a>
                ))}
                <a className="om-about-link" href={REPO_URL} target="_blank" rel="noopener noreferrer" title={t.repoTitle}>
                  {Icon.github}
                  <span>GitHub</span>
                </a>
              </div>
            </section>

            <button type="button" className="om-about-build" onClick={onBuildTap} title={buildInfo}>
              {buildInfo}
            </button>
          </div>
        </div>
      )}
      <PerfHud enabled={perfOn} />
    </div>
  );
}

export default App;
