// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// Ratio Corrected Demosaicing, ported from RawTherapee 5.13
// (rtengine/rcd_demosaic.cc, tiled version) and the border fill it runs after
// (demosaic_algos.cc border_interpolate). Copyright (c) 2017-2020 Luis Sanz
// Rodriguez and Ingo Weyrich; GPL-3.0-or-later.
// Fills the motion areas of a merge from one frame.

import type { Cfa } from "./mosaic";

const TILE_BORDER = 9;
const RCD_BORDER = 9;
const TILE = 194;
const TILE_N = TILE - 2 * TILE_BORDER;
const EPS = 1e-5;
const EPSSQ = 1e-10;
const SCALE = 65536;

const sq = (x: number) => x * x;
const intp = (a: number, b: number, c: number) => a * b + (1 - a) * c;

/** Which of RCD's tiles a caller needs. Tile (tr, tc) writes rows
 *  tr * 176 + 9 to tr * 176 + 184 and the same columns: each pixel inside the
 *  border is written by exactly one tile. */
export class RcdTiles {
  private readonly cols: number;
  private readonly flags: Uint8Array;

  constructor(width: number, height: number) {
    this.cols = Math.ceil(width / TILE_N);
    this.flags = new Uint8Array(this.cols * Math.ceil(height / TILE_N));
  }

  /** Pixel (i, j) must be demosaiced. The border (rcdDemosaic) always is. */
  need(i: number, j: number): void {
    if (i < TILE_BORDER || j < TILE_BORDER) return;
    const tr = Math.floor((i - TILE_BORDER) / TILE_N);
    const tc = Math.floor((j - TILE_BORDER) / TILE_N);
    if (tc < this.cols && tr * this.cols + tc < this.flags.length) this.flags[tr * this.cols + tc] = 1;
  }

  readonly wanted = (tr: number, tc: number): boolean => this.flags[tr * this.cols + tc] === 1;
}

/** Demosaics the frame `sample` reads (scaled values, 0 to 65535) into
 *  `rgba`, `width` x `height` x 4, leaving the fourth value alone: the tiles
 *  `wanted` names (all by default) and the border. */
export function rcdDemosaic(
  width: number,
  height: number,
  cfa: Cfa,
  sample: (i: number, j: number) => number,
  rgba: Float32Array,
  wanted: (tr: number, tc: number) => boolean = () => true,
): void {
  const fc = (r: number, c: number) => cfa[((r & 1) << 1) | (c & 1)];
  const numTh = Math.ceil(height / TILE_N);
  const numTw = Math.ceil(width / TILE_N);
  const w1 = TILE, w2 = 2 * TILE, w3 = 3 * TILE, w4 = 4 * TILE;

  const cfaT = new Float32Array(TILE * TILE);
  const rgb = [new Float32Array(TILE * TILE), new Float32Array(TILE * TILE), new Float32Array(TILE * TILE)];
  const vhDir = new Float32Array(TILE * TILE);
  const pqDir = new Float32Array((TILE * TILE) / 2);
  const lpf = pqDir;
  const pHpf = new Float32Array((TILE * TILE) / 2);
  const qHpf = new Float32Array((TILE * TILE) / 2);
  const bufferV = [new Float32Array(TILE - 8), new Float32Array(TILE - 8), new Float32Array(TILE - 8)];
  const bufferH = new Float32Array(TILE - 6);

  for (let tr = 0; tr < numTh; tr++) {
    for (let tc = 0; tc < numTw; tc++) {
      if (!wanted(tr, tc)) continue;
      const rowStart = tr * TILE_N;
      const rowEnd = Math.min(rowStart + TILE, height);
      if (rowStart + TILE_BORDER === rowEnd - TILE_BORDER) continue;
      const colStart = tc * TILE_N;
      const colEnd = Math.min(colStart + TILE, width);
      if (colStart + TILE_BORDER === colEnd - TILE_BORDER) continue;
      const tileRows = Math.min(rowEnd - rowStart, TILE);
      const tileCols = Math.min(colEnd - colStart, TILE);

      for (let row = rowStart; row < rowEnd; row++) {
        const c0 = fc(row, colStart);
        const c1 = fc(row, colStart + 1);
        for (let col = colStart, indx = (row - rowStart) * TILE; col < colEnd; col++, indx++) {
          const v = Math.min(1, Math.max(0, sample(row, col) / SCALE));
          cfaT[indx] = v;
          rgb[c0][indx] = v;
          rgb[c1][indx] = v;
        }
      }

      // Step 1: cardinal and diagonal interpolation directions.
      for (let row = 3; row < Math.min(tileRows - 3, 5); row++) {
        for (let col = 4, indx = row * TILE + col; col < tileCols - 4; col++, indx++) {
          bufferV[row - 3][col - 4] = sq(cfaT[indx - w3] - cfaT[indx - w1] - cfaT[indx + w1] + cfaT[indx + w3] - 3 * (cfaT[indx - w2] + cfaT[indx + w2]) + 6 * cfaT[indx]);
        }
      }
      let V0 = bufferV[0], V1 = bufferV[1], V2 = bufferV[2];
      for (let row = 4; row < tileRows - 4; row++) {
        for (let col = 3, indx = row * TILE + col; col < tileCols - 3; col++, indx++) {
          bufferH[col - 3] = sq(cfaT[indx - 3] - cfaT[indx - 1] - cfaT[indx + 1] + cfaT[indx + 3] - 3 * (cfaT[indx - 2] + cfaT[indx + 2]) + 6 * cfaT[indx]);
        }
        for (let col = 4, indx = (row + 1) * TILE + col; col < tileCols - 4; col++, indx++) {
          V2[col - 4] = sq(cfaT[indx - w3] - cfaT[indx - w1] - cfaT[indx + w1] + cfaT[indx + w3] - 3 * (cfaT[indx - w2] + cfaT[indx + w2]) + 6 * cfaT[indx]);
        }
        for (let col = 4, indx = row * TILE + col; col < tileCols - 4; col++, indx++) {
          const vStat = Math.max(EPSSQ, V0[col - 4] + V1[col - 4] + V2[col - 4]);
          const hStat = Math.max(EPSSQ, bufferH[col - 4] + bufferH[col - 3] + bufferH[col - 2]);
          vhDir[indx] = vStat / (vStat + hStat);
        }
        // Rows 0, 1, 2 become 1, 2, 0.
        const t = V0;
        V0 = V1;
        V1 = V2;
        V2 = t;
      }

      // Step 2: low pass filter of the raw samples.
      for (let row = 2; row < tileRows - 2; row++) {
        for (let col = 2 + (fc(row, 0) & 1), indx = row * TILE + col, lp = indx >> 1; col < tileCols - 2; col += 2, indx += 2, lp++) {
          lpf[lp] = cfaT[indx] +
            0.5 * (cfaT[indx - w1] + cfaT[indx + w1] + cfaT[indx - 1] + cfaT[indx + 1]) +
            0.25 * (cfaT[indx - w1 - 1] + cfaT[indx - w1 + 1] + cfaT[indx + w1 - 1] + cfaT[indx + w1 + 1]);
        }
      }

      // Step 3: green at red and blue positions.
      for (let row = 4; row < tileRows - 4; row++) {
        for (let col = 4 + (fc(row, 0) & 1), indx = row * TILE + col, lp = indx >> 1; col < tileCols - 4; col += 2, indx += 2, lp++) {
          const cfai = cfaT[indx];
          const nGrad = EPS + (Math.abs(cfaT[indx - w1] - cfaT[indx + w1]) + Math.abs(cfai - cfaT[indx - w2])) + (Math.abs(cfaT[indx - w1] - cfaT[indx - w3]) + Math.abs(cfaT[indx - w2] - cfaT[indx - w4]));
          const sGrad = EPS + (Math.abs(cfaT[indx - w1] - cfaT[indx + w1]) + Math.abs(cfai - cfaT[indx + w2])) + (Math.abs(cfaT[indx + w1] - cfaT[indx + w3]) + Math.abs(cfaT[indx + w2] - cfaT[indx + w4]));
          const wGrad = EPS + (Math.abs(cfaT[indx - 1] - cfaT[indx + 1]) + Math.abs(cfai - cfaT[indx - 2])) + (Math.abs(cfaT[indx - 1] - cfaT[indx - 3]) + Math.abs(cfaT[indx - 2] - cfaT[indx - 4]));
          const eGrad = EPS + (Math.abs(cfaT[indx - 1] - cfaT[indx + 1]) + Math.abs(cfai - cfaT[indx + 2])) + (Math.abs(cfaT[indx + 1] - cfaT[indx + 3]) + Math.abs(cfaT[indx + 2] - cfaT[indx + 4]));

          const lpfi = lpf[lp];
          const nEst = cfaT[indx - w1] * (lpfi + lpfi) / (EPS + lpfi + lpf[lp - w1]);
          const sEst = cfaT[indx + w1] * (lpfi + lpfi) / (EPS + lpfi + lpf[lp + w1]);
          const wEst = cfaT[indx - 1] * (lpfi + lpfi) / (EPS + lpfi + lpf[lp - 1]);
          const eEst = cfaT[indx + 1] * (lpfi + lpfi) / (EPS + lpfi + lpf[lp + 1]);

          const vEst = (sGrad * nEst + nGrad * sEst) / (nGrad + sGrad);
          const hEst = (wGrad * eEst + eGrad * wEst) / (eGrad + wGrad);

          const vhCentral = vhDir[indx];
          const vhNeighbourhood = 0.25 * ((vhDir[indx - w1 - 1] + vhDir[indx - w1 + 1]) + (vhDir[indx + w1 - 1] + vhDir[indx + w1 + 1]));
          const vhDisc = Math.abs(0.5 - vhCentral) < Math.abs(0.5 - vhNeighbourhood) ? vhNeighbourhood : vhCentral;
          rgb[1][indx] = intp(vhDisc, hEst, vEst);
        }
      }

      // Step 4.0: P/Q diagonal colour difference high pass, squared.
      for (let row = 3; row < tileRows - 3; row++) {
        for (let col = 3, indx = row * TILE + col, i2 = indx >> 1; col < tileCols - 3; col += 2, indx += 2, i2++) {
          pHpf[i2] = sq(cfaT[indx - w3 - 3] - cfaT[indx - w1 - 1] - cfaT[indx + w1 + 1] + cfaT[indx + w3 + 3] - 3 * (cfaT[indx - w2 - 2] + cfaT[indx + w2 + 2]) + 6 * cfaT[indx]);
          qHpf[i2] = sq(cfaT[indx - w3 + 3] - cfaT[indx - w1 + 1] - cfaT[indx + w1 - 1] + cfaT[indx + w3 - 3] - 3 * (cfaT[indx - w2 + 2] + cfaT[indx + w2 - 2]) + 6 * cfaT[indx]);
        }
      }

      // Step 4.1: P/Q diagonal discrimination.
      for (let row = 4; row < tileRows - 4; row++) {
        for (
          let col = 4 + (fc(row, 0) & 1), indx = row * TILE + col, i2 = indx >> 1, i3 = (indx - w1 - 1) >> 1, i4 = (indx + w1 - 1) >> 1;
          col < tileCols - 4;
          col += 2, indx += 2, i2++, i3++, i4++
        ) {
          const pStat = Math.max(EPSSQ, pHpf[i3] + pHpf[i2] + pHpf[i4 + 1]);
          const qStat = Math.max(EPSSQ, qHpf[i3 + 1] + qHpf[i2] + qHpf[i4]);
          pqDir[i2] = pStat / (pStat + qStat);
        }
      }

      // Step 4.2: red at blue and blue at red.
      for (let row = 4; row < tileRows - 4; row++) {
        const startCol = 4 + (fc(row, 0) & 1);
        const c = 2 - fc(row, startCol);
        const rc = rgb[c];
        const rg = rgb[1];
        for (
          let col = startCol, indx = row * TILE + col, pq = indx >> 1, pq2 = (indx - w1 - 1) >> 1, pq3 = (indx + w1 - 1) >> 1;
          col < tileCols - 4;
          col += 2, indx += 2, pq++, pq2++, pq3++
        ) {
          const pqCentral = pqDir[pq];
          const pqNeighbourhood = 0.25 * (pqDir[pq2] + pqDir[pq2 + 1] + pqDir[pq3] + pqDir[pq3 + 1]);
          const pqDisc = Math.abs(0.5 - pqCentral) < Math.abs(0.5 - pqNeighbourhood) ? pqNeighbourhood : pqCentral;

          const nwGrad = EPS + Math.abs(rc[indx - w1 - 1] - rc[indx + w1 + 1]) + Math.abs(rc[indx - w1 - 1] - rc[indx - w3 - 3]) + Math.abs(rg[indx] - rg[indx - w2 - 2]);
          const neGrad = EPS + Math.abs(rc[indx - w1 + 1] - rc[indx + w1 - 1]) + Math.abs(rc[indx - w1 + 1] - rc[indx - w3 + 3]) + Math.abs(rg[indx] - rg[indx - w2 + 2]);
          const swGrad = EPS + Math.abs(rc[indx - w1 + 1] - rc[indx + w1 - 1]) + Math.abs(rc[indx + w1 - 1] - rc[indx + w3 - 3]) + Math.abs(rg[indx] - rg[indx + w2 - 2]);
          const seGrad = EPS + Math.abs(rc[indx - w1 - 1] - rc[indx + w1 + 1]) + Math.abs(rc[indx + w1 + 1] - rc[indx + w3 + 3]) + Math.abs(rg[indx] - rg[indx + w2 + 2]);

          const nwEst = rc[indx - w1 - 1] - rg[indx - w1 - 1];
          const neEst = rc[indx - w1 + 1] - rg[indx - w1 + 1];
          const swEst = rc[indx + w1 - 1] - rg[indx + w1 - 1];
          const seEst = rc[indx + w1 + 1] - rg[indx + w1 + 1];

          const pEst = (nwGrad * seEst + seGrad * nwEst) / (nwGrad + seGrad);
          const qEst = (neGrad * swEst + swGrad * neEst) / (neGrad + swGrad);
          rc[indx] = rg[indx] + intp(pqDisc, qEst, pEst);
        }
      }

      // Step 4.3: red and blue at green positions.
      for (let row = 4; row < tileRows - 4; row++) {
        for (let col = 4 + (fc(row, 1) & 1), indx = row * TILE + col; col < tileCols - 4; col += 2, indx += 2) {
          const vhCentral = vhDir[indx];
          const vhNeighbourhood = 0.25 * ((vhDir[indx - w1 - 1] + vhDir[indx - w1 + 1]) + (vhDir[indx + w1 - 1] + vhDir[indx + w1 + 1]));
          const vhDisc = Math.abs(0.5 - vhCentral) < Math.abs(0.5 - vhNeighbourhood) ? vhNeighbourhood : vhCentral;
          const rg = rgb[1];
          const rgb1 = rg[indx];
          const n1 = EPS + Math.abs(rgb1 - rg[indx - w2]);
          const s1 = EPS + Math.abs(rgb1 - rg[indx + w2]);
          const w1g = EPS + Math.abs(rgb1 - rg[indx - 2]);
          const e1 = EPS + Math.abs(rgb1 - rg[indx + 2]);
          const gN = rg[indx - w1];
          const gS = rg[indx + w1];
          const gW = rg[indx - 1];
          const gE = rg[indx + 1];
          for (let c = 0; c <= 2; c += 2) {
            const rc = rgb[c];
            const snAbs = Math.abs(rc[indx - w1] - rc[indx + w1]);
            const ewAbs = Math.abs(rc[indx - 1] - rc[indx + 1]);
            const nGrad = n1 + snAbs + Math.abs(rc[indx - w1] - rc[indx - w3]);
            const sGrad = s1 + snAbs + Math.abs(rc[indx + w1] - rc[indx + w3]);
            const wGrad = w1g + ewAbs + Math.abs(rc[indx - 1] - rc[indx - 3]);
            const eGrad = e1 + ewAbs + Math.abs(rc[indx + 1] - rc[indx + 3]);

            const nEst = rc[indx - w1] - gN;
            const sEst = rc[indx + w1] - gS;
            const wEst = rc[indx - 1] - gW;
            const eEst = rc[indx + 1] - gE;

            const vEst = (nGrad * sEst + sGrad * nEst) / (nGrad + sGrad);
            const hEst = (eGrad * wEst + wGrad * eEst) / (eGrad + wGrad);
            rc[indx] = rgb1 + intp(vhDisc, hEst, vEst);
          }
        }
      }

      // The outermost tiles keep a smaller margin.
      const firstVertical = rowStart + (tr === 0 ? RCD_BORDER : TILE_BORDER);
      const lastVertical = rowEnd - (tr === numTh - 1 ? RCD_BORDER : TILE_BORDER);
      const firstHorizontal = colStart + (tc === 0 ? RCD_BORDER : TILE_BORDER);
      const lastHorizontal = colEnd - (tc === numTw - 1 ? RCD_BORDER : TILE_BORDER);
      for (let row = firstVertical; row < lastVertical; row++) {
        for (let col = firstHorizontal; col < lastHorizontal; col++) {
          const idx = (row - rowStart) * TILE + col - colStart;
          const o = (row * width + col) * 4;
          rgba[o] = Math.max(0, rgb[0][idx] * SCALE);
          rgba[o + 1] = Math.max(0, rgb[1][idx] * SCALE);
          rgba[o + 2] = Math.max(0, rgb[2][idx] * SCALE);
        }
      }
    }
  }
  borderInterpolate(width, height, RCD_BORDER, cfa, sample, rgba);
}

/** Pixels within `border` of the edge: each colour the mean of its samples in
 *  the 3x3 around, the pixel's own colour its sample. */
export function borderInterpolate(
  width: number,
  height: number,
  border: number,
  cfa: Cfa,
  sample: (i: number, j: number) => number,
  rgba: Float32Array,
): void {
  const fc = (r: number, c: number) => cfa[((r & 1) << 1) | (c & 1)];
  const sum = [0, 0, 0];
  const count = [0, 0, 0];
  const fill = (i: number, j: number) => {
    sum[0] = sum[1] = sum[2] = 0;
    count[0] = count[1] = count[2] = 0;
    for (let i1 = i - 1; i1 < i + 2; i1++) {
      if (i1 < 0 || i1 >= height) continue;
      for (let j1 = j - 1; j1 < j + 2; j1++) {
        if (j1 < 0 || j1 >= width) continue;
        const c = fc(i1, j1);
        sum[c] += sample(i1, j1);
        count[c]++;
      }
    }
    const own = fc(i, j);
    const o = (i * width + j) * 4;
    for (let c = 0; c < 3; c++) rgba[o + c] = c === own ? sample(i, j) : sum[c] / count[c];
  };
  for (let i = 0; i < height; i++) {
    const edgeRow = i < border || i >= height - border;
    if (edgeRow) {
      for (let j = 0; j < width; j++) fill(i, j);
      continue;
    }
    for (let j = 0; j < Math.min(border, width); j++) fill(i, j);
    for (let j = Math.max(border, width - border); j < width; j++) fill(i, j);
  }
}
