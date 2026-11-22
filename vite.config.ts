import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const manifest = JSON.parse(readFileSync(new URL("./safelight.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: { __EXT_VERSION__: JSON.stringify(manifest.version) },
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    outDir: "dist",
    sourcemap: true,
  },
  plugins: [
    {
      // The merge worker is inlined into the bundle (runtime.ts); the map Vite
      // emits beside it would be a file nothing loads.
      name: "drop-inline-worker-map",
      generateBundle(_, bundle) {
        for (const name of Object.keys(bundle)) if (/^assets\/merge-worker-.*\.map$/.test(name)) delete bundle[name];
      },
    },
  ],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
