"use client";
import { useEffect } from "react";
import { useEditor } from "@/lib/editor/store";
import { useMixer } from "@/lib/editor/mixer-store";
import { audibleGain, defaultMix, panMatrix } from "@/lib/audio/mixer";
import type { ChannelMix } from "@/lib/audio/mixer";

export function StemPlayback({
  urls,
  onError,
  initialMix,
}: {
  urls: Record<string, string>;
  onError: (message: string) => void;
  initialMix?: Record<string, ChannelMix>;
}) {
  useEffect(() => {
    const entries = Object.entries(urls);
    useMixer.getState().configure(
      entries.map(([id]) => id),
      initialMix,
    );
    if (!entries.length) return;
    const context = new AudioContext();
    let stopped = false,
      generation = 0,
      frame = 0;
    const tracks = entries.map(([id, url]) => {
      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.preload = "auto";
      audio.src = url;
      const node = context.createMediaElementSource(audio);
      const split = context.createChannelSplitter(2),
        merge = context.createChannelMerger(2);
      const gains = Array.from({ length: 4 }, () => context.createGain());
      node.connect(split);
      // LL, RL, LR, RR: stereo panning without changing playback timing.
      split.connect(gains[0], 0);
      split.connect(gains[1], 1);
      split.connect(gains[2], 0);
      split.connect(gains[3], 1);
      gains[0].connect(merge, 0, 0);
      gains[1].connect(merge, 0, 0);
      gains[2].connect(merge, 0, 1);
      gains[3].connect(merge, 0, 1);
      merge.connect(context.destination);
      const fail = () => {
        if (stopped) return;
        useEditor.getState().setPlaying(false);
        onError(
          "No se pudo reproducir una pista separada. Vuelve a abrir el análisis.",
        );
      };
      audio.addEventListener("error", fail);
      return { id, audio, node, split, merge, gains, fail };
    });
    const master = tracks[0].audio;
    const applyMix = () => {
      const channels = useMixer.getState().channels;
      const solo = Object.values(channels).some((c) => c.solo);
      for (const track of tracks) {
        const channel = channels[track.id] ?? defaultMix;
        const gain = audibleGain(channel, solo),
          matrix = panMatrix(channel.pan);
        track.gains.forEach((node, i) =>
          node.gain.setTargetAtTime(
            gain * matrix[i],
            context.currentTime,
            0.015,
          ),
        );
      }
    };
    applyMix();
    const unsubscribeMix = useMixer.subscribe(applyMix);
    const seek = (time: number) => {
      tracks.forEach(({ audio }) => {
        if (audio.readyState >= 1)
          audio.currentTime = Math.max(0, Math.min(time, audio.duration));
      });
    };
    // Browser media elements stream WAVs rather than decoding all six tracks into RAM.
    const ready = (audio: HTMLAudioElement, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (audio.error) {
          reject(new Error("Pista no disponible"));
          return;
        }
        if (audio.readyState >= 3) {
          resolve();
          return;
        }
        const cleanup = () => {
          audio.removeEventListener("canplay", done);
          audio.removeEventListener("error", fail);
          signal.removeEventListener("abort", abort);
        };
        const done = () => {
          cleanup();
          resolve();
        };
        const fail = () => {
          cleanup();
          reject(new Error("Pista no disponible"));
        };
        const abort = () => {
          cleanup();
          reject(new DOMException("Reproducción detenida", "AbortError"));
        };
        audio.addEventListener("canplay", done, { once: true });
        audio.addEventListener("error", fail, { once: true });
        signal.addEventListener("abort", abort, { once: true });
      });
    let preparation: AbortController | undefined;
    const transport = () => {
      const state = useEditor.getState(),
        version = ++generation;
      preparation?.abort();
      tracks.forEach(({ audio }) => audio.pause());
      if (!state.playing || state.mode !== "stems") return;
      preparation = new AbortController();
      const signal = preparation.signal;
      void Promise.all([
        context.resume(),
        ...tracks.map(({ audio }) => ready(audio, signal)),
      ])
        .then(async () => {
          if (stopped || version !== generation) return;
          seek(useEditor.getState().currentTime);
          await Promise.all(tracks.map(({ audio }) => audio.play()));
          // A newer transport command owns playback; a stale promise must not pause it.
        })
        .catch((error) => {
          if (
            !stopped &&
            version === generation &&
            error?.name !== "AbortError"
          ) {
            useEditor.getState().setPlaying(false);
            onError(
              "No se pudo iniciar la mezcla. Pulsa reproducir para volver a intentarlo.",
            );
          }
        });
    };
    const unsubscribeEditor = useEditor.subscribe((state, previous) => {
      if (state.playing !== previous.playing || state.mode !== previous.mode)
        transport();
      if (
        state.currentTime !== previous.currentTime &&
        Math.abs(master.currentTime - state.currentTime) > 0.08
      )
        seek(state.currentTime);
    });
    const tick = () => {
      const state = useEditor.getState();
      if (state.playing && state.mode === "stems" && !master.paused) {
        if (state.loop && state.region && master.currentTime >= state.region[1])
          seek(state.region[0]);
        tracks.forEach(({ audio }) => {
          if (Math.abs(audio.currentTime - master.currentTime) > 0.08)
            audio.currentTime = master.currentTime;
        });
        if (Math.abs(state.currentTime - master.currentTime) > 0.05)
          state.seek(master.currentTime);
      }
      if (!stopped) frame = requestAnimationFrame(tick);
    };
    const ended = () => {
      const state = useEditor.getState();
      if (state.mode === "stems") state.setPlaying(false);
    };
    master.addEventListener("ended", ended);
    transport();
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      generation++;
      preparation?.abort();
      cancelAnimationFrame(frame);
      unsubscribeEditor();
      unsubscribeMix();
      master.removeEventListener("ended", ended);
      tracks.forEach((track) => {
        track.audio.pause();
        track.audio.removeEventListener("error", track.fail);
        track.audio.removeAttribute("src");
        track.audio.load();
        track.node.disconnect();
        track.split.disconnect();
        track.merge.disconnect();
        track.gains.forEach((g) => g.disconnect());
      });
      void context.close();
    };
  }, [urls, onError, initialMix]);
  return null;
}
