// The decoder end to end on a synthetic PEF, with LibRaw stood in for by a
// fake that reads which frame the file points it at.

import { describe, expect, it } from "vitest";
import { pixelShiftDecoder, type DecoderRuntime } from "../src/decoder";
import { runMerge } from "../src/job";
import type { LibRawSession, Readout } from "../src/libraw";
import { DEFAULT_OPTIONS, type MergeOptions } from "../src/options";
import type { ImageDecodeRequest } from "../src/safelight";
import { bufferSource, findPixelShift, TAG } from "../src/tiff";
import { expected, frameOf, smooth } from "./support/scene";
import { pentaxPef, singleFrame, sonyArq } from "./support/tiff-builder";

const W = 32;
const H = 24;
const IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
const META = {
  camera_make: "Pentax",
  camera_model: "K-1",
  iso_speed: 100,
  filters: 0xb4b4b4b4,
  top_margin: 0,
  left_margin: 0,
  width: W,
  height: H,
  color_data: { black: 0, maximum: 65535, cam_mul: [2, 1, 1.5, 1], pre_mul: [2, 1, 1.5, 0], rgb_cam: IDENTITY },
};

interface Rig {
  runtime: DecoderRuntime;
  opened: number[];
  sessions: number;
  disposed: number;
}

/** A runtime whose LibRaw reads the frame the first frame's strip pointer
 *  names (the PEF builder fills frame k's strip with 0x10 + k), and whose
 *  merge runs in place. */
async function rig(): Promise<Rig> {
  const layout = await findPixelShift(bufferSource(pentaxPef(W, H).buffer as ArrayBuffer));
  if (layout?.kind !== "frames") throw new Error("no layout");
  const pointer = layout.frames[0].ifd.entries.get(TAG.stripOffsets);
  if (!pointer) throw new Error("no strip pointer");
  const frames = [0, 1, 2, 3].map((k) => frameOf(smooth, W, H, k));
  const state: Rig = {
    opened: [],
    sessions: 0,
    disposed: 0,
    runtime: {
      libraw: (): LibRawSession => {
        state.sessions++;
        let frame = -1;
        return {
          async open(bytes) {
            const offset = new DataView(bytes.buffer, bytes.byteOffset).getUint32(pointer.fieldAt, true);
            frame = bytes[offset] - 0x10;
            state.opened.push(frame);
          },
          async readout(): Promise<Readout> {
            return { rawWidth: W, rawHeight: H, top: 0, left: 0, width: W, height: H, data: frames[frame].slice() };
          },
          async metadata() {
            return META;
          },
          dispose() {
            state.disposed++;
          },
        };
      },
      merge: async (job) => runMerge(job),
    },
  };
  return state;
}

const request = (over: Partial<ImageDecodeRequest> = {}): ImageDecodeRequest => ({
  name: "IMGP0001.PEF",
  fullSize: true,
  background: false,
  signal: new AbortController().signal,
  ...over,
});

const decoder = (r: Rig, options: Partial<MergeOptions> = {}) => pixelShiftDecoder({ ...DEFAULT_OPTIONS, ...options }, "1.0.0+test", r.runtime);
const file = (bytes: Uint8Array) => new Blob([bytes.slice().buffer as ArrayBuffer]);

describe("pixelShiftDecoder", () => {
  it("reads PEF, DNG and ARQ, filed under its version", async () => {
    const d = decoder(await rig());
    expect(d.extensions).toEqual([".pef", ".dng", ".arq"]);
    expect(d.version).toBe("1.0.0+test");
  });

  it("answers null for a file that isn't pixel shift, without starting LibRaw", async () => {
    const r = await rig();
    expect(await decoder(r).decode(file(singleFrame()), request())).toBeNull();
    expect(r.sessions).toBe(0);
  });

  it("answers null with Use the first frame only, so Safelight's own decode reads it", async () => {
    const r = await rig();
    expect(await decoder(r, { firstFrameOnly: true }).decode(file(pentaxPef(W, H)), request())).toBeNull();
    expect(r.sessions).toBe(0);
  });

  it("reads the four frames in order, ends LibRaw, and answers the merge in linear light", async () => {
    const r = await rig();
    const image = await decoder(r).decode(file(pentaxPef(W, H)), request());
    expect(r.opened).toEqual([0, 1, 2, 3]);
    expect(r.disposed).toBe(r.sessions);
    if (image?.kind !== "linear") throw new Error("not linear");
    expect([image.width, image.height, image.oriented]).toEqual([W, H, false]);
    expect(image.data.length).toBe(W * H * 4);
    expect(image.asShotMultipliers).toEqual([2, 1, 1.5]);
    expect(image.sourceWidth).toBeUndefined();
    const o = (10 * W + 10) * 4;
    const mul = [2, 1, 1.5];
    for (let c = 0; c < 3; c++) expect(image.data[o + c]).toBeCloseTo((expected(smooth, 10, 10, c) * mul[c]) / 65535, 5);
    expect(image.data[o + 3]).toBe(1);
  });

  it("balances by the multipliers Safelight asks for", async () => {
    const image = await decoder(await rig()).decode(file(pentaxPef(W, H)), request({ asShotMultipliers: [3, 1, 2] }));
    if (image?.kind !== "linear") throw new Error("not linear");
    expect(image.asShotMultipliers).toEqual([3, 1, 2]);
    expect(image.data[(10 * W + 10) * 4]).toBeCloseTo((expected(smooth, 10, 10, 0) * 3) / 65535, 5);
  });

  it("bins the first frame alone for a reduced decode, saying the full size", async () => {
    const r = await rig();
    const image = await decoder(r).decode(file(pentaxPef(W, H)), request({ fullSize: false, targetEdge: 16, background: true }));
    expect(r.opened).toEqual([0]);
    if (image?.kind !== "linear") throw new Error("not linear");
    expect([image.width, image.height, image.sourceWidth, image.sourceHeight]).toEqual([W / 2, H / 2, W, H]);
  });

  it("merges in full when the target is past half the frame", async () => {
    const r = await rig();
    await decoder(r).decode(file(pentaxPef(W, H)), request({ fullSize: false, targetEdge: 20 }));
    expect(r.opened).toEqual([0, 1, 2, 3]);
  });

  it("stops when Safelight no longer needs the decode", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(decoder(await rig()).decode(file(pentaxPef(W, H)), request({ signal: controller.signal }))).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops LibRaw at once when Safelight gives up mid-read, failing the call it has", async () => {
    const controller = new AbortController();
    let disposed = 0;
    let started!: () => void;
    const opening = new Promise<void>((resolve) => (started = resolve));
    const runtime: DecoderRuntime = {
      libraw: () => {
        let fail: (e: Error) => void = () => {};
        return {
          open: () => {
            started();
            return new Promise<void>((_, reject) => (fail = reject));
          },
          readout: async () => null,
          metadata: async () => META,
          dispose: () => {
            disposed++;
            fail(new DOMException("ended", "AbortError"));
          },
        };
      },
      merge: () => Promise.reject(new Error("never merged")),
    };
    const decoding = pixelShiftDecoder(DEFAULT_OPTIONS, "t", runtime).decode(file(pentaxPef(W, H)), request({ signal: controller.signal }));
    await opening;
    controller.abort();
    await expect(decoding).rejects.toMatchObject({ name: "AbortError" });
    expect(disposed).toBeGreaterThan(0);
  });
});

describe("pixelShiftDecoder, ARQ", () => {
  const AW = 24;
  const AH = 16;
  /** The scene as an ARQ holds it: four samples a pixel, by colour filter position. */
  function arqSamples(): Uint16Array {
    const samples = new Uint16Array(AW * AH * 4);
    for (let r = 0; r < AH; r++) for (let c = 0; c < AW; c++) for (let p = 0; p < 4; p++) samples[(r * AW + c) * 4 + p] = expected(smooth, r, c, [0, 1, 1, 2][p]);
    return samples;
  }
  const sonyMeta = (width: number, height: number) => ({
    ...META,
    camera_make: "Sony",
    camera_model: "ILCE-7RM3",
    filters: 0,
    width,
    height,
    color_data: { ...META.color_data, cam_mul: [2, 1, 1.5, 1] },
  });

  function arqRuntime(meta: object, opened: number[]): DecoderRuntime {
    return {
      libraw: () => ({
        open: async (bytes) => void opened.push(bytes.length),
        readout: async () => null,
        metadata: async () => meta,
        dispose: () => {},
      }),
      merge: async (job) => runMerge(job),
    };
  }

  it("opens only the header in LibRaw, and merges the samples it reads itself", async () => {
    const bytes = sonyArq(arqSamples(), AW, AH);
    const opened: number[] = [];
    const image = await pixelShiftDecoder(DEFAULT_OPTIONS, "t", arqRuntime(sonyMeta(AW, AH), opened)).decode(file(bytes), request({ name: "a.ARQ" }));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toBeLessThan(bytes.length - AW * AH * 8 + 1);
    if (image?.kind !== "linear") throw new Error("not linear");
    expect([image.width, image.height]).toEqual([AW, AH]);
    const o = (8 * AW + 10) * 4;
    for (let c = 0; c < 3; c++) expect(image.data[o + c]).toBeCloseTo((expected(smooth, 8, 10, c) * [2, 1, 1.5][c]) / 65535, 5);
  });

  it("keeps a portrait ARQ's sensor size: LibRaw reports it turned", async () => {
    const image = await pixelShiftDecoder(DEFAULT_OPTIONS, "t", arqRuntime(sonyMeta(AH, AW), [])).decode(file(sonyArq(arqSamples(), AW, AH)), request({ name: "a.ARQ" }));
    if (image?.kind !== "linear") throw new Error("not linear");
    expect([image.width, image.height, image.oriented]).toEqual([AW, AH, false]);
  });
});

describe("pixelShiftDecoder.accepts", () => {
  const accept = (d: ReturnType<typeof decoder>, bytes: Uint8Array | Blob, signal = new AbortController().signal) => {
    if (!d.accepts) throw new Error("no accepts");
    return d.accepts(bytes instanceof Blob ? bytes : file(bytes), { name: "IMGP0001.PEF", signal });
  };

  /** A file that records the byte ranges read from it. */
  class CountingBlob extends Blob {
    read = 0;
    override slice(start?: number, end?: number, type?: string): Blob {
      this.read += (end ?? this.size) - (start ?? 0);
      return super.slice(start, end, type);
    }
  }

  it("takes a pixel-shift file and turns down any other, reading only its directories", async () => {
    const r = await rig();
    const pef = new CountingBlob([pentaxPef(400, 300, "PENTAX", 100_000).slice().buffer as ArrayBuffer]);
    expect(await accept(decoder(r), pef)).toBe(true);
    expect(pef.read).toBeLessThan(pef.size / 4);
    expect(await accept(decoder(r), singleFrame())).toBe(false);
    expect(r.sessions).toBe(0);
  });

  it("turns everything down with Use the first frame only", async () => {
    expect(await accept(decoder(await rig(), { firstFrameOnly: true }), pentaxPef(W, H))).toBe(false);
  });

  it("gives up when Safelight's 5 s are up, answering nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(Promise.resolve(accept(decoder(await rig()), pentaxPef(W, H), controller.signal))).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("pixelShiftDecoder, failures that may pass", () => {
  it("reports a LibRaw worker that didn't start as transient", async () => {
    const runtime: DecoderRuntime = {
      libraw: () => {
        throw new Error("Failed to construct 'Worker'");
      },
      merge: () => Promise.reject(new Error("never merged")),
    };
    await expect(pixelShiftDecoder(DEFAULT_OPTIONS, "t", runtime).decode(file(pentaxPef(W, H)), request())).rejects.toMatchObject({ transient: true });
  });

  it("reports a file that couldn't be read just then as transient", async () => {
    class Unreadable extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        return Promise.reject(new DOMException("gone", "NotReadableError"));
      }
    }
    const bytes = pentaxPef(W, H);
    await expect(decoder(await rig()).decode(new Unreadable([bytes.slice().buffer as ArrayBuffer]), request())).rejects.toMatchObject({ transient: true });
  });

  it("reports running out of memory in the merge as transient", async () => {
    const r = await rig();
    r.runtime.merge = () => Promise.reject(new RangeError("Array buffer allocation failed"));
    await expect(decoder(r).decode(file(pentaxPef(W, H)), request())).rejects.toMatchObject({ transient: true });
  });

  it("lets a file LibRaw can't unpack stay a plain failure", async () => {
    const r = await rig();
    const make = r.runtime.libraw;
    r.runtime.libraw = () => ({ ...make(), readout: async () => null });
    expect(await decoder(r).decode(file(pentaxPef(W, H)), request())).toBeNull();
  });
});

