// What activate() registers, how a settings change re-files the decoder, and
// the one-time placement ahead of Safelight's decoder.

import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../safelight.json";
import { activate, REREGISTER_DELAY_MS } from "../src/index";
import { DECODER_ID, type DecoderRuntime } from "../src/decoder";
import { EXT_ID, SETTING } from "../src/options";
import { withDecoderFirst } from "../src/placement";
import { fakeApi } from "./support/fake-api";

const runtime: DecoderRuntime = {
  libraw: () => {
    throw new Error("LibRaw isn't started at activation");
  },
  merge: () => Promise.reject(new Error("no merge at activation")),
};

const FULL_ID = `${EXT_ID}/${DECODER_ID}`;

describe("activate", () => {
  it("uses the manifest's id", () => {
    expect(EXT_ID).toBe(manifest.id);
  });

  it("registers its settings and the decoder, filed under the options", () => {
    const rig = fakeApi();
    activate(rig.api, runtime);
    expect(rig.settingsSections).toHaveLength(1);
    expect(rig.settingsSections[0].fields.map((f) => f.key)).toContain(SETTING.motionDetection);
    expect(rig.decoders.at(-1)?.id).toBe(DECODER_ID);
    expect(rig.decoders.at(-1)?.version).toMatch(/\+m0\.00f1s0\.70v0k0e-$/);
  });

  afterEach(() => void vi.useRealTimers());

  it("files the decoder anew once an option rests, not on every step of a slider", () => {
    vi.useFakeTimers();
    const rig = fakeApi();
    activate(rig.api, runtime);
    const registered = rig.decoders.length;
    const before = rig.decoders.at(-1)?.version;
    for (const v of [0.1, 0.2, 0.3, 0.4]) {
      rig.setSetting(SETTING.sensitivity, v);
      vi.advanceTimersByTime(REREGISTER_DELAY_MS / 4);
    }
    expect(rig.decoders).toHaveLength(registered);
    vi.advanceTimersByTime(REREGISTER_DELAY_MS);
    expect(rig.decoders).toHaveLength(registered + 1);
    expect(rig.decoders.at(-1)?.version).not.toBe(before);
    expect(rig.decoders.at(-1)?.version).toContain("m0.40");
  });

  it("goes ahead of Safelight's decoder for PEF, DNG and ARQ on the first start only", () => {
    const rig = fakeApi({ decoderOrder: { dng: ["libraw", "other/dng"] } });
    activate(rig.api, runtime);
    expect(rig.decoderOrder()).toEqual({
      dng: ["libraw", "other/dng"],
      pef: [FULL_ID, "libraw"],
      arq: [FULL_ID, "libraw"],
    });
    rig.setDecoderOrder({});
    activate(rig.api, runtime);
    expect(rig.decoderOrder()).toEqual({});
  });
});

describe("withDecoderFirst", () => {
  it("leaves alone formats the person ordered, and says when there is nothing to do", () => {
    const full = { pef: ["libraw"], dng: ["libraw"], arq: ["libraw"] };
    expect(withDecoderFirst(full, FULL_ID)).toBeNull();
    expect(withDecoderFirst({ pef: [] }, FULL_ID)?.pef).toEqual([FULL_ID, "libraw"]);
  });
});
