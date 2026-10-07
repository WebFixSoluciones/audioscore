"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/firebase/client";
import { useEditor } from "@/lib/editor/store";
import { ScoreViewer } from "./ScoreViewer";
import type { MusicDocument } from "@/lib/music/types";
import { messageOf } from "@/lib/utils/errors";
export function CloudScore({ projectId }: { projectId: string }) {
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ document: MusicDocument | null }>(
      `/api/projects/${projectId}/scores`,
    )
      .then((r) => {
        if (r.document) useEditor.getState().load(r.document);
        else setError("No hay eventos musicales para mostrar.");
      })
      .catch((e) => setError(messageOf(e)));
  }, [projectId]);
  return (
    <div className="content-page">
      <h1>Partitura global</h1>
      {error ? <p className="notice">{error}</p> : <ScoreViewer full />}
    </div>
  );
}
