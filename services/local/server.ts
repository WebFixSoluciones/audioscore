import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { z } from "zod";
import { probeAudio, audioPeaks } from "../../lib/audio/ffmpeg";
import { runIatpeAnalysis } from "../../lib/audio/iatpe/engine";
import {
  separationManifestSchema,
  type SeparatedStem,
} from "../../lib/audio/separation";
import { transcribeLocalAudio } from "../../lib/audio/transcription/server";
import { transcribeStems } from "../../lib/audio/transcription/stems";
import {
  documentSchema,
  musicalMetadataSchema,
  type MusicDocument,
} from "../../lib/music/types";
import { withTempoMap } from "../../lib/music/tempo-map";
import { tempoMapFromBeats } from "../../lib/music/beat-tempo";
import { localAnalysisOptionsSchema } from "../../lib/audio/local/options";
import { validateAudioFile } from "../../lib/audio/audio-validation";
import { writeMusicXML } from "../../lib/music/musicxml";
import { writeMidi } from "../../lib/music/midi-writer";
import { pythonRequest, stopPython } from "./python";
import type { LocalJob, LocalResult } from "../../lib/audio/local/types";
import { renderStemMix } from "../../lib/audio/mix-export";
import { defaultMix } from "../../lib/audio/mixer";
import {
  ownsLocalJob,
  savedLocalProjects,
} from "../../lib/audio/local/ownership";

const workspaceRoot = resolve(process.cwd());
const root = resolve(
  workspaceRoot,
  process.env.LOCAL_AUDIO_ROOT || ".local-audio/jobs",
);
if (!root.startsWith(workspaceRoot + sep))
  throw new Error("La carpeta de audio debe estar dentro del proyecto.");
const port = Number(process.env.LOCAL_AUDIO_PORT || 8765);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Puerto local inválido");
const token = process.env.LOCAL_AUDIO_TOKEN || "";
if (token.length < 32 || process.env.VERCEL === "1")
  throw new Error("El servicio solo admite el iniciador local.");
const jobs = new Map<string, LocalJob>();
const controllers = new Map<string, AbortController>();
const queue: string[] = [];
let active = false,
  practices = 0,
  uploading = 0;
const maxBytes = 50 * 1024 * 1024;
const json = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
};
function directory(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Identificador inválido");
  const path = resolve(root, id);
  if (!path.startsWith(root + sep)) throw new Error("Ruta inválida");
  return path;
}
async function persist(job: LocalJob) {
  const file = join(directory(job.id), "job.json");
  await writeFile(file + ".tmp", JSON.stringify(job));
  await rename(file + ".tmp", file);
}
async function progress(id: string, stage: string, value: number) {
  const job = jobs.get(id)!;
  if (job.status === "cancelled") return;
  job.stage = stage;
  job.progress = Math.round(value);
  job.status = "running";
  await persist(job);
}
const assetUrl = (id: string, file: string) =>
  `/api/local/jobs/${id}/files/${file}`;
async function run(id: string) {
  const job = jobs.get(id)!;
  const controller = new AbortController();
  controllers.set(id, controller);
  const signal = controller.signal,
    dir = directory(id);
  try {
    const options = localAnalysisOptionsSchema.parse(job.analysisOptions || {});
    await progress(id, "Analizando audio con motor IATPE", 4);
    const input = JSON.parse(await readFile(join(dir, "input.json"), "utf8"));
    const path = join(dir, input.file);
    const [iatpe, peaks] = await Promise.all([
      runIatpeAnalysis(path, { signal, maxDurationSeconds: 30 }),
      audioPeaks(path),
    ]);
    if (iatpe.format.durationSeconds > 900)
      throw new Error("El motor local admite hasta 15 minutos.");
    signal.throwIfAborted();
    await progress(id, "Midiendo pulso, tonalidad y acordes", 10);
    const metadata = z
      .object({
        bpm: z.number().min(20).max(400),
        tempoConfidence: z.number().min(0).max(1),
        key: documentSchema.shape.key,
        keyConfidence: z.number().min(0).max(1),
      })
      .merge(musicalMetadataSchema)
      .parse(
        await pythonRequest(
          {
            action: "metadata",
            input: path,
            tempo: options.tempo,
            detectBars: String(options.detectBars),
          },
          signal,
        ),
      );

    let stems: SeparatedStem[];
    let separationWarnings: string[] = [];
    let stemDurationSeconds: number | undefined;

    if (iatpe.channelPlan.isSolo) {
      const soloChannel = iatpe.channelPlan.channels[0];
      await progress(
        id,
        `Instrumento solista detectado: ${soloChannel.label}. Despachando canal único`,
        25,
      );
      stems = [
        {
          id: soloChannel.id,
          kind: (["piano", "guitar", "bass", "vocals", "drums"].includes(soloChannel.instrument)
            ? soloChannel.instrument
            : "piano") as any,
          label: soloChannel.label,
          confidence: iatpe.channelPlan.confidence,
          transcriptionEligible: true,
          localPath: path,
          storagePath: `local/${id}/${input.file}`,
        },
      ];
      separationWarnings.push(iatpe.channelPlan.decisionReason);
    } else {
      const engine =
        options.separationEngine ??
        iatpe.channelPlan.recommendedEngine ??
        "bs_roformer";
      const engineLabel =
        engine === "demucs"
          ? "Demucs (Híbrido U-Net)"
          : engine === "ensemble"
            ? "IATPE Ensamble Quirúrgico"
            : "BS-RoFormer (Transformer RoPE SOTA)";
      await progress(
        id,
        `Separación acústica autónoma (${iatpe.channelPlan.decisionReason.slice(0, 40)}...): ${engineLabel}`,
        18,
      );
      const manifest = separationManifestSchema.parse(
        await pythonRequest(
          {
            action: "separate",
            input: path,
            output: join(dir, "separated"),
            quality: options.quality,
            engine,
          },
          signal,
        ),
      );
      separationWarnings = manifest.warnings;
      stemDurationSeconds = manifest.durationSeconds;
      stems = manifest.sources.map((source) => ({
        ...source,
        localPath: join(dir, "separated", source.file),
        storagePath: `local/${id}/${source.file}`,
      }));
    }

    const tempoMap =
      options.tempo === "adaptive" && metadata.tempoConfidence > 0.1
        ? tempoMapFromBeats(
            metadata.beatTimes,
            metadata.bpm,
            metadata.tempoConfidence,
          )
        : [
            {
              startSeconds: 0,
              bpm: metadata.bpm,
              confidence: metadata.tempoConfidence,
            },
          ];

    const globalDoc: MusicDocument = {
      title: job.title,
      durationSeconds: stemDurationSeconds ?? iatpe.format.durationSeconds,
      timeSignature: [4, 4],
      key: metadata.keyConfidence > 0.05 ? metadata.key : "C",
      tempoMap,
      sources: [],
      events: [],
      sections: [],
      revision: 0,
      warnings: [
        ...(iatpe.googleClassification.googleGeminiReview
          ? [iatpe.googleClassification.googleGeminiReview]
          : []),
      ],
      confidence: iatpe.channelPlan.confidence,
      provenance: "transcription",
      analysis: {
        engine: "iatpe",
        keyConfidence: metadata.keyConfidence > 0.05 ? metadata.keyConfidence : 0,
        instrumentPredictions: iatpe.googleClassification.candidates.map((c) => ({
          label: c.label,
          labelEs: c.label,
          score: c.activation,
          audiosetId: c.audioSetId,
        })),
        scoreOriginSeconds: 0,
        musicalMetadata: musicalMetadataSchema.parse(metadata),
      },
    };

    const doc = await transcribeStems(globalDoc, stems, async (stem, index) => {
      await progress(
        id,
        `Transcribiendo ${stem.label}`,
        40 + (index / stems.length) * 50,
      );
      return transcribeLocalAudio(stem.localPath, job.title, {
        signal,
        sourceId: stem.id,
        tempoMap: globalDoc.tempoMap,
        reduceNoise: options.reduceNoise,
      });
    });
    signal.throwIfAborted();
    if (
      doc.analysis &&
      metadata.timeSignatureConfidence >= 0.4 &&
      metadata.estimatedTimeSignature
    ) {
      doc.timeSignature = metadata.estimatedTimeSignature;
      doc.warnings = doc.warnings.filter(
        (warning) =>
          !warning.startsWith("El compás 4/4 es una rejilla inicial"),
      );
      const firstNote = doc.events[0]?.startSeconds ?? 0;
      const origin = metadata.downbeatTimes?.findLast(
        (beat) => beat <= firstNote,
      );
      // Preserve a pickup instead of collapsing notes onto a later downbeat.
      doc.analysis.scoreOriginSeconds = origin ?? 0;
      doc.warnings.push(
        "Compás estimado a partir de pulsos fuertes; revisa anacrusa y cambios de métrica. No se eliminaron notas anteriores al primer pulso fuerte.",
      );
    }
    doc.warnings = [
      ...new Set([
        ...doc.warnings,
        ...separationWarnings,
        "Acordes y tonalidad son hipótesis armónicas; el compás sigue siendo editable.",
        ...(options.quality === "careful"
          ? [
              "Separación cuidadosa: dos pasadas y solapamiento del 50%; no garantiza mayor precisión en todas las mezclas.",
            ]
          : []),
        ...(options.reduceNoise
          ? [
              "Se redujo ruido en la entrada del transcriptor; los WAV separados conservan su sonido. Revisa notas suaves y sostenidas.",
            ]
          : []),
        ...(options.tempo === "adaptive"
          ? [
              "El mapa de tempo sigue grupos de pulsos estimados; revisa variaciones y valores al doble o a la mitad.",
            ]
          : []),
      ]),
    ].slice(0, 200);
    await progress(id, "Preparando pistas y partituras para esta sesión", 96);
    const result: LocalResult = {
      document: doc,
      analysisOptions: options,
      peaks: peaks.peaks,
      originalUrl: assetUrl(id, input.file),
      urls: Object.fromEntries(
        stems.map((s) => [s.id, assetUrl(id, basename(s.localPath))]),
      ),
    };
    await writeFile(join(dir, "result.json"), JSON.stringify(result));
    await writeFile(join(dir, "score.musicxml"), writeMusicXML(doc));
    await writeFile(join(dir, "score.mid"), writeMidi(doc));
    signal.throwIfAborted();
    Object.assign(job, {
      status: "completed",
      progress: 100,
      stage: "Separación y transcripción disponibles",
    });
  } catch (error) {
    if (signal.aborted || job.status === "cancelled")
      Object.assign(job, { status: "cancelled", stage: "Análisis cancelado" });
    else
      Object.assign(job, {
        status: "failed",
        stage: "No se pudo completar",
        error: error instanceof Error ? error.message : "Error de análisis",
      });
  } finally {
    controllers.delete(id);
    await persist(job);
  }
}
async function drain() {
  if (active || practices) return;
  active = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      if (jobs.get(id)?.status === "queued") await run(id);
    }
  } finally {
    active = false;
  }
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error("Solicitud demasiado grande");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function fileResponse(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) {
  const info = await stat(path);
  const extension = path.split(".").pop();
  const mime: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    flac: "audio/flac",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    aiff: "audio/aiff",
    aif: "audio/aiff",
    mid: "audio/midi",
    musicxml: "application/vnd.recordare.musicxml+xml",
    json: "application/json",
    pdf: "application/pdf",
    svg: "image/svg+xml",
    mei: "application/xml",
  };
  const headers: Record<string, string | number> = {
    "content-type": mime[extension!] || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  let start = 0,
    end = info.size - 1;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { "content-range": `bytes */${info.size}` });
      res.end();
      return;
    }
    start = match[1]
      ? Number(match[1])
      : Math.max(0, info.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || start > end || start < 0) {
      res.writeHead(416, { "content-range": `bytes */${info.size}` });
      res.end();
      return;
    }
    headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
  }
  headers["content-length"] = end - start + 1;
  res.writeHead(req.headers.range ? 206 : 200, headers);
  await pipeline(createReadStream(path, { start, end }), res);
}
async function rubberband(
  input: string,
  output: string,
  speed: number,
  pitch: number,
) {
  await new Promise<void>((resolveWork, reject) => {
    const child = spawn(
      process.env.FFMPEG_PATH || ffmpegStatic!,
      [
        "-y",
        "-v",
        "error",
        "-i",
        input,
        "-af",
        `rubberband=tempo=${speed}:pitch=${2 ** (pitch / 12)}:formant=preserved`,
        "-c:a",
        "pcm_s16le",
        output,
      ],
      { windowsHide: true },
    );
    let error = "";
    child.stderr.on("data", (b: Buffer) => {
      error = (error + b.toString()).slice(-1000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("La versión de práctica tardó demasiado."));
    }, 120000);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveWork();
      else reject(new Error(`No se pudo preparar la práctica: ${error}`));
    });
  });
}
async function main() {
  await mkdir(root, { recursive: true });
  for (const id of await readdir(root)) {
    if (!/^[a-f0-9-]{36}$/.test(id)) continue;
    try {
      const job = JSON.parse(
        await readFile(join(directory(id), "job.json"), "utf8"),
      ) as LocalJob;
      if (job.id !== id) continue;
      if (job.status === "running" || job.status === "queued") {
        job.status = "failed";
        job.stage = "Interrumpido al cerrar el motor";
        job.error = "Vuelve a abrir el audio para reanalizar.";
        await persist(job);
      }
      jobs.set(id, job);
    } catch {
      /* An interrupted upload is not a ready job. */
    }
  }
  const server = createServer(async (req, res) => {
    const presented = Buffer.from(String(req.headers["x-local-token"] || "")),
      expected = Buffer.from(token);
    if (
      presented.length !== expected.length ||
      !timingSafeEqual(presented, expected)
    ) {
      json(res, { error: "Servicio privado del equipo" }, 403);
      return;
    }
    try {
      const url = new URL(req.url!, "http://127.0.0.1:8765");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "health") {
        json(res, {
          ready: true,
          engine: "Demucs + librosa + Basic Pitch",
          queued: queue.length,
          active,
        });
        return;
      }
      if (parts[0] !== "jobs") {
        json(res, { error: "Ruta inexistente" }, 404);
        return;
      }
      const ownerUid = decodeURIComponent(
        String(req.headers["x-local-user"] || ""),
      );
      if (!ownerUid || ownerUid.length > 128 || /[\x00-\x1f]/.test(ownerUid)) {
        json(res, { error: "Se requiere un usuario autenticado" }, 401);
        return;
      }
      if (parts.length === 1 && req.method === "GET") {
        json(res, {
          jobs: savedLocalProjects(jobs.values(), ownerUid).slice(0, 100),
        });
        return;
      }
      if (parts.length === 1 && req.method === "POST") {
        if (
          queue.length + uploading >= 5 ||
          jobs.size + uploading >= 100 ||
          practices
        ) {
          json(
            res,
            {
              error:
                "El motor local tiene la cola llena. Espera a que termine.",
            },
            429,
          );
          return;
        }
        const name = decodeURIComponent(
          String(req.headers["x-audio-name"] || "audio.wav"),
        );
        const rawOptions = String(req.headers["x-analysis-options"] || "{}");
        if (rawOptions.length > 512)
          throw new Error("Opciones de análisis demasiado grandes");
        const analysisOptions = localAnalysisOptionsSchema.parse(
          JSON.parse(rawOptions),
        );
        const declared = Number(req.headers["content-length"]);
        const ext = validateAudioFile(
          name,
          String(req.headers["content-type"]),
          declared,
          { maxFileBytes: maxBytes },
        );
        const id = randomUUID(),
          dir = directory(id);
        uploading++;
        let size = 0;
        try {
          await mkdir(dir);
          await pipeline(
            req,
            new Transform({
              transform(chunk, _encoding, callback) {
                size += chunk.length;
                callback(
                  size > maxBytes ? new Error("El audio supera 50 MB") : null,
                  chunk,
                );
              },
            }),
            createWriteStream(join(dir, `input.${ext}`)),
          );
          if (size !== declared) throw new Error("Subida incompleta");
          await writeFile(
            join(dir, "input.json"),
            JSON.stringify({ file: `input.${ext}` }),
          );
          const job: LocalJob = {
            id,
            ownerUid,
            analysisOptions,
            title: name.replace(/\.[^.]+$/, "").slice(0, 120) || "Audio local",
            status: "queued",
            progress: 0,
            stage: "Esperando turno en este equipo",
            createdAt: new Date().toISOString(),
          };
          jobs.set(id, job);
          await persist(job);
          queue.push(id);
          json(res, { job }, 202);
          void drain();
        } catch (error) {
          jobs.delete(id);
          await rm(dir, { recursive: true, force: true });
          throw error;
        } finally {
          uploading--;
        }
        return;
      }
      const id = parts[1],
        dir = directory(id),
        job = jobs.get(id);
      if (!ownsLocalJob(job, ownerUid)) {
        json(res, { error: "Análisis inexistente" }, 404);
        return;
      }
      if (parts.length === 2 && req.method === "GET") {
        json(res, { job });
        return;
      }
      if (parts.length === 2 && req.method === "DELETE") {
        if (job.status === "running" || job.status === "queued") {
          job.status = "cancelled";
          job.stage = "Análisis cancelado";
          controllers.get(id)?.abort();
          // Active work owns its final write; avoid two renames of the same temporary file.
          if (!controllers.has(id)) await persist(job);
        }
        json(res, { job });
        return;
      }
      if (
        parts[2] === "result" &&
        req.method === "GET" &&
        job.status === "completed"
      ) {
        json(res, JSON.parse(await readFile(join(dir, "result.json"), "utf8")));
        return;
      }
      if (
        parts[2] === "project" &&
        req.method === "GET" &&
        job.status === "completed" &&
        job.savedAt
      ) {
        json(res, {
          job,
          result: JSON.parse(await readFile(join(dir, "result.json"), "utf8")),
        });
        return;
      }
      if (
        parts[2] === "project" &&
        req.method === "POST" &&
        job.status === "completed"
      ) {
        const input = z
          .object({
            document: documentSchema,
            mix: z
              .record(
                z.string(),
                z.object({
                  volume: z.number().min(0).max(1),
                  pan: z.number().min(-1).max(1),
                  muted: z.boolean(),
                  solo: z.boolean(),
                }),
              )
              .optional(),
          })
          .parse(await body(req));
        const result = JSON.parse(
          await readFile(join(dir, "result.json"), "utf8"),
        ) as LocalResult;
        if (Object.keys(input.mix || {}).some((id) => !result.urls[id]))
          throw new Error("La mezcla incluye una pista desconocida");
        result.document = input.document;
        result.mix = input.mix;
        await writeFile(join(dir, "result.json"), JSON.stringify(result));
        await writeFile(
          join(dir, "score.musicxml"),
          writeMusicXML(input.document),
        );
        await writeFile(join(dir, "score.mid"), writeMidi(input.document));
        Object.assign(job, {
          savedAt: new Date().toISOString(),
          title: input.document.title,
          durationSeconds: input.document.durationSeconds,
          sourceCount: input.document.sources.length,
        });
        await persist(job);
        json(res, { saved: true, job });
        return;
      }
      if (
        parts[2] === "document" &&
        req.method === "POST" &&
        job.status === "completed"
      ) {
        const document = documentSchema.parse(await body(req));
        const result = JSON.parse(
          await readFile(join(dir, "result.json"), "utf8"),
        ) as LocalResult;
        result.document = document;
        await writeFile(join(dir, "result.json"), JSON.stringify(result));
        await writeFile(join(dir, "score.musicxml"), writeMusicXML(document));
        await writeFile(join(dir, "score.mid"), writeMidi(document));
        json(res, { saved: true });
        return;
      }
      if (
        parts[2] === "waveforms" &&
        req.method === "GET" &&
        job.status === "completed"
      ) {
        const cache = join(dir, "waveforms.json");
        try {
          json(res, JSON.parse(await readFile(cache, "utf8")));
          return;
        } catch {
          /* Compute real per-stem peaks once. */
        }
        if (active || practices) {
          json(
            res,
            {
              error:
                "El motor está ocupado. Reintenta las ondas cuando termine.",
            },
            409,
          );
          return;
        }
        practices++;
        try {
          const result = JSON.parse(
            await readFile(join(dir, "result.json"), "utf8"),
          ) as LocalResult;
          const peaks: Record<string, number[]> = {};
          for (const sourceId of Object.keys(result.urls)) {
            const fileName = basename(result.urls[sourceId]);
            const directPath = join(dir, fileName);
            const separatedPath = join(dir, "separated", fileName);
            let filePath = directPath;
            try {
              await stat(directPath);
            } catch {
              filePath = separatedPath;
            }

            try {
              peaks[sourceId] = (await audioPeaks(filePath)).peaks;
            } catch {
              peaks[sourceId] = result.peaks;
            }
          }
          await writeFile(cache, JSON.stringify({ peaks }));
          json(res, { peaks });
        } finally {
          practices--;
          void drain();
        }
        return;
      }
      if (
        parts[2] === "mix" &&
        req.method === "POST" &&
        job.status === "completed"
      ) {
        if (active || practices) {
          json(
            res,
            { error: "Espera a que termine el procesamiento actual." },
            409,
          );
          return;
        }
        practices++;
        try {
          const input = z
            .object({
              channels: z.record(
                z.string(),
                z.object({
                  volume: z.number().min(0).max(1),
                  pan: z.number().min(-1).max(1),
                  muted: z.boolean(),
                  solo: z.boolean(),
                }),
              ),
            })
            .parse(await body(req));
          const result = JSON.parse(
            await readFile(join(dir, "result.json"), "utf8"),
          ) as LocalResult;
          if (Object.keys(input.channels).some((id) => !result.urls[id]))
            throw new Error("La mezcla incluye una pista desconocida");
          const inputs = await Promise.all(
            Object.keys(result.urls).map(async (id) => {
              const fileName = basename(result.urls[id]);
              const directPath = join(dir, fileName);
              const separatedPath = join(dir, "separated", fileName);
              let filePath = directPath;
              try {
                await stat(directPath);
              } catch {
                filePath = separatedPath;
              }
              return {
                path: filePath,
                channel: input.channels[id] ?? defaultMix,
              };
            }),
          );
          const file = `mix-${randomUUID()}.wav`;
          await renderStemMix(inputs, join(dir, file));
          json(res, { url: assetUrl(id, file) });
        } finally {
          practices--;
          void drain();
        }
        return;
      }
      if (
        parts[2] === "notation" &&
        req.method === "POST" &&
        job.status === "completed"
      ) {
        if (active || practices) {
          json(
            res,
            { error: "Espera a que termine el procesamiento actual." },
            409,
          );
          return;
        }
        practices++;
        try {
          const input = z
            .object({
              document: documentSchema,
              sourceId: z.string().optional(),
              readable: z.boolean(),
            })
            .parse(await body(req));
          const path = join(dir, "notation-review.musicxml");
          await writeFile(
            path,
            writeMusicXML(input.document, input.sourceId, {
              readable: input.readable,
            }),
          );
          const review = await pythonRequest(
            { action: "notation", input: path },
            new AbortController().signal,
          );
          json(res, review);
        } finally {
          practices--;
          void drain();
        }
        return;
      }
      if (
        parts[2] === "export" &&
        req.method === "POST" &&
        job.status === "completed"
      ) {
        if (active || practices) {
          json(
            res,
            { error: "Espera a que termine el procesamiento actual." },
            409,
          );
          return;
        }
        practices++;
        try {
          const input = z
            .object({
              format: z.enum(["pdf", "mei", "svg"]),
              document: documentSchema,
              sourceId: z.string().optional(),
              readable: z.boolean(),
            })
            .parse(await body(req));
          const { renderNotation } =
            await import("../../lib/music/score-converter");
          const file = `export-${input.document.revision}-${input.format}.${input.format}`;
          await writeFile(
            join(dir, file),
            await renderNotation(
              writeMusicXML(input.document, input.sourceId, {
                readable: input.readable,
              }),
              input.format,
            ),
          );
          json(res, { url: assetUrl(id, file) });
        } finally {
          practices--;
          void drain();
        }
        return;
      }
      if (
        parts[2] === "practice" &&
        req.method === "POST" &&
        job.status === "completed"
      ) {
        if (active || practices) {
          json(
            res,
            { error: "Espera a que termine el procesamiento actual." },
            409,
          );
          return;
        }
        practices++;
        try {
          const input = z
            .object({
              source: z.enum([
                "original",
                "piano",
                "guitar",
                "bass",
                "drums",
                "vocals",
                "other",
              ]),
              speed: z.number().min(0.5).max(1.5).multipleOf(0.05),
              semitones: z.number().int().min(-12).max(12),
            })
            .parse(await body(req));
          let source = join(dir, "original.wav");
          if (input.source === "original") {
            try {
              await stat(source);
            } catch {
              const inputConfig = JSON.parse(await readFile(join(dir, "input.json"), "utf8"));
              source = join(dir, inputConfig.file);
            }
          } else {
            source = join(dir, "separated", `${input.source}.wav`);
          }
          await stat(source);
          const file = `practice-${input.source}-${input.speed}-${input.semitones}.wav`;
          await rubberband(
            source,
            join(dir, file),
            input.speed,
            input.semitones,
          );
          json(res, { url: assetUrl(id, file) });
        } finally {
          practices--;
          void drain();
        }
        return;
      }
      if (parts[2] === "files" && parts.length === 4 && req.method === "GET") {
        const file = parts[3];
        if (
          !/^[a-zA-Z0-9_.-]+\.(wav|mid|musicxml|json|pdf|mei|svg|mp3|flac|m4a|aac|ogg|aiff|aif)$/.test(
            file,
          ) ||
          file.includes("..")
        )
          throw new Error("Archivo inválido");
        const directPath = join(dir, file);
        const separatedPath = join(dir, "separated", file);
        let targetPath = directPath;
        try {
          await stat(directPath);
        } catch {
          targetPath = separatedPath;
        }
        await fileResponse(req, res, targetPath);
        return;
      }
      json(res, { error: "Resultado todavía no disponible" }, 409);
    } catch (error) {
      if (!res.headersSent)
        json(
          res,
          { error: error instanceof Error ? error.message : "Error local" },
          400,
        );
      else res.destroy();
    }
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Motor local disponible en 127.0.0.1:${port}; los proyectos se guardan únicamente al solicitarlo.`,
    ),
  );
  const shutdown = () => {
    controllers.forEach((c) => c.abort());
    stopPython();
    server.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Error iniciando motor local",
  );
  process.exitCode = 1;
});
