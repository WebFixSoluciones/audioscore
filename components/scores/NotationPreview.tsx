"use client";
import { useEffect, useRef } from "react";
export function NotationPreview({ pitch }: { pitch: number }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    const container = root.current;
    if (!container) return;
    void import("vexflow").then(({ Renderer, Stave, StaveNote, Formatter }) => {
      if (disposed) return;
      container.replaceChildren();
      const renderer = new Renderer(container, Renderer.Backends.SVG);
      renderer.resize(160, 100);
      const context = renderer.getContext();
      context.setFillStyle("#bfa8f5");
      context.setStrokeStyle("#86789e");
      const stave = new Stave(0, 0, 145);
      stave.addClef("treble").setContext(context).draw();
      const names = [
        "c",
        "c#",
        "d",
        "d#",
        "e",
        "f",
        "f#",
        "g",
        "g#",
        "a",
        "a#",
        "b",
      ];
      const note = new StaveNote({
        keys: [`${names[pitch % 12]}/${Math.floor(pitch / 12) - 1}`],
        duration: "q",
      });
      Formatter.FormatAndDraw(context, stave, [note]);
    });
    return () => {
      disposed = true;
      container.replaceChildren();
    };
  }, [pitch]);
  return (
    <div ref={root} aria-label="Vista de notación de la nota seleccionada" />
  );
}
