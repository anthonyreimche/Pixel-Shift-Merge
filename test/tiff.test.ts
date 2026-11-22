// Finding a pixel-shift file's frames from its TIFF directories, and pointing
// the frame LibRaw reads at another one.

import { describe, expect, it } from "vitest";
import { bufferSource, findPixelShift, MAX_MERGE_PIXELS, pointAtFrame, TAG } from "../src/tiff";
import { buildTiff, makeTag, pentaxDng, pentaxPef, rawTags, singleFrame, sonyArq, strip } from "./support/tiff-builder";

const find = (bytes: Uint8Array) => findPixelShift(bufferSource(bytes.slice().buffer));

/** The byte the strip LibRaw would read starts with: its frame's fill. */
function stripFill(bytes: Uint8Array, layout: NonNullable<Awaited<ReturnType<typeof find>>>): number {
  if (layout.kind !== "frames") throw new Error("not frames");
  const entry = layout.frames[0].ifd.entries.get(TAG.stripOffsets);
  if (!entry) throw new Error("no strip");
  const offset = new DataView(bytes.buffer, bytes.byteOffset).getUint32(entry.fieldAt, true);
  return bytes[offset];
}

describe("findPixelShift", () => {
  it("finds a PEF's four frames: IFD0, then its SubIFDs in order", async () => {
    const bytes = pentaxPef();
    const layout = await find(bytes);
    expect(layout?.kind).toBe("frames");
    if (layout?.kind !== "frames") return;
    expect(layout.frames).toHaveLength(4);
    expect(layout.frames.map((f) => [f.width, f.height])).toEqual([[32, 24], [32, 24], [32, 24], [32, 24]]);
    expect(layout.black).toBeUndefined();
    expect(stripFill(bytes, layout)).toBe(0x10);
  });

  it("finds a DNG's four frames in chain order, and its black level by colour filter position", async () => {
    const layout = await find(pentaxDng());
    expect(layout?.kind).toBe("frames");
    if (layout?.kind !== "frames") return;
    expect(layout.frames).toHaveLength(4);
    expect(layout.black).toEqual([60, 61, 62, 63]);
  });

  it("turns down a file with one raw image", async () => {
    expect(await find(singleFrame())).toBeNull();
  });

  it("turns down a file with two or three frames of one size", async () => {
    const frame = () => ({ tags: rawTags(32, 24), strip: strip(64, 1) });
    const first = { ...frame(), tags: [makeTag("PENTAX"), ...rawTags(32, 24)] };
    expect(await find(buildTiff({ ...first, subIfds: [frame()] }))).toBeNull();
    expect(await find(buildTiff({ ...first, subIfds: [frame(), frame()] }))).toBeNull();
  });

  it("takes four frames only from a Pentax or Ricoh file", async () => {
    expect(await find(pentaxPef(32, 24, "RICOH IMAGING COMPANY, LTD."))).not.toBeNull();
    expect(await find(pentaxPef(32, 24, "NIKON CORPORATION"))).toBeNull();
  });

  it("counts only full-resolution images (NewSubfileType 0) as frames", async () => {
    const frame = (subfile: number) => ({ tags: [{ tag: 254, type: 4 as const, values: [subfile] }, ...rawTags(32, 24)], strip: strip(64, 1) });
    const first = { ...frame(0), tags: [makeTag("PENTAX"), ...frame(0).tags] };
    expect(await find(buildTiff({ ...first, subIfds: [frame(0), frame(0), frame(0)] }))).not.toBeNull();
    expect(await find(buildTiff({ ...first, subIfds: [frame(0), frame(0), frame(4)] }))).toBeNull();
  });

  it("turns down anything that isn't TIFF", async () => {
    expect(await find(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(await find(new Uint8Array(4))).toBeNull();
  });

  it("finds an ARQ's samples", async () => {
    const samples = new Uint16Array(6 * 4 * 4);
    const layout = await find(sonyArq(samples, 6, 4));
    expect(layout?.kind).toBe("arq");
    if (layout?.kind !== "arq") return;
    expect(layout.image.width).toBe(6);
    expect(layout.image.height).toBe(4);
    expect(layout.dataOffset % 2).toBe(0);
  });

  it("leaves a frame past the merge's size (a 16-shot ARQ) to Safelight's decoder", async () => {
    const width = 19200;
    const height = 12800;
    expect(width * height).toBeGreaterThan(MAX_MERGE_PIXELS);
    expect(await find(sonyArq(new Uint16Array(16), width, height, width * height * 8))).toBeNull();
    expect(await find(sonyArq(new Uint16Array(16), 2, 2))).not.toBeNull();
  });

  it("turns down a four-sample image whose strip holds the wrong amount", async () => {
    const samples = new Uint16Array(6 * 4 * 4);
    const bytes = sonyArq(samples.subarray(0, 20), 6, 4);
    expect(await find(bytes)).toBeNull();
  });
});

describe("pointAtFrame", () => {
  it("points the first frame's strip at frame k and puts it back", async () => {
    const bytes = pentaxPef();
    const layout = await find(bytes);
    if (layout?.kind !== "frames") throw new Error("not frames");
    const before = bytes.slice();
    for (let k = 0; k < 4; k++) {
      const restore = pointAtFrame(bytes, layout, k);
      expect(stripFill(bytes, layout)).toBe(0x10 + k);
      restore();
      expect(bytes).toEqual(before);
    }
  });

  it("points a DNG's first raw frame at the others", async () => {
    const bytes = pentaxDng();
    const layout = await find(bytes);
    if (layout?.kind !== "frames") throw new Error("not frames");
    const restore = pointAtFrame(bytes, layout, 2);
    expect(stripFill(bytes, layout)).toBe(0x22);
    restore();
    expect(stripFill(bytes, layout)).toBe(0x20);
  });
});
