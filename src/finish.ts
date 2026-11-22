// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// From the merge's scaled camera RGB to what Safelight asks of a RAW decode:
// linear Rec. 709, balanced at the as-shot multipliers, the least amplified
// channel saturating at 1. Safelight's own decode asks LibRaw for highlight
// mode 2, so clipped pixels get dcraw's blend_highlights here too.

/** dcraw's blend_highlights for three colours (dcraw.c; LibRaw). */
const TRANS = [
  [1, 1, 1],
  [1.7320508, -1.7320508, 0],
  [-1, -1, 2],
];
const ITRANS = [
  [1, 0.8660254, -0.5],
  [1, -0.8660254, -0.5],
  [1, 0, 1],
];

/** Finishes `rgba` in place: each pixel's camera RGB times `gains` must be
 *  white balanced at `mul` so the most amplified channel's white is 65535. It
 *  is blended where clipped, multiplied by `rgbCam` (row-major 3x3, camera to
 *  linear Rec. 709) and scaled so the least amplified channel's white is 1.
 *  Alpha becomes 1. */
export function finishLinear(
  rgba: Float32Array,
  mul: readonly [number, number, number],
  rgbCam: readonly number[],
  gains: readonly [number, number, number] = [1, 1, 1],
): void {
  const maxMul = Math.max(...mul);
  const minMul = Math.min(...mul);
  const clip = (65535 * minMul) / maxMul;
  const out = maxMul / minMul / 65535;
  const m = rgbCam;
  const cam = [0, 0, 0];
  const clipped = [0, 0, 0];
  const lab0 = [0, 0, 0];
  const lab1 = [0, 0, 0];
  for (let o = 0; o < rgba.length; o += 4) {
    let r = Math.min(65535, rgba[o] * gains[0]);
    let g = Math.min(65535, rgba[o + 1] * gains[1]);
    let b = Math.min(65535, rgba[o + 2] * gains[2]);
    if (r > clip || g > clip || b > clip) {
      cam[0] = r; cam[1] = g; cam[2] = b;
      clipped[0] = Math.min(r, clip); clipped[1] = Math.min(g, clip); clipped[2] = Math.min(b, clip);
      let sum0 = 0;
      let sum1 = 0;
      for (let c = 0; c < 3; c++) {
        lab0[c] = TRANS[c][0] * cam[0] + TRANS[c][1] * cam[1] + TRANS[c][2] * cam[2];
        lab1[c] = TRANS[c][0] * clipped[0] + TRANS[c][1] * clipped[1] + TRANS[c][2] * clipped[2];
        if (c > 0) {
          sum0 += lab0[c] * lab0[c];
          sum1 += lab1[c] * lab1[c];
        }
      }
      const chratio = sum0 > 0 ? Math.sqrt(sum1 / sum0) : 0;
      lab0[1] *= chratio;
      lab0[2] *= chratio;
      r = (ITRANS[0][0] * lab0[0] + ITRANS[0][1] * lab0[1] + ITRANS[0][2] * lab0[2]) / 3;
      g = (ITRANS[1][0] * lab0[0] + ITRANS[1][1] * lab0[1] + ITRANS[1][2] * lab0[2]) / 3;
      b = (ITRANS[2][0] * lab0[0] + ITRANS[2][1] * lab0[1] + ITRANS[2][2] * lab0[2]) / 3;
    }
    rgba[o] = (m[0] * r + m[1] * g + m[2] * b) * out;
    rgba[o + 1] = (m[3] * r + m[4] * g + m[5] * b) * out;
    rgba[o + 2] = (m[6] * r + m[7] * g + m[8] * b) * out;
    rgba[o + 3] = 1;
  }
}

/** The mask views as grey: 65535 is white (1). */
export function finishGrey(rgba: Float32Array): void {
  for (let o = 0; o < rgba.length; o += 4) {
    const v = rgba[o + 1] / 65535;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
    rgba[o + 3] = 1;
  }
}
