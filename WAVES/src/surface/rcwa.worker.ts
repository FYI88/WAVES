import { runJob, type RcwaJob, type RcwaReply } from "./rcwaJobs";

// The project compiles with the DOM lib only, so the worker scope is typed locally.
const scope = self as unknown as {
  postMessage(message: RcwaReply): void;
  addEventListener(type: "message", listener: (event: MessageEvent<RcwaJob>) => void): void;
};

scope.addEventListener("message", (event) => {
  const job = event.data;
  try {
    scope.postMessage({ id: job.id, ok: true, result: runJob(job) });
  } catch (error) {
    scope.postMessage({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
