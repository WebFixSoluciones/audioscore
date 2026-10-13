"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { tablatureAttacks } from "@/lib/music/tablature";
import { PPQ } from "@/lib/music/types";
export function TablatureViewer() {
  const doc = useEditor((s) => s.document),
    sourceId = useEditor((s) => s.sourceId);
  const source = doc.sources.find((s) => s.id === sourceId);
  const root = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0),
    [error, setError] = useState("");
  const supported =
    source &&
    source.program >= 24 &&
    source.program <= 39 &&
    source.category === "tonal";
  const attacks = useMemo(
    () => (supported ? tablatureAttacks(doc, source) : []),
    [doc, source, supported],
  );
  const measureTicks = (PPQ * doc.timeSignature[0] * 4) / doc.timeSignature[1];
  const span = measureTicks * 8;
  const pages = Math.max(
    1,
    Math.ceil(((attacks.at(-1)?.startTick ?? 0) + 1) / span),
  );
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => {
    const container = root.current;
    if (!container || !supported) return;
    let stopped = false;
    void import("vexflow")
      .then(({ Renderer, TabStave, TabNote, TickContext }) => {
        if (stopped) return;
        container.replaceChildren();
        setError("");
        const renderer = new Renderer(container, Renderer.Backends.SVG);
        const width = Math.max(640, container.clientWidth),
          rows = 4;
        renderer.resize(width, rows * 140);
        const context = renderer.getContext();
        context.setFillStyle("#d8c6f6");
        context.setStrokeStyle("#9f8db8");
        for (let row = 0; row < rows; row++) {
          const start = currentPage * span + row * measureTicks * 2;
          const end = start + measureTicks * 2;
          const stave = new TabStave(15, row * 140 + 10, width - 30, {
            numLines: source.program >= 32 ? 4 : 6,
          });
          stave.addTabGlyph().setContext(context).draw();
          context.fillText(
            `Compases ${currentPage * 8 + row * 2 + 1}–${currentPage * 8 + row * 2 + 2}`,
            20,
            row * 140 + 18,
          );
          for (const attack of attacks.filter(
            (a) => a.startTick >= start && a.startTick < end && a.positions,
          )) {
            const note = new TabNote(
              { positions: attack.positions!, duration: "q" },
              false,
            );
            const tick = new TickContext()
              .addTickable(note)
              .preFormat()
              .setX(
                85 +
                  ((attack.startTick - start) / (end - start)) * (width - 130),
              );
            note
              .setTickContext(tick)
              .setContext(context)
              .setStave(stave)
              .draw();
          }
        }
      })
      .catch((e) => {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "No se pudo dibujar la tablatura",
          );
      });
    return () => {
      stopped = true;
      container.replaceChildren();
    };
  }, [attacks, supported, source, currentPage, span, measureTicks]); // Document edits redraw the SVG.
  return (
    <section className="tablature-view" aria-label="Tablatura sugerida">
      {!supported ? (
        <p>Selecciona una pista de guitarra o bajo para ver la tablatura.</p>
      ) : (
        <>
          <p>
            Posiciones sugeridas · afinación estándar{" "}
            {source.program >= 32 ? "E–A–D–G" : "E–A–D–G–B–E"}. El audio no
            determina la digitación original. Consulta voces y duraciones en
            Partitura.
          </p>
          {attacks.some((a) => !a.positions) && (
            <p>
              Algunos ataques no se pueden representar con esta afinación o como
              un acorde tocable.
            </p>
          )}
          <div className="practice-controls">
            <button
              className="button secondary small"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Anterior
            </button>
            <span>
              Página {currentPage + 1} de {pages}
            </span>
            <button
              className="button secondary small"
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              Siguiente
            </button>
          </div>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div ref={root} />
        </>
      )}
    </section>
  );
}
