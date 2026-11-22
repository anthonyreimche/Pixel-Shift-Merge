// Synthetic pixel-shift frames: a scene of known red, green and blue, sampled
// as a sensor with an RGGB filter array sees it at each of the four shifts.
// With black 0, white 65535 and unit multipliers the merge's scaled values
// are the samples themselves, so the merge can be checked against the scene.

import type { Levels, Mosaic } from "../../src/mosaic";
import { readoutView } from "../../src/mosaic";

export const RGGB = [0, 1, 1, 2] as const;
export const UNIT_LEVELS: Levels = { black: [0, 0, 0, 0], white: 65535, mul: [1, 1, 1] };

/** Where each frame's sample sees the scene from: (dy, dx). */
export const SHIFT = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

export type Scene = (i: number, j: number, colour: number) => number;

/** A smooth scene: gentle gradients, different per colour. */
export const smooth: Scene = (i, j, c) => 6000 + 1500 * c + 40 * i + 25 * j + 300 * Math.sin((i + 2 * j) / 9);

/** Frame k of `scene`, `width` x `height`, each sample the scene's colour at
 *  its sensor position, from the scene point the frame's shift puts there. */
export function frameOf(scene: Scene, width: number, height: number, k: number): Uint16Array<ArrayBuffer> {
  const [dy, dx] = SHIFT[k];
  const data = new Uint16Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const colour = RGGB[((r & 1) << 1) | (c & 1)];
      const v = scene(Math.max(0, r - dy), Math.max(0, c - dx), colour);
      data[r * width + c] = Math.round(Math.min(65535, Math.max(0, v)));
    }
  }
  return data;
}

/** The four frames as a mosaic; `scenes` gives each frame its own scene. */
export function mosaicOf(width: number, height: number, scenes: Scene | [Scene, Scene, Scene, Scene]): Mosaic {
  const per = Array.isArray(scenes) ? scenes : [scenes, scenes, scenes, scenes];
  return {
    width,
    height,
    cfa: RGGB,
    frames: per.map((scene, k) => readoutView(frameOf(scene, width, height, k), width, 0, 0)),
  };
}

/** The scene rounded as the frames hold it. */
export function expected(scene: Scene, i: number, j: number, colour: number): number {
  return Math.round(Math.min(65535, Math.max(0, scene(i, j, colour))));
}
