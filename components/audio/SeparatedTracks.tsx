"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Headphones,
  Play,
  Pause,
  RotateCcw,
  AudioLines,
  Piano,
  Drum,
  Guitar,
  Mic2,
} from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { useMixer, activateStemMode } from "@/lib/editor/mixer-store";
import { audibleGain, defaultMix, type ChannelMix } from "@/lib/audio/mixer";
import { localRequest } from "@/lib/audio/local/client";
import { saveAs } from "file-saver";
import type { AudioSource } from "@/lib/music/types";
const colors = [
  "#d898f4",
  "#e4aa66",
  "#71c5dd",
  "#82d6ba",
  "#a799f4",
  "#e486a7",
];
const clock = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
function TrackWave({
  peaks,
  duration,
  name,
  color,
  select,
}: {
  peaks?: number[];
  duration: number;
  name: string;
  color: string;
  select: () => void;
}) {
  const time = useEditor((s) => s.currentTime);
  const path = useMemo(() => {
    if (!peaks?.length) return "";
    const max = Math.max(...peaks, 0.00001);
    const bars = 360,
      stride = Math.max(1, Math.ceil(peaks.length / bars));
    return Array.from({ length: Math.ceil(peaks.length / stride) }, (_, i) => {
      const height = Math.max(
        0.6,
        (Math.max(...peaks.slice(i * stride, (i + 1) * stride)) / max) * 30,
      );
      const x = (i / Math.ceil(peaks.length / stride)) * 1000;
      return `M${x.toFixed(1)},${(34 - height).toFixed(1)}V${(34 + height).toFixed(1)}`;
    }).join(" ");
  }, [peaks]);
  const position = duration ? Math.min(100, (time / duration) * 100) : 0;
  return (
    <div
      className="track-wave"
      style={{ "--track-color": color } as React.CSSProperties}
    >
      {path ? (
        <svg
          viewBox="0 0 1000 68"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d={path}
            stroke={color}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
        </svg>
      ) : (
        <span className="track-wave-pending">
          Preparando onda de esta pista…
        </span>
      )}
      <span className="track-playhead" style={{ left: `${position}%` }} />
      <input
        type="range"
        min={0}
        max={Math.max(0.01, duration)}
        step={0.01}
        value={Math.min(time, duration)}
        aria-label={`Posición en ${name}`}
        onChange={(e) => {
          select();
          useEditor.getState().seek(Number(e.target.value));
        }}
      />
    </div>
  );
}
function TrackRow({
  source,
  url,
  peaks,
  duration,
  index,
}: {
  source: AudioSource;
  url: string;
  peaks?: number[];
  duration: number;
  index: number;
}) {
  const channel = useMixer((s) => s.channels[source.id]) ?? defaultMix;
  const hasSolo = useMixer((s) =>
    Object.values(s.channels).some((c) => c.solo),
  );
  const selected = useEditor((s) => s.sourceId === source.id);
  const playing = useEditor((s) => s.playing && s.mode === "stems");
  const isolated = channel.solo && hasSolo;
  const update = (patch: Partial<ChannelMix>) => {
    activateStemMode();
    useMixer.getState().update(source.id, patch);
  };
  const Icon =
    source.category === "percussive"
      ? Drum
      : source.id.includes("other")
        ? AudioLines
        : source.id.includes("vocals")
          ? Mic2
          : source.program >= 24 && source.program < 32
            ? Guitar
            : source.program < 8
              ? Piano
              : AudioLines;
  const name = source.nameEs || source.name;
  return (
    <article
      className={`separated-track ${selected ? "track-selected" : ""} ${audibleGain(channel, hasSolo) === 0 ? "track-inaudible" : ""}`}
      style={
        {
          "--track-color": colors[index % colors.length],
        } as React.CSSProperties
      }
      aria-label={`Pista separada ${name}`}
    >
      <div className="track-details">
        <button
          className="track-title"
          onClick={() => useEditor.getState().selectSource(source.id)}
          aria-pressed={selected}
        >
          <span className="track-symbol">
            <Icon size={20} />
          </span>
          <span>
            <strong>{name}</strong>
          </span>
        </button>
        <div className="track-buttons">
          <button
            aria-label={`Escuchar solo ${name}`}
            title="Escuchar esta pista"
            onClick={() => {
              if (playing && isolated) useEditor.getState().setPlaying(false);
              else {
                for (const id of Object.keys(useMixer.getState().channels))
                  useMixer.getState().update(id, { solo: id === source.id });
                useMixer.getState().update(source.id, { muted: false });
                activateStemMode();
                useEditor.getState().setPlaying(true);
              }
            }}
          >
            {playing && isolated ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            className={channel.solo ? "on" : ""}
            aria-label={`Solo de pista ${name}`}
            aria-pressed={channel.solo}
            onClick={() => update({ solo: !channel.solo })}
          >
            S
          </button>
          <button
            className={channel.muted ? "muted" : ""}
            aria-label={`Silenciar pista ${name}`}
            aria-pressed={channel.muted}
            onClick={() => update({ muted: !channel.muted })}
          >
            M
          </button>
          <a
            href={url}
            download={`${name}.wav`}
            aria-label={`Descargar pista ${name}`}
            title="Descargar WAV"
          >
            <Download size={14} />
          </a>
        </div>
        <label className="track-volume">
          Volumen{" "}
          <input
            aria-label={`Volumen de pista ${name}`}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={channel.volume}
            onChange={(e) => update({ volume: Number(e.target.value) })}
          />
          <output>{Math.round(channel.volume * 100)}%</output>
        </label>
        <label className="track-pan">
          Balance{" "}
          <input
            aria-label={`Balance de pista ${name}`}
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={channel.pan}
            onChange={(e) => update({ pan: Number(e.target.value) })}
          />
          <output>
            {channel.pan === 0
              ? "Centro"
              : `${channel.pan < 0 ? "I" : "D"} ${Math.round(Math.abs(channel.pan) * 100)}`}
          </output>
        </label>
      </div>
      <TrackWave
        peaks={peaks}
        duration={duration}
        name={name}
        color={colors[index % colors.length]}
        select={() => useEditor.getState().selectSource(source.id)}
      />
    </article>
  );
}
export function SeparatedTracks({
  urls,
  jobId,
  busy,
  onError,
}: {
  urls: Record<string, string>;
  jobId?: string;
  busy: boolean;
  onError: (message: string) => void;
}) {
  const doc = useEditor((s) => s.document),
    mode = useEditor((s) => s.mode),
    playing = useEditor((s) => s.playing);
  const [peaks, setPeaks] = useState<Record<string, number[]>>({}),
    [waveError, setWaveError] = useState(""),
    [retry, setRetry] = useState(0),
    [exporting, setExporting] = useState(false);
  const sources = doc.sources.filter((s) => urls[s.id]);
  useEffect(() => {
    if (!jobId || busy) return;
    let stopped = false;
    void localRequest<{ peaks: Record<string, number[]> }>(
      `jobs/${jobId}/waveforms`,
    )
      .then((result) => {
        if (!stopped) {
          setPeaks(result.peaks);
          setWaveError("");
        }
      })
      .catch((e) => {
        if (!stopped)
          setWaveError(
            e instanceof Error ? e.message : "No se pudieron cargar las ondas",
          );
      });
    return () => {
      stopped = true;
    };
  }, [jobId, busy, retry]);
  if (!sources.length) return null;
  async function downloadMix() {
    setExporting(true);
    try {
      const channels = useMixer.getState().channels;
      const result = await localRequest<{ url: string }>(`jobs/${jobId}/mix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels }),
      });
      const response = await fetch(result.url);
      if (!response.ok) throw new Error("No se pudo descargar la mezcla");
      saveAs(await response.blob(), `${doc.title}-mezcla.wav`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo preparar la mezcla");
    } finally {
      setExporting(false);
    }
  }
  return (
    <section
      className="separated-tracks"
      aria-label="Mezclador de pistas separadas"
    >
      <header className="tracks-header">
        <div>
          <Headphones size={20} />
          <div>
            <h2>Pistas separadas</h2>
            <p>
              {sources.length} pistas · ajusta tu acompañamiento y escucha cada
              instrumento
            </p>
          </div>
        </div>
        <div className="tracks-actions">
          <button
            className={`button secondary small ${mode === "stems" ? "selected" : ""}`}
            onClick={() => {
              activateStemMode();
              useEditor.getState().setPlaying(!playing || mode !== "stems");
            }}
          >
            {playing && mode === "stems" ? (
              <Pause size={14} />
            ) : (
              <Play size={14} />
            )}{" "}
            {playing && mode === "stems" ? "Pausar mezcla" : "Escuchar mezcla"}
          </button>
          <button
            className="text-button"
            aria-pressed={mode === "audio"}
            onClick={() => {
              const play = useEditor.getState().playing;
              useEditor.getState().setMode("audio");
              useEditor.getState().setPlaying(play);
            }}
          >
            Audio original
          </button>
          <button
            className="icon-button"
            aria-label="Restablecer mezcla"
            title="Restablecer volumen, balance, solo y silencio"
            onClick={() => useMixer.getState().reset()}
          >
            <RotateCcw size={15} />
          </button>
          {jobId && (
            <button
              className="button secondary small"
              disabled={
                busy ||
                exporting ||
                (Boolean(jobId) && !Object.keys(peaks).length && !waveError)
              }
              onClick={() => void downloadMix()}
            >
              <Download size={14} />
              {exporting ? "Preparando…" : "Descargar mezcla"}
            </button>
          )}
        </div>
      </header>
      <p className="tracks-hint">
        S: escuchar solo · M: silenciar · selecciona una pista para editar sus
        notas. Las categorías pueden contener filtraciones de otros
        instrumentos.
      </p>
      {waveError && (
        <p className="error-text" role="alert">
          {waveError}{" "}
          <button
            className="text-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            Reintentar ondas
          </button>
        </p>
      )}
      <div className="tracks-ruler" aria-hidden="true">
        <span>Tiempo</span>
        <div>
          {Array.from({ length: 7 }, (_, i) => (
            <small key={i}>{clock((doc.durationSeconds * i) / 6)}</small>
          ))}
        </div>
      </div>
      {sources.map((source, index) => (
        <TrackRow
          key={`${source.id}-${urls[source.id]}`}
          source={source}
          url={urls[source.id]}
          peaks={peaks[source.id]}
          duration={doc.durationSeconds}
          index={index}
        />
      ))}
      <footer>
        WAV independientes · reproducción conjunta · ajustes de mezcla
        disponibles durante la escucha
      </footer>
    </section>
  );
}
