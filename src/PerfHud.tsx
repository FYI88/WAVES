import { useEffect, useState } from "react";
import { readPerf, type PerfStats } from "./perf";

export function PerfHud({ enabled }: { enabled: boolean }) {
  const [stats, setStats] = useState<PerfStats | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => setStats(readPerf());
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [enabled]);

  if (!enabled) return null;

  const idle = stats?.idle ?? true;
  return (
    <div className="om-perf" aria-hidden="true">
      <span>{stats && stats.fps ? `${stats.fps.toFixed(0)} fps` : "- fps"}</span>
      <span>p95 {stats && stats.p95 ? `${stats.p95.toFixed(1)} ms` : "-"}</span>
      <span>DPR {stats ? stats.dpr.toFixed(2) : "-"}</span>
      <span>{stats && stats.width ? `${stats.width}x${stats.height}` : "-"}</span>
      <span className={idle ? "is-idle" : undefined}>{idle ? "idle" : "live"}</span>
    </div>
  );
}
