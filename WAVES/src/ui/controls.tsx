import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { clamp } from "../render/util";
import { Icon } from "./icons";

/* ════════════════════════════════════════════════════════════════════════
   Control system shared by the main panel, the canvas frames and the
   Surface lab. Everything is styled through the --om-* tokens only.
   ════════════════════════════════════════════════════════════════════════ */

/* ── Slider ─────────────────────────────────────────────────────────── */

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  log?: boolean;
  unit?: string;
  digits?: number;
  /** CSS colour of the filled track; a wave colour token for wave parameters */
  accent?: string;
  onChange: (v: number) => void;
  ticks?: { v: number; label: string; tone?: "acc"; row?: 2 }[];
  hint?: ReactNode;
  fmtNum: (v: number, d?: number) => string;
  icon?: ReactNode;
}

export function Slider(props: SliderProps) {
  const { label, value, min, max, log, accent, onChange, ticks, hint, fmtNum, icon } = props;
  const step = props.step ?? 0.01;
  const unit = props.unit ?? "";
  const digits = props.digits ?? 2;
  const toPos = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (p: number) => {
    const v = log ? min * Math.pow(max / min, p) : min + p * (max - min);
    const q = Math.round(v / step) * step;
    return clamp(Number(q.toFixed(6)), min, max);
  };
  const pos = clamp(toPos(clamp(value, min, max)), 0, 1);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(",", "."));
    if (Number.isFinite(v)) onChange(clamp(Number((Math.round(v / step) * step).toFixed(6)), min, max));
    setDraft(null);
  };

  return (
    <div className="om-slider" style={{ "--acc": accent ?? "var(--om-ink-2)", "--pf": pos } as CSSProperties}>
      <div className="om-slider-head">
        <label className="om-label">
          {icon}
          {label}
        </label>
        <div className="om-value">
          <input
            className="om-value-input"
            inputMode="decimal"
            aria-label={label}
            value={draft ?? fmtNum(value, digits)}
            onFocus={(e) => {
              setDraft(fmtNum(value, digits));
              requestAnimationFrame(() => e.target.select());
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            style={{ width: `${Math.max(3, (draft ?? fmtNum(value, digits)).length) + 0.5}ch` }}
          />
          {unit && <span className="om-unit">{unit}</span>}
        </div>
      </div>
      <div className="om-range-wrap">
        <input
          type="range"
          className="om-range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(pos * 1000)}
          aria-label={label}
          aria-valuetext={`${fmtNum(value, digits)} ${unit}`}
          onChange={(e) => onChange(fromPos(Number(e.target.value) / 1000))}
          onKeyDown={(e) => {
            if (log && (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowDown")) {
              e.preventDefault();
              const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1;
              onChange(fromPos(clamp(pos + dir * 0.01, 0, 1)));
            }
          }}
        />
        <span className="om-bubble">
          {fmtNum(value, digits)} {unit}
        </span>
      </div>
      {ticks && (
        <div className={`om-ticks${ticks.some((t) => t.row === 2) ? " om-ticks-two-rows" : ""}`}>
          {ticks.map((t) => (
            <button
              key={`${t.label}-${t.v}`}
              type="button"
              className={`om-tick ${t.tone === "acc" ? "om-tick-acc" : ""}${t.row === 2 ? " om-tick-row-2" : ""} ${Math.abs(t.v - value) < step * 0.75 ? "is-on" : ""}`}
              style={{ left: `${clamp(toPos(t.v), 0, 1) * 100}%` }}
              onClick={() => onChange(clamp(t.v, min, max))}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {hint && <div className="om-hint">{hint}</div>}
    </div>
  );
}

/* ── Segmented control ──────────────────────────────────────────────── */

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: ReactNode; sub?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel: string;
}) {
  const { value, options, onChange, size = "md", ariaLabel } = props;
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      className={`om-seg om-seg-${size}`}
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ "--n": options.length, "--i": idx } as CSSProperties}
    >
      <span className="om-seg-thumb" aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`om-seg-btn ${o.value === value ? "is-on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          <span className="om-seg-label">{o.label}</span>
          {o.sub && <span className="om-seg-sub">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── Select ─────────────────────────────────────────────────────────── */

export function Select<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  const { value, options, onChange, ariaLabel } = props;
  return (
    <span className="om-select">
      <select
        value={String(value)}
        aria-label={ariaLabel}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="om-select-chev" aria-hidden>
        {Icon.down}
      </span>
    </span>
  );
}

/* ── Checkbox ───────────────────────────────────────────────────────── */

export function Check(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  const { checked, onChange, label, disabled } = props;
  return (
    <label className={`om-check ${disabled ? "is-disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="om-check-box" aria-hidden>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      </span>
      <span className="om-check-label">{label}</span>
    </label>
  );
}

/* ── Button ─────────────────────────────────────────────────────────── */

export function Button(props: {
  children?: ReactNode;
  onClick?: () => void;
  /** primary: the one main action; secondary: outlined; ghost: toolbar toggle; danger: destructive */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  icon?: ReactNode;
  block?: boolean;
  className?: string;
}) {
  const { children, onClick, variant = "secondary", size = "md", pressed, disabled, title, ariaLabel, icon, block, className } = props;
  return (
    <button
      type="button"
      className={`om-btn om-btn-${variant} om-btn-${size}${block ? " is-block" : ""}${pressed ? " is-on" : ""}${className ? ` ${className}` : ""}`}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── Collapsible section ────────────────────────────────────────────── */

export function Section(props: {
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { title, icon, meta, defaultOpen = false, children } = props;
  return (
    <details className="om-sec" open={defaultOpen}>
      <summary className="om-sec-head">
        <span className="om-sec-title">
          {icon}
          {title}
        </span>
        {meta && <span className="om-sec-meta">{meta}</span>}
        <span className="om-sec-chev" aria-hidden>
          {Icon.chevron}
        </span>
      </summary>
      <div className="om-sec-body">{children}</div>
    </details>
  );
}

/* ── Tabs ───────────────────────────────────────────────────────────── */

export function Tabs<T extends string>(props: {
  value: T;
  tabs: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  /** DOM id prefix: tab ids are `${idPrefix}-tab-${value}`, the panel is `${idPrefix}-panel` */
  idPrefix: string;
}) {
  const { value, tabs, onChange, ariaLabel, idPrefix } = props;
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].value);
    const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  };
  return (
    <div className="om-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, i) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.value}`}
          aria-selected={tab.value === value}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={tab.value === value ? 0 : -1}
          className={`om-tab ${tab.value === value ? "is-on" : ""}`}
          onClick={() => onChange(tab.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Legend (wave colours only) ─────────────────────────────────────── */

export type WaveKey = "inc" | "ref" | "tra" | "abs";

export function Legend(props: { items: { key: WaveKey | "neutral"; label: string; dash?: boolean }[] }) {
  return (
    <ul className="om-legend">
      {props.items.map((it) => (
        <li key={`${it.key}-${it.label}`} className={it.dash ? "is-dash" : ""}>
          <i style={{ "--k": it.key === "neutral" ? "var(--om-ink-3)" : `var(--om-${it.key})` } as CSSProperties} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/* ── Read-outs ──────────────────────────────────────────────────────── */

export function Readout(props: {
  items: { key: WaveKey; letter: string; name: string; value: string; unit?: string; sub?: string }[];
}) {
  return (
    <div className="om-readout">
      {props.items.map((it) => (
        <div key={it.letter} className="om-readout-item" style={{ "--k": `var(--om-${it.key})` } as CSSProperties}>
          <div className="om-readout-k">
            <b>{it.letter}</b>
            <span>{it.name}</span>
          </div>
          <div className="om-readout-v om-mono">
            {it.value}
            {it.unit && <small>{it.unit}</small>}
          </div>
          {it.sub && <div className="om-readout-sub om-mono">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function Stat(props: { label: string; value: string; unit?: string; sub?: string; tone?: string }) {
  return (
    <div className="om-stat" style={{ "--tone": props.tone ?? "var(--om-ink)" } as CSSProperties}>
      <div className="om-stat-label">{props.label}</div>
      <div className="om-stat-value om-mono">
        <span>{props.value}</span>
        {props.unit && <small>{props.unit}</small>}
      </div>
      {props.sub && <div className="om-stat-sub">{props.sub}</div>}
    </div>
  );
}
