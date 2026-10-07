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
import { Firestore } from "@google-cloud/firestore";
import { federatedFirebase } from "./federation";
let federatedDb: Firestore | undefined;
export function adminFirebase() {
  if (!process.env.FIREBASE_PROJECT_ID)
    throw new ApiError(
      503,
      "Configura Firebase para habilitar los servicios en la nube.",
    );
  const federation = federatedFirebase();
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
          : (federation?.credential ?? applicationDefault()),
    });
  return {
    auth: getAuth(app),
    db: federation
      ? (federatedDb ??= new Firestore({
          projectId: process.env.FIREBASE_PROJECT_ID,
          authClient: federation.authClient,
          preferRest: true,
        }))
      : getFirestore(app),
    appCheck: getAppCheck(app),
  };
}
