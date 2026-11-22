// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// Failures that may pass. Safelight tries the next decoder for these and asks
// again later, rather than remembering the file as one this decoder can't
// read: a worker that didn't start, a file that couldn't be read just then,
// memory that ran out.

import type { TransientDecodeError } from "./safelight";

export function transientError(message: string): TransientDecodeError {
  return Object.assign(new Error(message), { transient: true as const });
}

export function isTransient(e: unknown): boolean {
  return typeof e === "object" && e !== null && "transient" in e && e.transient === true;
}

const OUT_OF_MEMORY = /out of memory|\bOOM\b|bad_alloc|allocation failed|enlarge memory|Invalid (typed )?array length|Array buffer allocation/i;

/** Whether `e` (an error, or the message a worker sent back) says memory ran
 *  out, or the file couldn't be read: both may pass. */
export function mayPass(e: unknown): boolean {
  if (e instanceof RangeError) return true;
  if (e instanceof DOMException && (e.name === "NotReadableError" || e.name === "NotFoundError")) return true;
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return OUT_OF_MEMORY.test(message);
}

/** `e` as it should reach Safelight: transient when it may pass. An abort
 *  stays as it is: Safelight gave up on the decode itself. */
export function classified(e: unknown, what: string): Error {
  if (isTransient(e)) return e instanceof Error ? e : transientError(String(e));
  if (e instanceof DOMException && e.name === "AbortError") return e;
  const message = e instanceof Error ? e.message : String(e);
  return mayPass(e) ? transientError(`${what}: ${message}`) : e instanceof Error ? e : new Error(`${what}: ${message}`);
}
