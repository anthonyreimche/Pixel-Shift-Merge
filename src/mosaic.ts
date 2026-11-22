// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// The frames as the merge reads them: sensor samples in the visible area's
// coordinates, scaled the way RawTherapee scales raw data before it
// demosaics (rawimagesource.cc scaleColors, calculate_scale_mul).

/** The colour at each colour filter position, row-major 2x2: 0 red, 1 green, 2 blue. */
export type Cfa = readonly [number, number, number, number];

/** Where a frame's samples are in its buffer. Sample (i, j) of the visible
 *  area is `data[base + i * row + j * col + pos[(i & 1) * 2 + (j & 1)]]`. A
 *  LibRaw readout has col 1 and pos all 0; an ARQ file keeps four samples a
 *  pixel and each frame takes the one of its colour. */
export interface FrameView {
  data: Uint16Array;
  base: number;
  row: number;
  col: number;
  pos: readonly [number, number, number, number];
}

export interface Mosaic {
  width: number;
  height: number;
  cfa: Cfa;
  frames: FrameView[];
}

export interface Levels {
  /** By colour filter position, row-major 2x2. */
  black: readonly [number, number, number, number];
  white: number;
  /** White balance multipliers: red, green, blue. */
  mul: readonly [number, number, number];
}

/** LibRaw's `filters` read at the visible area's 2x2 origin. */
export function cfaFromFilters(filters: number): Cfa | null {
  const at = (r: number, c: number) => {
    const v = (filters >>> ((((r << 1) & 14) | (c & 1)) << 1)) & 3;
    return v === 3 ? 1 : v;
  };
  const cfa: Cfa = [at(0, 0), at(0, 1), at(1, 0), at(1, 1)];
  const reds = cfa.filter((c) => c === 0).length;
  const greens = cfa.filter((c) => c === 1).length;
  const blues = cfa.filter((c) => c === 2).length;
  const diagonalGreens = (cfa[0] === 1 && cfa[3] === 1) || (cfa[1] === 1 && cfa[2] === 1);
  return reds === 1 && greens === 2 && blues === 1 && diagonalGreens ? cfa : null;
}

/** RawTherapee's scale_mul: (mul / max mul) * 65535 / (white - black), by
 *  colour filter position. */
export function scaleMultipliers(cfa: Cfa, levels: Levels): Float64Array {
  const maxMul = Math.max(...levels.mul);
  const out = new Float64Array(4);
  for (let p = 0; p < 4; p++) out[p] = (levels.mul[cfa[p]] / maxMul) * 65535 / (levels.white - levels.black[p]);
  return out;
}

/** A table per colour filter position from a 16-bit sample to its scaled
 *  value: max(0, raw - black) * scale. */
export function scaleTables(cfa: Cfa, levels: Levels): Float32Array[] {
  const scale = scaleMultipliers(cfa, levels);
  return [0, 1, 2, 3].map((p) => {
    const t = new Float32Array(65536);
    const black = levels.black[p];
    for (let v = 0; v < 65536; v++) t[v] = Math.max(0, v - black) * scale[p];
    return t;
  });
}

/** A LibRaw readout as a frame: the visible area starts at the margins. */
export function readoutView(data: Uint16Array, rawWidth: number, top: number, left: number): FrameView {
  return { data, base: top * rawWidth + left, row: rawWidth, col: 1, pos: [0, 0, 0, 0] };
}

/** The ARQ positions RawTherapee gives the four shots (dcraw.cc
 *  sony_arq_load_raw, frame2pos): shot s sees the sensor moved by bit 0 rows
 *  and bit 1 columns. */
const ARQ_POSITION = [0, 1, 3, 2] as const;

/** Shot `shot` of an ARQ file's samples (four a pixel, by colour filter
 *  position), as RawTherapee rebuilds it: rows and columns moved by the
 *  shot's offset, each sample the one of the colour at its sensor position. */
export function arqView(data: Uint16Array, rawWidth: number, top: number, left: number, shot: number): FrameView {
  const position = ARQ_POSITION[shot];
  const dy = position & 1;
  const dx = (position >> 1) & 1;
  const row = rawWidth * 4;
  return { data, base: (top - dy) * row + (left - dx) * 4, row, col: 4, pos: [0, 1, 2, 3] };
}

/** Frame `f`'s scaled sample at (i, j), or 0 where the frame has none (an ARQ
 *  shot's first row or column). */
export function sampleAt(view: FrameView, tables: Float32Array[], i: number, j: number): number {
  const p = ((i & 1) << 1) | (j & 1);
  const raw = view.data[view.base + i * view.row + j * view.col + view.pos[p]];
  return raw === undefined ? 0 : tables[p][raw];
}
