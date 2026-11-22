// Builds little-endian TIFF files for tests: directories with SubIFDs, a
// next-IFD chain and strip data, laid out one after another.

export interface Tag {
  tag: number;
  /** 1 BYTE, 2 ASCII, 3 SHORT, 4 LONG. */
  type: 1 | 2 | 3 | 4;
  values: readonly number[] | string;
}

export interface Dir {
  tags: Tag[];
  /** Strip data: StripOffsets and StripByteCounts are added to point at it. */
  strip?: Uint8Array;
  /** The byte count StripByteCounts claims, when not the strip's own. */
  stripClaim?: number;
  subIfds?: Dir[];
  next?: Dir;
}

const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4 } as const;

class Writer {
  bytes = new Uint8Array(1 << 16);
  length = 0;

  reserve(n: number): number {
    const at = this.length;
    while (this.length + n > this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.length += n;
    if (this.length % 2) this.length++;
    return at;
  }

  u16(at: number, v: number) {
    new DataView(this.bytes.buffer).setUint16(at, v, true);
  }

  u32(at: number, v: number) {
    new DataView(this.bytes.buffer).setUint32(at, v, true);
  }
}

function writeValues(w: Writer, at: number, t: Tag) {
  if (typeof t.values === "string") {
    for (let i = 0; i < t.values.length; i++) w.bytes[at + i] = t.values.charCodeAt(i);
    return;
  }
  t.values.forEach((v, i) => {
    if (t.type === 3) w.u16(at + 2 * i, v);
    else if (t.type === 4) w.u32(at + 4 * i, v);
    else w.bytes[at + i] = v;
  });
}

function count(t: Tag): number {
  return typeof t.values === "string" ? t.values.length + 1 : t.values.length;
}

function writeDir(w: Writer, dir: Dir): number {
  const tags = [...dir.tags];
  if (dir.strip) {
    tags.push({ tag: 273, type: 4, values: [0] }, { tag: 279, type: 4, values: [dir.stripClaim ?? dir.strip.length] });
  }
  if (dir.subIfds?.length) tags.push({ tag: 330, type: 4, values: dir.subIfds.map(() => 0) });
  tags.sort((a, b) => a.tag - b.tag);
  const at = w.reserve(2 + tags.length * 12 + 4);
  w.u16(at, tags.length);
  const fields = new Map<number, number>();
  tags.forEach((t, i) => {
    const e = at + 2 + i * 12;
    w.u16(e, t.tag);
    w.u16(e + 2, t.type);
    w.u32(e + 4, count(t));
    const size = SIZE[t.type] * count(t);
    if (size <= 4) {
      writeValues(w, e + 8, t);
      fields.set(t.tag, e + 8);
    } else {
      const data = w.reserve(size);
      writeValues(w, data, t);
      w.u32(e + 8, data);
      fields.set(t.tag, data);
    }
  });
  if (dir.strip) {
    const data = w.reserve(dir.strip.length);
    w.bytes.set(dir.strip, data);
    w.u32(fields.get(273) ?? 0, data);
  }
  if (dir.subIfds?.length) {
    const list = fields.get(330) ?? 0;
    const single = dir.subIfds.length === 1;
    dir.subIfds.forEach((sub, k) => {
      const offset = writeDir(w, sub);
      w.u32(single ? list : list + 4 * k, offset);
    });
  }
  if (dir.next) w.u32(at + 2 + tags.length * 12, writeDir(w, dir.next));
  return at;
}

export function buildTiff(ifd0: Dir): Uint8Array {
  const w = new Writer();
  w.reserve(8);
  w.bytes[0] = 0x49;
  w.bytes[1] = 0x49;
  w.u16(2, 42);
  w.u32(4, writeDir(w, ifd0));
  return w.bytes.slice(0, w.length);
}

/** Tags of a 16-bit, single-sample raw image `width` x `height`. */
export function rawTags(width: number, height: number, compression = 65535): Tag[] {
  return [
    { tag: 256, type: 4, values: [width] },
    { tag: 257, type: 4, values: [height] },
    { tag: 258, type: 3, values: [14] },
    { tag: 259, type: 3, values: [compression] },
    { tag: 277, type: 3, values: [1] },
  ];
}

export function makeTag(make: string): Tag {
  return { tag: 271, type: 2, values: make };
}

/** A strip of `n` bytes, every byte `fill`: which frame a strip is shows in it. */
export function strip(n: number, fill: number): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

/** A Pentax pixel-shift PEF: frame 1 in IFD0, frames 2 to 4 in its SubIFDs. */
export function pentaxPef(width = 32, height = 24, make = "PENTAX", stripBytes = 64): Uint8Array {
  const frame = (k: number): Dir => ({ tags: rawTags(width, height), strip: strip(stripBytes, 0x10 + k) });
  return buildTiff({ ...frame(0), tags: [makeTag(make), ...rawTags(width, height)], subIfds: [frame(1), frame(2), frame(3)] });
}

/** A Pentax pixel-shift DNG: four IFDs in the chain, each with a preview and
 *  its raw frame in a SubIFD, black tagged per colour filter position. */
export function pentaxDng(width = 32, height = 24): Uint8Array {
  const preview: Tag[] = [
    { tag: 254, type: 4, values: [1] },
    { tag: 256, type: 4, values: [16] },
    { tag: 257, type: 4, values: [12] },
    { tag: 258, type: 3, values: [8, 8, 8] },
    { tag: 259, type: 3, values: [1] },
    { tag: 277, type: 3, values: [3] },
  ];
  const raw = (k: number): Dir => ({
    tags: [
      { tag: 254, type: 4, values: [0] },
      ...rawTags(width, height, 7),
      { tag: 50713, type: 3, values: [2, 2] },
      { tag: 50714, type: 4, values: [60, 61, 62, 63] },
    ],
    strip: strip(64, 0x20 + k),
  });
  const chain = (k: number): Dir => ({
    tags: [makeTag("PENTAX"), ...preview],
    strip: strip(16, 0),
    subIfds: [raw(k)],
    ...(k < 3 ? { next: chain(k + 1) } : {}),
  });
  return buildTiff(chain(0));
}

/** A plain one-frame raw file. */
export function singleFrame(width = 32, height = 24): Uint8Array {
  return buildTiff({ tags: [makeTag("PENTAX"), ...rawTags(width, height)], strip: strip(64, 1) });
}

/** A Sony ARQ: 16-bit samples, four a pixel, as one uncompressed strip.
 *  `claimed` makes the strip claim more bytes than it holds. */
export function sonyArq(samples: Uint16Array, width: number, height: number, claimed?: number): Uint8Array {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  return buildTiff({
    tags: [makeTag("SONY"), { tag: 254, type: 4, values: [1] }, { tag: 259, type: 3, values: [6] }],
    subIfds: [
      {
        tags: [
          { tag: 254, type: 4, values: [0] },
          { tag: 256, type: 4, values: [width] },
          { tag: 257, type: 4, values: [height] },
          { tag: 258, type: 3, values: [14] },
          { tag: 259, type: 3, values: [1] },
          { tag: 277, type: 3, values: [4] },
        ],
        strip: bytes,
        ...(claimed !== undefined ? { stripClaim: claimed } : {}),
      },
    ],
  });
}
