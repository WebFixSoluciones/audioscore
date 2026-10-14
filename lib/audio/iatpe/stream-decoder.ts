import { parseFile } from "music-metadata";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import type { AudioFormatInfo } from "./types";

const LOSSLESS_CODECS = new Set([
  "flac",
  "alac",
  "wavpack",
  "ape",
  "tak",
  "shorten",
  "tta",
]);

export function getFfmpegBinary(): string {
  const binary = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!binary) throw new Error("FFmpeg no está disponible en el entorno");
  return binary;
}

export async function probeAudioFormat(filePath: string): Promise<AudioFormatInfo> {
  const metadata = await parseFile(filePath, { duration: true });
  const f = metadata.format;
  if (!f.duration || !f.sampleRate || !f.numberOfChannels) {
    throw new Error("No se pudo inspeccionar el formato del audio o está corrupto");
  }

  const codecLower = (f.codec ?? "unknown").toLowerCase();
  const containerLower = (f.container ?? "").toLowerCase();

  // Distinguir PCM y códecs sin pérdida reales de contenedores que pueden albergar audio comprimido con pérdida (p. ej. ADPCM en WAV)
  const isLossless =
    f.lossless === true ||
    codecLower.startsWith("pcm_") ||
    codecLower === "pcm" ||
    LOSSLESS_CODECS.has(codecLower);

  return {
    codec: codecLower,
    container: containerLower || codecLower,
    isLossless,
    durationSeconds: f.duration,
    channels: f.numberOfChannels,
    sampleRate: f.sampleRate,
    bitrateKbps: f.bitrate ? Math.round(f.bitrate / 1000) : undefined,
  };
}

export interface StreamDecodeOptions {
  targetSampleRate?: number;
  channels?: number;
  startTimeSeconds?: number;
  maxDurationSeconds?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DecodedAudioStream {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
}

export async function streamAudioToFloat32(
  filePath: string,
  options: StreamDecodeOptions = {},
): Promise<DecodedAudioStream> {
  const targetSampleRate = options.targetSampleRate ?? 22050;
  const channels = options.channels ?? 1;
  const maxDuration = options.maxDurationSeconds ?? 900;
  const timeoutMs = options.timeoutMs ?? 60000;
  const binary = getFfmpegBinary();

  options.signal?.throwIfAborted();

  const args: string[] = ["-v", "error"];
  if (options.startTimeSeconds && options.startTimeSeconds > 0) {
    args.push("-ss", String(options.startTimeSeconds));
  }
  args.push(
    "-i",
    filePath,
    "-vn",
    "-ac",
    String(channels),
    "-ar",
    String(targetSampleRate),
    "-t",
    String(maxDuration),
    "-f",
    "f32le",
    "pipe:1",
  );

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let bytesCollected = 0;
    const maxBytes = 400 * 1024 * 1024; // 400 MB buffer limit in memory

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Timeout en decodificación de audio por streaming"));
    }, timeoutMs);

    const abortHandler = () => {
      child.kill();
      reject(new DOMException("Decodificación cancelada", "AbortError"));
    };
    options.signal?.addEventListener("abort", abortHandler, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      bytesCollected += chunk.length;
      if (bytesCollected > maxBytes) {
        child.kill();
        reject(new Error("Audio excede el límite de memoria para streaming"));
      } else {
        chunks.push(chunk);
      }
    });

    let stderrMsg = "";
    child.stderr.on("data", (c: Buffer) => {
      stderrMsg += c.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortHandler);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortHandler);
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`FFmpeg falló al decodificar audio: ${stderrMsg.trim() || `código ${code}`}`));
      }
    });
  });

  const floatArray = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    Math.floor(buffer.length / 4),
  );

  return {
    samples: floatArray,
    sampleRate: targetSampleRate,
    channels,
    durationSeconds: floatArray.length / (targetSampleRate * channels),
  };
}
