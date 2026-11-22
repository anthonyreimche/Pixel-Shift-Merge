// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// Reads frames' sensor data and the camera's details with the LibRaw build
// this extension ships (libraw-wasm, copied into dist/libraw by
// scripts/copy-libraw.mjs). Safelight's own decoder hands extensions no sensor
// data and can't pick a pixel-shift file's frames. The wasm runs in a worker
// of its own; calls on it go one at a time.

import { mayPass, transientError } from "./errors";
import { EXT_ID } from "./options";

declare const __EXT_VERSION__: string;

/** A file under the installed extension's folder. import.meta.url is
 *  undefined in an installed extension's module, so the URL is built the way
 *  core's loader builds it, cache-busted by the version. */
export function assetUrl(rel: string): string {
  const v = typeof __EXT_VERSION__ === "string" ? __EXT_VERSION__ : "";
  return `${location.origin}/__plugins__/${EXT_ID}/${rel}${v ? `?v=${encodeURIComponent(v)}` : ""}`;
}

/** LibRaw's whole sensor readout: the visible area sits at the margins. */
export interface Readout {
  rawWidth: number;
  rawHeight: number;
  top: number;
  left: number;
  width: number;
  height: number;
  data: Uint16Array<ArrayBuffer>;
}

/** What the decoder asks of LibRaw. */
export interface LibRawSession {
  /** Opens a copy of `bytes` (the caller keeps them). Reads the header only. */
  open(bytes: Uint8Array): Promise<void>;
  /** Unpacks the open file's raw image. */
  readout(): Promise<Readout | null>;
  /** The open file's details, LibRaw's `metadata(true)`. */
  metadata(): Promise<unknown>;
  /** Ends the session at once: a call in progress fails. */
  dispose(): void;
}

type Reply = { id?: number; out?: unknown; error?: string };

const ended = () => new DOMException("The LibRaw session was ended.", "AbortError");

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A LibRaw instance in its own worker. */
export class LibRawWorker implements LibRawSession {
  private readonly worker: Worker;
  private chain: Promise<unknown> = Promise.resolve();
  private next = 0;
  /** Fails the call the worker has, when the session ends under it. */
  private failPending: ((e: Error) => void) | null = null;
  private ended = false;

  constructor(url = assetUrl("dist/libraw/worker.js")) {
    this.worker = new Worker(url, { type: "module" });
  }

  private call(fn: string, args: unknown[]): Promise<unknown> {
    const run = () =>
      new Promise<unknown>((resolve, reject) => {
        if (this.ended) {
          reject(ended());
          return;
        }
        const id = ++this.next;
        this.failPending = reject;
        const settle = (answer: () => void) => {
          this.failPending = null;
          answer();
        };
        this.worker.onmessage = ({ data }: MessageEvent<Reply>) =>
          settle(() => {
            if (!data?.error) resolve(data?.out);
            else reject(mayPass(data.error) ? transientError(`LibRaw: ${data.error}`) : new Error(`LibRaw: ${data.error}`));
          });
        this.worker.onerror = (e) => settle(() => reject(transientError(e.message || "the LibRaw worker failed")));
        this.worker.postMessage({ id, fn, args });
      });
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  async open(bytes: Uint8Array): Promise<void> {
    await this.call("open", [bytes, {}]);
  }

  async readout(): Promise<Readout | null> {
    const r: unknown = await this.call("rawImageData", []);
    if (typeof r !== "object" || r === null) return null;
    // The worker's answer: a plain object whose fields are checked one by one.
    const o = r as Record<string, unknown>;
    const data = o.data;
    if (!(data instanceof Uint16Array) || !(data.buffer instanceof ArrayBuffer)) return null;
    return {
      rawWidth: num(o.raw_width),
      rawHeight: num(o.raw_height),
      top: num(o.top_margin),
      left: num(o.left_margin),
      width: num(o.width),
      height: num(o.height),
      data: new Uint16Array(data.buffer, data.byteOffset, data.length),
    };
  }

  metadata(): Promise<unknown> {
    return this.call("metadata", [true]);
  }

  /** Ends the worker at once, its wasm memory with it; the call it has and
   *  any after fail with an AbortError. */
  dispose(): void {
    if (this.ended) return;
    this.ended = true;
    this.worker.terminate();
    this.failPending?.(ended());
    this.failPending = null;
  }
}
