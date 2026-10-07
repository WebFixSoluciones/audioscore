"use client";
import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  getToken,
  type AppCheck,
} from "firebase/app-check";
export const firebaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
);
let check: AppCheck | undefined;
export function clientFirebase() {
  if (!firebaseConfigured)
    throw new Error(
      "Firebase aún no está configurado. Puedes usar el estudio local.",
    );
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  if (
    typeof window !== "undefined" &&
    !check &&
    process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY
  )
    check = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(
        process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY,
      ),
      isTokenAutoRefreshEnabled: true,
    });
  return { app, auth: getAuth(app) };
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  clientFirebase();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (check) headers.set("X-Firebase-AppCheck", (await getToken(check)).token);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "No se pudo completar la solicitud");
  return data as T;
}
