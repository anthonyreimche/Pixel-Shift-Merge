// A stand-in Safelight API for unit tests. It has only what this extension
// uses: reading any other member throws, naming it, so a test shows what to
// add here when the extension starts using more.

import type { AppSettings, ImageDecoderContribution, SafelightAPI, SettingsContribution } from "../../src/safelight";

type DecoderOrder = AppSettings["decoderOrder"];

/** The members of SafelightAPI this fake implements. The settings store is
 *  narrowed to the one setting the extension reads. */
interface FakeMembers {
  registerSettings: SafelightAPI["registerSettings"];
  settings: SafelightAPI["settings"];
  library: Pick<SafelightAPI["library"], "registerDecoder">;
  stores: { useSettings: { getState(): Pick<AppSettings, "decoderOrder"> } };
  appSettings: { update(patch: Pick<AppSettings, "decoderOrder">): void };
}

export interface Rig {
  api: SafelightAPI;
  settingsSections: SettingsContribution[];
  decoders: ImageDecoderContribution[];
  setSetting(key: string, value: unknown): void;
  decoderOrder(): DecoderOrder;
  setDecoderOrder(order: DecoderOrder): void;
}

export function fakeApi(initial: { decoderOrder?: DecoderOrder } = {}): Rig {
  const settingsSections: SettingsContribution[] = [];
  const decoders: ImageDecoderContribution[] = [];
  const values = new Map<string, unknown>();
  const listeners = new Set<(key: string, value: unknown) => void>();
  let order: DecoderOrder = initial.decoderOrder ?? {};

  const set = (key: string, value: unknown) => {
    values.set(key, value);
    for (const l of listeners) l(key, value);
  };

  const members: FakeMembers = {
    registerSettings: (c) => void settingsSections.push(c),
    settings: {
      get: <T>(key: string, fallback: T): T => (values.has(key) ? (values.get(key) as T) : fallback),
      set,
      onChange: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    library: { registerDecoder: (d) => void decoders.push(d) },
    stores: { useSettings: { getState: () => ({ decoderOrder: order }) } },
    appSettings: { update: (patch) => void (order = patch.decoderOrder) },
  };

  return {
    // Only the members above exist; strict() turns any other read into an error.
    api: strict(members, "api") as unknown as SafelightAPI,
    settingsSections,
    decoders,
    setSetting: set,
    decoderOrder: () => order,
    setDecoderOrder: (next) => void (order = next),
  };
}

/** Wraps a plain object so reading a member it lacks throws, naming the member. */
function strict<T extends object>(target: T, path: string): T {
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (typeof key === "symbol" || key === "then" || key === "toJSON") return Reflect.get(obj, key, receiver);
      if (!(key in obj)) throw new Error(`The fake API has no ${path}.${key}. Add it to test/support/fake-api.ts.`);
      const value: unknown = Reflect.get(obj, key, receiver);
      const isPlainObject = typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
      return isPlainObject ? strict(value, `${path}.${key}`) : value;
    },
  });
}
