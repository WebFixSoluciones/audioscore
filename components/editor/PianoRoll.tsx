"use client";
import { useEditor } from "@/lib/editor/store";
import { PPQ } from "@/lib/music/types";
import { secondsToTicks } from "@/lib/music/tempo-map";
import { auditionNote } from "@/components/audio/MidiPlayback";
export function PianoRoll({ editable = true }: { editable?: boolean }) {
  const {
    document: doc,
    sourceId,
    selectedId,
    select,
    edit,
    currentTime,
  } = useEditor();
  const source = doc.sources.find((s) => s.id === sourceId);
  const all = doc.events
    .filter((e) => e.sourceId === sourceId)
    .flatMap((e) =>
      e.pitches
        ? e.pitches.map((p) => ({ ...e, midiNote: p }))
        : e.midiNote === undefined
          ? []
          : [e],
    );
  const lowest = Math.max(0, Math.min(48, ...all.map((e) => e.midiNote! - 3)));
  const highest = Math.min(
    127,
    Math.max(83, ...all.map((e) => e.midiNote! + 3)),
  );
  const pitches = Array.from(
    { length: highest - lowest + 1 },
    (_, i) => highest - i,
  );
  const beatCount = Math.max(
    16,
    Math.ceil(
      Math.max(...all.map((e) => (e.startTick + e.durationTicks) / PPQ), 0) / 4,
    ) * 4,
  );
  const width = Math.min(40000, Math.max(720, beatCount * 48));
  const black = (n: number) => [1, 3, 6, 8, 10].includes(n % 12);
  return (
    <div className="piano-scroll">
      <div className="piano-layout" style={{ width: width + 50 }}>
        <div className="piano-keys">
          <div className="key-spacer" />
          {pitches.map((p) => (
            <button
              key={p}
              className={`piano-key ${black(p) ? "black" : ""}`}
              aria-label={`Escuchar nota MIDI ${p}`}
              onClick={() => void auditionNote(p)}
            >
              {p % 12 === 0 ? `C${Math.floor(p / 12) - 1}` : ""}
            </button>
          ))}
        </div>
        <div className="piano-grid" style={{ width }}>
          <div className="beat-ruler">
            {Array.from({ length: Math.ceil(width / 48) }, (_, i) => (
              <span key={i}>
                {i % 4 === 0 ? String(i / 4 + 1).padStart(2, "0") : "·"}
              </span>
            ))}
          </div>
          <div
            className="note-grid"
            style={{ height: pitches.length * 14, backgroundSize: "48px 14px" }}
            onDoubleClick={(event) => {
              if (!editable || !source || event.target !== event.currentTarget)
                return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const midiNote =
                highest - Math.floor((event.clientY - bounds.top) / 14);
              const startTick = Math.max(
                0,
                (Math.round((event.clientX - bounds.left) / 12) * PPQ) / 4,
              );
              const id = crypto.randomUUID();
              edit((d) => ({
                ...d,
                events: [
                  ...d.events,
                  {
                    id,
                    sourceId: source.id,
                    type: source.category === "percussive" ? "drum" : "note",
                    midiNote,
                    startTick,
                    durationTicks: PPQ,
                    startSeconds: 0,
                    durationSeconds: 0.5,
                    velocity: 90,
                    articulation: "normal",
                    confidence: 1,
                    isHumanReviewed: true,
                  },
                ],
              }));
              select(id);
            }}
          >
            <div
              className="roll-cursor"
              style={{
                left: (secondsToTicks(currentTime, doc.tempoMap) / PPQ) * 48,
              }}
            />
            {all.map((e) => (
              <button
                aria-label={`Nota ${e.midiNote}, confianza ${Math.round(e.confidence * 100)}%`}
                key={`${e.id}-${e.midiNote}`}
                className={`midi-note ${selectedId === e.id ? "chosen" : ""} ${e.confidence < 0.7 && !e.isHumanReviewed ? "uncertain" : ""}`}
                style={{
                  left: (e.startTick / PPQ) * 48,
                  width: Math.max(7, (e.durationTicks / PPQ) * 48 - 2),
                  top: (highest - e.midiNote!) * 14 + 1,
                }}
                onClick={() => select(e.id)}
                onKeyDown={(ev) => {
                  if (!editable) return;
                  if (
                    e.type === "chord" &&
                    e.pitches &&
                    ["ArrowUp", "ArrowDown"].includes(ev.key)
                  ) {
                    ev.preventDefault();
                    const pitches = e.pitches.map(
                      (p) => p + (ev.key === "ArrowUp" ? 1 : -1),
                    );
                    if (pitches.every((p) => p >= 0 && p <= 127))
                      useEditor.getState().updateNote(e.id, { pitches });
                    return;
                  }
                  const patch =
                    ev.key === "ArrowUp"
                      ? { midiNote: Math.min(127, e.midiNote! + 1) }
                      : ev.key === "ArrowDown"
                        ? { midiNote: Math.max(0, e.midiNote! - 1) }
                        : ev.key === "ArrowRight"
                          ? { startTick: e.startTick + PPQ / 4 }
                          : ev.key === "ArrowLeft"
                            ? { startTick: Math.max(0, e.startTick - PPQ / 4) }
                            : undefined;
                  if (patch) {
                    ev.preventDefault();
                    useEditor.getState().updateNote(e.id, patch);
                  }
                  if (ev.key === "Delete")
                    useEditor.getState().deleteNote(e.id);
                }}
              >
                {e.durationTicks >= PPQ ? e.midiNote : ""}
              </button>
            ))}
            {!all.length && (
              <div className="roll-hint">
                {source
                  ? "Doble clic para escribir una nota · Flechas para moverla"
                  : "Agrega una pista o importa un MIDI para empezar"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
