"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
export function MusicalAnalysis() {
  const doc = useEditor((s) => s.document),
    playing = useEditor((s) => s.playing);
  const [enabled, setEnabled] = useState(false);
  const context = useRef<AudioContext | null>(null),
    lastBeat = useRef(-1);
  const metadata = doc.analysis?.musicalMetadata;
  const toggle = async () => {
    if (!context.current) context.current = new AudioContext();
    await context.current.resume();
    setEnabled((v) => !v);
  };
  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!enabled || !playing) {
      lastBeat.current = -1;
      return;
    }
    const tick = () => {
      const time = useEditor.getState().currentTime;
      const beats = metadata?.beatTimes;
      const beat = beats?.length
        ? beats.findLastIndex((t) => t <= time)
        : Math.floor((time * doc.tempoMap[0].bpm) / 60);
      const beatTime = beats?.length
        ? beats[beat]
        : (beat * 60) / doc.tempoMap[0].bpm;
      if (beat < 0 || beat === lastBeat.current) return;
      lastBeat.current = beat;
      if (time - beatTime > 0.15 || !context.current) return;
      const ctx = context.current,
        oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      const downbeat = metadata?.downbeatTimes?.some(
        (t) => Math.abs(t - beatTime) < 0.07,
      );
      oscillator.frequency.value = downbeat ? 1700 : 1200;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.045);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.05);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    };
    const timer = setInterval(tick, 25);
    return () => clearInterval(timer);
  }, [enabled, playing, metadata, doc.tempoMap]);
  const time = useEditor((s) => s.currentTime);
  const chord = metadata?.chords.find(
    (c) => time >= c.startSeconds && time < c.endSeconds,
  );
  return (
    <section
      className="musical-analysis"
      aria-label="Pulso y acordes estimados"
    >
      <div className="panel-heading">
        <div>
          <strong>Pulso y armonía</strong>
          <span className="micro-tag">ESTIMADOS</span>
        </div>
        <button
          className={`button secondary small ${enabled ? "selected" : ""}`}
          onClick={() => void toggle()}
          aria-pressed={enabled}
        >
          Metrónomo {enabled ? "activo" : "apagado"}
        </button>
      </div>
      <p>
        {metadata?.beatTimes.length
          ? `${metadata.beatTimes.length} pulsos medidos · `
          : "Rejilla de referencia · "}
        {doc.tempoMap[0].bpm.toFixed(1)} BPM · tonalidad {doc.key}
        {chord && chord.label !== "N" ? ` · acorde ${chord.label}` : ""}. Compás
        editable; revisa los resultados.
        {!!metadata?.downbeatTimes?.length &&
          ` ${metadata.downbeatTimes.length} inicios de compás estimados.`}
        {doc.tempoMap.length > 1 &&
          ` ${doc.tempoMap.length} secciones de tempo.`}
      </p>
      {!!metadata?.downbeatTimes?.length && (
        <div
          className="chord-timeline"
          aria-label="Inicios de compás estimados"
        >
          {metadata.downbeatTimes.slice(0, 80).map((t, i) => (
            <button key={i} onClick={() => useEditor.getState().seek(t)}>
              <strong>Compás {i + 1}</strong>
              <small>{t.toFixed(1)} s</small>
            </button>
          ))}
        </div>
      )}
      {!!metadata?.chords.length && (
        <div className="chord-timeline">
          {metadata.chords.slice(0, 120).map((c, i) => (
            <button
              key={i}
              className={chord === c ? "selected" : ""}
              onClick={() => useEditor.getState().seek(c.startSeconds)}
              title={`${c.startSeconds.toFixed(1)} s · hipótesis ${Math.round(c.confidence * 100)}%`}
            >
              <strong>{c.label === "N" ? "?" : c.label}</strong>
              <small>
                {Math.floor(c.startSeconds / 60)}:
                {String(Math.floor(c.startSeconds % 60)).padStart(2, "0")}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
