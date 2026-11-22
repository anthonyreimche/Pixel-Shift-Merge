// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// Finds the frames of a pixel-shift file by its TIFF structure, reading only
// the directories, so a file that isn't one is turned down without reading
// its pixels. PEF, DNG and ARQ are all TIFF underneath.

/** Reads `length` bytes from `offset`; fewer at the end of the file. */
export type ByteSource = (offset: number, length: number) => Promise<DataView>;

export function blobSource(file: Blob): ByteSource {
  return async (offset, length) => new DataView(await file.slice(offset, offset + length).arrayBuffer());
}

export function bufferSource(bytes: ArrayBuffer): ByteSource {
  return async (offset, length) => {
    const start = Math.min(offset, bytes.byteLength);
    return new DataView(bytes, start, Math.min(length, bytes.byteLength - start));
  };
}

export const TAG = {
  newSubfileType: 254,
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  make: 271,
  stripOffsets: 273,
  samplesPerPixel: 277,
  stripByteCounts: 279,
  tileOffsets: 324,
  tileByteCounts: 325,
  subIfds: 330,
  blackLevelRepeatDim: 50713,
  blackLevel: 50714,
} as const;

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

export interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Where the entry's 4-byte value field sits in the file. */
  fieldAt: number;
  /** Where the values are: the value field itself when they fit in 4 bytes. */
  dataAt: number;
}

export interface Ifd {
  offset: number;
  entries: Map<number, IfdEntry>;
  next: number;
}

const MAX_ENTRIES = 1000;
const MAX_IFDS = 64;
const MAX_VALUES = 1 << 16;

export class TiffReader {
  private constructor(
    private readonly read: ByteSource,
    readonly littleEndian: boolean,
    readonly firstIfd: number,
  ) {}

  /** A reader for the file, or null when it isn't a TIFF stream. */
  static async open(read: ByteSource): Promise<TiffReader | null> {
    const head = await read(0, 8);
    if (head.byteLength < 8) return null;
    const order = head.getUint16(0, false);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const le = order === 0x4949;
    if (head.getUint16(2, le) !== 42) return null;
    return new TiffReader(read, le, head.getUint32(4, le));
  }

  async ifd(offset: number): Promise<Ifd | null> {
    if (offset < 8) return null;
    const head = await this.read(offset, 2);
    if (head.byteLength < 2) return null;
    const n = head.getUint16(0, this.littleEndian);
    if (n === 0 || n > MAX_ENTRIES) return null;
    const body = await this.read(offset + 2, n * 12 + 4);
    if (body.byteLength < n * 12) return null;
    const entries = new Map<number, IfdEntry>();
    for (let i = 0; i < n; i++) {
      const at = i * 12;
      const tag = body.getUint16(at, this.littleEndian);
      const type = body.getUint16(at + 2, this.littleEndian);
      const count = body.getUint32(at + 4, this.littleEndian);
      const fieldAt = offset + 2 + at + 8;
      const size = (TYPE_SIZE[type] ?? 1) * count;
      const dataAt = size <= 4 ? fieldAt : body.getUint32(at + 8, this.littleEndian);
      entries.set(tag, { tag, type, count, fieldAt, dataAt });
    }
    const next = body.byteLength >= n * 12 + 4 ? body.getUint32(n * 12, this.littleEndian) : 0;
    return { offset, entries, next };
  }

  /** An entry's values as numbers (rationals divided out). */
  async values(entry: IfdEntry | undefined): Promise<number[]> {
    if (!entry || entry.count === 0 || entry.count > MAX_VALUES) return [];
    const size = TYPE_SIZE[entry.type] ?? 1;
    const view = await this.read(entry.dataAt, size * entry.count);
    const le = this.littleEndian;
    const out: number[] = [];
    for (let i = 0; i < entry.count && (i + 1) * size <= view.byteLength; i++) {
      const at = i * size;
      switch (entry.type) {
        case 3: out.push(view.getUint16(at, le)); break;
        case 8: out.push(view.getInt16(at, le)); break;
        case 4: case 13: out.push(view.getUint32(at, le)); break;
        case 9: out.push(view.getInt32(at, le)); break;
        case 5: out.push(view.getUint32(at, le) / (view.getUint32(at + 4, le) || 1)); break;
        case 10: out.push(view.getInt32(at, le) / (view.getInt32(at + 4, le) || 1)); break;
        case 11: out.push(view.getFloat32(at, le)); break;
        case 12: out.push(view.getFloat64(at, le)); break;
        default: out.push(view.getUint8(at));
      }
    }
    return out;
  }

  async first(ifd: Ifd, tag: number): Promise<number | undefined> {
    return (await this.values(ifd.entries.get(tag)))[0];
  }

  async text(entry: IfdEntry | undefined): Promise<string> {
    if (!entry || entry.count === 0 || entry.count > MAX_VALUES) return "";
    const view = await this.read(entry.dataAt, entry.count);
    let s = "";
    for (let i = 0; i < view.byteLength; i++) {
      const c = view.getUint8(i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  }

  /** Every directory in the order dcraw (and so LibRaw) numbers them: each
   *  IFD of the main chain, depth first through its SubIFDs. */
  async directories(): Promise<Ifd[]> {
    const out: Ifd[] = [];
    const seen = new Set<number>();
    const visit = async (offset: number): Promise<Ifd | null> => {
      if (out.length >= MAX_IFDS || seen.has(offset)) return null;
      seen.add(offset);
      const ifd = await this.ifd(offset);
      if (!ifd) return null;
      out.push(ifd);
      for (const sub of await this.values(ifd.entries.get(TAG.subIfds))) await visit(sub);
      return ifd;
    };
    let offset = this.firstIfd;
    while (offset) offset = (await visit(offset))?.next ?? 0;
    return out;
  }
}

/** A raw image's directory, as found. */
export interface RawImage {
  ifd: Ifd;
  width: number;
  height: number;
  bitsPerSample: number;
  samplesPerPixel: number;
  compression: number;
}

/** The entries that say where a raw image's data is: strips or tiles. */
export function dataPointers(ifd: Ifd): IfdEntry[] {
  const strips = [ifd.entries.get(TAG.stripOffsets), ifd.entries.get(TAG.stripByteCounts)];
  const tiles = [ifd.entries.get(TAG.tileOffsets), ifd.entries.get(TAG.tileByteCounts)];
  const pick = tiles[0] && tiles[1] ? tiles : strips;
  return pick.filter((e): e is IfdEntry => e !== undefined);
}

const JPEG = 6;

/** The largest frame merged: past it (a 16-shot ARQ's 240 MP, say) the file
 *  is left to Safelight's own decoder. A 61 MP ARQ's merge peaks near 1.8 GB. */
export const MAX_MERGE_PIXELS = 64_000_000;

async function rawImageOf(tiff: TiffReader, ifd: Ifd): Promise<RawImage | null> {
  const width = (await tiff.first(ifd, TAG.width)) ?? 0;
  const height = (await tiff.first(ifd, TAG.height)) ?? 0;
  const bitsPerSample = (await tiff.first(ifd, TAG.bitsPerSample)) ?? 0;
  const samplesPerPixel = (await tiff.first(ifd, TAG.samplesPerPixel)) ?? 1;
  const compression = (await tiff.first(ifd, TAG.compression)) ?? 1;
  const subfile = (await tiff.first(ifd, TAG.newSubfileType)) ?? 0;
  if (width <= 0 || height <= 0 || bitsPerSample <= 8 || subfile !== 0 || compression === JPEG) return null;
  if (dataPointers(ifd).length !== 2) return null;
  return { ifd, width, height, bitsPerSample, samplesPerPixel, compression };
}

export type PixelShiftLayout =
  | {
      kind: "frames";
      littleEndian: boolean;
      /** Four raw images, the first being the one LibRaw reads. */
      frames: RawImage[];
      /** A DNG's black level by colour filter position (row-major 2x2), when tagged. */
      black?: [number, number, number, number];
    }
  | {
      kind: "arq";
      littleEndian: boolean;
      image: RawImage;
      /** Where the samples start; they run on as one block. */
      dataOffset: number;
    };

async function dngBlack(tiff: TiffReader, ifd: Ifd): Promise<[number, number, number, number] | undefined> {
  const levels = await tiff.values(ifd.entries.get(TAG.blackLevel));
  if (levels.length === 0) return undefined;
  const dim = await tiff.values(ifd.entries.get(TAG.blackLevelRepeatDim));
  const rows = dim[0] ?? 1;
  const cols = dim[1] ?? 1;
  const at = (r: number, c: number) => levels[(r % rows) * cols + (c % cols)] ?? levels[0];
  return [at(0, 0), at(0, 1), at(1, 0), at(1, 1)];
}

/** The pixel-shift frames of the file, or null when it isn't a pixel-shift
 *  file (or not one this reads). Reads the directories only, a few small
 *  reads, so it can decide whether a file is this decoder's to take. */
export async function findPixelShift(read: ByteSource): Promise<PixelShiftLayout | null> {
  const tiff = await TiffReader.open(read);
  if (!tiff) return null;
  const ifds = await tiff.directories();
  if (ifds.length === 0) return null;
  const make = (await tiff.text(ifds[0].entries.get(TAG.make))).toUpperCase();
  const raws: RawImage[] = [];
  for (const ifd of ifds) {
    const raw = await rawImageOf(tiff, ifd);
    if (raw) raws.push(raw);
  }
  if (raws.length === 0) return null;

  const arq = raws.find((r) => r.samplesPerPixel === 4 && r.compression === 1 && (r.bitsPerSample === 14 || r.bitsPerSample === 16));
  if (arq) {
    if (!make.startsWith("SONY") || !tiff.littleEndian || arq.width * arq.height > MAX_MERGE_PIXELS) return null;
    const counts = await tiff.values(arq.ifd.entries.get(TAG.stripByteCounts));
    const offsets = await tiff.values(arq.ifd.entries.get(TAG.stripOffsets));
    const total = counts.reduce((a, b) => a + b, 0);
    const contiguous = offsets.every((o, i) => i === 0 || o === offsets[i - 1] + counts[i - 1]);
    if (!contiguous || total !== arq.width * arq.height * 8 || offsets[0] % 2 !== 0) return null;
    return { kind: "arq", littleEndian: tiff.littleEndian, image: arq, dataOffset: offsets[0] };
  }

  if (!make.includes("PENTAX") && !make.includes("RICOH")) return null;
  const size = (r: RawImage) => r.width * r.height * r.bitsPerSample;
  const largest = Math.max(...raws.map(size));
  const frames = raws.filter((r) => size(r) === largest && r.samplesPerPixel === 1);
  if (frames.length !== 4 || frames[0].width * frames[0].height > MAX_MERGE_PIXELS) return null;
  const pointers = frames.map((f) => dataPointers(f.ifd));
  const patchable = pointers.every((p) => p.every((e, i) => e.tag === pointers[0][i].tag && e.count === pointers[0][i].count && e.type === pointers[0][i].type));
  if (!patchable) return null;
  const black = await dngBlack(tiff, frames[0].ifd);
  return { kind: "frames", littleEndian: tiff.littleEndian, frames, ...(black ? { black } : {}) };
}

/** The file with frame `k`'s data where LibRaw reads the first frame's: the
 *  first frame's strip (or tile) offsets and byte counts point at frame k's.
 *  Patches `bytes` in place and returns the bytes to restore. */
export function pointAtFrame(bytes: Uint8Array, layout: Extract<PixelShiftLayout, { kind: "frames" }>, k: number): () => void {
  const target = dataPointers(layout.frames[0].ifd);
  const source = dataPointers(layout.frames[k].ifd);
  const saved = target.map((e) => bytes.slice(e.fieldAt, e.fieldAt + 4));
  target.forEach((e, i) => bytes.copyWithin(e.fieldAt, source[i].fieldAt, source[i].fieldAt + 4));
  return () => target.forEach((e, i) => bytes.set(saved[i], e.fieldAt));
}
