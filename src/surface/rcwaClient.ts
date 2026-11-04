import { runJob, type RcwaJob, type RcwaReply } from "./rcwaJobs";
import type { RcwaResult, RcwaSweep } from "./rcwa";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RcwaRequest = DistributiveOmit<RcwaJob, "id">;

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (value: RcwaResult | RcwaSweep) => void; reject: (error: Error) => void }>();

function getWorker(): Worker | null {
  if (broken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./rcwa.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<RcwaReply>) => {
      const reply = event.data;
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id);
      if (reply.ok) entry.resolve(reply.result);
      else entry.reject(new Error(reply.error));
    };
    worker.onerror = () => {
      broken = true;
      worker = null;
      pending.forEach((entry) => entry.reject(new Error("RCWA worker failed")));
      pending.clear();
    };
  } catch {
    broken = true;
    worker = null;
  }
  return worker;
}

function run(request: RcwaRequest): Promise<RcwaResult | RcwaSweep> {
  const job = { ...request, id: nextId++ } as RcwaJob;
  const w = getWorker();
  if (!w) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(runJob(job));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, 0);
    });
  }
  return new Promise((resolve, reject) => {
    pending.set(job.id, { resolve, reject });
    w.postMessage(job);
  });
}

export const rcwaPoint = (request: Extract<RcwaRequest, { kind: "point" }>) => run(request) as Promise<RcwaResult>;
export const rcwaSweep = (request: Extract<RcwaRequest, { kind: "angle" | "freq" }>) => run(request) as Promise<RcwaSweep>;
