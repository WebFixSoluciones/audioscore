"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { writeMusicXML } from "@/lib/music/musicxml";
import { Music2 } from "lucide-react";
import { secondsToTicks } from "@/lib/music/tempo-map";
import { PPQ, type MusicDocument } from "@/lib/music/types";
import { scoreOriginTick } from "@/lib/music/score-layout";
function synchronizeCursor(
  osmd: import("opensheetmusicdisplay").OpenSheetMusicDisplay,
  doc: MusicDocument,
  time: number,
) {
  const cursor = osmd.cursor;
  if (!cursor || !osmd.Sheet) return;
  cursor.reset();
  const target =
    Math.max(0, secondsToTicks(time, doc.tempoMap) - scoreOriginTick(doc)) /
    (PPQ * 4);
  let count = 0;
  while (
    !cursor.Iterator.EndReached &&
    cursor.Iterator.currentTimeStamp.RealValue < target &&
    count++ < 10000
  )
    cursor.next();
}
export function ScoreViewer({
  full = false,
  readable = true,
}: {
  full?: boolean;
  readable?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    viewer = useRef<
      import("opensheetmusicdisplay").OpenSheetMusicDisplay | null
    >(null);
  const doc = useEditor((s) => s.document),
    sourceId = useEditor((s) => s.sourceId),
    currentTime = useEditor((s) => s.currentTime);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!root.current || !doc.events.length) return;
    let cancelled = false;
    const container = root.current;
    void (async () => {
      const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
      if (cancelled) return;
      setLoading(true);
      const osmd = new OpenSheetMusicDisplay(container, {
        autoResize: true,
        drawTitle: true,
        drawSubtitle: false,
        backend: "svg",
        drawingParameters: "compact",
        followCursor: false,
      });
      viewer.current = osmd;
      await osmd.load(
        writeMusicXML(doc, full ? undefined : sourceId, { readable }),
      );
      if (cancelled) return;
      osmd.render();
      osmd.cursor.show();
      synchronizeCursor(osmd, doc, useEditor.getState().currentTime);
      setError("");
      setLoading(false);
    })().catch((e) => {
      if (!cancelled) {
        setLoading(false);
        setError(
          e instanceof Error ? e.message : "Error al mostrar la partitura",
        );
      }
    });
    return () => {
      cancelled = true;
      viewer.current = null;
      container.replaceChildren();
    };
  }, [doc, sourceId, full, readable]);
  useEffect(() => {
    if (viewer.current) synchronizeCursor(viewer.current, doc, currentTime);
  }, [currentTime, doc]);
  return (
    <div className={`score-view ${doc.events.length ? "has-score" : ""}`}>
      {!doc.events.length && (
        <div className="score-empty">
          <Music2 size={40} />
          <strong>La música también se puede ver.</strong>
          <p>
            Importa un MIDI o escribe tus primeras notas.
            <br />
            La partitura se genera a partir de esos eventos.
          </p>
          <div className="empty-staff">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {!!doc.events.length && loading && !error && (
        <p role="status">
          Preparando la partitura… La primera carga puede tardar unos segundos.
        </p>
      )}
      <div ref={root} />
    </div>
  );
}
