// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// What a decode runs on in the app: LibRaw in its worker, the merge in one of
// its own. Each decode starts both and ends them, so their memory goes back
// as soon as the photo is decoded.

import type { DecoderRuntime } from "./decoder";
import { transientError } from "./errors";
import type { MergeJob, MergeOutput, MergeReply } from "./job";
import { LibRawWorker } from "./libraw";
import MergeWorker from "./merge-worker?worker&inline";
import type { SafelightAPI } from "./safelight";

/** The buffers a job carries, each once, handed to the worker. */
function buffersOf(job: MergeJob): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  if (job.source.kind === "views") {
    for (const view of job.source.views) if (view.data.buffer instanceof ArrayBuffer) buffers.add(view.data.buffer);
  }
  return [...buffers];
}

export function mergeInWorker(job: MergeJob, signal: AbortSignal): Promise<MergeOutput> {
  let worker: Worker;
  try {
    worker = new MergeWorker({ name: "pixel-shift-merge" });
  } catch (e) {
    return Promise.reject(transientError(`the merge worker didn't start: ${e instanceof Error ? e.message : String(e)}`));
  }
  return new Promise<MergeOutput>((resolve, reject) => {
    const end = () => {
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      end();
      reject(new DOMException("The decode was no longer needed.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<MergeReply>) => {
      end();
      if ("output" in data) resolve(data.output);
      else reject(data.transient ? transientError(data.error) : new Error(data.error));
    };
    worker.onerror = (e) => {
      end();
      reject(transientError(e.message || "the merge worker failed"));
    };
    worker.postMessage(job, buffersOf(job));
  });
}

export const appRuntime = (api: SafelightAPI): DecoderRuntime => ({
  libraw: () => new LibRawWorker(api.assetUrl("dist/libraw/worker.js")),
  merge: mergeInWorker,
});
