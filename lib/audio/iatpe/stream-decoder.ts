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

export async function probeWithFfmpeg(filePath: string): Promise<AudioFormatInfo> {
  const binary = getFfmpegBinary();
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ["-i", filePath, "-hide_banner"], {
      windowsHide: true,
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) =>
      reject(new Error(`Error al invocar FFmpeg para inspección: ${err.message}`)),
    );
    proc.on("close", () => {
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
      const audioMatch = stderr.match(
        /Stream\s+#\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Audio:\s*([^,\n\r]+)/i,
      );
      const containerMatch = stderr.match(/Input\s+#\d+,\s*([^,]+),/i);
      const bitrateMatch = stderr.match(/bitrate:\s*(\d+)\s*kb\/s/i);

      if (!durMatch) {
        return reject(
          new Error("No se pudo inspeccionar el formato del audio o está corrupto"),
        );
      }

      const durationSeconds =
        parseFloat(durMatch[1]) * 3600 +
        parseFloat(durMatch[2]) * 60 +
        parseFloat(durMatch[3]);

      if (durationSeconds <= 0 || !Number.isFinite(durationSeconds)) {
        return reject(
          new Error("No se pudo inspeccionar el formato del audio o está corrupto"),
        );
      }

      let sampleRate = 44100;
      let channels = 2;
      let codecLower = "unknown";

      if (audioMatch) {
        const fullAudioLine = stderr.slice(stderr.indexOf(audioMatch[0]));
        const line = fullAudioLine.split("\n")[0] || "";
        codecLower = audioMatch[1].trim().split(" ")[0].toLowerCase();
        const srMatch = line.match(/(\d+)\s*Hz/i);
        if (srMatch) sampleRate = parseInt(srMatch[1], 10);
        if (/mono/i.test(line)) channels = 1;
        else if (/stereo/i.test(line)) channels = 2;
        else {
          const chNumMatch = line.match(/(\d+)\s*channels/i);
          if (chNumMatch) channels = parseInt(chNumMatch[1], 10);
        }
      }

      const containerLower = containerMatch
        ? containerMatch[1].trim().split(",")[0].toLowerCase()
        : codecLower;

      const isLossless =
        codecLower.startsWith("pcm_") ||
        codecLower === "pcm" ||
        LOSSLESS_CODECS.has(codecLower);

      resolve({
        codec: codecLower,
        container: containerLower || codecLower,
        isLossless,
        durationSeconds,
        channels: Math.min(Math.max(1, channels), 8),
        sampleRate: Math.min(Math.max(8000, sampleRate), 192000),
        bitrateKbps: bitrateMatch ? parseInt(bitrateMatch[1], 10) : undefined,
      });
    });
  });
}

export async function probeAudioFormat(filePath: string): Promise<AudioFormatInfo> {
  try {
    const metadata = await parseFile(filePath, { duration: true });
    const f = metadata.format;
    if (f.duration && f.duration > 0 && f.sampleRate && f.numberOfChannels) {
      const codecLower = (f.codec ?? "unknown").toLowerCase();
      const containerLower = (f.container ?? "").toLowerCase();

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
  } catch {
    // Si parseFile falla por etiquetas no estándar o contenedor no coincidente con la extensión,
    // recurrimos a FFmpeg que inspecciona el flujo binario real de forma nativa.
  }

  // Fallback con FFmpeg para archivos DASH/AAC con extensión .mp3, VBR sin cabecera Xing, o contenedores especiales
  return await probeWithFfmpeg(filePath);
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
