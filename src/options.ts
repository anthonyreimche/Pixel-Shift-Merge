// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// The merge's options: the person's Preferences, read into one value the
// decoder holds for as long as it is registered.

import type { SettingsField } from "./safelight";

export const EXT_ID = "pixel-shift-merge";

/** Which frame a number names: 0 is the first frame shot. */
export type FrameIndex = 0 | 1 | 2 | 3;

export interface MergeOptions {
  /** Leave the file to Safelight's own decode, which reads the first frame. */
  firstFrameOnly: boolean;
  motionDetection: boolean;
  /** -2 to 2: the noise model's electrons per ISO are scaled by 2^(s - 1). */
  sensitivity: number;
  /** The frame motion areas are filled from, demosaiced. */
  fillFrame: FrameIndex;
  /** 0 to MAX_SMOOTH: 0 is a hard edge around motion areas. */
  smooth: number;
  equalizeBrightness: boolean;
  /** With equalizeBrightness: each colour by its own median, not green's. */
  equalizePerChannel: boolean;
  /** Paint motion areas green over the merge. */
  showMotion: boolean;
  /** Show the motion mask alone, in grey. */
  showMaskOnly: boolean;
}

export const DEFAULT_OPTIONS: MergeOptions = {
  firstFrameOnly: false,
  motionDetection: true,
  sensitivity: 0,
  fillFrame: 0,
  smooth: 0.7,
  equalizeBrightness: false,
  equalizePerChannel: false,
  showMotion: false,
  showMaskOnly: false,
};

/** At 1 the blend gives every pixel to the demosaiced frame, which is a
 *  single frame, not a merge; the option stops short of it. */
export const MAX_SMOOTH = 0.95;

export const SETTING = {
  firstFrameOnly: "firstFrameOnly",
  motionDetection: "motionDetection",
  sensitivity: "sensitivity",
  fillFrame: "fillFrame",
  smooth: "smooth",
  equalizeBrightness: "equalizeBrightness",
  equalizePerChannel: "equalizePerChannel",
  showMotion: "showMotion",
  showMaskOnly: "showMaskOnly",
} as const;

export const SETTINGS_FIELDS: SettingsField[] = [
  {
    key: SETTING.firstFrameOnly,
    label: "Use the first frame only",
    type: "boolean",
    default: DEFAULT_OPTIONS.firstFrameOnly,
    hint: "Read pixel-shift files as an ordinary photo: the first frame, demosaiced.",
  },
  {
    key: SETTING.motionDetection,
    label: "Motion detection",
    type: "boolean",
    default: DEFAULT_OPTIONS.motionDetection,
    hint: "Find what moved between the frames and fill it from one frame, so it doesn't show as a coloured ghost.",
  },
  {
    key: SETTING.sensitivity,
    label: "Motion sensitivity",
    type: "number",
    default: DEFAULT_OPTIONS.sensitivity,
    min: -2,
    max: 2,
    step: 0.1,
    hint: "Higher finds smaller movements, and more noise mistaken for movement.",
  },
  {
    key: SETTING.fillFrame,
    label: "Fill motion areas from",
    type: "select",
    default: "1",
    options: [
      { value: "1", label: "Frame 1" },
      { value: "2", label: "Frame 2" },
      { value: "3", label: "Frame 3" },
      { value: "4", label: "Frame 4" },
    ],
    hint: "The frame whose demosaiced pixels stand in where something moved.",
  },
  {
    key: SETTING.smooth,
    label: "Smooth transitions",
    type: "number",
    default: DEFAULT_OPTIONS.smooth,
    min: 0,
    max: MAX_SMOOTH,
    step: 0.05,
    hint: "Blend the edges of motion areas into the merge. 0 is a hard edge.",
  },
  {
    key: SETTING.equalizeBrightness,
    label: "Equalize brightness of frames",
    type: "boolean",
    default: DEFAULT_OPTIONS.equalizeBrightness,
    hint: "Even out frames whose light changed while they were shot, such as under flickering lamps.",
  },
  {
    key: SETTING.equalizePerChannel,
    label: "Equalize per channel",
    type: "boolean",
    default: DEFAULT_OPTIONS.equalizePerChannel,
    hint: "Even out red, green and blue each on its own, for light whose colour changed too.",
  },
  {
    key: SETTING.showMotion,
    label: "Show motion",
    type: "boolean",
    default: DEFAULT_OPTIONS.showMotion,
    hint: "Paint the areas filled from one frame green.",
  },
  {
    key: SETTING.showMaskOnly,
    label: "Show the motion mask only",
    type: "boolean",
    default: DEFAULT_OPTIONS.showMaskOnly,
    hint: "Show only the motion mask: white where the frame fills in, black where the frames merge.",
  },
];

type Read = <T>(key: string, fallback: T) => T;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function numberOf(read: Read, key: string, fallback: number, lo: number, hi: number): number {
  const v = read<unknown>(key, fallback);
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function booleanOf(read: Read, key: string, fallback: boolean): boolean {
  const v = read<unknown>(key, fallback);
  return typeof v === "boolean" ? v : fallback;
}

function frameOf(read: Read): FrameIndex {
  const n = Number(read<unknown>(SETTING.fillFrame, "1"));
  return n === 2 ? 1 : n === 3 ? 2 : n === 4 ? 3 : 0;
}

/** The options the person set, each in its range. */
export function readOptions(read: Read): MergeOptions {
  return {
    firstFrameOnly: booleanOf(read, SETTING.firstFrameOnly, DEFAULT_OPTIONS.firstFrameOnly),
    motionDetection: booleanOf(read, SETTING.motionDetection, DEFAULT_OPTIONS.motionDetection),
    sensitivity: numberOf(read, SETTING.sensitivity, DEFAULT_OPTIONS.sensitivity, -2, 2),
    fillFrame: frameOf(read),
    smooth: numberOf(read, SETTING.smooth, DEFAULT_OPTIONS.smooth, 0, MAX_SMOOTH),
    equalizeBrightness: booleanOf(read, SETTING.equalizeBrightness, DEFAULT_OPTIONS.equalizeBrightness),
    equalizePerChannel: booleanOf(read, SETTING.equalizePerChannel, DEFAULT_OPTIONS.equalizePerChannel),
    showMotion: booleanOf(read, SETTING.showMotion, DEFAULT_OPTIONS.showMotion),
    showMaskOnly: booleanOf(read, SETTING.showMaskOnly, DEFAULT_OPTIONS.showMaskOnly),
  };
}

/** A short text that changes whenever the merge's output would: it goes into
 *  the decoder's version, which files the RAW cache's decodes. */
export function optionsSignature(o: MergeOptions): string {
  const b = (v: boolean) => (v ? 1 : 0);
  if (o.firstFrameOnly) return "first";
  const motion = o.motionDetection
    ? `m${o.sensitivity.toFixed(2)}f${o.fillFrame + 1}s${o.smooth.toFixed(2)}v${b(o.showMotion)}k${b(o.showMaskOnly)}`
    : "m-";
  const equalize = o.equalizeBrightness ? `e${b(o.equalizePerChannel)}` : "e-";
  return `${motion}${equalize}`;
}
