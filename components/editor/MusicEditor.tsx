"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  Workflow,
  SlidersHorizontal,
} from "lucide-react";
import dynamic from "next/dynamic";
import { IatpeWorkflowViewer } from "@/components/audio/IatpeWorkflowViewer";
import { useEditor } from "@/lib/editor/store";
import { StemPlayback } from "@/components/audio/StemPlayback";
import { SeparatedTracks } from "@/components/audio/SeparatedTracks";
import { PianoRoll } from "./PianoRoll";
import { EventInspector } from "./EventInspector";
import { useMixer } from "@/lib/editor/mixer-store";
import type { ChannelMix } from "@/lib/audio/mixer";

const WaveformEditor = dynamic(
  () => import("@/components/audio/WaveformEditor").then((m) => m.WaveformEditor),
  { ssr: false },
);
const MidiPlayback = dynamic(
  () => import("@/components/audio/MidiPlayback").then((m) => m.MidiPlayback),
  { ssr: false },
);
const ScoreViewer = dynamic(
  () => import("@/components/scores/ScoreViewer").then((m) => m.ScoreViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center text-sm text-neutral-400">
        Cargando visualizador de partituras...
      </div>
    ),
  },
);
const NotationPreview = dynamic(
  () => import("@/components/scores/NotationPreview").then((m) => m.NotationPreview),
  { ssr: false },
);
const TablatureViewer = dynamic(
  () => import("@/components/scores/TablatureViewer").then((m) => m.TablatureViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 items-center justify-center text-sm text-neutral-400">
        Cargando visualizador de tablatura...
      </div>
    ),
  },
);
import { PracticePanel } from "@/components/audio/PracticePanel";
import { MusicalAnalysis } from "@/components/audio/MusicalAnalysis";
import { analyzeOnMachine, localRequest } from "@/lib/audio/local/client";
import type { LocalResult } from "@/lib/audio/local/types";
import {
  defaultAnalysisOptions,
  type LocalAnalysisOptions,
} from "@/lib/audio/local/options";
import { readMidi } from "@/lib/music/midi-reader";
import { writeMidi } from "@/lib/music/midi-writer";
import { writeMusicXML } from "@/lib/music/musicxml";
import { writeMXL } from "@/lib/music/mxl";
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
  localEngine = false,
  initialLocalJobId,
}: {
  projectId?: string;
  initial?: Project;
  localEngine?: boolean;
  initialLocalJobId?: string;
}) {
  const state = useEditor(),
    doc = state.document;
  const [url, setUrl] = useState<string>(),
    [file, setFile] = useState<File>(),
    [fileName, setFileName] = useState("");
  const [tab, setTab] = useState<"score" | "tab">("score"),
    [full, setFull] = useState(false),
    [readable, setReadable] = useState(true);
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(Boolean(initialLocalJobId)),
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
  const [localJobId, setLocalJobId] = useState<string>();
  const [savedLocal, setSavedLocal] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [stemMix, setStemMix] = useState<Record<string, ChannelMix>>();
  const [analysisOptions, setAnalysisOptions] = useState<LocalAnalysisOptions>(
    defaultAnalysisOptions,
  );
  const analysisAbort = useRef<AbortController>(null);
  const audioSelection = useRef(0);
  useEffect(
    () => () => {
      audioSelection.current++;
      analysisAbort.current?.abort();
    },
    [],
  );
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
        ...(initial
          ? { title: initial.title }
          : localEngine
            ? { title: "Nuevo audio" }
            : {}),
      });
    if (
      projectId &&
      initial?.document?.sources.some((source) => source.storagePath)
    )
      void api<{ urls: Record<string, string> }>(
        `/api/projects/${projectId}/sources`,
      )
        .then((result) => setStemUrls(result.urls))
        .catch((error) => setNotice(messageOf(error)));
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
  }, [initial, projectId, localEngine]);
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
            if (result.project.document?.events.length) {
              setTab("score");
              setFull(false);
            }
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
    const selection = ++audioSelection.current;
    await invoke(async () => {
      validateAudioFile(
        selected.name,
        selected.type || "audio/wav",
        selected.size,
      );
      if (selected.size > 50 * 1024 * 1024 && !projectId)
        throw new Error(
          localEngine
            ? "El motor de este equipo admite archivos de hasta 50 MB. Prueba con un fragmento más corto."
            : "El estudio local admite hasta 50 MB. Usa un proyecto en la nube para archivos más grandes.",
        );
      state.setPlaying(false);
      if (localEngine) {
        setLocalJobId(undefined);
        setSavedLocal(false);
        setStemMix(undefined);
        setStemUrls({});
        setLocalAnalysis(undefined);
        state.load({
          ...emptyDocument(),
          title:
            selected.name.replace(/\.[^.]+$/, "").slice(0, 120) ||
            "Audio local",
        });
      }
      setFile(selected);
      setFileName(selected.name);
      if (selected.size <= 50 * 1024 * 1024) {
        const objectUrl = URL.createObjectURL(selected);
        setUrl(objectUrl);
        // Obtener duración instantánea vía Audio (<10ms) sin decodificar 50MB en RAM
        const tempAudio = new Audio(objectUrl);
        tempAudio.onloadedmetadata = () => {
          if (selection === audioSelection.current && Number.isFinite(tempAudio.duration)) {
            setAudioDuration(tempAudio.duration);
          }
        };
        // Diagnóstico acústico no bloqueante en background
        void acousticFeatures(selected)
          .then((measured) => {
            if (selection === audioSelection.current && measured) {
              setFeature(measured);
            }
          })
          .catch(() => {
            // El análisis del motor IATPE suministrará las características reales
          });
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
  function loadMachineResult(result: LocalResult, id: string) {
    state.load(result.document);
    setStemUrls(result.urls);
    setUrl(result.originalUrl);
    setPeaks(result.peaks);
    setAudioDuration(result.document.durationSeconds);
    setFile(undefined);
    setFileName(result.document.title);
    setLocalJobId(id);
    setStemMix(result.mix);
    setAnalysisOptions({
      ...defaultAnalysisOptions,
      ...result.analysisOptions,
    });
    state.setMode("audio");
    state.setRegion(undefined);
    state.setLoop(false);
    setTab("score");
    setFull(false);
  }
  useEffect(() => {
    if (!initialLocalJobId) return;
    let stopped = false;
    void localRequest<{ result: LocalResult }>(
      `jobs/${initialLocalJobId}/project`,
    )
      .then(({ result }) => {
        if (!stopped) {
          loadMachineResult(result, initialLocalJobId);
          setSavedLocal(true);
        }
      })
      .catch((e) => {
        if (!stopped) setNotice(messageOf(e));
      })
      .finally(() => {
        if (!stopped) setBusy(false);
      });
    return () => {
      stopped = true;
    };
    // A saved project loads only after explicitly opening its page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLocalJobId]);
  const newAudio = useCallback(() => {
    audioSelection.current++;
    const state = useEditor.getState();
    analysisAbort.current?.abort();
    state.setPlaying(false);
    state.setMode("audio");
    state.load({ ...emptyDocument(), title: "Nuevo audio" });
    state.setRegion(undefined);
    state.setLoop(false);
    setFile(undefined);
    setUrl(undefined);
    setFileName("");
    setLocalJobId(undefined);
    setSavedLocal(false);
    setStemMix(undefined);
    setStemUrls({});
    setPeaks(undefined);
    setAudioDuration(undefined);
    setLocalAnalysis(undefined);
    setFeature(undefined);
    setNotice("");
    setTab("score");
    setFull(false);
    if (audioInput.current) audioInput.current.value = "";
    if (midiInput.current) midiInput.current.value = "";
  }, []);
  useEffect(() => {
    window.addEventListener("audioscore:new-audio", newAudio);
    return () => window.removeEventListener("audioscore:new-audio", newAudio);
  }, [newAudio]);
  async function analyze(region = false) {
    if (!projectId) {
      if (localEngine) {
        if (region) {
          setNotice(
            "El separador local procesa el audio completo. Abre una selección guardada como archivo para analizarla por separado.",
          );
          return;
        }
        if (!file) {
          setNotice(
            "Abre un audio para separarlo y transcribirlo en este equipo.",
          );
          return;
        }
        await invoke(async () => {
          const abort = new AbortController();
          analysisAbort.current = abort;
          state.setPlaying(false);
          setWorkflowOpen(true);
          let id = "";
          try {
            const result = await analyzeOnMachine(
              file,
              setLocalAnalysis,
              abort.signal,
              (value) => {
                id = value;
              },
              analysisOptions,
            );
            abort.signal.throwIfAborted();
            loadMachineResult(result, id);
            setSavedLocal(false);
            setLocalAnalysis({
              stage: "Pistas y partitura listas para revisar",
              progress: 100,
            });
            setNotice(
              `${result.document.sources.length} stems disponibles y ${result.document.events.length} notas para revisar. Selecciona cada pista para escucharla o ver su partitura.`,
            );
          } catch (error) {
            if (abort.signal.aborted) {
              setLocalAnalysis(undefined);
              setNotice("Análisis cancelado. Se conservó el arreglo anterior.");
            } else {
              const errMsg = messageOf(error);
              setLocalAnalysis((prev) => ({
                stage: `Error: ${errMsg}`,
                progress: prev?.progress ?? 0,
              }));
              setNotice(errMsg);
            }
          } finally {
            if (analysisAbort.current === abort) analysisAbort.current = null;
          }
        });
        return;
      }
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
        setWorkflowOpen(true);
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
          if (result.notes.length) {
            setTab("score");
            setFull(false);
          }
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
          if (abort.signal.aborted) {
            setLocalAnalysis(undefined);
            setNotice(
              "Transcripción cancelada. Se conservó el arreglo anterior.",
            );
          } else {
            const errMsg = messageOf(error);
            setLocalAnalysis((prev) => ({
              stage: `Error: ${errMsg}`,
              progress: prev?.progress ?? 0,
            }));
            setNotice(errMsg);
          }
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
    if (localEngine && localJobId) {
      await invoke(async () => {
        await localRequest(`jobs/${localJobId}/project`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            document: doc,
            mix: useMixer.getState().channels,
          }),
        });
        setSavedLocal(true);
        setNotice(
          "Proyecto guardado. Puedes volver a abrirlo desde Mis proyectos.",
        );
      });
      return;
    }
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
  async function reviewStructure() {
    if (!localJobId)
      throw new Error(
        "Separa y transcribe un audio antes de revisar sus compases.",
      );
    const review = await localRequest<{
      parts: number;
      measures: number;
      notes: number;
      issues: string[];
    }>(`jobs/${localJobId}/notation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        document: doc,
        sourceId: full ? undefined : state.sourceId,
        readable,
      }),
    });
    if (review.issues.length)
      throw new Error(
        `Revisa los compases: ${review.issues.slice(0, 3).join(" ")}`,
      );
    setNotice(
      `${review.parts} partes y ${review.measures} compases con estructura válida. Escucha las notas para comprobar la transcripción.`,
    );
  }
  async function exportFile(format: ExportFormat | "mxl") {
    await invoke(async () => {
      if (projectId) {
        if (format === "mxl")
          throw new Error("MXL está disponible en el estudio local.");
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
        else if (format === "mxl") {
          if (localEngine && localJobId) await reviewStructure();
          saveAs(
            new Blob(
              [
                new Uint8Array(
                  writeMXL(doc, full ? undefined : state.sourceId, {
                    readable,
                  }),
                ),
              ],
              {
                type: "application/vnd.recordare.musicxml",
              },
            ),
            `${doc.title}.mxl`,
          );
        } else if (format === "musicxml")
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
        else if (localEngine && localJobId && ["pdf", "mei"].includes(format)) {
          const result = await localRequest<{ url: string }>(
            `jobs/${localJobId}/export`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                format,
                document: doc,
                sourceId: full ? undefined : state.sourceId,
                readable,
              }),
            },
          );
          const response = await fetch(result.url);
          if (!response.ok)
            throw new Error("No se pudo descargar la partitura.");
          saveAs(await response.blob(), `${doc.title}.${format}`);
        } else if (localEngine && format === "wav") {
          const audioUrl = full ? url : stemUrls[state.sourceId || ""] || url;
          if (!audioUrl) throw new Error("No hay audio disponible.");
          const response = await fetch(audioUrl);
          if (!response.ok) throw new Error("No se pudo descargar el audio.");
          saveAs(
            await response.blob(),
            `${doc.title}-${full ? "original" : source?.nameEs || "original"}.wav`,
          );
        } else
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
              if (localEngine) {
                setLocalJobId(undefined);
                setStemUrls({});
              }
              setNotice(
                `${document.events.length} eventos importados del archivo. No se ha transcrito el audio.`,
              );
            });
          e.target.value = "";
        }}
      />

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
        {/* CONSOLA PRINCIPAL UNIFICADA DAW */}
        <div className="daw-console-bar">
          {/* Deck Izquierdo: Identidad de Estudio, Título del Track y Estado */}
          <div className="daw-deck-left">
            <div className="daw-brand-tag" title="AudioScore Studio DAW">
              <span className="daw-led-dot" />
              <strong>STUDIO</strong>
            </div>

            <div className="daw-project-field">
              <AudioLines size={14} className="daw-field-icon" />
              <input
                aria-label={
                  localEngine && !savedLocal
                    ? "Nombre del audio"
                    : "Título del proyecto"
                }
                value={doc.title}
                maxLength={120}
                disabled={!editable}
                placeholder="Sin título"
                onChange={(e) =>
                  state.edit((d) => ({
                    ...d,
                    title:
                      e.target.value ||
                      (localEngine && !savedLocal
                        ? "Audio sin nombre"
                        : "Proyecto sin título"),
                  }))
                }
              />
            </div>

            {/* Chip de Estado / Progreso de Análisis */}
            <div className="daw-status-wrapper">
              {localAnalysis ? (
                <div className="daw-status-chip processing" role="status">
                  <LoaderCircle className={busy ? "spin" : ""} size={12} />
                  <span className="daw-status-stage">{localAnalysis.stage}</span>
                  <progress max={100} value={localAnalysis.progress} />
                  <strong>{Math.round(localAnalysis.progress)}%</strong>
                  <button
                    className="daw-chip-btn"
                    onClick={() => setWorkflowOpen(true)}
                    title="Ver Flujo IATPE"
                  >
                    Flujo
                  </button>
                  {busy && (
                    <button
                      className="daw-chip-btn cancel"
                      onClick={() => analysisAbort.current?.abort()}
                      title="Cancelar"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ) : job ? (
                <div className="daw-status-chip processing">
                  <LoaderCircle
                    className={
                      job.status === "running" || job.status === "queued"
                        ? "spin"
                        : ""
                    }
                    size={12}
                  />
                  <span className="daw-status-stage">
                    {stageLabels[job.stage] ?? job.stage}
                  </span>
                  <progress max={100} value={job.progress} />
                  <strong>{job.progress}%</strong>
                  {projectId &&
                    !["completed", "failed", "cancelled"].includes(job.status) && (
                      <button
                        className="daw-chip-btn cancel"
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
                        <X size={10} />
                      </button>
                    )}
                </div>
              ) : doc.events.length > 0 ? (
                <div className="daw-status-chip ready">
                  <span className="tiny-dot green" />
                  <span>
                    {doc.sources.length} stems · {doc.events.length} notas
                  </span>
                </div>
              ) : (
                <div className="daw-status-chip idle">
                  <span className="tiny-dot violet" />
                  <span>Listo</span>
                </div>
              )}
            </div>
          </div>

          {/* Deck Central: Transporte DAW, Reloj LCD y Parámetros Musicales */}
          <div className="daw-deck-center">
            <div className="daw-transport-group">
              <button
                className="daw-transport-btn"
                aria-label="Volver al inicio"
                title="Volver al inicio (0:00)"
                onClick={() => {
                  state.setPlaying(false);
                  state.seek(0);
                }}
              >
                <SkipBack size={14} />
              </button>

              <button
                className={`daw-play-btn ${state.playing ? "is-playing" : ""}`}
                aria-label={state.playing ? "Pausar" : "Reproducir"}
                title={state.playing ? "Pausar (Espacio)" : "Reproducir (Espacio)"}
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
                  <Pause size={15} />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
              </button>

              <button
                className={`daw-transport-btn ${state.loop ? "selected" : ""}`}
                aria-label="Repetir región"
                title="Repetir región (Loop)"
                disabled={!state.region}
                onClick={() => state.setLoop(!state.loop)}
              >
                <Repeat2 size={14} />
              </button>
            </div>

            {/* Reloj Digital LCD */}
            <div className="daw-lcd-display" title="Tiempo actual / Duración total">
              <span className="daw-lcd-time">{clock(state.currentTime)}</span>
              <span className="daw-lcd-sep">/</span>
              <span className="daw-lcd-total">{clock(doc.durationSeconds)}</span>
            </div>

            {/* Parámetros Musicales: BPM, Compás, Tonalidad, Modo */}
            <div className="daw-params-group">
              <label className="daw-param-item" title="Tempo en pulsos por minuto">
                <span className="daw-param-tag">BPM</span>
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
              </label>

              <label className="daw-param-item" title="Métrica de compás">
                <span className="daw-param-tag">COMPÁS</span>
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
              </label>

              <label className="daw-param-item" title="Tonalidad estimada">
                <span className="daw-param-tag">TONO</span>
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
                    "C", "G", "D", "A", "E", "B", "F#", "F", "Bb", "Eb", "Ab", "Db", "Gb",
                    "Am", "Em", "Bm", "Dm", "Gm", "Cm", "C#m", "Ebm", "Fm", "F#m", "G#m", "Bbm",
                  ].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>

              <label className="daw-param-item mode-item" title="Salida de audio">
                <span className="daw-param-tag">SALIDA</span>
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
              </label>
            </div>
          </div>

          {/* Deck Derecho: Opciones de Análisis IA Popover y Acciones */}
          <div className="daw-deck-right">
            {/* Popover elegante de Opciones de Análisis IA */}
            {localEngine && (
              <details className="daw-popover analysis-options">
                <summary className="daw-tool-btn" title="Opciones de análisis y separación IA">
                  <SlidersHorizontal size={13} />
                  <span>Opciones IA</span>
                  <ChevronDown size={11} className="daw-popover-chevron" />
                </summary>
                <div className="daw-popover-dropdown">
                  <div className="daw-popover-title">
                    <Sparkles size={13} className="text-violet-400" />
                    <strong>Motor de Análisis IATPE</strong>
                  </div>
                  <div className="daw-popover-body">
                    <label className="daw-popover-field">
                      <span>Calidad de separación</span>
                      <select
                        aria-label="Calidad de separación"
                        disabled={busy}
                        value={analysisOptions.quality}
                        onChange={(e) =>
                          setAnalysisOptions((o) => ({
                            ...o,
                            quality: e.target
                              .value as LocalAnalysisOptions["quality"],
                          }))
                        }
                      >
                        <option value="balanced">Equilibrada (Rápida)</option>
                        <option value="careful">Cuidadosa · Alta fidelidad</option>
                      </select>
                    </label>

                    <label className="daw-popover-field">
                      <span>Seguimiento de tempo</span>
                      <select
                        aria-label="Seguimiento de tempo"
                        disabled={busy}
                        value={analysisOptions.tempo}
                        onChange={(e) =>
                          setAnalysisOptions((o) => ({
                            ...o,
                            tempo: e.target
                              .value as LocalAnalysisOptions["tempo"],
                          }))
                        }
                      >
                        <option value="steady">Pulso constante</option>
                        <option value="adaptive">Adaptativo · Seguir cambios</option>
                      </select>
                    </label>

                    <div className="daw-popover-checks">
                      <label className="daw-check-item">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={analysisOptions.detectBars}
                          onChange={(e) =>
                            setAnalysisOptions((o) => ({
                              ...o,
                              detectBars: e.target.checked,
                            }))
                          }
                        />
                        <span>Estimar inicios de compás</span>
                      </label>

                      <label className="daw-check-item">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={analysisOptions.reduceNoise}
                          aria-label="Reducir ruido para transcribir"
                          onChange={(e) =>
                            setAnalysisOptions((o) => ({
                              ...o,
                              reduceNoise: e.target.checked,
                            }))
                          }
                        />
                        <span>Reducir ruido para transcribir</span>
                      </label>
                    </div>
                  </div>
                  <div className="daw-popover-footer">
                    <small>
                      Separador autoadaptativo con preservación de frecuencias y pipeline 16kHz antialias.
                    </small>
                  </div>
                </div>
              </details>
            )}

            {/* Botón Abrir Audio */}
            <button
              className="daw-tool-btn"
              disabled={busy}
              onClick={() => audioInput.current?.click()}
              title="Cargar archivo de audio (.mp3, .wav, .m4a, .flac)"
            >
              <Upload size={13} />
              <span>Abrir audio</span>
            </button>

            {/* Botón Héroe: Separar y Transcribir */}
            <button
              className="daw-hero-btn"
              disabled={
                busy ||
                (!projectId && (localEngine ? !file : !feature)) ||
                (job && ["running", "queued"].includes(job.status))
              }
              onClick={() => void analyze()}
              title="Ejecutar separación multicanal IATPE y transcripción automática"
            >
              <Sparkles size={13} />
              <span>{localEngine ? "Separar y transcribir" : "Analizar y transcribir"}</span>
              <ArrowUpRight size={12} />
            </button>

            {/* Botón Flujo IATPE */}
            <button
              className="daw-tool-btn daw-flow-btn"
              onClick={() => setWorkflowOpen(true)}
              title="Visualizador de Flujo IATPE en tiempo real"
            >
              <Workflow size={13} className="text-amber-400" />
              <span>Flujo IATPE</span>
            </button>

            {/* Botón Guardar */}
            <button
              className="daw-tool-btn"
              onClick={() => void save()}
              disabled={!editable || (localEngine && !localJobId)}
              title="Guardar como proyecto"
            >
              <Save size={13} />
              <span>
                {localEngine
                  ? savedLocal
                    ? "Guardar cambios"
                    : "Guardar como proyecto"
                  : "Guardar"}
              </span>
            </button>

            {/* Menú Exportar */}
            <div className="export-wrap">
              <button
                className="daw-tool-btn daw-export-btn"
                disabled={busy || !doc.events.length}
                onClick={() => setExportOpen(!exportOpen)}
                title="Exportar archivo de audio o partitura"
              >
                <Download size={13} />
                <span>Exportar</span>
                <ChevronDown size={11} />
              </button>
              {exportOpen && (
                <div className="export-menu">
                  {(
                    [
                      "midi",
                      "musicxml",
                      ...(localEngine ? ["mxl" as const] : []),
                      "mei",
                      "pdf",
                      "wav",
                      "mp3",
                      "json",
                      "zip",
                    ] as (ExportFormat | "mxl")[]
                  )
                    .filter(
                      (f) =>
                        !localEngine ||
                        [
                          "midi",
                          "musicxml",
                          "mxl",
                          "mei",
                          "pdf",
                          "wav",
                          "json",
                        ].includes(f),
                    )
                    .map((f) => (
                      <button key={f} onClick={() => void exportFile(f)}>
                        {f === "mxl"
                          ? "MusicXML comprimido (.mxl)"
                          : f.toUpperCase()}
                        <span>
                          {!projectId &&
                          !localEngine &&
                          !["midi", "musicxml", "json"].includes(f)
                            ? "En la nube"
                            : "↓"}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Acciones Secundarias Compactas: MIDI y Nuevo Audio */}
            <div className="daw-extra-tools">
              <button
                className="daw-icon-tool"
                disabled={busy}
                onClick={() => midiInput.current?.click()}
                title="Importar MIDI"
              >
                <FileMusic size={13} />
              </button>

              {localEngine &&
                (initialLocalJobId ? (
                  <Link
                    className="daw-icon-tool"
                    href="/dashboard/studio"
                    aria-disabled={busy}
                    title="Nuevo audio"
                    onClick={(event) => {
                      if (busy) event.preventDefault();
                      else newAudio();
                    }}
                  >
                    <RotateCcw size={13} />
                  </Link>
                ) : (
                  <button
                    className="daw-icon-tool"
                    disabled={busy}
                    onClick={newAudio}
                    title="Nuevo audio"
                  >
                    <RotateCcw size={13} />
                  </button>
                ))}
            </div>
          </div>
        </div>
        <div className="editor-grid editor-grid-audio">
          <StemPlayback
            urls={stemUrls}
            onError={onError}
            initialMix={stemMix}
          />
          <div className="editor-center">
            <WaveformEditor
              localMode={localEngine}
              url={url}
              onError={onError}
              peaks={file ? undefined : peaks}
              duration={file ? undefined : audioDuration}
            />
            <SeparatedTracks
              key={localJobId || Object.values(stemUrls).join("|")}
              urls={stemUrls}
              jobId={localJobId}
              busy={busy}
              onError={onError}
            />
            <div className="notation-toolbar">
              <div className="tabs">
                <button
                  className={tab === "score" ? "active" : ""}
                  onClick={() => setTab("score")}
                >
                  <Music2 size={14} />
                  Partitura
                </button>
                <button
                  className={tab === "tab" ? "active" : ""}
                  onClick={() => setTab("tab")}
                >
                  <Music2 size={14} />
                  Tablatura
                </button>
              </div>
              <div className="notation-actions">
                {!!doc.sources.length && (
                  <select
                    aria-label="Pista de partitura"
                    value={state.sourceId || doc.sources[0].id}
                    onChange={(e) => {
                      state.selectSource(e.target.value);
                      setFull(false);
                    }}
                  >
                    {doc.sources.map((pista) => (
                      <option key={pista.id} value={pista.id}>
                        {pista.nameEs || pista.name}
                      </option>
                    ))}
                  </select>
                )}
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
                {localEngine && localJobId && (
                  <button
                    className="text-button"
                    disabled={!editable || !doc.events.length}
                    onClick={() => void invoke(reviewStructure)}
                  >
                    Revisar compases
                  </button>
                )}
              </div>
            </div>
            {tab === "tab" ? (
              <TablatureViewer />
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
      {/* Paneles secundarios ocultados temporalmente a petición del usuario para enfoque en IATPE y Stems */}
      <MidiPlayback onError={onError} />
      {selected && (
        <div className="detail-grid">
          <section className="detail-card">
            <h3>Nota seleccionada</h3>
            <NotationPreview pitch={selected.midiNote ?? 60} />
          </section>
        </div>
      )}
      <IatpeWorkflowViewer
        open={workflowOpen}
        onClose={() => setWorkflowOpen(false)}
        document={doc}
        progress={localAnalysis}
        fileName={fileName || doc.title}
      />
    </div>
  );
}
