"use client";
import { useRef, useState } from "react";
import { localRequest } from "@/lib/audio/local/client";
import { useEditor } from "@/lib/editor/store";
export function PracticePanel({
  jobId,
  disabled,
  urls,
}: {
  jobId: string;
  disabled: boolean;
  urls: Record<string, string>;
}) {
  const [speed, setSpeed] = useState(1),
    [pitch, setPitch] = useState(0),
    [source, setSource] = useState("original");
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  async function prepare() {
    setBusy(true);
    setError("");
    setUrl("");
    audio.current?.pause();
    useEditor.getState().setPlaying(false);
    try {
      const result = await localRequest<{ url: string }>(
        `jobs/${jobId}/practice`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, speed, semitones: pitch }),
        },
      );
      setUrl(result.url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo preparar la práctica",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="practice-panel"
      aria-label="Práctica de velocidad y tono"
    >
      <strong>Practicar con el audio</strong>
      <div className="practice-controls">
        <label>
          Pista
          <select
            aria-label="Pista de práctica"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setUrl("");
            }}
            disabled={busy}
          >
            <option value="original">Audio original</option>
            {Object.keys(urls).map((id) => {
              const cleanId = id.replace(/^(demucs-|bs_roformer-|solo-)/, "");
              const labelMap: Record<string, string> = {
                piano: "Piano",
                guitar: "Guitarra",
                bass: "Bajo",
                drums: "Batería",
                vocals: "Voz",
                other: "Otros sonidos",
              };
              return (
                <option key={id} value={cleanId}>
                  {labelMap[cleanId] || cleanId}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          Velocidad
          <select
            aria-label="Velocidad de práctica"
            value={speed}
            onChange={(e) => {
              setSpeed(Number(e.target.value));
              setUrl("");
            }}
            disabled={busy}
          >
            {[0.5, 0.65, 0.75, 0.85, 1, 1.15, 1.25, 1.5].map((v) => (
              <option key={v} value={v}>
                {Math.round(v * 100)}%
              </option>
            ))}
          </select>
        </label>
        <label>
          Tono
          <select
            aria-label="Semitonos de práctica"
            value={pitch}
            onChange={(e) => {
              setPitch(Number(e.target.value));
              setUrl("");
            }}
            disabled={busy}
          >
            {Array.from({ length: 25 }, (_, i) => i - 12).map((n) => (
              <option key={n} value={n}>
                {n > 0 ? "+" : ""}
                {n} semitonos
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary small"
          disabled={busy || disabled}
          onClick={() => void prepare()}
        >
          {busy ? "Preparando…" : "Preparar escucha"}
        </button>
      </div>
      <p>
        La velocidad conserva el tono. Esta escucha es independiente; la
        partitura y el original se conservan.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {url && (
        <audio
          ref={audio}
          controls
          src={url}
          onPlay={() => useEditor.getState().setPlaying(false)}
          aria-label="Audio de práctica"
        />
      )}
    </section>
  );
}
