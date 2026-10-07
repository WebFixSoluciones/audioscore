"use client";
import { useEditor } from "@/lib/editor/store";
import {
  SlidersHorizontal,
  Volume2,
  Trash2,
  Scissors,
  Merge,
} from "lucide-react";
import { auditionNote } from "@/components/audio/MidiPlayback";
export function EventInspector() {
  const {
    document: doc,
    selectedId,
    updateNote,
    deleteNote,
    edit,
    select,
  } = useEditor();
  const note = doc.events.find((e) => e.id === selectedId);
  return (
    <section className="inspector">
      <div className="inspector-title">
        <SlidersHorizontal size={16} />
        <strong>Inspector de eventos</strong>
        <span className="micro-tag">
          {note ? "NOTA SELECCIONADA" : "SIN SELECCIÓN"}
        </span>
      </div>
      {!note ? (
        <p>
          Selecciona una nota en el piano roll para ajustar su pitch, duración y
          expresión.
        </p>
      ) : (
        <div className="inspector-fields">
          <label>
            {note.type === "chord" ? "Pitches del acorde" : "Pitch MIDI"}
            {note.type === "chord" ? (
              <input
                aria-label="Pitches del acorde"
                value={note.pitches?.join(",") ?? ""}
                onChange={(e) => {
                  const pitches = e.target.value.split(",").map(Number);
                  if (
                    pitches.length &&
                    pitches.length <= 16 &&
                    pitches.every(
                      (p) => Number.isInteger(p) && p >= 0 && p <= 127,
                    )
                  )
                    updateNote(note.id, { pitches });
                }}
              />
            ) : (
              <input
                aria-label="Pitch MIDI"
                type="number"
                min={0}
                max={127}
                value={note.midiNote ?? 60}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 0 && n <= 127) updateNote(note.id, { midiNote: n });
                }}
              />
            )}
          </label>
          <label>
            Inicio · ticks
            <input
              type="number"
              min={0}
              value={note.startTick}
              onChange={(e) =>
                updateNote(note.id, {
                  startTick: Math.max(0, Math.round(Number(e.target.value))),
                })
              }
            />
          </label>
          <label>
            Duración · ticks
            <input
              type="number"
              min={1}
              value={note.durationTicks}
              onChange={(e) =>
                updateNote(note.id, {
                  durationTicks: Math.max(
                    1,
                    Math.round(Number(e.target.value)),
                  ),
                })
              }
            />
          </label>
          <label>
            Velocity
            <input
              type="number"
              min={1}
              max={127}
              value={note.velocity}
              onChange={(e) =>
                updateNote(note.id, {
                  velocity: Math.max(
                    1,
                    Math.min(127, Math.round(Number(e.target.value))),
                  ),
                })
              }
            />
          </label>
          <label>
            Articulación
            <select
              value={note.articulation}
              onChange={(e) =>
                updateNote(note.id, {
                  articulation: e.target.value as typeof note.articulation,
                })
              }
            >
              <option value="normal">Normal</option>
              <option value="staccato">Staccato</option>
              <option value="accent">Acento</option>
              <option value="tenuto">Tenuto</option>
            </select>
          </label>
          <div className="confidence-pill">
            {Math.round(note.confidence * 100)}%
            <small>{note.isHumanReviewed ? "Revisada" : "Confianza"}</small>
          </div>
          <div className="inspector-actions">
            <button
              className="icon-button"
              aria-label="Escuchar nota"
              onClick={() => void auditionNote(note.midiNote ?? 60)}
            >
              <Volume2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Dividir nota"
              disabled={note.durationTicks < 2}
              onClick={() => {
                const half = Math.floor(note.durationTicks / 2);
                edit((d) => ({
                  ...d,
                  events: [
                    ...d.events.filter((e) => e.id !== note.id),
                    {
                      ...note,
                      durationTicks: half,
                      confidence: 1,
                      isHumanReviewed: true,
                    },
                    {
                      ...note,
                      id: crypto.randomUUID(),
                      startTick: note.startTick + half,
                      durationTicks: note.durationTicks - half,
                      confidence: 1,
                      isHumanReviewed: true,
                    },
                  ],
                }));
              }}
            >
              <Scissors size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Unir con siguiente nota"
              onClick={() => {
                const next = doc.events.find(
                  (e) =>
                    e.id !== note.id &&
                    e.sourceId === note.sourceId &&
                    e.midiNote === note.midiNote &&
                    e.startTick === note.startTick + note.durationTicks,
                );
                if (next)
                  edit((d) => ({
                    ...d,
                    events: d.events
                      .filter((e) => e.id !== next.id)
                      .map((e) =>
                        e.id === note.id
                          ? {
                              ...e,
                              durationTicks:
                                e.durationTicks + next.durationTicks,
                              confidence: 1,
                              isHumanReviewed: true,
                            }
                          : e,
                      ),
                  }));
              }}
            >
              <Merge size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Eliminar nota"
              onClick={() => {
                deleteNote(note.id);
                select();
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
