import "server-only";
import { Storage } from "@google-cloud/storage";
import { adminFirebase } from "./admin";
import { ApiError } from "@/lib/utils/errors";
import { createHash } from "node:crypto";
import { federationOptions } from "./federation";
let storage: Storage | undefined;
export function temporaryBucket() {
  if (!process.env.GOOGLE_CLOUD_STORAGE_BUCKET)
    throw new ApiError(503, "Almacenamiento temporal no configurado");
  storage ??= new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    ...(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY
      ? {
          credentials: {
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
          },
        }
      : { credentials: federationOptions() }),
  });
  return storage.bucket(process.env.GOOGLE_CLOUD_STORAGE_BUCKET);
}
export function assertStorageOwner(
  path: string,
  uid: string,
  projectId: string,
) {
  if (
    !path.startsWith(`temporary/${uid}/${projectId}/`) ||
    path.includes("..") ||
    path.includes("\\")
  )
    throw new ApiError(403, "Archivo no autorizado");
}
export async function trackAsset(
  uid: string,
  projectId: string,
  path: string,
  fileType: string,
  expiresAt: string,
) {
  assertStorageOwner(path, uid, projectId);
  const id = createHash("sha256").update(path).digest("hex");
  await adminFirebase().db.doc(`temporaryAssets/${id}`).set({
    userId: uid,
    projectId,
    storagePath: path,
    fileType,
    createdAt: new Date().toISOString(),
    expiresAt,
    deleted: false,
  });
}
export async function signedRead(
  uid: string,
  projectId: string,
  path: string,
  expiresAt: string,
) {
  assertStorageOwner(path, uid, projectId);
  const expiry = Math.min(Date.now() + 5 * 60000, Date.parse(expiresAt));
  if (!Number.isFinite(expiry) || expiry <= Date.now())
    throw new ApiError(410, "Este archivo ya caducó");
  const [exists] = await temporaryBucket().file(path).exists();
  if (!exists) throw new ApiError(410, "El archivo ya no está disponible");
  const [url] = await temporaryBucket()
    .file(path)
    .getSignedUrl({ version: "v4", action: "read", expires: expiry });
  return url;
}
