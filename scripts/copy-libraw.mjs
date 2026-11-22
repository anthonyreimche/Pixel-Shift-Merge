// Copies the LibRaw build (libraw-wasm) into dist/libraw beside the bundle.
// Its worker and pthread scripts find their siblings through import.meta.url,
// which an app:// served script may not have; self.location.href, the
// worker's own URL, stands in for it. The licence files go with it.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "libraw-wasm", "dist");
const to = join(root, "dist", "libraw");
mkdirSync(to, { recursive: true });

for (const name of ["worker.js", "libraw.js"]) {
  const src = readFileSync(join(from, name), "utf8").replaceAll("import.meta.url", "self.location.href").replace(/\n\/\/# sourceMappingURL=.*$/m, "");
  if (src.includes("import.meta")) throw new Error(`${name} still reads import.meta`);
  writeFileSync(join(to, name), src);
}
copyFileSync(join(from, "libraw.wasm"), join(to, "libraw.wasm"));
copyFileSync(join(root, "node_modules", "libraw-wasm", "package.json"), join(to, "package.json"));
// LibRaw's licences and copyright, and the notice for libraw-wasm and Little CMS.
const licences = join(root, "scripts", "licenses");
for (const name of readdirSync(licences)) copyFileSync(join(licences, name), join(to, name));
console.log("Copied libraw-wasm into dist/libraw.");
