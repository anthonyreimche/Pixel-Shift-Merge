// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// The camera's details from LibRaw's metadata(true), as far as the merge and
// its finish need them, and the levels Safelight's own decode of the file
// would use.

import { cfaFromFilters, type Cfa, type Levels } from "./mosaic";

/** The visible area's size as LibRaw reports it, which libraw-wasm gives
 *  already turned for a portrait flip: the one that fits the readout. */
export function visibleSize(r: { rawWidth: number; rawHeight: number; top: number; left: number; width: number; height: number }): { width: number; height: number } {
  const roomW = r.rawWidth - r.left;
  const roomH = r.rawHeight - r.top;
  if (r.width <= roomW && r.height <= roomH) return { width: r.width, height: r.height };
  if (r.height <= roomW && r.width <= roomH) return { width: r.height, height: r.width };
  return { width: Math.min(r.width, roomW), height: Math.min(r.height, roomH) };
}

export interface CameraDetails {
  make: string;
  model: string;
  iso: number;
  /** Null when LibRaw reports no three-colour Bayer layout. */
  cfa: Cfa | null;
  black: number;
  white: number;
  /** LibRaw's as-shot multipliers, else its daylight ones: red, green, blue. */
  mul: [number, number, number];
  /** Camera to linear Rec. 709, row-major 3x3. */
  rgbCam: number[];
  top: number;
  left: number;
  width: number;
  height: number;
}

// LibRaw's answer, crossing from its worker: plain objects and arrays whose
// fields are checked one by one.
type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose => (typeof v === "object" && v !== null ? (v as Loose) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(num) : []);

/** A 3x3 (of LibRaw's 3x4) matrix, row-major, when its first value passes `floor`. */
function matrixOf(v: unknown, floor: number): number[] | null {
  const rows = Array.isArray(v) ? v.map(nums) : [];
  if (rows.length < 3 || rows.some((r) => r.length < 3)) return null;
  const m = rows.slice(0, 3).flatMap((r) => r.slice(0, 3));
  return m[0] > floor && m.some((x) => x !== 0) ? m : null;
}

export function cameraDetails(meta: unknown): CameraDetails | null {
  const m = obj(meta);
  const colour = obj(m.color_data);
  const camMul = nums(colour.cam_mul);
  const preMul = nums(colour.pre_mul);
  const usable = camMul[0] > 0 && camMul[1] > 0 && camMul[2] > 0;
  const source = usable ? camMul : preMul;
  if (!(source[0] > 0 && source[1] > 0 && source[2] > 0)) return null;
  // Safelight's decode asks LibRaw for the camera's white balance, and with
  // it LibRaw takes the matrix the file carries (cmatrix, a PEF's for one)
  // over its own table's (dcraw's use_camera_matrix rule).
  const rgbCam = matrixOf(colour.cmatrix, 0.125) ?? matrixOf(colour.rgb_cam, 0);
  const white = num(colour.maximum);
  if (!rgbCam || white <= 0) return null;
  return {
    make: str(m.camera_make),
    model: str(m.camera_model),
    iso: num(m.iso_speed) || 100,
    cfa: cfaFromFilters(num(m.filters)),
    black: num(colour.black),
    white,
    mul: [source[0], source[1], source[2]],
    rgbCam,
    top: num(m.top_margin),
    left: num(m.left_margin),
    width: num(m.width),
    height: num(m.height),
  };
}

/** Multipliers with green at 1. */
export function greenOne(mul: readonly [number, number, number]): [number, number, number] {
  return [mul[0] / mul[1], 1, mul[2] / mul[1]];
}

/** The sensor's levels: a DNG's black by colour filter position when it
 *  tags one, else LibRaw's. */
export function sensorLevels(
  camera: CameraDetails,
  black: readonly [number, number, number, number] | undefined,
  mul: readonly [number, number, number],
): Levels {
  const b = black ?? [camera.black, camera.black, camera.black, camera.black];
  return { black: [b[0], b[1], b[2], b[3]], white: camera.white, mul: [mul[0], mul[1], mul[2]] };
}

/** The gain Safelight's own decode puts on the file past its sensor levels:
 *  LibRaw lowers its white to the first frame's brightest sample when that
 *  sits between 75 % and 100 % of the range above black (adjust_maximum, on
 *  by default). */
export function whiteGain(levels: Levels, brightest: number): number {
  const black = Math.min(...levels.black);
  const range = levels.white - black;
  const real = brightest - black;
  if (!(real > 0 && real < range && real > range * 0.75)) return 1;
  return range / real;
}
