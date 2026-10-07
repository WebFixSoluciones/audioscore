"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ArrowUpRight,
  Upload,
  FileMusic,
  Play,
  Pause,
  SkipBack,
  Download,
  Undo2,
  Redo2,
  Wand2,
  Repeat2,
  Music2,
  Grid2X2,
  Save,
  X,
  ShieldCheck,
  Sparkles,
  ChevronDown,
  RotateCcw,
  LoaderCircle,
  Layers,
  FileAudio,
} from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { WaveformEditor } from "@/components/audio/WaveformEditor";
import { MidiPlayback } from "@/components/audio/MidiPlayback";
import { StemMixer } from "@/components/audio/StemMixer";
import { PianoRoll } from "./PianoRoll";
import { EventInspector } from "./EventInspector";
import { ScoreViewer } from "@/components/scores/ScoreViewer";
import { NotationPreview } from "@/components/scores/NotationPreview";
import { readMidi } from "@/lib/music/midi-reader";
import { writeMidi } from "@/lib/music/midi-writer";
import { writeMusicXML } from "@/lib/music/musicxml";
import { restoreExcludedNotes } from "@/lib/music/restore-candidates";
import { withTempoMap } from "@/lib/music/tempo-map";
import { validateAudioFile } from "@/lib/audio/audio-validation";
import {
  acousticFeatures,
  type AcousticFeatures,
} from "@/lib/audio/browser-features";
import { api } from "@/lib/firebase/client";
import type { Project, MusicDocument } from "@/lib/music/types";
import { emptyDocument } from "@/lib/music/types";
import { FeatureGate } from "@/components/billing/FeatureGate";
import { messageOf } from "@/lib/utils/errors";
import { saveAs } from "file-saver";
import type { ExportFormat, Plan } from "@/lib/billing/plans";
import { transcribeInBrowser } from "@/lib/audio/transcription/browser";
import { transcriptionDocument } from "@/lib/audio/transcription/document";
import type { TranscriptionProgress } from "@/lib/audio/transcription/types";
const clock = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const stageLabels: Record<string, string> = {
  queued: "En cola",
  validating: "Validando audio",
  normalizing: "Normalizando audio",
  global_analysis: "Análisis global",
  source_separation: "Separando fuentes",
  instrument_detection: "Revisando instrumentos",
  note_transcription: "Transcribiendo eventos",
  midi_generation: "Generando MIDI",
  musicxml_generation: "Generando MusicXML",
  pdf_generation: "Generando PDF",
  quality_validation: "Validando resultados",
  completed: "Completado",
  needs_review: "Requiere revisión",
  failed: "Error",
  cancelled: "Cancelado",
};
export function MusicEditor({
  projectId,
  initial,
}: {
  projectId?: string;
  initial?: Project;
}) {
  const state = useEditor(),
    doc = state.document;
  const [url, setUrl] = useState<string>(),
    [file, setFile] = useState<File>(),
    [fileName, setFileName] = useState("");
  const [tab, setTab] = useState<"piano" | "score">("piano"),
    [full, setFull] = useState(false),
    [readable, setReadable] = useState(true);
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [feature, setFeature] = useState<AcousticFeatures>();
  const [job, setJob] = useState<{
      id: string;
      progress: number;
      stage: string;
      status: string;
    }>(),
    [stemUrls, setStemUrls] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan>();
  const [localAnalysis, setLocalAnalysis] = useState<TranscriptionProgress>();
  const analysisAbort = useRef<AbortController>(null);
  useEffect(() => () => analysisAbort.current?.abort(), []);
  const editable =
    (!projectId || Boolean(plan?.features.manualCorrection)) &&
    !busy &&
    (!job || !["queued", "running"].includes(job.status));
  const [peaks, setPeaks] = useState(initial?.peaks);
  const [audioDuration, setAudioDuration] = useState(initial?.durationSeconds);
  useEffect(() => {
    if (projectId) {
      void api<{ plan: Plan }>("/api/usage/current")
        .then((r) => setPlan(r.plan))
        .catch((e) => setNotice(messageOf(e)));
      void api<{ urls: Record<string, string> }>(
        `/api/projects/${projectId}/sources`,
      )
        .then((r) => setStemUrls(r.urls))
        .catch((e) => setNotice(messageOf(e)));
    }
  }, [projectId]);
  const audioInput = useRef<HTMLInputElement>(null),
    midiInput = useRef<HTMLInputElement>(null),
    acousticPanel = useRef<HTMLElement>(null),
    keys = useRef<Record<string, string>>({});
  const revision = useRef(initial?.revision ?? 0);
  const onError = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (initial?.document) useEditor.getState().load(initial.document);
    else
      useEditor.getState().load({
        ...emptyDocument(),
        ...(initial ? { title: initial.title } : {}),
      });
    if (initial?.storagePath && projectId)
      void api<{ url: string }>(`/api/projects/${projectId}/download/original`)
        .then((r) => setUrl(r.url))
        .catch((e) => setNotice(messageOf(e)));
    if (projectId)
      void api<{ job: typeof job }>(`/api/projects/${projectId}/status`)
        .then((r) => {
          if (r.job) setJob(r.job);
        })
        .catch((e) => setNotice(messageOf(e)));
  }, [initial, projectId]);
  useEffect(
    () => () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(() => {
    if (
      !job ||
      !projectId ||
      ["completed", "failed", "cancelled"].includes(job.status)
    )
      return;
    const interval = setInterval(() => {
      void api<{ project: Project; job: typeof job }>(
        `/api/projects/${projectId}/status`,
      )
        .then(async (result) => {
          if (result.job) setJob(result.job);
          if (result.job?.status === "completed") {
            if (result.project.document)
              useEditor.getState().load(result.project.document);
            revision.current = result.project.revision;
            const sources = await api<{ urls: Record<string, string> }>(
              `/api/projects/${projectId}/sources`,
            );
            setStemUrls(sources.urls);
            setFile(undefined);
            setPeaks(result.project.peaks);
            setAudioDuration(result.project.durationSeconds);
            if (result.project.storagePath) {
              const original = await api<{ url: string }>(
                `/api/projects/${projectId}/download/original`,
              );
              setUrl(original.url);
            }
            setNotice(
              result.project.status === "needs_review"
                ? "Análisis disponible. Revisa las advertencias y las zonas de baja confianza."
                : "Análisis completado.",
            );
          }
        })
        .catch((e) => {
          setNotice(messageOf(e));
        });
    }, 3000);
    return () => clearInterval(interval);
  }, [job, projectId]);
  const invoke = async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  async function openAudio(selected: File) {
    await invoke(async () => {
      validateAudioFile(
        selected.name,
        selected.type || "audio/wav",
        selected.size,
      );
      if (selected.size > 50 * 1024 * 1024 && !projectId)
        throw new Error(
          "El estudio local admite hasta 50 MB. Usa un proyecto en la nube para archivos más grandes.",
        );
      state.setPlaying(false);
      setFile(selected);
      setFileName(selected.name);
      if (selected.size <= 50 * 1024 * 1024) {
        setUrl(URL.createObjectURL(selected));
        setFeature(await acousticFeatures(selected));
      } else
        setNotice(
          "Audio seleccionado. Sube el archivo para generar peaks en el servidor.",
        );
      state.edit((d) => ({
        ...d,
        title:
          d.title === "Proyecto sin título"
            ? selected.name.replace(/\.[^.]+$/, "").slice(0, 120)
            : d.title,
      }));
    });
  }
  function operationKey(kind: string) {
    return (keys.current[kind] ??= crypto.randomUUID());
  }
  async function analyze(region = false) {
    if (!projectId) {
      if (!file) {
        setNotice("Abre un archivo de audio para analizarlo y transcribirlo.");
        return;
      }
      if (
        region &&
        (!state.region ||
          doc.provenance !== "transcription" ||
          doc.sources.length !== 1)
      ) {
        setNotice(
          "Primero transcribe el audio completo antes de reprocesar una región.",
        );
        return;
      }
      const selectedRegion = region ? state.region : undefined;
      await invoke(async () => {
        const abort = new AbortController();
        analysisAbort.current = abort;
        state.setPlaying(false);
        try {
          const result = await transcribeInBrowser(
            file,
            setLocalAnalysis,
            abort.signal,
            selectedRegion,
          );
          const mapped = selectedRegion
            ? {
                ...result,
                durationSeconds: feature?.duration ?? doc.durationSeconds,
                notes: result.notes.map((note) => ({
                  ...note,
                  startSeconds: note.startSeconds + selectedRegion[0],
                })),
                excludedNotes: result.excludedNotes?.map((note) => ({
                  ...note,
                  startSeconds: note.startSeconds + selectedRegion[0],
                })),
              }
            : result;
          const transcribed = transcriptionDocument(
            mapped,
            doc.title,
            selectedRegion
              ? { sourceId: doc.sources[0].id, tempoMap: doc.tempoMap }
              : undefined,
          );
          state.edit(() =>
            selectedRegion
              ? {
                  ...doc,
                  events: [
                    ...doc.events.filter(
                      (event) =>
                        !(
                          event.startSeconds >= selectedRegion[0] &&
                          event.startSeconds + event.durationSeconds <=
                            selectedRegion[1]
                        ),
                    ),
                    ...transcribed.events.map((event) => ({
                      ...event,
                      id: crypto.randomUUID(),
                    })),
                  ],
                  warnings: [
                    ...new Set([
                      ...doc.warnings,
                      ...transcribed.warnings,
                      "Se conservaron las notas que cruzan los bordes de la región; revisa posibles solapamientos.",
                    ]),
                  ],
                  ...(doc.analysis
                    ? {
                        analysis: {
                          ...doc.analysis,
                          excludedNotes: [
                            ...(doc.analysis.excludedNotes ?? []).filter(
                              (n) =>
                                n.startSeconds < selectedRegion[0] ||
                                n.startSeconds >= selectedRegion[1],
                            ),
                            ...(transcribed.analysis?.excludedNotes ?? []),
                          ],
                        },
                      }
                    : {}),
                }
              : transcribed,
          );
          state.selectSource(transcribed.sources[0]?.id);
          state.select(undefined);
          state.seek(0);
          setLocalAnalysis({
            stage: "Transcripción disponible para revisión",
            progress: 100,
          });
          setNotice(
            result.notes.length
              ? `${result.notes.length} notas detectadas. Puedes escucharlas, corregirlas, ver la partitura y exportar MIDI o MusicXML.`
              : "El análisis terminó sin notas tonales suficientemente claras. Prueba con una región o un instrumento aislado.",
          );
        } catch (error) {
          setLocalAnalysis(undefined);
          if (abort.signal.aborted)
            setNotice(
              "Transcripción cancelada. Se conservó el arreglo anterior.",
            );
          else throw error;
        } finally {
          if (analysisAbort.current === abort) analysisAbort.current = null;
        }
      });
      return;
    }
    await invoke(async () => {
      if (file && !region) {
        const signed = await api<{ url: string }>(
          `/api/projects/${projectId}/upload-url`,
          {
            method: "POST",
            body: JSON.stringify({
              name: file.name,
              mime: file.type,
              size: file.size,
            }),
          },
        );
        const upload = await fetch(signed.url, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!upload.ok)
          throw new Error(
            "La subida falló. Comprueba la configuración CORS del bucket.",
          );
        await api(`/api/projects/${projectId}/upload-complete`, {
          method: "POST",
          body: "{}",
        });
      }
      const result = await api<{ job: NonNullable<typeof job> }>(
        `/api/projects/${projectId}/${region ? "reprocess-region" : "analyze"}`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: operationKey(
              `${region ? "region" : "analysis"}-${JSON.stringify(state.region)}-${file?.name}-${file?.size}-${file?.lastModified}-${job && ["failed", "cancelled"].includes(job.status) ? job.id : "initial"}`,
            ),
            ...(region ? { region: state.region } : {}),
          }),
        },
      );
      setJob(result.job);
    });
  }
  async function save() {
    if (!projectId) {
      saveAs(
        new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
        `${doc.title}.json`,
      );
      setNotice(
        "Documento musical descargado. El audio local permanece solo en esta sesión.",
      );
      return;
    }
    await invoke(async () => {
      const result = await api<{ revision: number }>(
        `/api/projects/${projectId}/corrections`,
        {
          method: "POST",
          body: JSON.stringify({
            document: doc,
            expectedRevision: revision.current,
            operation: "edit_document",
          }),
        },
      );
      revision.current = result.revision;
      setNotice("Cambios guardados y registrados en el historial.");
    });
  }
  async function exportFile(format: ExportFormat) {
    await invoke(async () => {
      if (projectId) {
        const result = await api<{ job: NonNullable<typeof job> }>(
          `/api/projects/${projectId}/export`,
          {
            method: "POST",
            body: JSON.stringify({
              format,
              sourceId: full ? undefined : state.sourceId,
              idempotencyKey: operationKey(
                `export-${format}-${revision.current}-${state.sourceId}-${full}`,
              ),
            }),
          },
        );
        setJob(result.job);
        setNotice(
          "Exportación en cola. Descárgala desde la página de exportaciones al finalizar.",
        );
      } else {
        if (!doc.events.length)
          throw new Error("Importa o escribe notas antes de exportar.");
        if (format === "midi")
          saveAs(
            new Blob(
              [
                new Uint8Array(
                  writeMidi(doc, full ? undefined : state.sourceId),
                ),
              ],
              { type: "audio/midi" },
            ),
            `${doc.title}.mid`,
          );
        else if (format === "musicxml")
          saveAs(
            new Blob(
              [
                writeMusicXML(doc, full ? undefined : state.sourceId, {
                  readable,
                }),
              ],
              {
                type: "application/vnd.recordare.musicxml+xml",
              },
            ),
            `${doc.title}.musicxml`,
          );
        else if (format === "json")
          saveAs(
            new Blob([JSON.stringify(doc, null, 2)], {
              type: "application/json",
            }),
            `${doc.title}.json`,
          );
        else
          throw new Error(
            "Este formato se genera en el servidor. Crea un proyecto en la nube.",
          );
      }
      setExportOpen(false);
    });
  }
  const selected = doc.events.find((e) => e.id === state.selectedId);
  const source = doc.sources.find((s) => s.id === state.sourceId);
  return (
    <div className="studio-page">
      <div className="page-heading">
        <div className="eyebrow">
          <span className="tiny-dot violet" /> TU ESPACIO DE CREACIÓN
        </div>
        <div className="heading-line">
          <div>
            <h1>
              De audio a ideas. <span>De ideas a música.</span>
            </h1>
            <p>
              {projectId
                ? "Escucha, transcribe y afina cada detalle en un solo espacio."
                : "Analiza tu audio, transcribe notas y corrige la partitura en el estudio."}
            </p>
          </div>
          <div className="heading-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => midiInput.current?.click()}
            >
              <FileMusic size={16} />
              Importar MIDI
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => audioInput.current?.click()}
            >
              <Upload size={16} />
              Abrir audio
            </button>
          </div>
        </div>
      </div>
      <input
        ref={audioInput}
        type="file"
        accept="audio/*,.aiff,.aif,.flac,.m4a"
        className="sr-only"
        aria-label="Abrir archivo de audio"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openAudio(f);
          e.target.value = "";
        }}
      />
      <input
        ref={midiInput}
        type="file"
        accept=".mid,.midi,.json"
        className="sr-only"
        aria-label="Importar archivo MIDI"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            void invoke(async () => {
              if (f.size > 5 * 1024 * 1024)
                throw new Error("MIDI o JSON demasiado grande.");
              const document = f.name.endsWith(".json")
                ? (
                    await import("@/lib/music/notation-validation")
                  ).validateDocument(JSON.parse(await f.text()))
                : readMidi(await f.arrayBuffer());
              state.load(document);
              setNotice(
                `${document.events.length} eventos importados del archivo. No se ha transcrito el audio.`,
              );
            });
          e.target.value = "";
        }}
      />
      <div className="overview-grid">
        <div className="overview-card">
          <span className="overview-icon violet">
            <FileAudio size={19} />
          </span>
          <div>
            <small>ARCHIVO DE AUDIO</small>
            <strong>
              {fileName ||
                (initial?.storagePath
                  ? "Audio del proyecto"
                  : "Listo para tu audio")}
            </strong>
            <p>
              {feature
                ? `${clock(feature.duration)} · ${(feature.sampleRate / 1000).toFixed(1)} kHz`
                : "Abre un archivo para empezar"}
            </p>
          </div>
        </div>
        <div className="overview-card">
          <span className="overview-icon cyan">
            <Layers size={19} />
          </span>
          <div>
            <small>PISTAS MUSICALES</small>
            <strong>
              {doc.sources.length} <span>pistas en tu arreglo</span>
            </strong>
            <p>{doc.events.length} eventos musicales</p>
          </div>
        </div>
        <div className="overview-card">
          <span className="overview-icon amber">
            <ShieldCheck size={19} />
          </span>
          <div>
            <small>REVISIÓN MUSICAL</small>
            <strong>
              {
                doc.events.filter(
                  (e) =>
                    !e.isHumanReviewed &&
                    (doc.provenance === "transcription" || e.confidence < 0.7),
                ).length
              }{" "}
              <span>eventos por revisar</span>
            </strong>
            <p>La confianza acompaña cada nota</p>
          </div>
        </div>
      </div>
      {!projectId && (
        <div className="notice">
          <AudioLines size={16} />
          <span>
            <strong>Transcripción integrada.</strong> Abre un audio y pulsa
            «Analizar y transcribir» para detectar notas e instrumentos
            probables. El audio se procesa en tu navegador. Revisa los
            resultados antes de exportarlos; las mezclas pueden contener errores
            de transcripción.
          </span>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <Sparkles size={16} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Cerrar aviso"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {job && (
        <div className="job-progress">
          <LoaderCircle
            className={
              job.status === "running" || job.status === "queued" ? "spin" : ""
            }
            size={17}
          />
          <span>{stageLabels[job.stage] ?? job.stage}</span>
          <progress max={100} value={job.progress} />
          <strong>{job.progress}%</strong>
          {projectId &&
            !["completed", "failed", "cancelled"].includes(job.status) && (
              <button
                className="text-button"
                onClick={() =>
                  void invoke(async () => {
                    await api(`/api/projects/${projectId}/cancel`, {
                      method: "POST",
                      body: "{}",
                    });
                    setJob({ ...job, status: "cancelled", stage: "cancelled" });
                  })
                }
              >
                Cancelar
              </button>
            )}
        </div>
      )}
      {localAnalysis && (
        <div className="job-progress" role="status">
          <LoaderCircle className={busy ? "spin" : ""} size={17} />
          <span>{localAnalysis.stage}</span>
          <progress max={100} value={localAnalysis.progress} />
          <strong>{Math.round(localAnalysis.progress)}%</strong>
          {busy && (
            <button
              className="text-button"
              onClick={() => analysisAbort.current?.abort()}
            >
              Cancelar análisis
            </button>
          )}
        </div>
      )}
      <section
        className="workstation"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (busy) return;
          const f = e.dataTransfer.files[0];
          if (f) void openAudio(f);
        }}
      >
        <div className="project-bar">
          <div className="project-title">
            <span className="project-icon">
              <AudioLines size={18} />
            </span>
            <div>
              <input
                aria-label="Título del proyecto"
                value={doc.title}
                maxLength={120}
                disabled={!editable}
                onChange={(e) =>
                  state.edit((d) => ({
                    ...d,
                    title: e.target.value || "Proyecto sin título",
                  }))
                }
              />
              <span>
                <span className="tiny-dot green" />
                {projectId
                  ? "Proyecto en la nube"
                  : "Estudio local · sesión del navegador"}
              </span>
            </div>
          </div>
          <div className="project-actions">
            <button
              className="button secondary small"
              onClick={() => void save()}
              disabled={!editable}
            >
              <Save size={14} />
              Guardar
            </button>
            <div className="export-wrap">
              <button
                className="button primary small"
                disabled={busy || !doc.events.length}
                onClick={() => setExportOpen(!exportOpen)}
              >
                <Download size={14} />
                Exportar
                <ChevronDown size={13} />
              </button>
              {exportOpen && (
                <div className="export-menu">
                  {(
                    [
                      "midi",
                      "musicxml",
                      "mei",
                      "pdf",
                      "wav",
                      "mp3",
                      "json",
                      "zip",
                    ] as ExportFormat[]
                  ).map((f) => (
                    <button key={f} onClick={() => void exportFile(f)}>
                      {f.toUpperCase()}
                      <span>
                        {!projectId && !["midi", "musicxml", "json"].includes(f)
                          ? "En la nube"
                          : "↓"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="transport">
          <div className="transport-play">
            <button
              className="icon-button"
              aria-label="Volver al inicio"
              onClick={() => {
                state.setPlaying(false);
                state.seek(0);
              }}
            >
              <SkipBack size={17} />
            </button>
            <button
              className="play-button"
              aria-label={state.playing ? "Pausar" : "Reproducir"}
              disabled={
                state.mode === "stems"
                  ? !Object.keys(stemUrls).length
                  : state.mode === "audio"
                    ? !url
                    : state.mode === "compare"
                      ? !url || !doc.events.length
                      : !doc.events.length
              }
              onClick={() => state.setPlaying(!state.playing)}
            >
              {state.playing ? (
                <Pause size={17} />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
            </button>
            <span className="time-display">
              {clock(state.currentTime)}
              <small>/ {clock(doc.durationSeconds)}</small>
            </span>
            <button
              className={`icon-button ${state.loop ? "selected" : ""}`}
              aria-label="Repetir región"
              disabled={!state.region}
              onClick={() => state.setLoop(!state.loop)}
            >
              <Repeat2 size={17} />
            </button>
          </div>
          <div className="transport-music">
            <label>
              <input
                aria-label="Tempo BPM"
                disabled={!editable}
                type="number"
                min={20}
                max={400}
                value={doc.tempoMap[0].bpm}
                onChange={(e) => {
                  const bpm = Number(e.target.value);
                  if (bpm >= 20 && bpm <= 400)
                    state.edit((d) =>
                      withTempoMap(d, [
                        { startSeconds: 0, bpm, confidence: 1 },
                      ]),
                    );
                }}
              />
              <span>
                BPM
                {doc.provenance === "midi_import"
                  ? " · MIDI"
                  : doc.tempoMap[0].confidence === 1
                    ? " · MANUAL"
                    : doc.tempoMap[0].confidence
                      ? " · ESTIMADO"
                      : " · REFERENCIA"}
              </span>
            </label>
            <label>
              <select
                aria-label="Compás"
                disabled={!editable}
                value={doc.timeSignature.join("/")}
                onChange={(e) =>
                  state.edit((d) => ({
                    ...d,
                    timeSignature: e.target.value
                      .split("/")
                      .map(Number) as MusicDocument["timeSignature"],
                  }))
                }
              >
                {["4/4", "3/4", "2/4", "6/8", "9/8", "12/8", "5/4", "7/8"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
              <span>COMPÁS{doc.analysis ? " · REVISAR" : ""}</span>
            </label>
            <label>
              <select
                aria-label="Tonalidad"
                disabled={!editable}
                value={doc.key}
                onChange={(e) =>
                  state.edit((d) => ({
                    ...d,
                    key: e.target.value as MusicDocument["key"],
                    ...(d.analysis
                      ? { analysis: { ...d.analysis, keyConfidence: 1 } }
                      : {}),
                  }))
                }
              >
                {[
                  "C",
                  "G",
                  "D",
                  "A",
                  "E",
                  "B",
                  "F#",
                  "F",
                  "Bb",
                  "Eb",
                  "Ab",
                  "Db",
                  "Gb",
                  "Am",
                  "Em",
                  "Bm",
                  "Dm",
                  "Gm",
                  "Cm",
                  "C#m",
                  "Ebm",
                  "Fm",
                  "F#m",
                  "G#m",
                  "Bbm",
                ].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <span>
                TONALIDAD
                {doc.analysis
                  ? doc.analysis.keyConfidence === 1
                    ? " · MANUAL"
                    : doc.analysis.keyConfidence
                      ? " · ESTIMADA"
                      : " · REFERENCIA"
                  : ""}
              </span>
            </label>
          </div>
          <div className="transport-right">
            <select
              aria-label="Modo de reproducción"
              value={state.mode}
              onChange={(e) =>
                state.setMode(e.target.value as typeof state.mode)
              }
            >
              <option value="audio">Audio original</option>
              <option value="midi">MIDI sintetizado</option>
              <option value="compare">Audio + MIDI</option>
              <option value="stems">Mezcla de stems</option>
            </select>
            <button
              className="button analyze small"
              disabled={
                busy ||
                (!projectId && !feature) ||
                (job && ["running", "queued"].includes(job.status))
              }
              onClick={() => void analyze()}
            >
              <Sparkles size={14} />
              Analizar y transcribir
              <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
        <div className="editor-grid">
          <StemMixer urls={stemUrls} editable={editable} />
          <div className="editor-center">
            <WaveformEditor
              url={url}
              onError={onError}
              peaks={file ? undefined : peaks}
              duration={file ? undefined : audioDuration}
            />
            <div className="notation-toolbar">
              <div className="tabs">
                <button
                  className={tab === "piano" ? "active" : ""}
                  onClick={() => setTab("piano")}
                >
                  <Grid2X2 size={14} />
                  Piano roll
                </button>
                <button
                  className={tab === "score" ? "active" : ""}
                  onClick={() => setTab("score")}
                >
                  <Music2 size={14} />
                  Partitura
                </button>
              </div>
              <div className="notation-actions">
                {tab === "score" && (
                  <>
                    <button
                      className={`text-button ${full ? "selected" : ""}`}
                      onClick={() => setFull(!full)}
                    >
                      {full ? "Global" : "Individual"}
                    </button>
                    <select
                      aria-label="Modo de partitura"
                      value={readable ? "readable" : "performed"}
                      onChange={(e) =>
                        setReadable(e.target.value === "readable")
                      }
                    >
                      <option value="readable">Legible</option>
                      <option value="performed">Interpretado</option>
                    </select>
                    {source && (
                      <select
                        aria-label="Pentagramas de la pista"
                        disabled={!editable}
                        value={source.notationLayout ?? "single"}
                        onChange={(e) =>
                          state.edit((d) => ({
                            ...d,
                            sources: d.sources.map((s) =>
                              s.id === source.id
                                ? {
                                    ...s,
                                    notationLayout: e.target.value as
                                      "single" | "piano",
                                  }
                                : s,
                            ),
                          }))
                        }
                      >
                        <option value="single">Un pentagrama</option>
                        <option value="piano">Piano · dos pentagramas</option>
                      </select>
                    )}
                    {source?.notationLayout === "piano" && (
                      <select
                        aria-label="Separación de registros"
                        disabled={!editable}
                        value={source.notationSplitPitch ?? 60}
                        onChange={(e) =>
                          state.edit((d) => ({
                            ...d,
                            sources: d.sources.map((s) =>
                              s.id === source.id
                                ? {
                                    ...s,
                                    notationSplitPitch: Number(e.target.value),
                                  }
                                : s,
                            ),
                          }))
                        }
                      >
                        {Array.from({ length: 128 }, (_, pitch) => (
                          <option key={pitch} value={pitch}>
                            Sol desde{" "}
                            {
                              [
                                "C",
                                "C♯",
                                "D",
                                "D♯",
                                "E",
                                "F",
                                "F♯",
                                "G",
                                "G♯",
                                "A",
                                "A♯",
                                "B",
                              ][pitch % 12]
                            }
                            {Math.floor(pitch / 12) - 1}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                )}
                <button
                  className="icon-button"
                  aria-label="Deshacer"
                  disabled={!editable || !state.past.length}
                  onClick={state.undo}
                >
                  <Undo2 size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Rehacer"
                  disabled={!editable || !state.future.length}
                  onClick={state.redo}
                >
                  <Redo2 size={15} />
                </button>
                <button
                  className="text-button"
                  disabled={!editable || !doc.events.length}
                  onClick={state.quantize}
                >
                  <Wand2 size={14} />
                  Cuantizar
                </button>
              </div>
            </div>
            {tab === "piano" ? (
              <PianoRoll editable={editable} />
            ) : (
              <ScoreViewer full={full} readable={readable} />
            )}
            <div className="notation-footer">
              <span>
                <span className="tiny-dot violet" />{" "}
                {source?.nameEs || "Sin pista seleccionada"}
              </span>
              <span>
                {state.region
                  ? `Región ${clock(state.region[0])} — ${clock(state.region[1])}`
                  : "Selecciona · Escucha · Corrige"}
              </span>
              {state.region &&
                (projectId || doc.provenance === "transcription") && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void analyze(true)}
                  >
                    <RotateCcw size={12} />
                    Reprocesar
                  </button>
                )}
            </div>
          </div>
        </div>
        {projectId ? (
          <FeatureGate
            feature="manualCorrection"
            plan={plan}
            active={Boolean(plan)}
          >
            <EventInspector />
          </FeatureGate>
        ) : (
          <EventInspector />
        )}
      </section>
      <MidiPlayback onError={onError} />
      <div className="studio-footnotes">
        <div>
          <ShieldCheck size={15} />
          <span>
            {projectId
              ? "Originales y stems: máximo 24 h. Descarga tus resultados antes de su caducidad."
              : "El audio local permanece en tu navegador. Guarda tus eventos antes de cerrar."}
          </span>
        </div>
        <span className="micro-tag">NO SE GENERAN NOTAS SIN EVIDENCIA</span>
      </div>
      {(doc.warnings.length > 0 || feature || selected || doc.analysis) && (
        <div className="detail-grid">
          {doc.analysis && (
            <section className="detail-card">
              <h3>
                Instrumentos probables <span>Detección automática</span>
              </h3>
              <p>
                Sonidos identificados en fragmentos de la mezcla. Las
                puntuaciones indican activación del modelo; no son pistas
                separadas ni identificaciones confirmadas.
              </p>
              {doc.analysis.instrumentPredictions.length ? (
                <div className="instrument-predictions">
                  {doc.analysis.instrumentPredictions.map((prediction) => (
                    <span className="micro-tag" key={prediction.label}>
                      {prediction.labelEs} ·{" "}
                      {Math.round(prediction.score * 100)}%
                    </span>
                  ))}
                </div>
              ) : (
                <p>
                  No hay una identificación de instrumento suficientemente
                  clara.
                </p>
              )}
              {!!doc.analysis.excludedNotes?.length && (
                <>
                  <p>
                    {doc.analysis.excludedNotes.length} detecciones breves o
                    posibles armónicos se apartaron para limpiar la
                    transcripción. Puedes recuperarlas y deshacer la
                    recuperación.
                  </p>
                  <button
                    className="button small"
                    disabled={!editable || busy}
                    onClick={() =>
                      void invoke(async () => {
                        state.edit(restoreExcludedNotes);
                        setNotice(
                          "Detecciones apartadas recuperadas para revisión.",
                        );
                      })
                    }
                  >
                    Recuperar detecciones apartadas
                  </button>
                </>
              )}
            </section>
          )}
          {feature && (
            <section
              className="detail-card"
              ref={acousticPanel}
              tabIndex={-1}
              aria-label="Análisis acústico del audio"
            >
              <h3>
                Características acústicas <span>Meyda</span>
              </h3>
              <p>
                Medidas de ventanas del canal principal; no representan una
                transcripción.
              </p>
              <div className="acoustic-stats">
                <div>
                  <strong>{feature.rms.toFixed(3)}</strong>
                  <small>RMS medio</small>
                </div>
                <div>
                  <strong>{Math.round(feature.spectralCentroidHz)} Hz</strong>
                  <small>Centroide espectral</small>
                </div>
                <div>
                  <strong>{feature.clippingPercent.toFixed(1)}%</strong>
                  <small>Clipping estimado</small>
                </div>
              </div>
            </section>
          )}
          {doc.warnings.length > 0 && (
            <section className="detail-card">
              <h3>Revisión del análisis</h3>
              {doc.warnings.map((w, i) => (
                <p key={i} className="warning-text">
                  {w}
                </p>
              ))}
            </section>
          )}
          {selected && (
            <section className="detail-card">
              <h3>Nota seleccionada</h3>
              <NotationPreview pitch={selected.midiNote ?? 60} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
