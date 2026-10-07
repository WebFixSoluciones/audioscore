import * as tf from "@tensorflow/tfjs";
import { setWasmPaths, setThreadsCount } from "@tensorflow/tfjs-backend-wasm";
import { inferAudio } from "./inference";
import type { TranscriptionWorkerMessage } from "./types";
const scope = self as unknown as {
  location: Location;
  onmessage: (event: MessageEvent<{ samples: Float32Array }>) => void;
  postMessage: (message: TranscriptionWorkerMessage) => void;
};
scope.onmessage = async ({ data }) => {
  let pitch: tf.GraphModel | undefined, instruments: tf.GraphModel | undefined;
  try {
    scope.postMessage({
      type: "progress",
      value: { stage: "Cargando los modelos de análisis", progress: 5 },
    });
    tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
    setThreadsCount(1);
    setWasmPaths(new URL("/models/tfjs/", scope.location.origin).href);
    if (!(await tf.setBackend("wasm")))
      throw new Error("No se pudo iniciar el motor de análisis.");
    await tf.ready();
    pitch = await tf.loadGraphModel(
      new URL("/models/basic-pitch/model.json", scope.location.origin).href,
    );
    try {
      instruments = await tf.loadGraphModel(
        new URL("/models/yamnet/model.json", scope.location.origin).href,
      );
    } catch {
      /* Notes remain available even when the optional classifier fails. */
    }
    const result = await inferAudio(data.samples, pitch, instruments, (value) =>
      scope.postMessage({ type: "progress", value }),
    );
    scope.postMessage({ type: "complete", result });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "No se pudo transcribir el audio.",
    });
  } finally {
    pitch?.dispose();
    instruments?.dispose();
  }
};
