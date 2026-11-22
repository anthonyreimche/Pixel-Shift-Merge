// The merge's smaller pieces: the colour filter layout, the scale, the ARQ
// shots, the blur, the demosaic, the finish, the camera's details, the
// automatic white balance and the options.

import { describe, expect, it } from "vitest";
import { cameraDetails, greenOne, visibleSize, whiteGain } from "../src/camera";
import { finishGrey, finishLinear } from "../src/finish";
import { gaussianBlur } from "../src/gauss";
import { channelGains } from "../src/job";
import { arqView, cfaFromFilters, sampleAt, scaleTables } from "../src/mosaic";
import { DEFAULT_OPTIONS, MAX_SMOOTH, optionsSignature, readOptions, SETTING, SETTINGS_FIELDS } from "../src/options";
import { rcdDemosaic, RcdTiles } from "../src/rcd";
import { autoMultipliers } from "../src/wb";
import { RGGB, UNIT_LEVELS } from "./support/scene";

describe("cfaFromFilters", () => {
  it("reads LibRaw's filters at the visible area's origin", () => {
    expect(cfaFromFilters(0xb4b4b4b4)).toEqual([0, 1, 1, 2]);
    expect(cfaFromFilters(0x94949494)).toEqual([0, 1, 1, 2]);
    expect(cfaFromFilters(0x16161616)).toEqual([2, 1, 1, 0]);
    expect(cfaFromFilters(0x61616161)).toEqual([1, 0, 2, 1]);
  });

  it("refuses what isn't a three-colour Bayer layout", () => {
    expect(cfaFromFilters(0)).toBeNull();
    expect(cfaFromFilters(9)).toBeNull();
  });
});

describe("scaleTables", () => {
  it("takes off the black and scales so the most amplified colour's white is 65535", () => {
    const t = scaleTables(RGGB, { black: [100, 100, 100, 100], white: 16100, mul: [2, 1, 1.5] });
    expect(t[0][16100]).toBeCloseTo(65535, 6);
    expect(t[1][16100]).toBeCloseTo(65535 / 2, 6);
    expect(t[2][16100]).toBeCloseTo(65535 / 2, 6);
    expect(t[3][16100]).toBeCloseTo((65535 * 1.5) / 2, 6);
    expect(t[0][50]).toBe(0);
  });
});

describe("arqView", () => {
  // Pixel (r, c) holds four samples by colour filter position; sample p of
  // pixel (r, c) is 1000 p + 10 r + c, so each read names where it came from.
  const width = 6;
  const height = 4;
  const samples = new Uint16Array(width * height * 4);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) for (let p = 0; p < 4; p++) samples[(r * width + c) * 4 + p] = 1000 * p + 10 * r + c;
  const tables = scaleTables(RGGB, UNIT_LEVELS);

  it("gives shot 1 each pixel's sample of the colour at its own position", () => {
    const v = arqView(samples, width, 0, 0, 0);
    expect(sampleAt(v, tables, 1, 2)).toBe(1000 * 2 + 10 + 2);
    expect(sampleAt(v, tables, 2, 3)).toBe(1000 * 1 + 20 + 3);
  });

  it("moves shots 2 to 4 down, down and right, and right, as RawTherapee rebuilds them", () => {
    expect(sampleAt(arqView(samples, width, 0, 0, 1), tables, 2, 3)).toBe(1000 * 1 + 10 + 3);
    expect(sampleAt(arqView(samples, width, 0, 0, 2), tables, 2, 3)).toBe(1000 * 1 + 10 + 2);
    expect(sampleAt(arqView(samples, width, 0, 0, 3), tables, 2, 3)).toBe(1000 * 1 + 20 + 2);
  });

  it("reads 0 where a moved shot has no sample", () => {
    expect(sampleAt(arqView(samples, width, 0, 0, 1), tables, 0, 3)).toBe(0);
  });
});

describe("gaussianBlur", () => {
  it("keeps a constant constant", () => {
    const plane = new Float32Array(40 * 30).fill(0.99);
    gaussianBlur(plane, 40, 30, 1);
    for (const v of plane) expect(v).toBeCloseTo(0.99, 5);
  });

  it("spreads an impulse evenly about its centre, keeping its sum", () => {
    const plane = new Float32Array(41 * 41);
    plane[20 * 41 + 20] = 1;
    gaussianBlur(plane, 41, 41, 1);
    const at = (i: number, j: number) => plane[i * 41 + j];
    expect(plane.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    expect(at(20, 21)).toBeCloseTo(at(20, 19), 6);
    expect(at(21, 20)).toBeCloseTo(at(19, 20), 6);
    expect(at(21, 20)).toBeCloseTo(at(20, 21), 6);
    expect(at(20, 20)).toBeGreaterThan(at(20, 21));
    expect(at(20, 21)).toBeGreaterThan(at(20, 22));
    expect(at(20, 22)).toBeGreaterThan(at(20, 23));
  });
});

describe("rcdDemosaic", () => {
  const W = 400;
  const H = 300;
  const flat = (i: number, j: number) => [1000, 2000, 3000][RGGB[((i & 1) << 1) | (j & 1)]];

  it("gives a flat colour back everywhere", () => {
    const rgba = new Float32Array(W * H * 4);
    rcdDemosaic(W, H, RGGB, flat, rgba);
    for (const [i, j] of [[0, 0], [5, 7], [150, 200], [H - 1, W - 1]]) {
      const o = (i * W + j) * 4;
      expect(Math.abs(rgba[o] - 1000)).toBeLessThan(0.5);
      expect(Math.abs(rgba[o + 1] - 2000)).toBeLessThan(0.5);
      expect(Math.abs(rgba[o + 2] - 3000)).toBeLessThan(0.5);
    }
  });

  it("demosaics only the tiles asked for, and always the border", () => {
    const rgba = new Float32Array(W * H * 4).fill(-1);
    const tiles = new RcdTiles(W, H);
    tiles.need(20, 20);
    rcdDemosaic(W, H, RGGB, flat, rgba, tiles.wanted);
    expect(rgba[(20 * W + 20) * 4]).toBeCloseTo(1000, 1);
    expect(rgba[(250 * W + 300) * 4]).toBe(-1);
    expect(rgba[(250 * W + 2) * 4]).toBeCloseTo(1000, 1);
  });
});

describe("finishLinear", () => {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  it("puts the least amplified colour's white at 1", () => {
    const rgba = new Float32Array([65535 / 2, 65535 / 2, 65535 / 2, 0]);
    finishLinear(rgba, [2, 1, 1.5], identity);
    expect([...rgba]).toEqual([1, 1, 1, 1].map((v) => expect.closeTo(v, 6)));
  });

  it("applies the camera matrix", () => {
    const rgba = new Float32Array([1000, 2000, 3000, 0]);
    finishLinear(rgba, [1, 1, 1], [2, -1, 0, 0, 1, 0, 0, 0.5, 0.5]);
    expect(rgba[0]).toBeCloseTo(0, 6);
    expect(rgba[1]).toBeCloseTo(2000 / 65535, 6);
    expect(rgba[2]).toBeCloseTo(2500 / 65535, 6);
  });

  it("blends a pixel clipped in every colour to neutral, as dcraw's highlight mode 2 does", () => {
    const rgba = new Float32Array([65535, 40000, 40000, 0]);
    finishLinear(rgba, [2, 1, 1], identity);
    expect(rgba[0]).toBeCloseTo(rgba[1], 6);
    expect(rgba[1]).toBeCloseTo(rgba[2], 6);
  });

  it("applies per-channel gains first", () => {
    const rgba = new Float32Array([1000, 1000, 1000, 0]);
    finishLinear(rgba, [1, 1, 1], identity, [2, 1, 0.5]);
    expect([...rgba.slice(0, 3)].map((v) => v * 65535)).toEqual([2000, 1000, 500].map((v) => expect.closeTo(v, 3)));
  });

  it("shows the mask grey", () => {
    const rgba = new Float32Array([0, 65535, 0, 0, 0, 32768, 0, 0]);
    finishGrey(rgba);
    expect([...rgba]).toEqual([1, 1, 1, 1, 32768 / 65535, 32768 / 65535, 32768 / 65535, 1].map((v) => expect.closeTo(v, 6)));
  });
});

describe("channelGains", () => {
  it("turns the merge's scale into the delivered white balance's", () => {
    expect(channelGains([2, 1, 2], [2, 1, 1], 1)).toEqual([1, 1, 0.5]);
    expect(channelGains([2, 1, 1], [2, 1, 1], 1.5)).toEqual([1.5, 1.5, 1.5]);
  });
});

describe("cameraDetails", () => {
  const meta = (colour: Record<string, unknown>) => ({
    camera_make: "Pentax",
    camera_model: "K-1",
    iso_speed: 200,
    filters: 0xb4b4b4b4,
    top_margin: 18,
    left_margin: 6,
    width: 7376,
    height: 4932,
    color_data: { black: 64, maximum: 16383, cam_mul: [17600, 8192, 13216, 8192], pre_mul: [2.2, 0.9, 1.3, 0], ...colour },
  });
  const adobe = [[1.6, -0.38, -0.22, 0], [-0.19, 1.62, -0.43, 0], [0.01, -0.41, 1.4, 0]];
  const camera = [[1.7, -0.54, -0.16, 0], [-0.18, 1.68, -0.5, 0], [0.02, -0.34, 1.33, 0]];

  it("takes the matrix the file carries over LibRaw's table, as LibRaw does with the camera's white balance", () => {
    expect(cameraDetails(meta({ rgb_cam: adobe, cmatrix: camera }))?.rgbCam).toEqual(camera.flatMap((r) => r.slice(0, 3)));
    expect(cameraDetails(meta({ rgb_cam: adobe, cmatrix: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }))?.rgbCam).toEqual(adobe.flatMap((r) => r.slice(0, 3)));
  });

  it("reads the multipliers, levels, layout and margins", () => {
    const d = cameraDetails(meta({ rgb_cam: adobe }));
    expect(d).toMatchObject({ make: "Pentax", model: "K-1", iso: 200, cfa: [0, 1, 1, 2], black: 64, white: 16383, mul: [17600, 8192, 13216], top: 18, left: 6 });
    expect(greenOne([17600, 8192, 13216])).toEqual([17600 / 8192, 1, 13216 / 8192]);
  });

  it("falls back to the daylight multipliers, and gives up without a matrix", () => {
    expect(cameraDetails(meta({ rgb_cam: adobe, cam_mul: [0, 0, 0, 0] }))?.mul).toEqual([2.2, 0.9, 1.3]);
    expect(cameraDetails(meta({}))).toBeNull();
  });
});

describe("visibleSize and whiteGain", () => {
  it("takes the size that fits the readout", () => {
    expect(visibleSize({ rawWidth: 7392, rawHeight: 4950, top: 18, left: 6, width: 7376, height: 4932 })).toEqual({ width: 7376, height: 4932 });
    expect(visibleSize({ rawWidth: 7392, rawHeight: 4950, top: 18, left: 6, width: 4932, height: 7376 })).toEqual({ width: 7376, height: 4932 });
  });

  it("brightens as LibRaw lowers its white to the brightest sample between 75 % and 100 %", () => {
    const levels = { black: [64, 64, 64, 64], white: 16383, mul: [2, 1, 1.5] } as const;
    expect(whiteGain(levels, 16383)).toBe(1);
    expect(whiteGain(levels, 5000)).toBe(1);
    expect(whiteGain(levels, 16064)).toBeCloseTo(16319 / 16000, 9);
  });
});

describe("autoMultipliers", () => {
  const W = 32;
  const H = 32;
  const flat = (r: number, c: number) => 64 + [1000, 2000, 2000, 500][((r & 1) << 1) | (c & 1)];

  it("is each colour's inverse mean above black", () => {
    const data = new Uint16Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) data[r * W + c] = flat(r, c);
    const m = autoMultipliers({ data, base: 0, row: W, col: 1, pos: [0, 0, 0, 0] }, RGGB, W, H, [64, 64, 64, 64], 16383);
    expect(m?.map((v) => 1 / v)).toEqual([1000, 2000, 500].map((v) => expect.closeTo(v, 6)));
  });

  it("leaves out an 8x8 block holding a clipped sample", () => {
    const data = new Uint16Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) data[r * W + c] = r < 8 && c < 8 ? (r === 3 && c === 3 ? 16383 : 64 + 9000) : flat(r, c);
    const m = autoMultipliers({ data, base: 0, row: W, col: 1, pos: [0, 0, 0, 0] }, RGGB, W, H, [64, 64, 64, 64], 16383);
    expect(1 / (m?.[0] ?? 0)).toBeCloseTo(1000, 6);
  });
});

describe("options", () => {
  const read = (values: Record<string, unknown>) => <T>(key: string, fallback: T) => (key in values ? (values[key] as T) : fallback);

  it("reads the defaults when nothing is set", () => {
    expect(readOptions(read({}))).toEqual(DEFAULT_OPTIONS);
  });

  it("keeps values in range and frames as frame numbers", () => {
    const o = readOptions(read({ [SETTING.sensitivity]: 9, [SETTING.smooth]: -1, [SETTING.fillFrame]: "3", [SETTING.motionDetection]: "yes" }));
    expect(o.sensitivity).toBe(2);
    expect(o.smooth).toBe(0);
    expect(o.fillFrame).toBe(2);
    expect(readOptions(read({ [SETTING.smooth]: 1 })).smooth).toBe(MAX_SMOOTH);
    expect(o.motionDetection).toBe(true);
  });

  it("stops Smooth transitions short of 1, where the frame would stand for the whole merge", () => {
    expect(SETTINGS_FIELDS.find((f) => f.key === SETTING.smooth)).toMatchObject({ max: MAX_SMOOTH });
    expect(MAX_SMOOTH).toBeLessThan(1);
  });

  it("changes the signature with anything that changes the image, and only then", () => {
    const base = optionsSignature(DEFAULT_OPTIONS);
    expect(optionsSignature({ ...DEFAULT_OPTIONS, sensitivity: 0.5 })).not.toBe(base);
    expect(optionsSignature({ ...DEFAULT_OPTIONS, showMaskOnly: true })).not.toBe(base);
    expect(optionsSignature({ ...DEFAULT_OPTIONS, equalizeBrightness: true })).not.toBe(base);
    const off = { ...DEFAULT_OPTIONS, motionDetection: false };
    expect(optionsSignature({ ...off, sensitivity: 1 })).toBe(optionsSignature(off));
  });
});
