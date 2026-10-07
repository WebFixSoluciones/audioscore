import "server-only";
import { adminFirebase } from "@/lib/firebase/admin";
import { ApiError } from "@/lib/utils/errors";
import type { Project } from "@/lib/music/types";
export function safeId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    throw new ApiError(400, "Identificador inválido");
  return id;
}
export function projectRef(uid: string, id: string) {
  return adminFirebase().db.doc(`users/${safeId(uid)}/projects/${safeId(id)}`);
}
export async function ownedProject(uid: string, id: string): Promise<Project> {
  const doc = await projectRef(uid, id).get();
  if (!doc.exists || doc.data()?.userId !== uid || doc.data()?.deleted)
    throw new ApiError(404, "Proyecto no encontrado");
  return { ...doc.data(), id: doc.id } as Project;
}
