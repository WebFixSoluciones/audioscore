"use client";
import { useMixer, activateStemMode } from "@/lib/editor/mixer-store";
import { defaultMix, type ChannelMix } from "@/lib/audio/mixer";
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
function StemRow({
  source,
  url,
  index,
  editable,
}: {
  source: AudioSource;
  url?: string;
  index: number;
  editable: boolean;
}) {
  const { sourceId, selectSource, document: doc } = useEditor();
  const channel = useMixer((s) => s.channels[source.id]) ?? defaultMix;
  const { muted, volume, pan, solo } = channel;
  const update = (patch: Partial<ChannelMix>) => {
    activateStemMode();
    useMixer.getState().update(source.id, patch);
  };
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
              : source.storagePath && source.evidence === "estimated"
                ? "Stem estimado · revisar escuchando"
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
          className={solo ? "on" : ""}
          onClick={() => update({ solo: !solo })}
          aria-pressed={solo}
          aria-label={`Solo ${source.name}`}
          disabled={!url}
        >
          S
        </button>
        <button
          className={muted ? "on" : ""}
          onClick={() => update({ muted: !muted })}
          aria-pressed={muted}
          aria-label={`Silenciar ${source.name}`}
          disabled={!url}
        >
          M
        </button>
      </div>
      {source.storagePath && (
        <small className="channel-explanation">
          {
            doc.events.filter(
              (event) =>
                event.sourceId === source.id &&
                ["note", "chord", "drum"].includes(event.type),
            ).length
          }{" "}
          eventos
          {source.category === "percussive"
            ? " · transcripción de batería pendiente"
            : source.warnings.some((warning) =>
                  warning.startsWith("Señal débil:"),
                )
              ? " · señal débil; revisa el audio"
              : " · notas del canal"}
        </small>
      )}
      <div className="stem-sliders">
        <input
          aria-label={`Volumen ${source.name}`}
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => update({ volume: Number(e.target.value) })}
          disabled={!url}
        />
        <input
          aria-label={`Paneo ${source.name}`}
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={pan}
          onChange={(e) => update({ pan: Number(e.target.value) })}
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
            {doc.sources.some((source) => source.storagePath)
              ? "Hipótesis sobre la mezcla. Las pistas de arriba contienen los stems disponibles."
              : "Sonidos probables de la mezcla. Cada stem requiere audio separado."}
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
                <p>
                  {doc.sources.some((source) => source.storagePath)
                    ? "Hipótesis del clasificador · revisar en los stems"
                    : "Separación pendiente · sin notas individuales"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="stem-bottom">
        <span className="tiny-dot cyan" />{" "}
        {Object.keys(urls).length
          ? "Stems de audio disponibles"
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
