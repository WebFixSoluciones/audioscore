import "server-only";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { spawn } from "node:child_process";
import { parseFile } from "music-metadata";
import { readFile } from "node:fs/promises";
import { ApiError } from "@/lib/utils/errors";
const binary = () => process.env.FFMPEG_PATH || ffmpegStatic;
export async function probeAudio(path: string) {
  try {
    const metadata = await parseFile(path, { duration: true });
    const f = metadata.format;
    if (
      f.duration &&
      Number.isFinite(f.duration) &&
      f.duration > 0 &&
      f.sampleRate &&
      f.sampleRate >= 8000 &&
      f.sampleRate <= 192000 &&
      f.numberOfChannels &&
      f.numberOfChannels <= 8
    ) {
      return {
        durationSeconds: f.duration,
        sampleRate: f.sampleRate,
        channels: f.numberOfChannels,
        codec: f.codec ?? "unknown",
      };
    }
  } catch {
    // Si parseFile falla al procesar el archivo, recurrimos a FFmpeg
  }

  const executable = binary();
  if (!executable) throw new ApiError(503, "FFmpeg no disponible");

  return new Promise<{
    durationSeconds: number;
    sampleRate: number;
    channels: number;
    codec: string;
  }>((resolve, reject) => {
    const proc = spawn(executable, ["-i", path, "-hide_banner"], {
      windowsHide: true,
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) =>
      reject(new ApiError(500, `Error al invocar FFmpeg: ${err.message}`)),
    );
    proc.on("close", () => {
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      const audioMatch = stderr.match(
        /Stream\s+#\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Audio:\s*([^,\n\r]+)/i,
      );

      if (!durMatch) {
        return reject(
          new ApiError(422, "Audio vacío, corrupto o con formato no compatible"),
        );
      }

      const durationSeconds =
        parseFloat(durMatch[1]) * 3600 +
        parseFloat(durMatch[2]) * 60 +
        parseFloat(durMatch[3]);

      if (durationSeconds <= 0 || !Number.isFinite(durationSeconds)) {
        return reject(
          new ApiError(422, "Audio vacío, corrupto o con formato no compatible"),
        );
      }

      let sampleRate = 44100;
      let channels = 2;
      let codec = "unknown";

      if (audioMatch) {
        const fullAudioLine = stderr.slice(stderr.indexOf(audioMatch[0]));
        const line = fullAudioLine.split("\n")[0] || "";
        codec = audioMatch[1].trim().split(" ")[0].toLowerCase();
        const srMatch = line.match(/(\d+)\s*Hz/i);
        if (srMatch) sampleRate = parseInt(srMatch[1], 10);
        if (/mono/i.test(line)) channels = 1;
        else if (/stereo/i.test(line)) channels = 2;
        else {
          const chNumMatch = line.match(/(\d+)\s*channels/i);
          if (chNumMatch) channels = parseInt(chNumMatch[1], 10);
        }
      }

      resolve({
        durationSeconds,
        sampleRate: Math.min(Math.max(8000, sampleRate), 192000),
        channels: Math.min(Math.max(1, channels), 8),
        codec,
      });
    });
  });
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
    }, 180000);
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
