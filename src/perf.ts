const SAMPLE_LIMIT = 120;

interface FrameMeta {
  dpr: number;
  width: number;
  height: number;
}

export interface PerfStats {
  fps: number;
  p95: number;
  dpr: number;
  width: number;
  height: number;
  idle: boolean;
}

const state = {
  samples: [] as number[],
  meta: { dpr: 1, width: 0, height: 0 } as FrameMeta,
  lastAt: 0,
};

export function resetPerf(): void {
  state.samples.length = 0;
  state.lastAt = 0;
}

export function recordFrame(ms: number, meta?: FrameMeta): void {
  if (!Number.isFinite(ms) || ms <= 0 || ms > 200) return;
  state.samples.push(ms);
  if (state.samples.length > SAMPLE_LIMIT) state.samples.shift();
  if (meta) state.meta = meta;
  state.lastAt = performance.now();
}

export function readPerf(): PerfStats {
  const { samples, meta, lastAt } = state;
  const count = samples.length;
  const sum = samples.reduce((total, value) => total + value, 0);
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = count ? sorted[Math.min(count - 1, Math.floor(count * 0.95))] : 0;
  return {
    fps: sum ? 1000 / (sum / count) : 0,
    p95,
    dpr: meta.dpr,
    width: meta.width,
    height: meta.height,
    idle: performance.now() - lastAt > 500,
  };
}
