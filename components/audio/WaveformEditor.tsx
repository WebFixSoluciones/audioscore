"use client";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import Regions from "wavesurfer.js/dist/plugins/regions.esm.js";
import Timeline from "wavesurfer.js/dist/plugins/timeline.esm.js";
import Hover from "wavesurfer.js/dist/plugins/hover.esm.js";
import Minimap from "wavesurfer.js/dist/plugins/minimap.esm.js";
import Spectrogram from "wavesurfer.js/dist/plugins/spectrogram.esm.js";
import { useEditor } from "@/lib/editor/store";
import { AudioLines, ZoomIn, ZoomOut, Waves } from "lucide-react";
export function WaveformEditor({
  url,
  peaks,
  duration,
  onError,
}: {
  url?: string;
  peaks?: number[];
  duration?: number;
  onError: (message: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    spectroRoot = useRef<HTMLDivElement>(null),
    wave = useRef<WaveSurfer | null>(null);
  const [spectro, setSpectro] = useState(false),
    [zoom, setZoom] = useState(0),
    [ready, setReady] = useState(false);
  const playing = useEditor((s) => s.playing),
    mode = useEditor((s) => s.mode),
    currentTime = useEditor((s) => s.currentTime);
  useEffect(() => {
    if (!url || !root.current) return;
    const regions = Regions.create();
    const ws = WaveSurfer.create({
      container: root.current,
      url,
      height: 126,
      waveColor: "#62518f",
      progressColor: "#b596ff",
      cursorColor: "#e4d6ff",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      ...(peaks && duration ? { peaks: [peaks], duration } : {}),
      plugins: [
        regions,
        Timeline.create({
          height: 22,
          timeInterval: 5,
          primaryLabelInterval: 10,
          style: { color: "#838396", fontSize: "10px" },
        }),
        Hover.create({ lineColor: "#ffffff66", labelBackground: "#181622" }),
        Minimap.create({
          height: 22,
          waveColor: "#3a334f",
          progressColor: "#765bae",
        }),
      ],
    });
    wave.current = ws;
    const drag = regions.enableDragSelection({ color: "#a98bfa25" });
    ws.on("ready", () => {
      setReady(true);
      useEditor.getState().edit((d) => ({
        ...d,
        durationSeconds: Math.max(d.durationSeconds, ws.getDuration()),
      }));
    });
    ws.on("timeupdate", (t) => {
      const s = useEditor.getState();
      if (s.mode === "audio" || s.mode === "compare") s.seek(t);
      if (s.loop && s.region && t >= s.region[1]) ws.setTime(s.region[0]);
    });
    ws.on("interaction", (t) => useEditor.getState().seek(t));
    ws.on("finish", () => useEditor.getState().setPlaying(false));
    ws.on("error", (e) => {
      if (e.name !== "AbortError")
        onError("No se pudo leer el audio. Revisa el formato o la URL.");
    });
    regions.on("region-created", (r) => {
      regions
        .getRegions()
        .filter((x) => x.id !== r.id)
        .forEach((x) => x.remove());
      useEditor.getState().setRegion([r.start, r.end]);
    });
    regions.on("region-updated", (r) =>
      useEditor.getState().setRegion([r.start, r.end]),
    );
    return () => {
      drag();
      ws.destroy();
      wave.current = null;
      setReady(false);
    };
  }, [url, peaks, duration, onError]);
  useEffect(() => {
    const ws = wave.current;
    if (!ws || !ready) return;
    if (playing && (mode === "audio" || mode === "compare"))
      void ws.play().catch(() => {
        useEditor.getState().setPlaying(false);
        onError("Pulsa reproducir para habilitar el audio.");
      });
    else ws.pause();
  }, [playing, mode, ready, onError]);
  useEffect(() => {
    const ws = wave.current;
    if (ws && ready && Math.abs(ws.getCurrentTime() - currentTime) > 0.25)
      ws.setTime(currentTime);
  }, [currentTime, ready]);
  useEffect(() => {
    if (ready) wave.current?.zoom(zoom);
  }, [zoom, ready]);
  useEffect(() => {
    if (!spectro || !wave.current || !spectroRoot.current || !ready) return;
    const plugin = wave.current.registerPlugin(
      Spectrogram.create({
        container: spectroRoot.current,
        height: 90,
        labels: true,
        fftSamples: 512,
      }),
    );
    return () => plugin.destroy();
  }, [spectro, ready]);
  return (
    <div className="wave-panel">
      <div className="panel-heading">
        <div>
          <AudioLines size={16} />
          <strong>Audio original</strong>
          <span className="micro-tag">WAVEFORM</span>
        </div>
        <div className="wave-tools">
          <button
            className={`icon-button ${spectro ? "selected" : ""}`}
            aria-label="Mostrar espectrograma"
            onClick={() => setSpectro(!spectro)}
          >
            <Waves size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Alejar waveform"
            onClick={() => setZoom(Math.max(0, zoom - 15))}
          >
            <ZoomOut size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Acercar waveform"
            onClick={() => setZoom(Math.min(200, zoom + 15))}
          >
            <ZoomIn size={15} />
          </button>
        </div>
      </div>
      {!url && (
        <div className="wave-empty">
          <AudioLines size={34} />
          <span>Tu audio se verá aquí</span>
          <small>Abre un archivo para escuchar y seleccionar regiones</small>
        </div>
      )}
      <div ref={root} />
      {spectro && <div ref={spectroRoot} />}
      <div className="wave-footer">
        <span>
          <span className="tiny-dot violet" />{" "}
          {url
            ? "Arrastra sobre el audio para seleccionar una región"
            : "MP3, WAV, FLAC, M4A, AAC, OGG y AIFF"}
        </span>
        <span>
          {url ? "Web Audio · WaveSurfer" : "Hasta 250 MB en la nube"}
        </span>
      </div>
    </div>
  );
}
