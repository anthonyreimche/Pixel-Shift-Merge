// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// Puts the decoder ahead of Safelight's own for the formats pixel-shift files
// come in, once, and only for formats the person hasn't ordered: it answers
// null for every other file, which then goes on to Safelight's decoder.

import type { SafelightAPI } from "./safelight";

/** Format ids in Preferences ▸ File formats. */
export const LEAD_FORMATS = ["pef", "dng", "arq"] as const;
const CORE_DECODER = "libraw";
const PLACED = "placedDecoder";

/** `order` with `decoderId` first for each format it leaves unordered, or null
 *  when it orders them all already. */
export function withDecoderFirst(order: Readonly<Record<string, string[]>>, decoderId: string): Record<string, string[]> | null {
  const missing = LEAD_FORMATS.filter((format) => !order[format]?.length);
  if (missing.length === 0) return null;
  const next: Record<string, string[]> = { ...order };
  for (const format of missing) next[format] = [decoderId, CORE_DECODER];
  return next;
}

/** On the first start only: a person who moves the decoder back keeps it there. */
export function placeDecoderFirst(api: SafelightAPI, decoderId: string): void {
  if (api.settings.get(PLACED, false)) return;
  const next = withDecoderFirst(api.stores.useSettings.getState().decoderOrder ?? {}, decoderId);
  if (next) api.appSettings.update({ decoderOrder: next });
  api.settings.set(PLACED, true);
}
