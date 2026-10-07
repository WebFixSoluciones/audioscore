import "server-only";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { spawn } from "node:child_process";
import { parseFile } from "music-metadata";
import { readFile } from "node:fs/promises";
import { ApiError } from "@/lib/utils/errors";
const binary = () => process.env.FFMPEG_PATH || ffmpegStatic;
export async function probeAudio(path: string) {
  const metadata = await parseFile(path, { duration: true });
  const f = metadata.format;
  if (
    !f.duration ||
    !Number.isFinite(f.duration) ||
    f.duration <= 0 ||
    !f.sampleRate ||
    f.sampleRate < 8000 ||
    f.sampleRate > 192000 ||
    !f.numberOfChannels ||
    f.numberOfChannels > 8
  )
    throw new ApiError(
      422,
      "Audio vacío, corrupto o con formato no compatible",
    );
  return {
    durationSeconds: f.duration,
    sampleRate: f.sampleRate,
    channels: f.numberOfChannels,
    codec: f.codec ?? "unknown",
  };
}
export function transcodeAudio(
  input: string,
  output: string,
  format: "wav" | "mp3" = "wav",
  region?: [number, number],
): Promise<void> {
  const executable = binary();
  if (!executable) throw new ApiError(503, "FFmpeg no está disponible");
  ffmpeg.setFfmpegPath(executable);
  return new Promise((resolve, reject) => {
    const task = ffmpeg(input)
      .noVideo()
      .audioChannels(2)
      .audioFrequency(44100)
      .format(format)
      .outputOptions(
        format === "wav"
          ? ["-acodec pcm_s16le"]
          : ["-codec:a libmp3lame", "-b:a 192k"],
      );
    if (region) task.seekInput(region[0]).duration(region[1] - region[0]);
    const timer = setTimeout(() => {
      task.kill("SIGKILL");
      reject(new Error("FFmpeg excedió el tiempo de procesamiento"));
    }, 120000);
    task
      .on("end", () => {
        clearTimeout(timer);
        resolve();
      })
      .on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .save(output);
  });
}
export async function audioPeaks(path: string) {
  const executable = binary();
  if (!executable) throw new ApiError(503, "FFmpeg no disponible");
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-v",
        "error",
        "-i",
        path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "4000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Timeout en peaks"));
    }, 60000);
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > 120_000_000) {
        child.kill();
        reject(new Error("Audio demasiado largo"));
      } else chunks.push(b);
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error("No se pudo decodificar el audio"));
    });
  });
  const peaks: number[] = [];
  let squares = 0,
    clipped = 0;
  const n = bytes.length / 4,
    step = Math.max(1, Math.ceil(n / 2000));
  for (let i = 0; i < n; i += step) {
    let peak = 0;
    for (let j = i; j < Math.min(i + step, n); j++) {
      const x = bytes.readFloatLE(j * 4);
      if (!Number.isFinite(x)) throw new Error("Audio inválido");
      peak = Math.max(peak, Math.abs(x));
      squares += x * x;
      if (Math.abs(x) >= 0.999) clipped++;
    }
    peaks.push(peak);
  }
  const rms = Math.sqrt(squares / Math.max(n, 1));
  if (rms < 0.00001)
    throw new ApiError(422, "El audio está vacío o en silencio");
  return {
    peaks,
    rms,
    clippingRatio: clipped / Math.max(n, 1),
    warnings:
      clipped / Math.max(n, 1) > 0.05
        ? ["El audio presenta clipping extremo. Revisa el original."]
        : [],
  };
}
export const audioBytes = readFile;
