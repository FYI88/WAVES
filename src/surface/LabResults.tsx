import type { CSSProperties } from "react";
import type { PolMode } from "../physics";
import type { LabLayer, LabMode } from "./labState";
import type { ProfileParams } from "./profiles";
import type { SurfaceMaterialId } from "./materials";
import { LAB_TEXT, MATERIAL_NAMES, PROFILE_NAMES } from "./labText";
import { Icon } from "../ui/icons";
import { Ring } from "../ui/Ring";

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
  const energies = [["R", t.reflected, p.R, "ref"], ["T", t.transmitted, p.T, "tra"], ["A", t.absorbed, Math.max(0, p.A), "abs"]] as const;
  const total = energies.reduce((sum, [, , value]) => sum + value, 0);
  const db = (value: number) => value <= 0 || 10 * Math.log10(value) < -150 ? "< −150" : p.fmtNum(10 * Math.log10(value), 2);
  return <article className="om-lab-results" data-current={current ? "true" : "false"}>
    <header className="om-lab-report-header">
      <div className="om-lab-report-kicker">
        <span>{t.resultSheet}</span>
        <span className="om-mono" aria-label={`${t.mode}: ${p.mode === "fast" ? t.fast : t.rigorous}`}>{p.mode === "fast" ? "EMT" : "RCWA"}</span>
      </div>
      <h2>{t.title}</h2>
      <dl className="om-lab-conditions">
        <div><dt aria-label={t.frequency}>f</dt><dd>{p.fmtNum(p.freq, 2)}<small> GHz</small></dd></div>
        <div><dt aria-label={t.angle}>θ</dt><dd>{p.fmtNum(p.angle, 1)}<small>°</small></dd></div>
        <div><dt>{t.polarization}</dt><dd>{p.pol === "AVG" ? <abbr title={t.avg}>AVG</abbr> : p.pol}</dd></div>
      </dl>
      <div className="om-lab-result-status" role="status" aria-live="polite" aria-busy={p.busy}>
        {!current && <p className="om-lab-warning">{Icon.info}<span>{p.source === "previous" ? t.previousResult : t.emtPreview}</span></p>}
        {p.busy && <p>{t.computing}</p>}
        {p.sweepBusy && <p>{t.sweepAxis} · {t.computing}</p>}
        {p.error && <p className="om-lab-warning">{Icon.warn}<span>{t.error}: {p.error}</span></p>}
        {p.sweepError && <p className="om-lab-warning">{Icon.warn}<span>{t.error} · {t.sweepAxis}: {p.sweepError}</span></p>}
      </div>
    </header>

    <section className="om-lab-energy-sheet" aria-label={current ? t.energyBalance : p.source === "previous" ? t.previousResult : t.emtPreview}>
        {energies.slice(0, 2).map(([key, label, value, tone]) =>
          <div className="om-card om-hero" key={key} style={{ "--tone": `var(--om-${tone})` } as CSSProperties}>
            <Ring value={value} color={`var(--om-${tone})`} />
            <div>
              <div className="om-hero-label">{label} · {key}</div>
              <div className="om-hero-value">{p.fmtNum(value * 100, value * 100 < 10 ? 2 : 1)}<small>%</small></div>
              <div className="om-hero-sub om-mono">{db(value)} dB</div>
            </div>
          </div>)}
      <div className="om-card om-budget">
        <div className="om-budget-head"><span className="om-hero-label">{t.energyBalance}</span><span className="om-budget-note om-mono">R + T + A = {pct(total)}</span></div>
        <div className="om-bar" role="img" aria-label={energies.map(([key, , value]) => `${key} ${pct(value)}`).join(", ")}>
          {energies.map(([key, , value, tone]) => <span key={key} style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%`, background: `var(--om-${tone})` }} />)}
        </div>
        <div className="om-budget-legend">
          {energies.map(([key, label, value, tone]) => <div key={key}><i style={{ background: `var(--om-${tone})` }} />{label}<b>{pct(value)}</b></div>)}
        </div>
      </div>
    </section>

    <section className="om-lab-report-section" aria-label={t.configuration}>
      <h3>{t.configuration}</h3>
      <dl className="om-lab-kv">
        <div><dt>{t.profile}</dt><dd>{PROFILE_NAMES[p.profile.id][p.lang]}</dd></div>
        <div><dt>{t.material}</dt><dd>{MATERIAL_NAMES[p.material][p.lang]}</dd></div>
        {p.profile.id !== "flat" && <div><dt>{t.period}</dt><dd className="om-mono">{p.fmtNum(p.profile.period, 2)} cm</dd></div>}
        <div><dt>{p.profile.id === "flat" ? t.slabDepth : t.depth}</dt><dd className="om-mono">{p.fmtNum(p.profile.depth, 2)} cm</dd></div>
      </dl>
      <div className="om-lab-backing">
        <h4>{t.backing}</h4>
        {p.below.length ? <ol className="om-lab-layer-list">{p.below.map((layer, index) =>
          <li key={index}><div className="om-lab-layer-row"><span>{MATERIAL_NAMES[layer.material][p.lang]}</span><span className="om-mono">{p.fmtNum(layer.cm, 2)} cm</span></div></li>)}
        </ol> : <p>{t.airBacking}</p>}
      </div>
      {p.outOfRange && <p className="om-lab-warning">{Icon.warn}<span>{p.lang === "fr" ? "Matériau hors du domaine UIT-R P.2040" : "Material outside the ITU-R P.2040 range"}</span></p>}
    </section>

    <section className="om-lab-report-section" aria-label={t.mode}>
      <dl className="om-lab-kv">
        <div><dt>{t.mode}</dt><dd>{p.mode === "fast" ? t.fast : t.rigorous}</dd></div>
        <div><dt>{t.validity}</dt><dd><span className="om-lab-validity" data-state={p.validity}>{p.validity !== "ok" && Icon.warn}{t.valid[p.validity]}</span></dd></div>
        {p.mixValidity && <div><dt>{t.mixValidity}</dt><dd><span className="om-lab-validity" data-state={p.mixValidity}>{p.mixValidity !== "ok" && Icon.warn}{t.valid[p.mixValidity]}</span></dd></div>}
      </dl>
      <details className="om-lab-calculation-details">
        <summary>{t.numericalDetails}{Icon.chevron}</summary>
        <dl className="om-lab-kv">
          <div><dt>{t.slices}</dt><dd className="om-mono">{p.slices}</dd></div>
          {p.mode === "rigorous" && <div><dt>{t.harmonics}</dt><dd className="om-mono">{p.harmonics}</dd></div>}
        </dl>
        <p>{p.mode === "fast" ? t.fastHint : t.rigorousHint}</p>
      </details>
    </section>

    {p.fog && <section className="om-lab-report-section" aria-label={t.link}>
      <h3>{t.link}</h3>
      <dl className="om-lab-kv">
        <div><dt>{t.reflected} · R</dt><dd className="om-mono">{pct(p.fog.R)}</dd></div>
        <div><dt>{t.transmitted} · T</dt><dd className="om-mono">{pct(p.fog.T)}</dd></div>
        <div><dt>{t.fogLoss}</dt><dd className="om-mono">{p.fmtNum(p.fog.lossDb, 3)} dB</dd></div>
      </dl>
    </section>}
  </article>;
}
