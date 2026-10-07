import { cp, mkdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { createRequire } from "node:module";
const workspace = resolve(import.meta.dirname, "..");
const source = resolve(workspace, ".next/static");
const destination = resolve(workspace, ".next/standalone/.next/static");
if (relative(workspace, destination).startsWith("..") || source === destination)
  throw new Error("Invalid standalone destination");
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
await cp(
  resolve(workspace, "public"),
  resolve(workspace, ".next/standalone/public"),
  { recursive: true },
);
// The child worker is a separate entry point with its own package dependencies.
const require = createRequire(import.meta.url);
const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
const { fileList } = await nodeFileTrace(
  [resolve(workspace, "runtime/transcription-worker.cjs")],
  { base: workspace, processCwd: workspace },
);
const standalone = resolve(workspace, ".next/standalone");
for (const file of fileList) {
  const input = resolve(workspace, file);
  const output = resolve(standalone, file);
  if (
    relative(workspace, input).startsWith("..") ||
    relative(standalone, output).startsWith("..")
  )
    throw new Error("Worker dependency outside the workspace");
  await mkdir(dirname(output), { recursive: true });
  await cp(input, output);
}
console.log(
  "Standalone preparado con archivos estáticos y motor de transcripción.",
);
