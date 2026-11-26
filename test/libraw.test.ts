// The LibRaw session's worker: ending it fails the call in progress and any
// after, so an abandoned decode doesn't wait on LibRaw.

import { afterEach, describe, expect, it, vi } from "vitest";
import { LibRawWorker } from "../src/libraw";
import { appRuntime } from "../src/runtime";
import { fakeApi } from "./support/fake-api";

class SilentWorker {
  static made: SilentWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  constructor() {
    SilentWorker.made.push(this);
  }

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  SilentWorker.made = [];
});

describe("LibRawWorker", () => {
  it("ends the worker at once on dispose, failing the call it has and any after", async () => {
    vi.stubGlobal("Worker", SilentWorker);
    const lr = new LibRawWorker("app://test/worker.js");
    const opening = lr.open(new Uint8Array(4));
    await Promise.resolve();
    expect(SilentWorker.made[0].posted).toHaveLength(1);
    lr.dispose();
    expect(SilentWorker.made[0].terminated).toBe(true);
    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    await expect(lr.metadata()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("answers a call with the worker's reply", async () => {
    vi.stubGlobal("Worker", SilentWorker);
    const lr = new LibRawWorker("app://test/worker.js");
    const meta = lr.metadata();
    await Promise.resolve();
    SilentWorker.made[0].onmessage?.(new MessageEvent("message", { data: { id: 1, out: { width: 8 } } }));
    await expect(meta).resolves.toEqual({ width: 8 });
  });
});

describe("the app runtime", () => {
  it("starts LibRaw from the file the extension asks the app for", () => {
    const urls: unknown[] = [];
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = null;
        onerror = null;
        constructor(url: unknown) {
          urls.push(url);
        }
        terminate() {}
      },
    );
    appRuntime(fakeApi().api).libraw().dispose();
    expect(urls).toEqual(["asset://pixel-shift-merge/dist/libraw/worker.js"]);
  });
});

describe("LibRawWorker failures", () => {
  it("reports a worker that fails to load as transient, LibRaw's own errors as they are, and its OOM as transient", async () => {
    vi.stubGlobal("Worker", SilentWorker);
    const lr = new LibRawWorker("app://test/worker.js");
    const a = lr.metadata();
    await Promise.resolve();
    SilentWorker.made[0].onmessage?.(new MessageEvent("message", { data: { id: 1, error: "Unsupported file format" } }));
    await expect(a).rejects.not.toMatchObject({ transient: true });
    const b = lr.metadata();
    await Promise.resolve();
    await Promise.resolve();
    SilentWorker.made[0].onmessage?.(new MessageEvent("message", { data: { id: 2, error: "Aborted(OOM)" } }));
    await expect(b).rejects.toMatchObject({ transient: true });
    const c = lr.metadata();
    await Promise.resolve();
    await Promise.resolve();
    SilentWorker.made[0].onerror?.({ message: "Failed to fetch worker script" });
    await expect(c).rejects.toMatchObject({ transient: true });
  });
});
