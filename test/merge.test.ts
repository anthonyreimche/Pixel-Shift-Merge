// The merge on synthetic frames: a still scene comes back exactly, a thing
// that moved between frames is found and filled from one frame, and the
// options do what RawTherapee's do.

import { describe, expect, it } from "vitest";
import { fillHoles, noiseModel, pixelShift, type MergeSettings, type Shot } from "../src/merge";
import { readoutView, sampleAt, scaleTables } from "../src/mosaic";
import { rcdDemosaic } from "../src/rcd";
import { expected, frameOf, mosaicOf, RGGB, smooth, UNIT_LEVELS, type Scene } from "./support/scene";

const W = 64;
const H = 48;
const SHOT: Shot = { make: "Pentax", model: "K-1", iso: 100 };
const OFF: MergeSettings = {
  motionDetection: false,
  sensitivity: 0,
  fillFrame: 0,
  smooth: 0.7,
  equalizeBrightness: false,
  equalizePerChannel: false,
  showMotion: false,
  showMaskOnly: false,
};
const ON: MergeSettings = { ...OFF, motionDetection: true };
const tables = scaleTables(RGGB, UNIT_LEVELS);

function merge(scenes: Scene | [Scene, Scene, Scene, Scene], settings: MergeSettings) {
  const rgba = new Float32Array(W * H * 4);
  const report = pixelShift(mosaicOf(W, H, scenes), UNIT_LEVELS, tables, SHOT, settings, rgba);
  return { rgba, report };
}

const px = (rgba: Float32Array, i: number, j: number) => [0, 1, 2].map((c) => rgba[(i * W + j) * 4 + c]);

/** A bright square at rows 20-29, columns 30-39, in one frame only. */
const withSquare: Scene = (i, j, c) => (i >= 20 && i < 30 && j >= 30 && j < 40 ? 40000 : smooth(i, j, c));

describe("pixelShift, motion detection off", () => {
  it("gives every inner pixel its own red, green and blue from the frames", () => {
    const { rgba } = merge(smooth, OFF);
    for (let i = 1; i < H - 1; i++) {
      for (let j = 1; j < W - 1; j++) {
        expect(px(rgba, i, j)).toEqual([0, 1, 2].map((c) => expected(smooth, i, j, c)));
      }
    }
  });

  it("gives the outer pixels their inner neighbour's colour", () => {
    const { rgba } = merge(smooth, OFF);
    expect(px(rgba, 0, 10)).toEqual(px(rgba, 1, 10));
    expect(px(rgba, H - 1, 10)).toEqual(px(rgba, H - 2, 10));
    expect(px(rgba, 10, 0)).toEqual(px(rgba, 10, 1));
    expect(px(rgba, 10, W - 1)).toEqual(px(rgba, 10, W - 2));
  });

  it("leaves a moving thing as it is: the coloured ghost motion detection is for", () => {
    const { rgba, report } = merge([smooth, smooth, withSquare, smooth], OFF);
    expect(report.mask).toBeNull();
    expect(px(rgba, 25, 35)).not.toEqual([0, 1, 2].map((c) => expected(smooth, 25, 35, c)));
  });
});

describe("pixelShift, motion detection on", () => {
  it("finds no motion in a still scene and merges it as with detection off", () => {
    const on = merge(smooth, { ...ON, smooth: 0 });
    const off = merge(smooth, OFF);
    expect(on.report.mask?.some((v) => v !== 0)).toBe(false);
    for (let i = 4; i < H - 4; i++) for (let j = 4; j < W - 4; j++) expect(px(on.rgba, i, j)).toEqual(px(off.rgba, i, j));
  });

  it("marks a thing that moved and fills it from the chosen frame, demosaiced", () => {
    const { rgba, report } = merge([smooth, smooth, withSquare, smooth], { ...ON, smooth: 0 });
    const mask = report.mask;
    if (!mask) throw new Error("no mask");
    for (let i = 21; i < 29; i++) for (let j = 31; j < 39; j++) expect(mask[i * W + j]).toBe(255);
    expect(mask[10 * W + 10]).toBe(0);

    const reference = new Float32Array(W * H * 4);
    const frame0 = readoutView(frameOf(smooth, W, H, 0), W, 0, 0);
    rcdDemosaic(W, H, RGGB, (i, j) => sampleAt(frame0, tables, i, j), reference);
    expect(px(rgba, 25, 35)).toEqual(px(reference, 25, 35));
    expect(px(rgba, 10, 10)).toEqual([0, 1, 2].map((c) => expected(smooth, 10, 10, c)));
  });

  it("fills holes in the motion mask", () => {
    const mask = new Uint8Array(10 * 10);
    for (let i = 2; i < 7; i++) for (let j = 2; j < 7; j++) if (i === 2 || i === 6 || j === 2 || j === 6) mask[i * 10 + j] = 255;
    fillHoles(mask, 10, 0, 10, 0, 10);
    expect(mask[4 * 10 + 4]).toBe(255);
    expect(mask[0]).toBe(0);
  });

  it("fills motion areas from frame 3 one row and column on, where frame 3 lies", () => {
    const { rgba } = merge(smooth, { ...ON, smooth: 0, fillFrame: 2 });
    expect(px(rgba, 11, 11)).toEqual([0, 1, 2].map((c) => expected(smooth, 10, 10, c)));
  });

  it("shows the motion mask alone: 65535 where motion, 0 elsewhere", () => {
    const { rgba } = merge([smooth, smooth, withSquare, smooth], { ...ON, smooth: 0, showMaskOnly: true });
    expect(px(rgba, 25, 35)).toEqual([65535, 65535, 65535]);
    expect(px(rgba, 10, 10)).toEqual([0, 0, 0]);
  });

  it("paints motion green with Show motion", () => {
    const { rgba } = merge([smooth, smooth, withSquare, smooth], { ...ON, smooth: 0, showMotion: true });
    expect(px(rgba, 25, 35)).toEqual([0, 13500, 0]);
  });

  it("blends the edge of a motion area with smooth transitions", () => {
    const hard = merge([smooth, smooth, withSquare, smooth], { ...ON, smooth: 0 });
    const soft = merge([smooth, smooth, withSquare, smooth], { ...ON, smooth: 0.7 });
    const mask = hard.report.mask;
    if (!mask) throw new Error("no mask");
    let blended = 0;
    for (let i = 4; i < H - 4; i++) {
      for (let j = 4; j < W - 4; j++) {
        if (mask[i * W + j] === 0 && px(hard.rgba, i, j)[1] !== px(soft.rgba, i, j)[1]) blended++;
      }
    }
    expect(blended).toBeGreaterThan(0);
  });
});

describe("pixelShift, equalized brightness", () => {
  const brighter: Scene = (i, j, c) => smooth(i, j, c) * 1.25;

  it("measures each frame against the chosen one by its median", () => {
    const { report } = merge([smooth, smooth, brighter, smooth], { ...OFF, equalizeBrightness: true });
    expect(report.brightness.green[0]).toBe(1);
    expect(report.brightness.green[2]).toBeCloseTo(0.8, 2);
    expect(report.brightness.red).toEqual(report.brightness.green);
  });

  it("measures each colour on its own with Equalize per channel", () => {
    const warmer: Scene = (i, j, c) => smooth(i, j, c) * (c === 0 ? 1.5 : 1);
    const { report } = merge([smooth, smooth, warmer, smooth], { ...OFF, equalizeBrightness: true, equalizePerChannel: true });
    expect(report.brightness.green[2]).toBeCloseTo(1, 2);
    expect(report.brightness.red[2]).toBeCloseTo(1 / 1.5, 1);
  });
});

describe("noiseModel", () => {
  it("reads RawTherapee's tables by body and ISO", () => {
    expect(noiseModel({ make: "Pentax", model: "K-1", iso: 100 })).toEqual({ nRead: 3.45, ePerIso: 0.75 });
    expect(noiseModel({ make: "Pentax", model: "K-1 Mark II", iso: 200 })).toEqual({ nRead: 3.0, ePerIso: 0.75 });
    expect(noiseModel({ make: "Pentax", model: "K-3 II", iso: 1600 })).toEqual({ nRead: 1.75, ePerIso: 0.35 });
    expect(noiseModel({ make: "Pentax", model: "KP", iso: 100 })).toEqual({ nRead: 4, ePerIso: 0.5 });
    expect(noiseModel({ make: "Sony", model: "ILCE-7RM4", iso: 100 })).toEqual({ nRead: 4.2, ePerIso: 0.8 });
  });

  it("reads the end of the table past it", () => {
    expect(noiseModel({ make: "Pentax", model: "K-1", iso: 50 }).nRead).toBe(3.45);
    expect(noiseModel({ make: "Pentax", model: "K-3 II", iso: 1_000_000 }).nRead).toBe(1.5);
  });
});
