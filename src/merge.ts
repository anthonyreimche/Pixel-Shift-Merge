// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// The pixel-shift merge with motion detection, ported from RawTherapee 5.13
// (rtengine/pixelshift.cc). pixelshift.cc: Copyright (C) 2016 - 2018 Ingo
// Weyrich <heckflosse67@gmx.de>; GPL-3.0-or-later.
//
// Frame k's sample at sensor (i + dy, j + dx) sees scene point (i, j): frame 0
// (0, 0), frame 1 (1, 0), frame 2 (1, 1), frame 3 (0, 1). So at a red or blue
// site the frames give it red, blue and two greens, and at a green site two
// greens, red and blue. Values are the frames' scaled samples (mosaic.ts) and
// the result is RGB in the same scale, before white balance is undone or a
// matrix applied (finish.ts).

import { gaussianBlur } from "./gauss";
import { sampleAt, scaleMultipliers, type Levels, type Mosaic } from "./mosaic";
import type { FrameIndex } from "./options";
import { RcdTiles, rcdDemosaic } from "./rcd";

export interface MergeSettings {
  motionDetection: boolean;
  sensitivity: number;
  fillFrame: FrameIndex;
  smooth: number;
  equalizeBrightness: boolean;
  equalizePerChannel: boolean;
  showMotion: boolean;
  showMaskOnly: boolean;
}

export interface Shot {
  make: string;
  model: string;
  iso: number;
}

/** What the merge made besides the image: the motion mask (255 = motion),
 *  for tests and the reference comparison. */
export interface MergeReport {
  mask: Uint8Array | null;
  brightness: { red: number[]; green: number[]; blue: number[] };
}

const BORDER = 4;
const STDDEV_FACTOR = 25;
const PRNU = 0.01;
const RED_BLUE_WEIGHT = 1.7;
const GREEN_WEIGHT = 2;
const NO_MOTION = 0.99;
const THRESHOLD = 3 + 9 * NO_MOTION;
const SIGMA = 1;
const PAINT = 13500;

const N_READ_K3II = [3.4, 3.1, 2.5, 2.5, 2.5, 2.5, 2.3, 2.5, 2.3, 2.3, 2.4, 2.3, 1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 1.75, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];
const N_READ_K1 = [
  3.45, 3.15, 3.45, 3.0, 3.0, 3.0, 2.7, 2.7, 2.7, 2.5, 2.5, 2.5, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4,
  2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4, 2.4,
];
const N_READ_K70 = [4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];
const N_READ_ILCE7RM3 = [4.2, 3.9, 3.6, 3.55, 3.5, 3.45, 3.35, 3.3, 1.3, 1.2, 1.2, 1.2, 1.15, 1.2, 1.15, 1.15, 1.1, 1.1, 1.05, 1.05, 1.05, 1, 1, 1, 1, 1, 1, 1, 1.1, 1.1, 1.1];

/** Read noise and electrons per ISO for the body (RawTherapee's tables: the
 *  K-70's for Pentax bodies it has none for, the A7R III's for Sony). */
export function noiseModel(shot: Shot): { nRead: number; ePerIso: number } {
  const index = Math.round(Math.log2(shot.iso / 100) * 3);
  const pick = (table: number[]) => table[Math.min(table.length - 1, Math.max(0, Number.isFinite(index) ? index : 0))];
  if (/sony/i.test(shot.make)) return { nRead: pick(N_READ_ILCE7RM3), ePerIso: 0.8 };
  if (shot.model.includes("K-3")) return { nRead: pick(N_READ_K3II), ePerIso: 0.35 };
  if (shot.model.includes("K-1")) return { nRead: pick(N_READ_K1), ePerIso: 0.75 };
  return { nRead: pick(N_READ_K70), ePerIso: 0.5 };
}

function greenDiff(a: number, b: number, eperIso: number, nRead: number): number {
  let gDiff = (a - b) * eperIso;
  gDiff *= gDiff;
  const avg = (a + b) * 0.5 * eperIso;
  const prnu = PRNU * avg;
  return gDiff - STDDEV_FACTOR * (avg + nRead + prnu * prnu);
}

function nonGreenDiffCross(right: number, left: number, top: number, bottom: number, centre: number, clipped: number, eperIso: number, nRead: number): number {
  if (right > clipped || left > clipped || top > clipped || bottom > clipped || centre > clipped) return 0;
  let hDiff = ((right + left) * 0.5 - centre) * eperIso;
  hDiff *= hDiff;
  let vDiff = ((top + bottom) * 0.5 - centre) * eperIso;
  vDiff *= vDiff;
  const avg = (right + left + (top + bottom)) * 0.25 * eperIso;
  const prnu = PRNU * avg;
  return Math.min(hDiff, vDiff) - STDDEV_FACTOR * (avg + nRead + prnu * prnu);
}

/** Median of a histogram of `datalen` samples, interpolated as RawTherapee
 *  does (pixelshift.cc calcFrameBrightnessFactor). */
function histogramMedian(histogram: Uint32Array, datalen: number): number {
  const half = Math.floor(datalen / 2);
  let lmedian = 0;
  let count = 0;
  while (count < half) {
    count += histogram[lmedian];
    lmedian++;
  }
  const weight = (count - datalen / 2) / histogram[lmedian - 1];
  return weight * (lmedian - 2) + (1 - weight) * (lmedian - 1);
}

function brightnessFactors(frame: number, datalen: number, histograms: Uint32Array[]): number[] {
  const medians = histograms.map((h) => histogramMedian(h, datalen));
  return medians.map((m) => medians[frame] / m);
}

const histIndex = (v: number) => (v >= 65535 ? 65535 : v <= 0 ? 0 : Math.floor(v));

interface MergedRow {
  red: Float32Array;
  blue: Float32Array;
  /** The two greens each pixel is seen in, brightness equalized. */
  g1: Float32Array;
  g2: Float32Array;
  row: number;
}

/** Merges the four frames into `rgba` (`width` x `height` x 4, scaled RGB;
 *  the fourth value is left alone). */
export function pixelShift(mosaic: Mosaic, levels: Levels, tables: Float32Array[], shot: Shot, settings: MergeSettings, rgba: Float32Array): MergeReport {
  const { width: W, height: H, cfa, frames } = mosaic;
  const fc = (r: number, c: number) => cfa[((r & 1) << 1) | (c & 1)];
  const at = (k: number, i: number, j: number): number => {
    const f = frames[k];
    const p = ((i & 1) << 1) | (j & 1);
    return tables[p][f.data[f.base + i * f.row + j * f.col + f.pos[p]]];
  };

  const motionDetection = settings.motionDetection;
  const showMotion = motionDetection && settings.showMotion;
  const showOnlyMask = motionDetection && settings.showMaskOnly;
  const smoothFactor = 1 - settings.smooth;
  const smoothTransitions = settings.smooth > 0;
  const frame = settings.fillFrame;

  const demosaic = (wanted?: (tr: number, tc: number) => boolean) =>
    rcdDemosaic(W, H, cfa, (i, j) => sampleAt(frames[frame], tables, i, j), rgba, wanted);

  const report: MergeReport = { mask: null, brightness: { red: [1, 1, 1, 1], green: [1, 1, 1, 1], blue: [1, 1, 1, 1] } };
  if (motionDetection && smoothFactor === 0 && !showMotion && !showOnlyMask) {
    demosaic();
    return report;
  }

  const scale = scaleMultipliers(cfa, levels);
  const scaleOf = (colour: number) => scale[cfa.indexOf(colour)];
  const whiteOf = (colour: number) => levels.white - levels.black[cfa.indexOf(colour)];
  const model = noiseModel(shot);
  const eperIsoModel = model.ePerIso * Math.pow(2, settings.sensitivity - 1);
  const eperIso = eperIsoModel * (100 / shot.iso);
  const eperIsoRed = (eperIso / scaleOf(0)) * (65535 / whiteOf(0));
  const eperIsoGreen = (eperIso / scaleOf(1)) * (65535 / whiteOf(1));
  const eperIsoBlue = (eperIso / scaleOf(2)) * (65535 / whiteOf(2));
  const clippedRed = 65535 / scaleOf(0);
  const clippedBlue = 65535 / scaleOf(2);
  const nRead = model.nRead * model.nRead;

  let redB = [1, 1, 1, 1];
  let greenB = [1, 1, 1, 1];
  let blueB = [1, 1, 1, 1];
  if (settings.equalizeBrightness) {
    const hg = [0, 1, 2, 3].map(() => new Uint32Array(65536));
    const hr = [0, 1, 2, 3].map(() => new Uint32Array(65536));
    const hb = [0, 1, 2, 3].map(() => new Uint32Array(65536));
    for (let i = 1; i < H - 1; i++) {
      const blueRow = fc(i, 1) + fc(i, 2) === 3;
      for (let j = 1, o = fc(i, 1) & 1; j < W - 1; j++, o ^= 1) {
        hg[1 - o][histIndex(at(1 - o, i - o + 1, j))]++;
        hg[3 - o][histIndex(at(3 - o, i + o, j + 1))]++;
        if (blueRow) {
          hr[2 - o][histIndex(at(2 - o, i + 1, j - o + 1))]++;
          hb[3 * o][histIndex(at(3 * o, i, j + o))]++;
        } else {
          hr[3 * o][histIndex(at(3 * o, i, j + o))]++;
          hb[2 - o][histIndex(at(2 - o, i + 1, j - o + 1))]++;
        }
      }
    }
    const quarter = Math.floor(((H - 2) * (W - 2)) / 4);
    const half = Math.floor(((H - 2) * (W - 2)) / 2);
    redB = brightnessFactors(frame, quarter, hr);
    blueB = brightnessFactors(frame, quarter, hb);
    greenB = brightnessFactors(frame, half, hg);
    if (!settings.equalizePerChannel) {
      redB = greenB;
      blueB = greenB;
    }
    report.brightness = { red: redB, green: greenB, blue: blueB };
  }

  /** Frame k's samples at (r, c), (r, c + 2), (r, c + 4) ...: one colour
   *  filter position, so one table and a fixed step. */
  const lane = (k: number, r: number, c: number) => {
    const f = frames[k];
    const p = ((r & 1) << 1) | (c & 1);
    return { data: f.data, at: f.base + r * f.row + c * f.col + f.pos[p], step: 2 * f.col, table: tables[p] };
  };

  /** Row i of the merge, from column 1 to W - 2: red, blue and the two greens
   *  each pixel is seen in. */
  const fillRow = (i: number, row: MergedRow) => {
    const blueRow = fc(i, 1) + fc(i, 2) === 3;
    const own = blueRow ? row.blue : row.red;
    const other = blueRow ? row.red : row.blue;
    for (let j0 = 1; j0 <= 2; j0++) {
      const o = fc(i, j0) & 1;
      const ownB = (blueRow ? blueB : redB)[3 * o];
      const otherB = (blueRow ? redB : blueB)[2 - o];
      const g1B = greenB[1 - o];
      const g2B = greenB[3 - o];
      const a = lane(3 * o, i, j0 + o);
      const b = lane(2 - o, i + 1, j0 - o + 1);
      const c = lane(1 - o, i - o + 1, j0);
      const d = lane(3 - o, i + o, j0 + 1);
      for (let j = j0, ia = a.at, ib = b.at, ic = c.at, id = d.at; j < W - 1; j += 2, ia += a.step, ib += b.step, ic += c.step, id += d.step) {
        own[j] = a.table[a.data[ia]] * ownB;
        other[j] = b.table[b.data[ib]] * otherB;
        row.g1[j] = c.table[c.data[ic]] * g1B;
        row.g2[j] = d.table[d.data[id]] * g2B;
      }
    }
  };
  const newRow = (): MergedRow => ({ red: new Float32Array(W), blue: new Float32Array(W), g1: new Float32Array(W), g2: new Float32Array(W), row: -1 });

  if (!motionDetection) {
    const row = newRow();
    for (let i = 1; i < H - 1; i++) {
      fillRow(i, row);
      for (let j = 1, o = (i * W + 1) * 4; j < W - 1; j++, o += 4) {
        rgba[o] = row.red[j];
        rgba[o + 1] = (row.g1[j] + row.g2[j]) * 0.5;
        rgba[o + 2] = row.blue[j];
      }
    }
    copyEdges(rgba, W, H);
    return report;
  }

  const offsY = frame === 1 || frame === 2 ? 1 : 0;
  const offsX = frame === 2 || frame === 3 ? 1 : 0;
  const yStart = BORDER - offsY;
  const yEnd = H - (BORDER + offsY);
  const xStart = BORDER - offsX;
  const xEnd = W - (BORDER + offsX);

  // Three merged rows at a time: row i lives at slot i % 3.
  const ring = [newRow(), newRow(), newRow()];
  const rowOf = (i: number) => {
    const slot = ring[i % 3];
    if (slot.row !== i) {
      fillRow(i, slot);
      slot.row = i;
    }
    return slot;
  };

  const psMask = new Float32Array(W * H);
  for (let i = yStart; i < yEnd; i++) {
    const up = rowOf(i - 1);
    const mid = rowOf(i);
    const down = rowOf(i + 1);
    for (let j = xStart; j < xEnd; j++) {
      const idx = i * W + j;
      psMask[idx] = NO_MOTION;
      if (greenDiff(mid.g1[j], mid.g2[j], eperIsoGreen, nRead) > 0) {
        psMask[idx] = GREEN_WEIGHT;
        continue;
      }
      if (nonGreenDiffCross(mid.red[j + 1], mid.red[j - 1], up.red[j], down.red[j], mid.red[j], clippedRed, eperIsoRed, nRead) > 0) {
        psMask[idx] = RED_BLUE_WEIGHT;
        continue;
      }
      if (nonGreenDiffCross(mid.blue[j + 1], mid.blue[j - 1], up.blue[j], down.blue[j], mid.blue[j], clippedBlue, eperIsoBlue, nRead) > 0) {
        psMask[idx] = RED_BLUE_WEIGHT;
      }
    }
  }

  gaussianBlur(psMask, W, H, SIGMA);

  const mask = new Uint8Array(W * H);
  for (let i = yStart; i < yEnd; i++) {
    for (let j = xStart; j < xEnd; j++) {
      let sum = 0;
      for (let v = -1; v <= 1; v++) {
        const r = (i + v) * W + j;
        sum += psMask[r - 1] + psMask[r] + psMask[r + 1];
      }
      if (sum >= THRESHOLD) mask[i * W + j] = 255;
    }
  }
  fillHoles(mask, W, xStart, xEnd, yStart, yEnd);
  report.mask = mask;

  // Only the tiles whose pixels show the demosaiced frame are demosaiced:
  // motion areas, and with smooth transitions the blend around them. The
  // edges the merge leaves are in the border RCD always fills.
  if (!showOnlyMask && !showMotion) {
    const tiles = new RcdTiles(W, H);
    for (let i = yStart; i < yEnd; i++) {
      for (let j = xStart, idx = i * W + j; j < xEnd; j++, idx++) {
        if (mask[idx] === 255 || (smoothTransitions && psMask[idx] > 1)) tiles.need(i + offsY, j + offsX);
      }
    }
    demosaic(tiles.wanted);
  }

  for (let i = yStart; i < yEnd; i++) {
    const mid = rowOf(i);
    for (let j = xStart; j < xEnd; j++) {
      const idx = i * W + j;
      const out = ((i + offsY) * W + j + offsX) * 4;
      const over = psMask[idx] - 1;
      const blend = !smoothTransitions ? 0 : smoothFactor === 0 ? 1 : over > 0 ? Math.pow(over, smoothFactor) : 0;
      if (showOnlyMask) {
        const v = smoothTransitions ? blend * 32768 : mask[idx] === 255 ? 65535 : 0;
        rgba[out] = rgba[out + 1] = rgba[out + 2] = v;
      } else if (mask[idx] === 255) {
        if (showMotion) {
          rgba[out] = 0;
          rgba[out + 1] = PAINT;
          rgba[out + 2] = 0;
        }
      } else {
        const green = (mid.g1[j] + mid.g2[j]) * 0.5;
        if (smoothTransitions) {
          rgba[out] = blend * (showMotion ? 0 : rgba[out]) + (1 - blend) * mid.red[j];
          rgba[out + 1] = blend * (showMotion ? PAINT : rgba[out + 1]) + (1 - blend) * green;
          rgba[out + 2] = blend * (showMotion ? 0 : rgba[out + 2]) + (1 - blend) * mid.blue[j];
        } else {
          rgba[out] = mid.red[j];
          rgba[out + 1] = green;
          rgba[out + 2] = mid.blue[j];
        }
      }
    }
  }
  return report;
}

/** The outer pixel of each side takes its inner neighbour's colour. */
function copyEdges(rgba: Float32Array, W: number, H: number): void {
  const copy = (to: number, from: number) => {
    rgba[to] = rgba[from];
    rgba[to + 1] = rgba[from + 1];
    rgba[to + 2] = rgba[from + 2];
  };
  for (let i = 1; i < H - 1; i++) {
    copy(i * W * 4, (i * W + 1) * 4);
    copy((i * W + W - 1) * 4, (i * W + W - 2) * 4);
  }
  for (let j = 0; j < W; j++) {
    copy(j * 4, (W + j) * 4);
    copy(((H - 1) * W + j) * 4, ((H - 2) * W + j) * 4);
  }
}

/** Sets every non-motion pixel of the area that can't reach the area's edge
 *  through non-motion pixels (4-connected): the holes in the motion mask. */
export function fillHoles(mask: Uint8Array, W: number, x0: number, x1: number, y0: number, y1: number): void {
  if (x1 <= x0 || y1 <= y0) return;
  const reached = new Uint8Array(mask.length);
  const stack: number[] = [];
  const seed = (i: number, j: number) => {
    const idx = i * W + j;
    if (mask[idx] === 0 && !reached[idx]) {
      reached[idx] = 1;
      stack.push(idx);
    }
  };
  for (let j = x0; j < x1; j++) {
    seed(y0, j);
    seed(y1 - 1, j);
  }
  for (let i = y0; i < y1; i++) {
    seed(i, x0);
    seed(i, x1 - 1);
  }
  for (let idx = stack.pop(); idx !== undefined; idx = stack.pop()) {
    const i = Math.floor(idx / W);
    const j = idx - i * W;
    if (i > y0) seed(i - 1, j);
    if (i < y1 - 1) seed(i + 1, j);
    if (j > x0) seed(i, j - 1);
    if (j < x1 - 1) seed(i, j + 1);
  }
  for (let i = y0; i < y1; i++) {
    for (let j = x0; j < x1; j++) {
      const idx = i * W + j;
      if (mask[idx] === 0 && !reached[idx]) mask[idx] = 255;
    }
  }
}
