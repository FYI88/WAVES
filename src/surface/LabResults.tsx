import type { CSSProperties } from "react";
import type { PolMode } from "../physics";
import type { LabLayer, LabMode } from "./labState";
import type { ProfileParams } from "./profiles";
import type { SurfaceMaterialId } from "./materials";
import { LAB_TEXT, MATERIAL_NAMES, PROFILE_NAMES } from "./labText";

/** Display only: all values come directly from the mounted SurfaceLab. */
export function LabResults(p: {
  lang: "fr" | "en"; fmtNum: (v: number, digits?: number) => string;
  R: number; T: number; A: number; freq: number; angle: number; pol: PolMode;
  profile: ProfileParams; material: SurfaceMaterialId; below: LabLayer[]; mode: LabMode;
  harmonics: number; slices: number;
  source: "emt" | "rcwa" | "previous" | "preview";
  validity: "ok" | "marginal" | "invalid"; mixValidity: "ok" | "marginal" | "invalid" | null;
  outOfRange: boolean; busy: boolean; sweepBusy: boolean; error: string | null; sweepError: string | null;
  fog: { R: number; T: number; lossDb: number } | null;
}) {
  const t = LAB_TEXT[p.lang];
  const pct = (v: number) => `${p.fmtNum(v * 100, v * 100 < 10 ? 2 : 1)} %`;
  const current = p.source === "emt" || p.source === "rcwa";
  return <div className="om-lab-results">
    <div className="om-card om-lab-summary">
      <h2>{t.title}</h2>
      <p className="om-mono">{p.fmtNum(p.freq, 2)} GHz · {p.fmtNum(p.angle, 1)}° · {p.pol === "AVG" ? `AVG · ${t.avg}` : p.pol}</p>
      <p>{p.mode === "fast" ? t.fast : t.rigorous}</p>
      <div role="status" aria-live="polite" aria-busy={p.busy}>
        {!current && <p className="om-lab-warning">{p.source === "previous" ? t.previousResult : t.emtPreview}</p>}
        {p.busy && <p>{t.computing}</p>}
        {p.sweepBusy && <p>{t.sweepAxis} · {t.computing}</p>}
        {p.error && <p className="om-lab-warning">{t.error}: {p.error}</p>}
        {p.sweepError && <p className="om-lab-warning">{t.error} · {t.sweepAxis}: {p.sweepError}</p>}
      </div>
    </div>
    <div className="om-card om-budget" role="group" aria-label={current ? t.title : p.source === "previous" ? t.previousResult : t.emtPreview}>
      <div className="om-budget-legend">
        {([["R", t.reflected, p.R, "ref"], ["T", t.transmitted, p.T, "tra"], ["A", t.absorbed, Math.max(0, p.A), "abs"]] as const).map(([key, label, value, tone]) =>
          <div key={key} style={{ "--tone": `var(--om-${tone})` } as CSSProperties}><i style={{ background: `var(--om-${tone})` }} />{label} · {key}<b className="om-mono">{pct(value)}</b></div>)}
      </div>
    </div>
    <div className="om-card om-lab-summary">
      <dl className="om-lab-kv">
        <dt>{t.profile}</dt><dd>{PROFILE_NAMES[p.profile.id][p.lang]}</dd>
        <dt>{t.material}</dt><dd>{MATERIAL_NAMES[p.material][p.lang]}</dd>
        {p.profile.id !== "flat" && <><dt>{t.period}</dt><dd>{p.fmtNum(p.profile.period, 2)} cm</dd></>}
        <dt>{p.profile.id === "flat" ? t.slabDepth : t.depth}</dt><dd>{p.fmtNum(p.profile.depth, 2)} cm</dd>
        <dt>{t.layersTitle}</dt><dd>{p.below.length ? p.below.map((l) => `${MATERIAL_NAMES[l.material][p.lang]} · ${p.fmtNum(l.cm, 2)} cm`).join(" / ") : t.noLayers}</dd>
        <dt>{t.validity}</dt><dd>{t.valid[p.validity]}</dd>
        <dt>{t.slices}</dt><dd>{p.slices}</dd>
        {p.mode === "rigorous" && <><dt>{t.harmonics}</dt><dd>{p.harmonics}</dd></>}
        {p.mixValidity && <><dt>{t.mixValidity}</dt><dd>{t.valid[p.mixValidity]}</dd></>}
      </dl>
      {p.outOfRange && <p className="om-lab-warning">{p.lang === "fr" ? "Matériau hors du domaine UIT-R P.2040" : "Material outside the ITU-R P.2040 range"}</p>}
      <p>{p.mode === "fast" ? t.fastHint : t.rigorousHint}</p>
      {p.fog && <><h3>{t.link}</h3><p className="om-mono">R {pct(p.fog.R)} · T {pct(p.fog.T)}</p><p>{t.fogLoss}: {p.fmtNum(p.fog.lossDb, 3)} dB</p></>}
    </div>
  </div>;
}
