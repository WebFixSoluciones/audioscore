import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as tf from "@tensorflow/tfjs";
import { setThreadsCount, setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import { inferAudio } from "@/lib/audio/transcription/inference";
import type { TranscriptionWorkerMessage } from "@/lib/audio/transcription/types";
const send = (message: TranscriptionWorkerMessage) =>
  parentPort?.postMessage(message);
async function loadModel(folder: string) {
  const manifest = JSON.parse(
    await readFile(join(folder, "model.json"), "utf8"),
  );
  const weights: Buffer[] = [];
  for (const group of manifest.weightsManifest)
    for (const file of group.paths)
      weights.push(await readFile(join(folder, file)));
  const bytes = Buffer.concat(weights);
  return tf.loadGraphModel(
    tf.io.fromMemory({
      modelTopology: manifest.modelTopology,
      weightSpecs: manifest.weightsManifest.flatMap(
        (group: { weights: tf.io.WeightsManifestEntry[] }) => group.weights,
      ),
      weightData: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    }),
  );
}
async function main() {
  let pitch: tf.GraphModel | undefined, instruments: tf.GraphModel | undefined;
  try {
    tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
    setThreadsCount(1);
    setWasmPaths(workerData.wasmDirectory);
    if (!(await tf.setBackend("wasm")))
      throw new Error("No se pudo iniciar el motor interno.");
    await tf.ready();
    const bytes = await readFile(workerData.pcmPath);
    if (bytes.length > 22050 * 900 * 4 || bytes.length % 4)
      throw new Error(
        "El motor integrado admite hasta 15 minutos por análisis.",
      );
    const samples = new Float32Array(bytes.length / 4);
    for (let i = 0; i < samples.length; i++)
      samples[i] = bytes.readFloatLE(i * 4);
    pitch = await loadModel(join(workerData.modelsDirectory, "basic-pitch"));
    try {
      instruments = await loadModel(join(workerData.modelsDirectory, "yamnet"));
    } catch {
      /* The note model can still run independently. */
    }
    const result = await inferAudio(samples, pitch, instruments, (value) =>
      send({ type: "progress", value }),
    );
    send({ type: "complete", result });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.error(error);
    send({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Transcripción interna fallida",
    });
  } finally {
    pitch?.dispose();
    instruments?.dispose();
  }
}
void main();
