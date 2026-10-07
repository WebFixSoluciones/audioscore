# AudioScore AI

Estudio musical y base SaaS en Next.js + React + TypeScript. Interfaz oscura en español, editor MIDI, waveform, partituras y procesamiento asíncrono con archivos temporales. Todo el procesamiento propio usa JavaScript/TypeScript; FFmpeg procesa audio desde Node.

**Estado:** estudio con transcripción integrada de audio a notas/MIDI/partitura e identificación probable de instrumentos, sin cuenta ni proveedor externo en modo local. Los modelos Basic Pitch y YAMNet se incluyen y ejecutan dentro de la aplicación usando TensorFlow.js/WASM. La separación de instrumentos en stems individuales todavía requiere un motor adicional. Firebase Auth (Email/password) y Firestore Standard en `nam5` están configurados en `audioscore-ca277`, con reglas e índices desplegados, planes inicializados y primera cuenta administradora aprovisionada. Se verificaron accesos y permisos contra Firebase real. Storage, Tasks, Cloud Run y los proveedores de IA todavía necesitan configuración. Consulta [docs/FIREBASE.md](docs/FIREBASE.md).

Repositorio: [WebFixSoluciones/audioscore](https://github.com/WebFixSoluciones/audioscore). La rama principal es `main`; las versiones estables se identifican con etiquetas `vX.Y.Z` y se documentan en [CHANGELOG.md](CHANGELOG.md). `artifacts/` y los archivos temporales de análisis permanecen fuera del control de versiones.

**Vercel:** importa ese repositorio desde [Vercel](https://vercel.com/new), selecciona la raíz y deja `main` como rama de producción. El repositorio incluye la configuración de compilación y Node 22; una vez vinculado, los siguientes pushes se publican automáticamente. El estudio funciona sin variables cloud. Para habilitar cuentas y proyectos, consulta [docs/VERCEL.md](docs/VERCEL.md). La vinculación y el despliegue remoto todavía deben realizarse en la cuenta del propietario.

## Inicio local

Node 22, npm y un navegador moderno.

```powershell
npm ci
npm run dev
```

Abre `http://localhost:3000/studio`. Sin Firebase puedes:

1. Abrir audio real de hasta 50 MB y escuchar waveform, seleccionar regiones y ver espectrograma.
2. Consultar RMS, centroide espectral y clipping estimado de ventanas reales con Meyda.
3. Pulsar **Analizar y transcribir**: detectar notas polifónicas, estimar tempo/tonalidad e identificar instrumentos probables. Ver el avance y cancelar; el cálculo ocurre en un worker y no envía el audio a un tercero.
4. Importar MIDI o un JSON musical validado.
5. Crear una pista; doble clic en el piano roll agrega notas. Las flechas ajustan la nota seleccionada y Delete la elimina.
6. Editar pitch, inicio, duración, velocity y articulación; dividir/unir notas, cuantizar y deshacer/rehacer hasta 50 pasos.
7. Reproducir MIDI con Tone.js, compararlo con el original y ver MusicXML individual/global con OpenSheetMusicDisplay.
8. Descargar MIDI, MusicXML y JSON locales. El botón Guardar descarga los eventos; **no mantiene audio ni archivos permanentes**.

El piano roll muestra pitches MIDI de concierto. Abrir audio no inicia la transcripción; el botón **Analizar y transcribir** ejecuta los modelos reales. El límite local es 50 MB y 15 minutos. El motor integrado procesa ventanas acotadas con solapamiento y conserva tiempos; puede tardar varios minutos según el equipo. No genera notas cuando no encuentra evidencia tonal suficiente. El compás 4/4 es una rejilla editable sin detección automática; tempo y tonalidad son estimaciones y se avisa si no hay evidencia suficiente. Los porcentajes son activaciones de los modelos, no probabilidades calibradas. La pista transcrita contiene notas de la mezcla: los instrumentos probables no se presentan como stems separados.

Cuando el piano es el candidato predominante, el motor contrasta el pulso del audio con ataques claros del registro superior para resolver posibles valores al doble. Aparta de forma conservadora candidatos breves y débiles o posibles armónicos; se conservan en el documento y pueden recuperarse con **Recuperar detecciones apartadas**, con deshacer. El filtro no se aplica a mezclas sin evidencia predominante de piano.

La partitura utiliza una copia escrita de los eventos: dos pentagramas para piano, separación por registro estimada, ataques en una rejilla de semicorcheas, acordes, silencios y ligaduras con figuras explícitas. La vista **Legible** simplifica la resonancia del pedal y las duraciones de acordes; **Interpretado** conserva las duraciones originales. La reproducción y el MIDI mantienen el tiempo del audio. El primer ataque se toma como inicio escrito y el cursor compensa ese desplazamiento; no se detectan automáticamente anacrusas, manos ni repeticiones. Puedes elegir uno o dos pentagramas y ajustar el registro de separación. La escritura enarmónica respeta la armadura.

El worker cloud utiliza el mismo motor interno por defecto, hasta 15 minutos por análisis. `TRANSCRIPTION_PROVIDER_URL` permite sustituirlo de forma opcional para motores adicionales; ya no es un requisito para transcribir. Las cuentas, almacenamiento, cuotas, jobs y revisión Gemini siguen necesitando configuración cloud. Los pesos y licencias están en [public/models/README.md](public/models/README.md).

El análisis omite ventanas y notas con energía muy baja respecto al tramo más fuerte para reducir detecciones en silencios y colas de ruido; algunas notas muy suaves pueden perderse. Las detecciones de instrumentos resumen las activaciones más fuertes con apoyo en varios frames, para no diluir instrumentos intermitentes entre silencios. No se asigna a una nota un instrumento por esta clasificación.

AudioSet se integra mediante el modelo YAMNet entrenado en ese conjunto y un catálogo oficial de **87 categorías musicales** compatibles con el modelo: instrumentos, familias, técnicas y voces. La identificación cubre toda la pista en ventanas de tres segundos con contexto, y evita mostrar padres e hijos redundantes. Cada candidato incluye su identificador AudioSet, activación y un enlace a ejemplos oficiales para compararlos con el audio. Los ejemplos se abren externamente; el análisis local no sube tu archivo a Google. No es una búsqueda de grabaciones similares ni garantiza todos los instrumentos en una mezcla. El origen, versión y licencia CC BY-SA 4.0 de la ontología se documentan en [public/models/audioset/README.md](public/models/audioset/README.md).

## Estructura

```text
app/
  (marketing)/                  landing, pricing, features
  studio/                       estudio local
  auth/[mode]/                  login, register, forgot-password, verify-email
  dashboard/                    layout privado, proyectos, editor, scores, exports, usage
  admin/                        layout con claims y vistas users/plans/jobs/usage/logs/settings
  api/auth/session/             creación y eliminación de sesión
  api/[...segments]/            APIs con dispatch validado
components/
  audio/                        waveform, MIDI playback, stems
  editor/                       MusicEditor, PianoRoll, EventInspector
  scores/                       OSMD, VexFlow, visor cloud
  billing/                      FeatureGate, UsageMeter
  projects/                     proyectos, creación, descargas
  auth/, admin/, layout/
lib/
  firebase/, security/, validation/
  audio/                        FFmpeg, validación, Meyda y proveedores
  music/                        modelo, tempo, cuantización, MIDI, MusicXML, conversión, correcciones
  editor/                       Zustand y historial local
  billing/                      planes y transacciones de reserva
  jobs/                         cola, procesamiento, limpieza, idempotencia
workers/                        exportación y limpieza CLI
scripts/seed.ts                 inicialización de planes
tests/                          invariantes musicales, reservas y rendering
tests/e2e/                      flujos reales de editor y audio, desktop/mobile
infra/                          CORS y política de Storage
docs/                           arquitectura y contratos de proveedores
```

Se consolidan rutas y piezas estrechamente relacionadas para evitar archivos vacíos o wrappers por cada etapa. La arquitectura, flujo y modelo están en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Los contratos completos de audio están en [docs/PROVIDERS.md](docs/PROVIDERS.md).

Consulta [docs/PHASES.md](docs/PHASES.md) para el estado de las once fases, su verificación y las capacidades avanzadas pendientes.

## Variables de entorno

Copia `.env.example` a `.env.local`. No incluye valores reales. `NEXT_PUBLIC_*` configura únicamente Firebase web, reCAPTCHA y la URL pública; **nunca** uses ese prefijo en una clave Gemini, privada o secreto interno.

| Grupo        | Configuración                                                                   |
| ------------ | ------------------------------------------------------------------------------- |
| Firebase web | API key pública, authDomain, projectId, storageBucket, messagingSenderId, appId |
| App Check    | `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY`                                     |
| Admin        | `FIREBASE_PROJECT_ID`; ADC en Cloud Run o client email/private key local        |
| Gemini       | `GEMINI_API_KEY`, `GEMINI_MODEL` seleccionado para tu cuenta                    |
| Google Cloud | project, ubicación, bucket dedicado temporal                                    |
| Tasks        | queue, ubicación, cuenta de servicio y `WORKER_URL` sin slash final             |
| Seguridad    | `INTERNAL_JOB_SECRET` aleatorio de al menos 32 caracteres; cookie name opcional |
| Origen       | `NEXT_PUBLIC_APP_URL` debe coincidir exactamente con el dominio del navegador   |
| Motores      | URLs HTTPS de separación/transcripción y key privada si aplica                  |
| FFmpeg       | `FFMPEG_PATH`, `FFPROBE_PATH` opcionales; Docker usa binarios de sistema        |

Firebase firma la cookie de sesión; no se necesita `SESSION_COOKIE_SECRET` propio. Las variables públicas se incrustan al compilar: vuelve a generar la imagen si cambian. No añadas `.env.local` al repositorio o la imagen Docker.

## Firebase

1. Crea un proyecto Firebase y una aplicación web. Registra el dominio de producción y localhost en Authentication.
2. Activa Email/Password y Google en Authentication. Personaliza correos de verificación y recuperación.
3. Crea Firestore en modo producción. Instala Firebase CLI fuera del código si vas a desplegar reglas.
4. Registra reCAPTCHA Enterprise en App Check y su site key pública. Activa enforcement para Firestore. Las APIs propias exigen App Check desde el inicio; no existe un bypass por `NODE_ENV`.
5. Configura ADC o credenciales de Admin solo en el servidor. Cloud Run debe utilizar una cuenta con acceso mínimo a Firestore, Storage y Tasks.
6. Inicializa planes: `npm run seed`. Ejecutar otra vez actualiza los planes iniciales; no se debe usar este comando sobre precios personalizados sin revisar los cambios.
7. Despliega reglas e índices:

```text
firebase use YOUR_PROJECT_ID
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Todas las escrituras directas del navegador se deniegan; las APIs usan Admin y vuelven a validar propiedad/plan. El usuario se crea al establecer una sesión verificada por Admin y recibe Free. Debe verificar su email antes de entrar al dashboard.

Para habilitar un administrador, un operador autorizado debe asignar Custom Claims `admin: true` mediante Admin SDK y volver a iniciar sesión. Cambiar `role` en Firestore no concede acceso administrativo. La consola UI permite asignar planes, cambiar estado y reintentar jobs; no hay checkout ni integración de pagos.

## Storage temporal

Usa un bucket dedicado con acceso público bloqueado, sin versionado y con Soft Delete deshabilitado si necesitas borrado efectivo sin conservación adicional. La UI usa URLs firmadas V4; habilita CORS copiando el archivo de ejemplo y sustituyendo el dominio. No añadas `*` como origen.

```text
gcloud storage buckets update gs://YOUR_BUCKET --cors-file=infra/storage-cors.example.json
gcloud storage buckets update gs://YOUR_BUCKET --lifecycle-file=infra/storage-lifecycle.json
```

El ciclo de vida de 8 días es solo respaldo. Scheduler debe borrar mediante `expiresAt`: original/stems/working/WAV/MP3/ZIP hasta 24 h y exportaciones de notación según plan, hasta 7 días. Los metadatos quedan para conservar el trabajo musical y auditar la limpieza. Las URLs firmadas duran como máximo 5 minutos.

Uploads: crear proyecto → URL firmada por 10 minutos → PUT con Content-Type exacto → upload-complete → validación servidor de tamaño, MIME, duración y generación → reserva → análisis. FFmpeg verifica decodificación, silence/clipping y obtiene peaks dentro del worker.

## Jobs, consumo y proveedores

Los proveedores externos opcionales se describen en [docs/PROVIDERS.md](docs/PROVIDERS.md). El motor base incluido no requiere un endpoint de transcripción externo; el worker verifica que esté preparado antes de reservar consumo. No se usa Gemini como motor de separación o de detección precisa de notas.

Cloud Tasks requiere una cola en la ubicación elegida y una cuenta de servicio que pueda invocar el worker. La cuenta del backend necesita `cloudtasks.tasks.create` y permiso `iam.serviceAccounts.actAs` sobre esa identidad. Configura una política de reintento con más de tres entregas y un intervalo mínimo razonable. El worker realiza hasta tres intentos efectivos y libera la reserva si falla definitivamente.

`WORKER_URL` identifica el servicio que contiene `/api/internal/jobs/process`. Cada tarea lleva OIDC con audiencia WORKER_URL y el secreto interno. El guard verifica firma, audiencia, email y secreto. En Cloud Run privado verifica el comportamiento de Authorization reenviado por la plataforma; un deployment que retire su firma requiere adaptar el guard a una identidad verificada por IAM sin reducir las comprobaciones.

No se ejecuta el trabajo en memoria después de responder al usuario. Firestore persiste el job antes de encolarlo; Scheduler vuelve a despachar pendientes. Reservas, counters y confirmación son transacciones. La misma idempotencyKey no duplica un job o su consumo; reutilizarla con parámetros distintos produce 409. Los jobs de exportación usan un snapshot de revisión y no consumen minutos de análisis.

El reprocesamiento regional conserva notas que atraviesan los bordes y marca posibles solapamientos. Requiere Advanced Analysis y un proveedor que conserve IDs originales de fuentes. El audio original debe seguir disponible.

## API implementada

Todas las rutas privadas requieren sesión y App Check; las mutaciones también verifican Origin. Las APIs se implementan en `lib/api/dispatch.ts` y se exponen por un Route Handler compartido.

| Rutas                                                                  | Métodos                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| `/api/auth/session`                                                    | POST, DELETE                                         |
| `/api/projects`                                                        | GET, POST                                            |
| `/api/projects/{id}`                                                   | GET, PATCH título, DELETE                            |
| `.../upload-url`, `.../upload-complete`                                | POST                                                 |
| `.../analyze`, `.../reprocess-region`, `.../cancel`                    | POST                                                 |
| `.../status`, `.../sources`, `.../events`, `.../scores`, `.../exports` | GET                                                  |
| `.../events`                                                           | PATCH con documento y expectedRevision               |
| `.../corrections`                                                      | GET, POST con documento, expectedRevision, operation |
| `.../undo`, `.../redo`                                                 | POST con expectedRevision                            |
| `.../scores/render`                                                    | POST devuelve SVG                                    |
| `.../export`                                                           | POST con format, sourceId opcional, idempotencyKey   |
| `.../download/{asset}`                                                 | GET devuelve URL firmada; `original` para audio      |
| `/api/plans`                                                           | GET público con configuración inicial de planes      |
| `/api/usage/current`                                                   | GET                                                  |
| `/api/admin/users`, `/api/admin/users/{uid}`                           | GET, PATCH estado/plan/suscripción                   |
| `/api/admin/plans`                                                     | GET, PATCH plan validado                             |
| `/api/admin/jobs`, `/api/admin/jobs/{jobId}/retry`                     | GET, POST nuevo job reservado                        |
| `/api/admin/logs`, `/api/admin/usage`, `/api/admin/settings`           | GET                                                  |
| `/api/internal/jobs/process`, `/api/internal/cleanup`                  | POST con identidad interna                           |

Listados limitados a 100 registros en esta entrega; paginación avanzada pendiente. La UI de precios refleja los valores iniciales; cambios administrativos se aplican al plan leído del servidor. La prioridad y batch son features modeladas, pendientes de configurar con colas y UI correspondientes.

## Exportaciones

- MIDI individual/multitrack: MidiWriterJS + lectura y verificación con @tonejs/midi.
- MusicXML individual/global: generador determinista desde los eventos.
- MEI y PDF: importación MusicXML en Verovio, SVG a PDF mediante PDFKit.
- WAV/MP3: FFmpeg sobre un stem real seleccionado; no se inventan stems para completar un paquete.
- JSON: documento musical validado.
- ZIP: metadatos del proyecto/original, análisis, confidence, stems existentes, MIDI, MusicXML, MEI, PDF y README. Máximo 150 MB para controlar memoria.

Pitch bend/automation se rechazan al exportar MIDI si existen; no se eliminan silenciosamente. Tresillos explícitos, transposición, dinámicas avanzadas y notación de percusión profesional requieren ampliación. La partitura interpretada puede contener valores de duración irregulares; la vista legible es preferible para engraving.

## Tests y build

```text
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm start
```

Las pruebas unitarias comprueban tipos de archivo, timing con cambios de tempo, compases, cuantización, MIDI de ida/vuelta, MusicXML, ligaduras, ownership de archivos, cuotas y solicitudes concurrentes contra un double transaccional. La integración real Verovio genera SVG, MEI y PDF. E2E abre un WAV generado como fixture de prueba, edita notas, importa MIDI, muestra partitura y descarga MIDI en escritorio y móvil. Las fixtures se identifican como prueba y nunca se muestran como un análisis de usuario.

Autenticación contra Firebase, reglas en emuladores, GCS URLs, IAM, Tasks y Gemini en una cuenta real necesitan configuración adicional y no se presentan como verificados por las pruebas locales. La evaluación de precisión con Faded cubre cuatro compases leídos manualmente; no representa una medición general sobre un corpus musical.

## Docker y despliegue

```text
docker compose --env-file .env.local up --build
```

La imagen usa Node22, build standalone de Next y FFmpeg del sistema. Las variables Firebase públicas son build args. En producción usa Secret Manager para Gemini, secretos internos y otras credenciales; preferir ADC sobre una clave privada de servicio. Cloud Run debe disponer de memoria suficiente (recomendado comenzar con 2 GiB), disco temporal y timeout de al menos 1800s para el worker. Usa concurrency baja para el worker y cuotas acorde a tu capacidad. La imagen contiene UI y APIs, pero puedes desplegar dos servicios desde ella.

Crea un Scheduler cada minuto para POST a `WORKER_URL/api/internal/cleanup`, usando OIDC con la misma cuenta permitida y audiencia WORKER_URL, más `X-Internal-Secret`. El endpoint recupera despachos pendientes y elimina hasta 200 archivos por ejecución; aumenta frecuencia/capacidad según volumen y atiende `more: true`. Puedes ejecutar la misma limpieza manualmente con `npm run cleanup` desde un entorno autorizado.

No hay despliegue automático en esta entrega: necesitas elegir región, proyecto, dominio, proveedores y cuentas de servicio. No se han instalado recursos o realizado cargos cloud.

## Solución de problemas

| Síntoma                           | Revisar                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| Pantalla local funciona, login no | Variables públicas Firebase y build nuevo                            |
| App Check 403                     | reCAPTCHA Enterprise, dominios autorizados, site key y enforcement   |
| Origin no autorizado              | NEXT_PUBLIC_APP_URL exacta, incluyendo protocolo y puerto            |
| Usuario bloqueado en dashboard    | Correo verificado, nuevo login, cuenta active, sesión vigente        |
| Error al crear proyecto           | Planes inicializados, máximo de proyectos, acceso Firestore          |
| Subida PUT falla                  | CORS del bucket, MIME exacto, URL no vencida                         |
| Job en cola sin ejecutar          | Tasks, IAM, WORKER_URL, OIDC, secreto, Scheduler de recuperación     |
| Sin notas o sin stems             | Contrato y disponibilidad del proveedor; Gemini no los crea          |
| PDF falla                         | Duraciones/tuplet no soportado, límite de páginas y warnings Verovio |
| 410 al descargar                  | Archivo ya caducó; conservar metadatos no conserva el archivo        |
| Edición 409                       | Trabajo activo o revisión modificada en otra sesión                  |

`fluent-ffmpeg` está deprecado por su mantenedor y se conserva por el requisito explícito. Su uso queda acotado al adaptador de transcodificación para poder sustituirlo por spawn de FFmpeg sin cambiar el dominio. No hay claves API privadas en código ni archivos de usuario permanentes.
