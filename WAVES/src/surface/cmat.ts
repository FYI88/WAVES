import { cx, type Cx } from "../physics";

/* ════════════════════════════════════════════════════════════════════════
   Dense complex square matrices (row-major, split real / imaginary storage)
   Small and dependency-free: sized for RCWA with up to ~81 harmonics.
   ════════════════════════════════════════════════════════════════════════ */

export interface CMat {
  n: number;
  re: Float64Array;
  im: Float64Array;
}

export function cmZeros(n: number): CMat {
  return { n, re: new Float64Array(n * n), im: new Float64Array(n * n) };
}

export function cmEye(n: number): CMat {
  const m = cmZeros(n);
  for (let i = 0; i < n; i++) m.re[i * n + i] = 1;
  return m;
}

export function cmDiag(d: Cx[]): CMat {
  const n = d.length;
  const m = cmZeros(n);
  for (let i = 0; i < n; i++) {
    m.re[i * n + i] = d[i].re;
    m.im[i * n + i] = d[i].im;
  }
  return m;
}

export function cmCopy(a: CMat): CMat {
  return { n: a.n, re: a.re.slice(), im: a.im.slice() };
}

export function cmGet(a: CMat, i: number, j: number): Cx {
  const k = i * a.n + j;
  return cx(a.re[k], a.im[k]);
}

export function cmAdd(a: CMat, b: CMat): CMat {
  const out = cmZeros(a.n);
  for (let k = 0; k < a.re.length; k++) {
    out.re[k] = a.re[k] + b.re[k];
    out.im[k] = a.im[k] + b.im[k];
  }
  return out;
}

export function cmSub(a: CMat, b: CMat): CMat {
  const out = cmZeros(a.n);
  for (let k = 0; k < a.re.length; k++) {
    out.re[k] = a.re[k] - b.re[k];
    out.im[k] = a.im[k] - b.im[k];
  }
  return out;
}

/** α·A + β·B for real scalars α, β */
export function cmLin(a: CMat, alpha: number, b: CMat, beta: number): CMat {
  const out = cmZeros(a.n);
  for (let k = 0; k < a.re.length; k++) {
    out.re[k] = alpha * a.re[k] + beta * b.re[k];
    out.im[k] = alpha * a.im[k] + beta * b.im[k];
  }
  return out;
}

/** s·A for a complex scalar s */
export function cmScale(a: CMat, s: Cx): CMat {
  const out = cmZeros(a.n);
  for (let k = 0; k < a.re.length; k++) {
    const r = a.re[k];
    const i = a.im[k];
    out.re[k] = r * s.re - i * s.im;
    out.im[k] = r * s.im + i * s.re;
  }
  return out;
}

export function cmMul(a: CMat, b: CMat): CMat {
  const n = a.n;
  const out = cmZeros(n);
  const or = out.re;
  const oi = out.im;
  for (let i = 0; i < n; i++) {
    const ri = i * n;
    for (let k = 0; k < n; k++) {
      const xr = a.re[ri + k];
      const xi = a.im[ri + k];
      if (xr === 0 && xi === 0) continue;
      const rk = k * n;
      for (let j = 0; j < n; j++) {
        const yr = b.re[rk + j];
        const yi = b.im[rk + j];
        or[ri + j] += xr * yr - xi * yi;
        oi[ri + j] += xr * yi + xi * yr;
      }
    }
  }
  return out;
}

/** diag(d)·A (row scaling) */
export function cmDiagMul(d: Cx[], a: CMat): CMat {
  const n = a.n;
  const out = cmZeros(n);
  for (let i = 0; i < n; i++) {
    const dr = d[i].re;
    const di = d[i].im;
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const r = a.re[k];
      const m = a.im[k];
      out.re[k] = dr * r - di * m;
      out.im[k] = dr * m + di * r;
    }
  }
  return out;
}

/** A·diag(d) (column scaling) */
export function cmMulDiag(a: CMat, d: Cx[]): CMat {
  const n = a.n;
  const out = cmZeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const r = a.re[k];
      const m = a.im[k];
      out.re[k] = r * d[j].re - m * d[j].im;
      out.im[k] = r * d[j].im + m * d[j].re;
    }
  }
  return out;
}

/** 1-norm: maximum absolute column sum */
export function cmNorm1(a: CMat): number {
  const n = a.n;
  let best = 0;
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.hypot(a.re[i * n + j], a.im[i * n + j]);
    if (sum > best) best = sum;
  }
  return best;
}

function swapRows(re: Float64Array, im: Float64Array, n: number, i: number, j: number) {
  for (let c = 0; c < n; c++) {
    const a = i * n + c;
    const b = j * n + c;
    let t = re[a];
    re[a] = re[b];
    re[b] = t;
    t = im[a];
    im[a] = im[b];
    im[b] = t;
  }
}

/** Inverse by Gauss–Jordan elimination with partial pivoting. */
export function cmInv(a: CMat): CMat {
  const n = a.n;
  const mr = a.re.slice();
  const mi = a.im.slice();
  const out = cmEye(n);
  const xr = out.re;
  const xi = out.im;
  for (let c = 0; c < n; c++) {
    let p = c;
    let best = -1;
    for (let r = c; r < n; r++) {
      const v = mr[r * n + c] * mr[r * n + c] + mi[r * n + c] * mi[r * n + c];
      if (v > best) {
        best = v;
        p = r;
      }
    }
    if (!(best > 0)) throw new Error("cmInv: singular matrix");
    if (p !== c) {
      swapRows(mr, mi, n, p, c);
      swapRows(xr, xi, n, p, c);
    }
    const pr = mr[c * n + c];
    const pi = mi[c * n + c];
    const ir = pr / best;
    const ii = -pi / best;
    for (let j = 0; j < n; j++) {
      const k = c * n + j;
      let r = mr[k];
      let m = mi[k];
      mr[k] = r * ir - m * ii;
      mi[k] = r * ii + m * ir;
      r = xr[k];
      m = xi[k];
      xr[k] = r * ir - m * ii;
      xi[k] = r * ii + m * ir;
    }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const fr = mr[r * n + c];
      const fi = mi[r * n + c];
      if (fr === 0 && fi === 0) continue;
      for (let j = 0; j < n; j++) {
        const k = r * n + j;
        const kc = c * n + j;
        mr[k] -= fr * mr[kc] - fi * mi[kc];
        mi[k] -= fr * mi[kc] + fi * mr[kc];
        xr[k] -= fr * xr[kc] - fi * xi[kc];
        xi[k] -= fr * xi[kc] + fi * xr[kc];
      }
    }
  }
  return out;
}

/** log |det A| by LU with partial pivoting (−∞ when singular). */
export function cmLogAbsDet(a: CMat): number {
  const n = a.n;
  const mr = a.re.slice();
  const mi = a.im.slice();
  let log = 0;
  for (let c = 0; c < n; c++) {
    let p = c;
    let best = -1;
    for (let r = c; r < n; r++) {
      const v = mr[r * n + c] * mr[r * n + c] + mi[r * n + c] * mi[r * n + c];
      if (v > best) {
        best = v;
        p = r;
      }
    }
    if (!(best > 0)) return -Infinity;
    if (p !== c) swapRows(mr, mi, n, p, c);
    const pr = mr[c * n + c];
    const pi = mi[c * n + c];
    log += 0.5 * Math.log(best);
    for (let r = c + 1; r < n; r++) {
      const ar = mr[r * n + c];
      const ai = mi[r * n + c];
      if (ar === 0 && ai === 0) continue;
      const fr = (ar * pr + ai * pi) / best;
      const fi = (ai * pr - ar * pi) / best;
      for (let j = c; j < n; j++) {
        const k = r * n + j;
        const kc = c * n + j;
        mr[k] -= fr * mr[kc] - fi * mi[kc];
        mi[k] -= fr * mi[kc] + fi * mr[kc];
      }
    }
  }
  return log;
}

/** Matrix exponential: scaling and squaring with a (6,6) Padé approximant. */
export function cmExpm(a: CMat): CMat {
  const n = a.n;
  const norm = cmNorm1(a);
  const s = norm > 0.5 ? Math.max(0, Math.ceil(Math.log2(norm / 0.5))) : 0;
  const x = cmScale(a, cx(1 / 2 ** s));
  const q = 6;
  let c = 1;
  let term = cmEye(n);
  let num = cmEye(n);
  let den = cmEye(n);
  for (let k = 1; k <= q; k++) {
    c = (c * (q - k + 1)) / (k * (2 * q - k + 1));
    term = cmMul(term, x);
    num = cmLin(num, 1, term, c);
    den = cmLin(den, 1, term, k % 2 === 0 ? c : -c);
  }
  let e = cmMul(cmInv(den), num);
  for (let k = 0; k < s; k++) e = cmMul(e, e);
  return e;
}

/**
 * Principal square root and its inverse by the determinant-scaled
 * Denman–Beavers iteration. The input must have no eigenvalue on the closed
 * negative real axis.
 */
export function cmSqrtm(a: CMat, maxIter = 100): { root: CMat; invRoot: CMat } {
  const n = a.n;
  let y = cmCopy(a);
  let z = cmEye(n);
  let scaled = true;
  let prev = Infinity;
  for (let it = 0; it < maxIter; it++) {
    let mu = 1;
    if (scaled) {
      const ld = cmLogAbsDet(y) + cmLogAbsDet(z);
      if (Number.isFinite(ld)) mu = Math.exp(-ld / (2 * n));
    }
    const yInv = cmInv(y);
    const zInv = cmInv(z);
    const yNext = cmLin(y, mu / 2, zInv, 1 / (2 * mu));
    const zNext = cmLin(z, mu / 2, yInv, 1 / (2 * mu));
    const change = cmNorm1(cmSub(yNext, y)) / Math.max(1e-300, cmNorm1(yNext));
    y = yNext;
    z = zNext;
    if (change < 1e-2) scaled = false;
    if (change < 1e-14) break;
    if (!scaled && change < 1e-10 && change > prev / 2) break; // stagnated at rounding level
    prev = change;
  }
  return { root: y, invRoot: z };
}
