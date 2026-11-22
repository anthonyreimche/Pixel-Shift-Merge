// Which failures reach Safelight as transient: they may pass, so the file is
// tried again later instead of being remembered as unreadable.

import { describe, expect, it } from "vitest";
import { classified, isTransient, mayPass, transientError } from "../src/errors";

describe("transient failures", () => {
  it("marks its own errors transient, as Safelight reads them", () => {
    const e = transientError("the merge worker didn't start");
    expect(e).toBeInstanceOf(Error);
    expect(isTransient(e)).toBe(true);
    expect(isTransient(new Error("x"))).toBe(false);
  });

  it("counts running out of memory and an unreadable file as passing", () => {
    expect(mayPass(new RangeError("Array buffer allocation failed"))).toBe(true);
    expect(mayPass("Aborted(OOM). Build with -sASSERTIONS for more info.")).toBe(true);
    expect(mayPass(new DOMException("gone", "NotReadableError"))).toBe(true);
    expect(mayPass(new Error("Unsupported file format or not RAW file"))).toBe(false);
  });

  it("classifies: transient when it may pass, the error as it is otherwise", () => {
    expect(classified(new RangeError("Invalid typed array length"), "merge")).toMatchObject({ transient: true });
    const plain = new Error("corrupt data");
    expect(classified(plain, "LibRaw")).toBe(plain);
  });
});
