import "server-only";
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getAppCheck } from "firebase-admin/app-check";
import { ApiError } from "@/lib/utils/errors";
export function adminFirebase() {
  if (!process.env.FIREBASE_PROJECT_ID)
    throw new ApiError(
      503,
      "Configura Firebase para habilitar los servicios en la nube.",
    );
  const app =
    getApps()[0] ??
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
      credential:
        process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY
          ? cert({
              projectId: process.env.FIREBASE_PROJECT_ID,
              clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
              privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(
                /\\n/g,
                "\n",
              ),
            })
          : applicationDefault(),
    });
  return {
    auth: getAuth(app),
    db: getFirestore(app),
    appCheck: getAppCheck(app),
  };
}
