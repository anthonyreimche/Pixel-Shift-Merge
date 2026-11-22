// Pixel Shift Merge, a Safelight extension (GPL-3.0-or-later).
// The worker a decode's merge runs in (job.ts). Built inline into the bundle,
// so it loads wherever the extension does.

import { mayPass } from "./errors";
import { runMerge, type MergeJob, type MergeReply } from "./job";

onmessage = async (e: MessageEvent<MergeJob>) => {
  let reply: MergeReply;
  try {
    reply = { output: await runMerge(e.data) };
  } catch (err) {
    reply = { error: err instanceof Error ? err.message : String(err), transient: mayPass(err) };
  }
  postMessage(reply, { transfer: "output" in reply ? [reply.output.data.buffer] : [] });
};
