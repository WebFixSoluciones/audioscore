import "server-only";
import { randomUUID } from "node:crypto";
import { adminFirebase } from "@/lib/firebase/admin";
import { projectRef } from "@/lib/security/ownership";
import { validateDocument } from "./notation-validation";
import { ApiError } from "@/lib/utils/errors";
import type { MusicDocument } from "./types";
export async function saveCorrection(
  uid: string,
  projectId: string,
  input: MusicDocument,
  expectedRevision: number,
  operation: string,
) {
  const doc = validateDocument(input);
  if (Buffer.byteLength(JSON.stringify(doc)) > 700000)
    throw new ApiError(413, "El documento musical supera 700 KB");
  const { db } = adminFirebase(),
    ref = projectRef(uid, projectId),
    id = randomUUID();
  return db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p || p.userId !== uid || p.deleted)
      throw new ApiError(404, "Proyecto no encontrado");
    if (p.activeJobId)
      throw new ApiError(
        409,
        "Espera a que termine el trabajo antes de editar",
      );
    if (p.revision !== expectedRevision)
      throw new ApiError(
        409,
        "El proyecto cambió en otra sesión. Recarga antes de guardar.",
      );
    if (p.storagePath && doc.durationSeconds > p.durationSeconds + 0.02)
      throw new ApiError(
        422,
        "Los eventos corregidos exceden la duración del audio original",
      );
    const revision = p.revision + 1,
      now = new Date().toISOString();
    tx.set(ref.collection("scoreRevisions").doc(`${id}-before`), {
      document: p.document ?? null,
      createdAt: now,
    });
    tx.set(ref.collection("scoreRevisions").doc(`${id}-after`), {
      document: { ...doc, revision },
      createdAt: now,
    });
    tx.set(ref.collection("corrections").doc(id), {
      userId: uid,
      operation,
      before: `${id}-before`,
      after: `${id}-after`,
      createdAt: now,
      updatedAt: now,
    });
    tx.update(ref, {
      document: { ...doc, revision },
      title: doc.title,
      revision,
      status: "needs_review",
      undoStack: [...(p.undoStack ?? []).slice(-49), id],
      redoStack: [],
      updatedAt: now,
    });
    return { revision, correctionId: id };
  });
}
export async function moveHistory(
  uid: string,
  projectId: string,
  direction: "undo" | "redo",
  expectedRevision: number,
) {
  const { db } = adminFirebase(),
    ref = projectRef(uid, projectId);
  return db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p || p.userId !== uid || p.deleted)
      throw new ApiError(404, "Proyecto no encontrado");
    if (p.activeJobId || p.revision !== expectedRevision)
      throw new ApiError(409, "Proyecto ocupado o revisión diferente");
    const stack: string[] =
      p[direction === "undo" ? "undoStack" : "redoStack"] ?? [];
    const id = stack[stack.length - 1];
    if (!id) throw new ApiError(409, "No hay cambios en esta dirección");
    const snapshot = (
      await tx.get(
        ref
          .collection("scoreRevisions")
          .doc(`${id}-${direction === "undo" ? "before" : "after"}`),
      )
    ).data();
    if (!snapshot) throw new ApiError(409, "Revisión no encontrada");
    const revision = p.revision + 1;
    tx.update(ref, {
      document: snapshot.document ? { ...snapshot.document, revision } : null,
      revision,
      undoStack:
        direction === "undo"
          ? stack.slice(0, -1)
          : [...(p.undoStack ?? []), id],
      redoStack:
        direction === "redo"
          ? stack.slice(0, -1)
          : [...(p.redoStack ?? []), id],
      updatedAt: new Date().toISOString(),
    });
    return { document: snapshot.document, revision };
  });
}
