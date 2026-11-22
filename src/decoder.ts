// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// The decoder Safelight calls for PEF, DNG and ARQ files: pixel-shift files
// are merged, any other file is answered with null so Safelight's own decoder
// reads it.

import type { DecodedImageResult, ImageAcceptRequest, ImageDecodeRequest, ImageDecoderContribution } from "./safelight";
import { cameraDetails, greenOne, sensorLevels, visibleSize, type CameraDetails } from "./camera";
import type { FrameSource, MergeJob, MergeOutput } from "./job";
import type { LibRawSession, Readout } from "./libraw";
import { readoutView, type Cfa } from "./mosaic";
import type { MergeOptions } from "./options";
import { classified, transientError } from "./errors";
import { blobSource, findPixelShift, pointAtFrame, type ByteSource, type PixelShiftLayout } from "./tiff";

export const DECODER_ID = "pixel-shift";
export const DECODER_EXTENSIONS = [".pef", ".dng", ".arq"] as const;

/** Sony's ARQ layout, as RawTherapee reads it: red, green / green, blue. */
const ARQ_CFA: Cfa = [0, 1, 1, 2];

export interface DecoderRuntime {
  libraw(): LibRawSession;
  /** Runs the merge off the page; rejects with an AbortError when `signal` fires. */
  merge(job: MergeJob, signal: AbortSignal): Promise<MergeOutput>;
}

function abortError(): DOMException {
  return new DOMException("The decode was no longer needed.", "AbortError");
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Whether a decode for `request` can be the first frame binned 2x2. */
function wantsHalf(request: ImageDecodeRequest, width: number, height: number): boolean {
  return !request.fullSize && request.targetEdge !== undefined && request.targetEdge <= Math.floor(Math.max(width, height) / 2);
}

/** Whether `file` is one this decoder merges: its TIFF directories only, a
 *  few small reads, given up between reads once `signal` fires. */
export async function isPixelShift(file: Blob, signal?: AbortSignal): Promise<boolean> {
  const read = blobSource(file);
  const watched: ByteSource = (offset, length) => {
    if (signal) checkAbort(signal);
    return read(offset, length);
  };
  return (await findPixelShift(watched)) !== null;
}

interface Frames {
  camera: CameraDetails;
  cfa: Cfa;
  source: FrameSource;
  width: number;
  height: number;
  binned: boolean;
}

async function readPentax(
  lr: LibRawSession,
  file: Blob,
  layout: Extract<PixelShiftLayout, { kind: "frames" }>,
  request: ImageDecodeRequest,
): Promise<Frames | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkAbort(request.signal);
  const readouts: Readout[] = [];
  const readFrame = async (k: number) => {
    const restore = pointAtFrame(bytes, layout, k);
    try {
      await lr.open(bytes);
    } finally {
      restore();
    }
    const readout = await lr.readout();
    if (!readout) return false;
    readouts.push(readout);
    return true;
  };
  if (!(await readFrame(0))) return null;
  const camera = cameraDetails(await lr.metadata());
  if (!camera?.cfa) return null;
  const first = readouts[0];
  const size = visibleSize(first);
  const binned = wantsHalf(request, size.width, size.height);
  for (let k = 1; k < (binned ? 1 : 4); k++) {
    checkAbort(request.signal);
    if (!(await readFrame(k))) return null;
    const r = readouts[k];
    if (r.rawWidth !== first.rawWidth || r.rawHeight !== first.rawHeight || r.top !== first.top || r.left !== first.left) return null;
  }
  const views = readouts.map((r) => readoutView(r.data, r.rawWidth, r.top, r.left));
  return { camera, cfa: camera.cfa, source: { kind: "views", views }, ...size, binned };
}

/** An ARQ's details come from LibRaw opening the header alone; the merge
 *  worker reads the samples from the file itself. */
async function readArq(
  lr: LibRawSession,
  file: Blob,
  layout: Extract<PixelShiftLayout, { kind: "arq" }>,
  request: ImageDecodeRequest,
): Promise<Frames | null> {
  await lr.open(new Uint8Array(await file.slice(0, layout.dataOffset).arrayBuffer()));
  const camera = cameraDetails(await lr.metadata());
  if (!camera) return null;
  const { width: rawWidth, height: rawHeight } = layout.image;
  const size = visibleSize({ rawWidth, rawHeight, top: camera.top, left: camera.left, width: camera.width, height: camera.height });
  if (size.width <= 0 || size.height <= 0) return null;
  const binned = wantsHalf(request, size.width, size.height);
  const source: FrameSource = {
    kind: "arq",
    file,
    dataOffset: layout.dataOffset,
    rawWidth,
    rawHeight,
    top: camera.top,
    left: camera.left,
    shots: binned ? [0] : [0, 1, 2, 3],
  };
  return { camera, cfa: ARQ_CFA, source, ...size, binned };
}

/** Runs `read` with a LibRaw session that ends when it does, or at once when
 *  Safelight gives up on the decode, the call in progress failing with it. */
async function withLibRaw<T>(runtime: DecoderRuntime, signal: AbortSignal, read: (lr: LibRawSession) => Promise<T>): Promise<T> {
  checkAbort(signal);
  let lr: LibRawSession;
  try {
    lr = runtime.libraw();
  } catch (e) {
    throw transientError(`LibRaw didn't start: ${e instanceof Error ? e.message : String(e)}`);
  }
  const end = () => lr.dispose();
  signal.addEventListener("abort", end, { once: true });
  try {
    return await read(lr);
  } catch (e) {
    if (signal.aborted) throw abortError();
    throw e;
  } finally {
    signal.removeEventListener("abort", end);
    lr.dispose();
  }
}

/** The decoder for the merge `options` describe, filed under `version`. */
export function pixelShiftDecoder(options: MergeOptions, version: string, runtime: DecoderRuntime): ImageDecoderContribution {
  async function decodeMerged(file: Blob, request: ImageDecodeRequest): Promise<DecodedImageResult | null> {
    if (options.firstFrameOnly) return null;
    const layout = await findPixelShift(blobSource(file));
    if (!layout) return null;
    const frames = await withLibRaw(runtime, request.signal, (lr) =>
      layout.kind === "arq" ? readArq(lr, file, layout, request) : readPentax(lr, file, layout, request),
    );
    if (!frames) return null;
    checkAbort(request.signal);

    const { camera, cfa, source, width, height, binned } = frames;
    const mul = request.asShotMultipliers ?? camera.mul;
    const black = layout.kind === "frames" ? layout.black : undefined;
    const output = await runtime.merge(
      {
        width,
        height,
        cfa,
        source,
        levels: sensorLevels(camera, black, mul),
        rgbCam: camera.rgbCam,
        shot: { make: camera.make, model: camera.model, iso: camera.iso },
        settings: options,
        binned,
      },
      request.signal,
    );
    return {
      kind: "linear",
      width: output.width,
      height: output.height,
      data: output.data,
      oriented: false,
      asShotMultipliers: greenOne(mul),
      ...(binned ? { sourceWidth: width, sourceHeight: height } : {}),
    };
  }

  return {
    id: DECODER_ID,
    label: "Pixel shift merge",
    version,
    extensions: DECODER_EXTENSIONS,
    // Depends on the file and the options alone, and the options are in
    // `version`, so Safelight may remember the answer.
    async accepts(file: Blob, request: ImageAcceptRequest): Promise<boolean> {
      return !options.firstFrameOnly && (await isPixelShift(file, request.signal));
    },
    async decode(file: Blob, request: ImageDecodeRequest): Promise<DecodedImageResult | null> {
      try {
        return await decodeMerged(file, request);
      } catch (e) {
        throw classified(e, "Pixel shift merge");
      }
    },
  };
}
