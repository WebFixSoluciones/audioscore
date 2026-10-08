"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import {
  Music2,
  Plus,
  Piano,
  AudioLines,
  Drum,
  Headphones,
} from "lucide-react";
import type { AudioSource } from "@/lib/music/types";
const colors = ["#b090f6", "#5dd6c7", "#e9b567", "#eb83a5", "#69aaf7"];
let mixerContext: AudioContext | undefined;
let mixerUsers = 0;
function StemRow({
  source,
  url,
  index,
  soloed,
  onSolo,
  master,
  editable,
}: {
  source: AudioSource;
  url?: string;
  index: number;
  soloed?: string;
  onSolo: () => void;
  master: boolean;
  editable: boolean;
}) {
  const { sourceId, selectSource, playing, currentTime, mode } = useEditor();
  const [muted, setMuted] = useState(false),
    [volume, setVolume] = useState(0.8),
    [pan, setPan] = useState(0);
  const audio = useRef<HTMLAudioElement>(null),
    panner = useRef<StereoPannerNode | null>(null),
    context = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!url) return;
    const element = new Audio();
    element.crossOrigin = "anonymous";
    element.preload = "metadata";
    element.src = url;
    audio.current = element;
    if (!mixerContext || mixerContext.state === "closed")
      mixerContext = new AudioContext();
    const ctx = mixerContext;
    mixerUsers++;
    const sourceNode = ctx.createMediaElementSource(element);
    const node = ctx.createStereoPanner();
    sourceNode.connect(node).connect(ctx.destination);
    context.current = ctx;
    panner.current = node;
    const onTime = () => {
      const s = useEditor.getState();
      if (master && s.mode === "stems") {
        if (s.loop && s.region && element.currentTime >= s.region[1])
          element.currentTime = s.region[0];
        s.seek(element.currentTime);
      }
    };
    const onEnd = () => {
      if (master && useEditor.getState().mode === "stems")
        useEditor.getState().setPlaying(false);
    };
    element.addEventListener("timeupdate", onTime);
    element.addEventListener("ended", onEnd);
    return () => {
      element.pause();
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("ended", onEnd);
      element.removeAttribute("src");
      element.load();
      audio.current = null;
      sourceNode.disconnect();
      node.disconnect();
      mixerUsers--;
      if (mixerUsers === 0) {
        void ctx.close();
        mixerContext = undefined;
      }
    };
  }, [url, master]);
  useEffect(() => {
    if (panner.current) panner.current.pan.value = pan;
  }, [pan]);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.volume =
      muted || (soloed !== undefined && soloed !== source.id) ? 0 : volume;
  }, [muted, soloed, source.id, volume]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !url) return;
    if (playing && mode === "stems") {
      void context.current?.resume();
      void element.play().catch(() => useEditor.getState().setPlaying(false));
    } else element.pause();
  }, [playing, url, mode]);
  useEffect(() => {
    const element = audio.current;
    if (
      element &&
      Number.isFinite(element.duration) &&
      Math.abs(element.currentTime - currentTime) > 0.3
    )
      element.currentTime = Math.min(currentTime, element.duration);
  }, [currentTime]);
  const Icon =
    source.category === "percussive"
      ? Drum
      : source.program >= 32 && source.program <= 39
        ? AudioLines
        : Piano;
  return (
    <div
      className={`stem-row ${sourceId === source.id ? "stem-active" : ""}`}
      style={
        { "--stem-color": colors[index % colors.length] } as React.CSSProperties
      }
    >
      <button className="stem-name" onClick={() => selectSource(source.id)}>
        <span className="stem-icon">
          <Icon size={17} />
        </span>
        <span>
          <strong>{source.nameEs || source.name}</strong>
          <small>
            {source.evidence === "human"
              ? "Pista manual"
              : `${Math.round(source.confidence * 100)}% de confianza`}
          </small>
        </span>
      </button>
      <select
        className="stem-instrument"
        aria-label={`Instrumento de ${source.name}`}
        disabled={!editable}
        value={source.category === "percussive" ? 128 : source.program}
        onChange={(event) => {
          const program = Number(event.target.value),
            name = event.target.selectedOptions[0].text;
          useEditor.getState().edit((d) => ({
            ...d,
            sources: d.sources.map((s) =>
              s.id === source.id
                ? {
                    ...s,
                    name,
                    nameEs: name,
                    family: name,
                    program: program === 128 ? 0 : program,
                    notationLayout:
                      program >= 0 && program <= 7 ? "piano" : "single",
                    category: program === 128 ? "percussive" : "tonal",
                    channel:
                      program === 128 ? 10 : s.channel === 10 ? 1 : s.channel,
                    evidence: "human",
                    analogOrDigital: "unknown",
                    acousticOrElectronic: "unknown",
                  }
                : s,
            ),
          }));
        }}
      >
        {![0, 24, 32, 48, 65, 80].includes(source.program) &&
          source.category !== "percussive" && (
            <option value={source.program}>
              Programa {source.program + 1}
            </option>
          )}
        {[
          [0, "Piano"],
          [24, "Guitarra"],
          [32, "Bajo"],
          [48, "Cuerdas"],
          [65, "Saxo"],
          [80, "Sintetizador"],
          [128, "Batería"],
        ].map(([p, n]) => (
          <option key={p} value={p}>
            {n}
          </option>
        ))}
      </select>
      <div className="stem-controls">
        <button
          className={soloed === source.id ? "on" : ""}
          onClick={onSolo}
          aria-label={`Solo ${source.name}`}
          disabled={!url}
        >
          S
        </button>
        <button
          className={muted ? "on" : ""}
          onClick={() => setMuted(!muted)}
          aria-label={`Silenciar ${source.name}`}
          disabled={!url}
        >
          M
        </button>
      </div>
      <div className="stem-sliders">
        <input
          aria-label={`Volumen ${source.name}`}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          disabled={!url}
        />
        <input
          aria-label={`Paneo ${source.name}`}
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={pan}
          onChange={(e) => setPan(Number(e.target.value))}
          disabled={!url}
        />
      </div>
    </div>
  );
}
export function StemMixer({
  urls = {},
  editable = true,
}: {
  urls?: Record<string, string>;
  editable?: boolean;
}) {
  const { document: doc, edit, selectSource } = useEditor();
  const [solo, setSolo] = useState<string>();
  const detected = (doc.analysis?.instrumentPredictions ?? []).filter(
    (prediction) => prediction.kind !== "technique",
  );
  function add() {
    if (!editable || doc.sources.length >= 64) return;
    const id = crypto.randomUUID();
    edit((d) => ({
      ...d,
      sources: [
        ...d.sources,
        {
          id,
          name: `Piano ${d.sources.length + 1}`,
          nameEs: `Piano ${d.sources.length + 1}`,
          category: "tonal",
          family: "Piano",
          acousticOrElectronic: "unknown",
          analogOrDigital: "unknown",
          polyphony: "polyphonic",
          confidence: 1,
          evidence: "human",
          program: 0,
          channel: (d.sources.length % 9) + 1,
          warnings: [],
        },
      ],
    }));
    selectSource(id);
  }
  return (
    <aside className="stem-panel">
      <div className="panel-heading">
        <div>
          <Headphones size={16} />
          <strong>Pistas</strong>
          <span className="count-badge">{doc.sources.length}</span>
        </div>
        <button
          className="icon-button"
          aria-label="Agregar pista"
          disabled={!editable}
          onClick={add}
        >
          <Plus size={17} />
        </button>
      </div>
      <div className="stem-list">
        {doc.sources.map((s, i) => (
          <StemRow
            key={`${s.id}-${urls[s.id] ?? "manual"}`}
            source={s}
            url={urls[s.id]}
            index={i}
            soloed={solo}
            onSolo={() => setSolo(solo === s.id ? undefined : s.id)}
            master={s.id === Object.keys(urls)[0]}
            editable={editable}
          />
        ))}
        {!doc.sources.length && (
          <div className="stems-empty">
            <Music2 size={26} />
            <strong>Tu arreglo, pista a pista</strong>
            <p>Importa un MIDI o crea una pista para escribir música.</p>
            <button
              onClick={add}
              className="button secondary small"
              disabled={!editable}
            >
              <Plus size={14} />
              Crear pista
            </button>
          </div>
        )}
      </div>
      {!!detected.length && (
        <section
          className="detected-channels"
          aria-label="Instrumentos detectados"
        >
          <div className="panel-heading">
            <strong>Instrumentos detectados</strong>
            <span className="count-badge">{detected.length}</span>
          </div>
          <p className="channel-explanation">
            Sonidos probables de la mezcla. Cada stem requiere audio separado.
          </p>
          <div className="detected-channel-list">
            {detected.map((prediction, i) => (
              <div
                className="stem-row detected-channel"
                key={prediction.label}
                style={
                  {
                    "--stem-color": colors[i % colors.length],
                  } as React.CSSProperties
                }
              >
                <div className="stem-name">
                  <span className="stem-icon">
                    <AudioLines size={17} />
                  </span>
                  <span>
                    <strong>{prediction.labelEs}</strong>
                    <small>
                      {Math.round(prediction.score * 100)}% · señal del modelo
                    </small>
                  </span>
                </div>
                <p>Separación pendiente · sin notas individuales</p>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="stem-bottom">
        <span className="tiny-dot cyan" />{" "}
        {Object.keys(urls).length
          ? "Stems temporales disponibles"
          : "Sin stems de audio"}
        <p>
          {Object.keys(urls).length
            ? "Solo y volumen controlan el audio separado disponible."
            : doc.provenance === "transcription"
              ? "Las notas de la mezcla se editan en Audio transcrito. Detectar un sonido no lo aísla."
              : "Las pistas MIDI no incluyen audio aislado."}
        </p>
      </div>
    </aside>
  );
}
