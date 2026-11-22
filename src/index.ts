// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// Safelight imports dist/index.js (built from this file) and calls activate()
// once with the API, scoped to this extension.

import { DECODER_ID, pixelShiftDecoder, type DecoderRuntime } from "./decoder";
import { EXT_ID, SETTINGS_FIELDS, optionsSignature, readOptions } from "./options";
import { placeDecoderFirst } from "./placement";
import { appRuntime } from "./runtime";
import type { SafelightAPI } from "./safelight";

declare const __EXT_VERSION__: string;

export const REREGISTER_DELAY_MS = 400;

/** The decoder's version: the extension's, and the options its output follows. */
export function decoderVersion(signature: string): string {
  const v = typeof __EXT_VERSION__ === "string" ? __EXT_VERSION__ : "0";
  return `${v}+${signature}`;
}

export function activate(api: SafelightAPI, runtime: DecoderRuntime = appRuntime): void {
  api.registerSettings({
    title: "Pixel Shift Merge",
    fields: SETTINGS_FIELDS,
    keywords: ["pixel shift", "multi shot", "motion", "Pentax", "Sony", "ARQ"],
  });
  const register = () => {
    const options = readOptions((key, fallback) => api.settings.get(key, fallback));
    api.library.registerDecoder(pixelShiftDecoder(options, decoderVersion(optionsSignature(options)), runtime));
  };
  register();
  // A slider writes its setting on every step; each new version decodes the
  // open photo again, so the decoder is filed anew once the slider rests.
  let pending: ReturnType<typeof setTimeout> | undefined;
  api.settings.onChange(() => {
    clearTimeout(pending);
    pending = setTimeout(register, REREGISTER_DELAY_MS);
  });
  placeDecoderFirst(api, `${EXT_ID}/${DECODER_ID}`);
}
