"use client";
import { useEffect } from "react";
import { useEditor } from "@/lib/editor/store";
export async function auditionNote(midi: number) {
  const Tone = await import("tone");
  await Tone.start();
  const synth = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.3 },
  }).toDestination();
  synth.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), "8n");
  setTimeout(() => synth.dispose(), 1000);
}
export function MidiPlayback({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const playing = useEditor((s) => s.playing),
    mode = useEditor((s) => s.mode),
    doc = useEditor((s) => s.document);
  useEffect(() => {
    if (!playing || mode === "audio" || mode === "stems") return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const Tone = await import("tone");
      await Tone.start();
      if (disposed) return;
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel();
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
      }).toDestination();
      synth.volume.value = -12;
      const s = useEditor.getState();
      transport.seconds = s.currentTime;
      doc.events
        .filter((e) => ["note", "chord", "drum"].includes(e.type))
        .forEach((e) => {
          transport.schedule(
            (time) =>
              synth.triggerAttackRelease(
                (e.pitches ?? [e.midiNote!]).map((p) =>
                  Tone.Frequency(p, "midi").toFrequency(),
                ),
                e.durationSeconds,
                time,
                e.velocity / 127,
              ),
            e.startSeconds,
          );
        });
      if (s.loop && s.region) {
        transport.loop = true;
        transport.loopStart = s.region[0];
        transport.loopEnd = s.region[1];
      } else transport.loop = false;
      const interval = setInterval(() => {
        if (mode === "midi") useEditor.getState().seek(transport.seconds);
        if (
          !transport.loop &&
          transport.seconds >= doc.durationSeconds &&
          doc.durationSeconds > 0
        )
          useEditor.getState().setPlaying(false);
      }, 40);
      transport.start();
      cleanup = () => {
        clearInterval(interval);
        transport.stop();
        transport.cancel();
        synth.dispose();
      };
    })().catch(() => {
      onError("No se pudo iniciar la reproducción MIDI.");
      useEditor.getState().setPlaying(false);
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [playing, mode, doc, onError]);
  return null;
}
