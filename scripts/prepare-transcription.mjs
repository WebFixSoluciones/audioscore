import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const pitchRoot = dirname(require.resolve("@spotify/basic-pitch/package.json"));
const wasmRoot = dirname(
  require.resolve("@tensorflow/tfjs-backend-wasm/package.json"),
);
await mkdir(resolve(root, "public/models/basic-pitch"), { recursive: true });
await mkdir(resolve(root, "public/models/tfjs"), { recursive: true });
await cp(
  resolve(pitchRoot, "model"),
  resolve(root, "public/models/basic-pitch"),
  { recursive: true },
);
await cp(
  resolve(pitchRoot, "LICENSE"),
  resolve(root, "public/models/basic-pitch/LICENSE"),
);
await cp(
  resolve(pitchRoot, "LICENSE"),
  resolve(root, "public/models/yamnet/LICENSE"),
);
await cp(
  resolve(pitchRoot, "LICENSE"),
  resolve(root, "public/models/tfjs/LICENSE"),
);
for (const file of [
  "tfjs-backend-wasm.wasm",
  "tfjs-backend-wasm-simd.wasm",
  "tfjs-backend-wasm-threaded-simd.wasm",
])
  await cp(
    resolve(wasmRoot, "dist", file),
    resolve(root, "public/models/tfjs", file),
  );
const classes = (
  await readFile(resolve(root, "public/models/yamnet/classes.csv"), "utf8")
)
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => {
    const match = line.match(/^(\d+),([^,]+),(.+)$/);
    if (!match) throw new Error("Invalid YAMNet label");
    return { index: Number(match[1]), label: match[3].replace(/^"|"$/g, "") };
  });
await writeFile(
  resolve(root, "public/models/yamnet/classes.json"),
  JSON.stringify(classes),
);
await mkdir(resolve(root, "runtime"), { recursive: true });
await build({
  entryPoints: [resolve(root, "workers/transcribe-audio.ts")],
  outfile: resolve(root, "runtime/transcription-worker.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: [
    "@tensorflow/tfjs",
    "@tensorflow/tfjs-backend-wasm",
    "@spotify/basic-pitch",
  ],
});
console.log("Modelos internos de transcripción preparados.");
