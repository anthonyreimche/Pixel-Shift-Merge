// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// One decode's pixel work, as the merge worker runs it: an ARQ file's samples
// read, the levels Safelight's own decode would use measured, the frames
// merged (or the first frame binned, for a reduced decode) and finished to
// linear Rec. 709. Nothing here runs on the page.

import { whiteGain } from "./camera";
import { finishGrey, finishLinear } from "./finish";
import { pixelShift, type MergeSettings, type Shot } from "./merge";
import { arqView, scaleTables, type Cfa, type FrameView, type Levels, type Mosaic } from "./mosaic";
import { autoMultipliers } from "./wb";

/** Where the frames come from: LibRaw's readouts, or an ARQ file whose four
 *  samples a pixel the worker reads itself. */
export type FrameSource =
  | { kind: "views"; views: FrameView[] }
  | {
      kind: "arq";
      file: Blob;
      /** Where the samples start; they run on as one little-endian block. */
      dataOffset: number;
      rawWidth: number;
      rawHeight: number;
      top: number;
      left: number;
      /** The shots to rebuild: all four, or the first for a binned decode. */
      shots: number[];
    };

export interface MergeJob {
  width: number;
  height: number;
  cfa: Cfa;
  source: FrameSource;
  /** The sensor's levels, with the as-shot multipliers the image is delivered at. */
  levels: Levels;
  /** Camera to linear Rec. 709, row-major 3x3. */
  rgbCam: number[];
  shot: Shot;
  settings: MergeSettings;
  /** Bin the first frame 2x2 instead of merging: a half-size image. */
  binned: boolean;
}

export interface MergeOutput {
  data: Float32Array<ArrayBuffer>;
  width: number;
  height: number;
  /** The motion mask (255 = motion), when motion detection ran. */
  mask: Uint8Array | null;
}

/** `transient`: the failure may pass (memory ran out, the file couldn't be read). */
export type MergeReply = { output: MergeOutput } | { error: string; transient: boolean };

/** Per channel, from the merge's scale (`merged`) to the delivered one. */
export function channelGains(
  merged: readonly [number, number, number],
  delivered: readonly [number, number, number],
  gain: number,
): [number, number, number] {
  const maxMerged = Math.max(...merged);
  const maxOut = Math.max(...delivered);
  const g = (c: number) => ((delivered[c] / maxOut) / (merged[c] / maxMerged)) * gain;
  return [g(0), g(1), g(2)];
}

/** The brightest sample the first frame has in the visible area: of an ARQ
 *  file, of all four samples a pixel, as LibRaw counts them. */
export function brightestOf(view: FrameView, width: number, height: number): number {
  const perPixel = view.col === 1 ? 1 : 4;
  let max = 0;
  for (let i = 0; i < height; i++) {
    const start = view.base + i * view.row;
    for (let j = 0; j < width; j++) {
      for (let s = 0; s < perPixel; s++) {
        const v = view.data[start + j * view.col + s];
        if (v > max) max = v;
      }
    }
  }
  return max;
}

async function framesOf(source: FrameSource): Promise<FrameView[]> {
  if (source.kind === "views") return source.views;
  const { file, dataOffset, rawWidth, rawHeight, top, left, shots } = source;
  const bytes = await file.slice(dataOffset, dataOffset + rawWidth * rawHeight * 8).arrayBuffer();
  const samples = new Uint16Array(bytes);
  if (samples.length !== rawWidth * rawHeight * 4) throw new Error("the file ends before its samples do");
  return shots.map((shot) => arqView(samples, rawWidth, top, left, shot));
}

export async function runMerge(job: MergeJob): Promise<MergeOutput> {
  const frames = await framesOf(job.source);
  const mosaic: Mosaic = { width: job.width, height: job.height, cfa: job.cfa, frames };
  const sensor = job.levels;
  const gain = whiteGain(sensor, brightestOf(frames[0], job.width, job.height));
  // RawTherapee scales the frames by its automatic pre-demosaic white
  // balance before the merge (wb.ts); a binned frame isn't merged.
  const detection = job.binned ? null : autoMultipliers(frames[0], job.cfa, job.width, job.height, sensor.black, sensor.white);
  const levels: Levels = detection ? { ...sensor, mul: detection } : sensor;
  const tables = scaleTables(job.cfa, levels);
  const gains = channelGains(levels.mul, sensor.mul, gain);
  if (job.binned) {
    const out = binFirstFrame(mosaic, tables);
    finishLinear(out.data, sensor.mul, job.rgbCam, gains);
    return { ...out, mask: null };
  }
  const data = new Float32Array(mosaic.width * mosaic.height * 4);
  const report = pixelShift(mosaic, levels, tables, job.shot, job.settings, data);
  if (job.settings.motionDetection && job.settings.showMaskOnly) finishGrey(data);
  else finishLinear(data, sensor.mul, job.rgbCam, gains);
  return { data, width: mosaic.width, height: mosaic.height, mask: report.mask };
}

/** The first frame at half size: each 2x2 block's red, mean green and blue. */
export function binFirstFrame(mosaic: Mosaic, tables: Float32Array[]): { data: Float32Array<ArrayBuffer>; width: number; height: number } {
  const width = Math.floor(mosaic.width / 2);
  const height = Math.floor(mosaic.height / 2);
  const f = mosaic.frames[0];
  const data = new Float32Array(width * height * 4);
  const colour = mosaic.cfa;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 0;
      for (let p = 0; p < 4; p++) {
        const i = 2 * y + (p >> 1);
        const j = 2 * x + (p & 1);
        const v = tables[p][f.data[f.base + i * f.row + j * f.col + f.pos[p]]];
        data[o + colour[p]] += colour[p] === 1 ? v * 0.5 : v;
      }
    }
  }
  return { data, width, height };
}
