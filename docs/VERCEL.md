# GitHub → Vercel

El repositorio está preparado para importarse en Vercel. La vinculación inicial
se realiza en la cuenta del propietario; después Vercel despliega los cambios
de GitHub automáticamente. Producción publicada en https://audioscore.vercel.app. Las variables de Firebase se gestionan en Vercel y no se transfieren con los commits de GitHub.

## Primera publicación

1. En https://vercel.com/new selecciona **Import Git Repository** y autoriza
   acceso a `WebFixSoluciones/audioscore`.
2. Selecciona ese repositorio y conserva la raíz `./`, el framework **Next.js**
   y Node.js **22.x**. `vercel.json` define instalación y compilación.
3. Pulsa **Deploy**. El estudio `/studio` funciona sin Firebase: carga,
   análisis Basic Pitch / AudioSet, edición y exportación local.
4. En **Settings → Git**, confirma **Production Branch: main**. Cada push a
   `main` actualizará producción; otras ramas generan vistas previas.

No configures una carpeta `out`, servidor personalizado ni exportación estática:
la aplicación tiene rutas API y páginas privadas. Vercel usa su adaptador
Next.js; el servidor standalone se mantiene para desarrollo de producción local
y el worker Docker / Cloud Run.

## Cuentas y proyectos cloud

El estudio local no requiere variables. Para habilitar cuentas, añade las
variables de `.env.example` en **Settings → Environment Variables** y redeploy:

| Función                                          | Variables                                                                                                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase en navegador                            | `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` |
| App Check                                        | `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY`                                                                                                                                                                             |
| Identidad federada del servidor (producción)     | `FIREBASE_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_AUDIENCE`, `GCP_SERVICE_ACCOUNT_EMAIL`                                                                                                                                    |
| Credenciales privadas del servidor (alternativa) | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`                                                                                                                                                  |
| Origen autorizado de sesiones                    | `NEXT_PUBLIC_APP_URL` con la URL HTTPS exacta del sitio                                                                                                                                                                 |
| Archivos temporales                              | `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_STORAGE_BUCKET`                                                                                                                                                                |
| Cola y worker de análisis                        | `CLOUD_TASKS_QUEUE`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_SERVICE_ACCOUNT`, `WORKER_URL`, `INTERNAL_JOB_SECRET`                                                                                                         |
| Revisión Gemini opcional                         | `GEMINI_API_KEY`, `GEMINI_MODEL`                                                                                                                                                                                        |

Las variables `NEXT_PUBLIC_*` se incorporan durante la compilación. La clave
privada admite saltos de línea reales o `\n`; no se publica en GitHub ni usa
prefijo público. La cuenta de servicio debe tener permisos para Firebase,
Storage y crear tareas en la cola; Cloud Run debe permitir invocación a la
identidad indicada por `CLOUD_TASKS_SERVICE_ACCOUNT`.

Añade el dominio publicado a los dominios autorizados de Firebase Auth y al
registro de App Check / reCAPTCHA; actualiza Storage CORS con ese origen.
Usa proyectos Firebase y variables separados para Preview y Production si
habilitas cuentas en ambas. Una vista previa necesita su propio origen
autorizado; sin esas variables sigue disponible el estudio local.

## Procesamiento de audio

El estudio procesa el audio en el navegador y descarga modelos estáticos del
propio sitio. Los pesos permanecen publicados en `public/models/`.

Los proyectos cloud suben directamente a Storage mediante URLs firmadas y
envían tareas a Cloud Run. `WORKER_URL` debe apuntar al servicio Cloud Run, nunca
al sitio Vercel. Las rutas internas de análisis se rechazan en Vercel y el
paquete de sus funciones excluye los modelos y runtime exclusivos del worker.
Las funciones web tienen un máximo configurado de 300 segundos; los análisis
largos siguen en el worker. El estudio funciona sin configurar esta parte.

Cloud Tasks y Storage reutilizan en Vercel la identidad federada configurada; las credenciales privadas siguen siendo una alternativa. En Cloud Run
se usa la identidad del servicio. FFmpeg y el motor de transcripción se
incluyen en el Dockerfile del worker; su target `audio-worker` añade Python/Demucs para separación real. Ver [despliegue del separador](SEPARATION.md). No configures rutas locales de Windows
en `FFMPEG_PATH` o `FFPROBE_PATH` de Vercel.

Referencias: [Next.js en Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs),
[integración con GitHub](https://vercel.com/docs/git/vercel-for-github),
[versiones de Node.js](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## Identidad federada de producción

La cuenta `audioscore-vercel` recibe únicamente los roles `firebaseauth.admin` y `datastore.user`. El proveedor OIDC limita la confianza al equipo y proyecto de AudioScore y a los entornos Production y Development; Preview no recibe estos permisos. Vercel proporciona un token temporal, que el servidor intercambia mediante Google Auth Library. Firebase Auth y Firestore usan la misma identidad. No se necesita `FIREBASE_PRIVATE_KEY` ni se deben copiar credenciales locales a Vercel.

App Check usa una clave reCAPTCHA Enterprise para `audioscore.vercel.app` y `APP_CHECK_ENFORCED=true`. No se habilitó facturación. Los servicios de archivos y trabajos cloud aún requieren su configuración independiente.

## Compatibilidad del SDK de Firebase

Se fija `jose@5.10.0` exclusivamente dentro de `jwks-rsa` para evitar `ERR_REQUIRE_ESM` con Firebase Admin 14 en el cargador de Vercel. `npm run check:firebase-runtime` verifica que Auth y App Check puedan cargarse con `require(ESM)` desactivado. Esta comprobación corre antes de cada compilación de Vercel. Referencia: https://github.com/firebase/firebase-admin-node/issues/3181.
