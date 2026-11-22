// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// RawTherapee's automatic pre-demosaic white balance (rawimage.cc
// get_colorsCoeff, its default "Preprocess WB: Auto"): each colour's mean over
// 8x8 blocks that hold no sample near black or white. RawTherapee scales the
// frames by it before the merge, and the motion detection judges clipping in
// that scale, so the merge uses it too. The image is delivered at the as-shot
// white balance all the same (job.ts channelGains).

import type { Cfa, FrameView } from "./mosaic";

const BLACK_MARGIN = 8;
const WHITE_MARGIN = 25;

/** Red, green, blue multipliers, or null where a colour had no usable block. */
export function autoMultipliers(
  view: FrameView,
  cfa: Cfa,
  width: number,
  height: number,
  black: readonly [number, number, number, number],
  white: number,
): [number, number, number] | null {
  const sum = [0, 0, 0, 0];
  const count = [0, 0, 0, 0];
  const block = [0, 0, 0, 0];
  const blockCount = [0, 0, 0, 0];
  for (let row = 0; row < height; row += 8) {
    const yMax = Math.min(row + 8, height);
    for (let col = 0; col < width; col += 8) {
      const xMax = Math.min(col + 8, width);
      block.fill(0);
      blockCount.fill(0);
      let usable = true;
      for (let y = row; y < yMax && usable; y++) {
        for (let x = col; x < xMax; x++) {
          const p = ((y & 1) << 1) | (x & 1);
          const v = view.data[view.base + y * view.row + x * view.col + view.pos[p]];
          if (v > white - WHITE_MARGIN || v < black[p] + BLACK_MARGIN) {
            usable = false;
            break;
          }
          block[p] += v - black[p];
          blockCount[p]++;
        }
      }
      if (!usable) continue;
      for (let p = 0; p < 4; p++) {
        sum[p] += block[p];
        count[p] += blockCount[p];
      }
    }
  }
  const byColour = [0, 0, 0];
  const greens: number[] = [];
  for (let p = 0; p < 4; p++) {
    if (sum[p] <= 0) return null;
    const m = count[p] / sum[p];
    if (cfa[p] === 1) greens.push(m);
    else byColour[cfa[p]] = m;
  }
  byColour[1] = greens.reduce((a, b) => a + b, 0) / greens.length;
  return [byColour[0], byColour[1], byColour[2]];
}
