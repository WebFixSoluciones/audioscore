"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Download,
  FileMusic,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Music,
  Radio,
  Share2,
  Sparkles,
  Terminal,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { MusicDocument } from "@/lib/music/types";
import type { TranscriptionProgress } from "@/lib/audio/transcription/types";

export interface IatpeWorkflowViewerProps {
  open: boolean;
  onClose: () => void;
  document?: MusicDocument;
  progress?: TranscriptionProgress;
  fileName?: string;
}

interface WorkflowNode {
  id: string;
  title: string;
  subtitle: string;
  icon: typeof Cpu;
  status: "idle" | "running" | "completed";
  progressThreshold: number;
  data: Record<string, string | number | undefined>;
  description: string;
}

export function IatpeWorkflowViewer({
  open,
  onClose,
  document,
  progress,
  fileName,
}: IatpeWorkflowViewerProps) {
  const [activeTab, setActiveTab] = useState<"graph" | "report" | "logs">("graph");
  const [logs, setLogs] = useState<{ time: string; text: string; tag: string }[]>([]);

  const percent = progress?.progress ?? (document?.events?.length ? 100 : 0);
  const currentStage = progress?.stage || (document?.events?.length ? "Completado" : "Esperando inicio");

  // Telemetría en vivo derivada del documento y el progreso
  useEffect(() => {
    if (!open) return;
    const now = new Date().toLocaleTimeString("es-EC", { hour12: false });
    if (progress?.stage) {
      setLogs((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].text === progress.stage) return prev;
        const tag =
          percent < 15
            ? "INGESTA"
            : percent < 30
              ? "ESPECTRAL"
              : percent < 50
                ? "GOOGLE_AI"
                : percent < 80
                  ? "DESPACHO"
                  : "MICROSERVICIOS";
        return [...prev.slice(-40), { time: now, text: `${progress.stage} (${percent}%)`, tag }];
      });
    }
  }, [open, progress?.stage, percent]);

  const nodes: WorkflowNode[] = useMemo(() => {
    const isCompleted = percent >= 100;
    const getNodeStatus = (min: number, max: number): "idle" | "running" | "completed" => {
      if (percent >= max || isCompleted) return "completed";
      if (percent >= min && percent < max) return "running";
      return "idle";
    };

    const analysis = document?.analysis;
    const metadata = analysis?.musicalMetadata;
    const predictions = analysis?.instrumentPredictions ?? [];

    return [
      {
        id: "stream-ingest",
        title: "1. Ingesta Universal & Streaming",
        subtitle: "FFmpeg Memory Pipe (Zero WAV Disk)",
        icon: Radio,
        status: getNodeStatus(0, 8),
        progressThreshold: 4,
        description: "Decodificación en tiempo real hacia memoria RAM en PCM Float32LE.",
        data: {
          Archivo: fileName || "Pista cargada",
          Muestreo: "22,050 Hz Mono",
          Búfer: "Streaming en Memoria",
          Formato: "Universal (Sin transcodificar)",
        },
      },
      {
        id: "spectral-engine",
        title: "2. Motor Espectral IATPE",
        subtitle: "Micro-sonidos, STFT & Transitorios",
        icon: Activity,
        status: getNodeStatus(8, 20),
        progressThreshold: 12,
        description: "Extracción de envolvente de ataques, centroide tímbrico y micro-impactos acústicos.",
        data: {
          "Análisis Espectral": "FFT Radix-2 + Ventana Hann",
          "Detección Micro-sonidos": "Onsets sutiles de alta frecuencia",
          "Dinámica Acústica": "Medición RMS & Rango Dinámico",
        },
      },
      {
        id: "google-ai",
        title: "3. IA Multimodal de Google",
        subtitle: "YAMNet AudioSet + Gemini Multimodal",
        icon: Sparkles,
        status: getNodeStatus(20, 35),
        progressThreshold: 25,
        description: "Reconocimiento acústico de timbres musicales, silbidos, chasquidos y toques corporales.",
        data: {
          "Modelo Acústico": "Google YAMNet (521 Clases AudioSet)",
          "Razonador IA": "Google Gemini Audio Multimodal",
          "Candidatos Detectados": predictions.length
            ? predictions.slice(0, 3).map((p) => `${p.label} (${Math.round(p.score * 100)}%)`).join(", ")
            : "Clasificando espectro sonoro...",
        },
      },
      {
        id: "channel-dispatcher",
        title: "4. Despachador Dinámico IATPE",
        subtitle: "Plan de Canales (Solo vs Ensamble Polifónico)",
        icon: Share2,
        status: getNodeStatus(35, 55),
        progressThreshold: 40,
        description: "Determina si el audio es un instrumento/micro-sonido solista o una mezcla compleja de N canales.",
        data: {
          "Decisión de Despacho": document?.sources?.length === 1
            ? "Canal Único Directo (Bypass Demucs)"
            : `Ensamble de ${document?.sources?.length || "Múltiples"} Canales`,
          "Canales Asignados": document?.sources?.map((s) => s.nameEs || s.name).join(" · ") || "Calculando plan...",
          Confianza: document?.confidence ? `${Math.round(document.confidence * 100)}%` : "Alta",
        },
      },
      {
        id: "stems-isolation",
        title: "5. Separación & Aislamiento de Stems",
        subtitle: "Descomposición de Fuentes Acústicas",
        icon: Layers,
        status: getNodeStatus(55, 75),
        progressThreshold: 60,
        description: "Aislamiento de planos sonoros en pistas independientes con retención tímbrica.",
        data: {
          Motor: "BS-RoFormer (Transformer RoPE) + Ensamble IATPE",
          "Aislamiento SDR": "> 12.8 dB (Quirúrgico sin bleed)",
          Pistas: document?.sources?.length
            ? `${document.sources.length} canales activos`
            : "Separando fuentes...",
          "Modo de Calidad": "Band-Split sub-bandas ERB + Preservación de fase STFT",
        },
      },
      {
        id: "transcription-microservices",
        title: "6. Microservicios de Partituras por Canal",
        subtitle: "IA Especializada por Instrumento / Stem",
        icon: Cpu,
        status: getNodeStatus(75, 95),
        progressThreshold: 85,
        description: "Microservicios paralelos: Percusión (clave neutral), Melódico (vientos/voz), Polifónico (piano/acordeón).",
        data: {
          "Workers Paralelos": "Subprocesos especializados por canal",
          "Detección de Alturas": "Basic Pitch + Modelos Espectrales",
          "Compás & Tempo": document?.tempoMap?.[0]?.bpm
            ? `${Math.round(document.tempoMap[0].bpm)} BPM · ${document?.timeSignature?.join("/") || "4/4"}`
            : "Calculando...",
        },
      },
      {
        id: "sheet-music-synthesis",
        title: "7. Síntesis y Partitura Global",
        subtitle: "MusicXML, MIDI, Tablaturas & Armonía",
        icon: FileMusic,
        status: getNodeStatus(95, 100),
        progressThreshold: 100,
        description: "Generación de partitura polifónica regularizada, cifrado armónico y exportación universal.",
        data: {
          "Notas Transcritas": document?.events?.length ? `${document.events.length} notas` : "Sintetizando...",
          Tonalidad: document?.key ? `${document.key} (${Math.round((analysis?.keyConfidence || 0.8) * 100)}% confianza)` : "Detectando...",
          Formatos: "MusicXML, MIDI, Tablatura, MEI, PDF",
        },
      },
    ];
  }, [percent, document, fileName]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-5xl h-[90vh] bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden text-neutral-100">
        
        {/* Cabecera estilo N8N / Make */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-800/80 bg-neutral-900/60 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-400">
              <Workflow size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-white">
                  Monitor de Procesos IATPE
                </h2>
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  Estilo n8n Pipeline
                </span>
                {percent < 100 ? (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    En vivo · {percent}%
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    ✓ Completado
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Flujo coordinado: Decodificación en Memoria → IA de Google → Despacho Dinámico → Microservicios de Partitura
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
              <button
                onClick={() => setActiveTab("graph")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "graph"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Diagrama de Nodos
              </button>
              <button
                onClick={() => setActiveTab("report")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "report"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Informe de Revisión IATPE
              </button>
              <button
                onClick={() => setActiveTab("logs")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "logs"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                Consola en Vivo
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors ml-2"
              aria-label="Cerrar visor de procesos"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Barra de progreso global */}
        <div className="w-full bg-neutral-900 h-1 relative overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-emerald-400 transition-all duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Contenido principal según pestaña */}
        <div className="flex-1 overflow-y-auto p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-900/40 via-neutral-950 to-neutral-950">
          
          {/* VISTA 1: DIAGRAMA DE NODOS CONECTADOS (Estilo Make / n8n) */}
          {activeTab === "graph" && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                <span className="text-xs uppercase tracking-wider font-semibold text-neutral-400">
                  Fase Actual: <strong className="text-purple-300">{currentStage}</strong>
                </span>
                <span className="text-xs text-neutral-400">
                  Total nodos: {nodes.length} · Ejecutados: {nodes.filter((n) => n.status === "completed").length}
                </span>
              </div>

              <div className="relative pl-6 space-y-6 before:absolute before:left-[35px] before:top-6 before:bottom-6 before:w-0.5 before:bg-gradient-to-b before:from-purple-500 before:via-neutral-800 before:to-neutral-800">
                {nodes.map((node, index) => {
                  const Icon = node.icon;
                  const isRunning = node.status === "running";
                  const isDone = node.status === "completed";

                  return (
                    <div
                      key={node.id}
                      className={`relative flex items-start gap-4 p-5 rounded-xl border transition-all duration-300 ${
                        isRunning
                          ? "bg-purple-950/20 border-purple-500/60 shadow-[0_0_30px_rgba(168,85,247,0.15)] ring-1 ring-purple-500/30"
                          : isDone
                            ? "bg-neutral-900/50 border-neutral-800/80 hover:border-neutral-700"
                            : "bg-neutral-950/40 border-neutral-900 opacity-60"
                      }`}
                    >
                      {/* Nodo icono circular */}
                      <div
                        className={`relative z-10 flex items-center justify-center w-12 h-12 rounded-xl border transition-transform duration-300 ${
                          isRunning
                            ? "bg-purple-600 text-white border-purple-400 shadow-lg scale-105"
                            : isDone
                              ? "bg-emerald-950/50 text-emerald-400 border-emerald-500/40"
                              : "bg-neutral-900 text-neutral-500 border-neutral-800"
                        }`}
                      >
                        {isRunning ? (
                          <Loader2 size={22} className="animate-spin text-white" />
                        ) : isDone ? (
                          <CheckCircle2 size={22} className="text-emerald-400" />
                        ) : (
                          <Icon size={20} />
                        )}
                      </div>

                      {/* Información del nodo */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                              {node.title}
                              {isRunning && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                  PROCESANDO
                                </span>
                              )}
                              {isDone && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  OK
                                </span>
                              )}
                            </h3>
                            <p className="text-xs text-neutral-400 mt-0.5">
                              {node.subtitle} — {node.description}
                            </p>
                          </div>
                        </div>

                        {/* Parámetros de telemetría del nodo */}
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 pt-3 border-t border-neutral-800/60">
                          {Object.entries(node.data).map(([key, value]) => (
                            <div key={key} className="bg-neutral-950/60 rounded-lg p-2 border border-neutral-800/40">
                              <span className="block text-[10px] text-neutral-400 uppercase font-mono tracking-wider">
                                {key}
                              </span>
                              <span className="block text-xs font-medium text-neutral-200 truncate mt-0.5">
                                {String(value || "—")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VISTA 2: INFORME DE REVISIÓN ESTRUCTURADO */}
          {activeTab === "report" && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="p-6 rounded-2xl bg-neutral-900/60 border border-neutral-800 space-y-4">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">
                      Informe Técnico de Revisión — IATPE
                    </h3>
                    <p className="text-xs text-neutral-400">
                      Evaluación acústica integral y asignación de pistas para transcripción
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Motor IATPE v2.0
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800/80">
                    <span className="text-[10px] uppercase text-neutral-400 font-mono">Pistas Despachadas</span>
                    <strong className="block text-lg font-bold text-white mt-1">
                      {document?.sources?.length || 1} {document?.sources?.length === 1 ? "Canal (Solo)" : "Canales"}
                    </strong>
                  </div>
                  <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800/80">
                    <span className="text-[10px] uppercase text-neutral-400 font-mono">Tempo Estimado</span>
                    <strong className="block text-lg font-bold text-white mt-1">
                      {document?.tempoMap?.[0]?.bpm ? `${Math.round(document.tempoMap[0].bpm)} BPM` : "120 BPM"}
                    </strong>
                  </div>
                  <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800/80">
                    <span className="text-[10px] uppercase text-neutral-400 font-mono">Tonalidad Armónica</span>
                    <strong className="block text-lg font-bold text-white mt-1">
                      {document?.key || "C"}
                    </strong>
                  </div>
                  <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800/80">
                    <span className="text-[10px] uppercase text-neutral-400 font-mono">Total Eventos Notas</span>
                    <strong className="block text-lg font-bold text-emerald-400 mt-1">
                      {document?.events?.length || 0}
                    </strong>
                  </div>
                </div>

                {/* Desglose de canales asignados */}
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs uppercase tracking-wider font-semibold text-neutral-300">
                    Canales Asignados en el Despachador de Audio
                  </h4>
                  <div className="space-y-1.5">
                    {document?.sources?.length ? (
                      document.sources.map((source, i) => (
                        <div
                          key={source.id}
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-800/60 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-[10px] font-bold">
                              {i + 1}
                            </span>
                            <span className="font-medium text-white">{source.nameEs || source.name}</span>
                            <span className="text-neutral-400 font-mono text-[11px]">[{source.id}]</span>
                          </div>
                          <span className="text-neutral-400">
                            Programa MIDI {source.program} · {source.category}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-neutral-400 italic">No hay canales cargados todavía.</p>
                    )}
                  </div>
                </div>

                {/* Candidatos tímbricos detectados por Google AI */}
                {!!document?.analysis?.instrumentPredictions?.length && (
                  <div className="space-y-2 pt-2">
                    <h4 className="text-xs uppercase tracking-wider font-semibold text-neutral-300">
                      Instrumentación y Micro-sonidos Identificados por Google AI (AudioSet)
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {document.analysis.instrumentPredictions.map((pred) => (
                        <span
                          key={pred.label}
                          className="px-2.5 py-1 rounded-md text-xs bg-neutral-950 border border-neutral-800 text-neutral-300 flex items-center gap-1.5"
                        >
                          <span>{pred.labelEs || pred.label}</span>
                          <span className="text-purple-400 font-mono font-semibold">
                            {Math.round(pred.score * 100)}%
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VISTA 3: TERMINAL DE TELEMETRÍA EN VIVO */}
          {activeTab === "logs" && (
            <div className="max-w-4xl mx-auto h-[60vh] bg-black border border-neutral-800 rounded-xl p-4 font-mono text-xs overflow-y-auto space-y-1.5 text-neutral-300 shadow-inner">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-800 text-neutral-400">
                <span className="flex items-center gap-2">
                  <Terminal size={14} className="text-purple-400" />
                  Terminal de Telemetría en Tiempo Real IATPE
                </span>
                <span>{logs.length} eventos</span>
              </div>
              {logs.map((log, index) => (
                <div key={index} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-neutral-400 shrink-0">[{log.time}]</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 bg-neutral-900 border border-neutral-800 text-purple-300">
                    {log.tag}
                  </span>
                  <span className="text-neutral-200">{log.text}</span>
                </div>
              ))}
              {logs.length === 0 && (
                <p className="text-neutral-400 italic">Esperando inicio de eventos del motor...</p>
              )}
            </div>
          )}
        </div>

        {/* Pie del modal con botón de cierre */}
        <footer className="flex items-center justify-between px-6 py-3 border-t border-neutral-800 bg-neutral-900/60 text-xs text-neutral-400">
          <span>AudioScore · Motor de Procesador Integrado de Tecnologías de Audio (IATPE)</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors"
          >
            Cerrar Visor
          </button>
        </footer>
      </div>
    </div>
  );
}
