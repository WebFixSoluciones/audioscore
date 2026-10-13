# AudioScore: arquitectura y modelo de procesos actuales

Fecha: **12 de octubre de 2026**, America/Guayaquil. Alcance: código y recorrido local de este repositorio, contrastados con la auditoría del trabajo «Faded». Esta entrega documenta el sistema; no cambia el comportamiento del motor. Las propuestas se identifican como pendientes.

> **Cambios posteriores:** esta es la instantánea del 12 de octubre. La incorporación local de IATPE y del adaptador RoFormer se revisa en [AUDIT-STEMS-2026-10-13.md](AUDIT-STEMS-2026-10-13.md), con defectos reproducidos de muestreo, ensamblado y despacho. Los PNG de esta instantánea no representan esos cambios posteriores.

## Diagramas PNG

- [Arquitectura actual — 3450 × 2750](diagrams/audioscore-arquitectura-actual-2026-10-12.png).
- [Modelo de procesos, macro y micro, con propuesta pendiente — 3450 × 3030](diagrams/audioscore-modelo-procesos-2026-10-12.png).

Verde: componente conectado al recorrido local, sin implicar precisión musical validada. Ámbar: cálculo costoso o limitación actual. Azul: acceso, contratos y servicios de control. Gris con borde discontinuo: otro recorrido preparado en código o propuesta pendiente.

## 1. Qué arquitectura tenemos realmente

El sistema tiene cuatro responsabilidades principales:

1. **Experiencia musical en el navegador:** cargar y escuchar audio, controlar pistas, editar eventos y mostrar partituras/tablaturas.
2. **Aplicación y control de acceso en Next.js:** landing, login, dashboard, administración de usuarios/planes y APIs privadas.
3. **Orquestación local en Node.js:** recibe trabajos, controla la cola, llama a motores y publica resultados.
4. **Cálculo de audio en dos entornos:** Python/PyTorch para ritmo, armonía y separación; Node/TensorFlow.js/WASM para notas y clasificación de instrumentos.

No hay cuatro servidores independientes: Next.js, el servicio Node, Python y los workers de notas comparten el mismo equipo. El navegador también consume CPU/RAM del equipo. La comunicación Python es un protocolo JSON por stdin/stdout, no una API FastAPI. El worker de notas es un hilo Node separado, no un servicio Python.

La aplicación local está en `http://audioscore.localhost:3000/dashboard/studio`. Firebase Client autentica al navegador directamente con Firebase Authentication; Firebase Admin comprueba la sesión y el perfil en el servidor. El servicio de audio está en `127.0.0.1:8765` y exige un token temporal del iniciador; el navegador accede mediante `/api/local/*`. El proxy verifica la cuenta y transmite el UID obtenido de la sesión, sin aceptar que el usuario elija otro propietario.

**Firebase sigue siendo real y externo:** `audioscore-ca277`, Authentication Email/password y Firestore Standard en nam5. Perfiles, estados, roles y planes están en Firebase. El audio, los resultados y los proyectos del modo local están en disco local. No se utilizan emuladores ni Vercel Blob en este recorrido. La verificación de la cuenta requiere conexión; el cálculo no llama a una API externa de inferencia. Los pesos pueden descargarse en la instalación o primer uso si faltan en caché.

La ruta cloud de Storage, Cloud Tasks, Cloud Run, cuotas y adaptadores existe por separado en código. **No participa en el trabajo local auditado.** Tener sus dependencias o archivos no demuestra que esté desplegada/configurada. GitHub/Vercel corresponden al versionado y publicación de la web, no al procesamiento de este motor local. No se verificó ni modificó el despliegue remoto en esta revisión; hay cambios locales pendientes de versionar.

El documento [ARCHITECTURE.md](ARCHITECTURE.md) describe decisiones anteriores y la ruta cloud. Contenía afirmaciones superadas —sin Python, sin separación integrada y acceso local sin cuenta—; se marca como histórico para que este informe sea la referencia del recorrido actual.

## 2. Inventario: qué hace cada tecnología

Las versiones de JavaScript son las declaradas en el manifiesto; sus rangos no sustituyen al lockfile. Las dependencias Python locales se fijan en `local-requirements.txt` y `requirements.txt`.

| Tecnología | Responsabilidad conectada | Estado y límite relevante |
| --- | --- | --- |
| Next.js 16 / React 19 / TypeScript | Web, dashboard, administración y proxy de APIs | Activo; no realiza la inferencia de Demucs |
| Node.js 22 | Servicio HTTP local, cola, procesos y worker de notas | Activo; un análisis pesado a la vez |
| Firebase Auth / Firestore / Admin | Cuenta, perfil, rol, estado, planes y verificación de sesión | Activo; backend externo para control de usuarios |
| Firebase App Check | SDK y protecciones de otras APIs | Existe en el proyecto; `requireAccount()` sin request en el proxy local no exige token App Check |
| Zustand / Zod | Estado del editor y validación de contratos | Activo; no reconocimiento de audio |
| WaveSurfer.js / Web Audio API | Onda, regiones, escucha, espectrograma y mezcla | Activo; la preparación del navegador también decodifica audio |
| Meyda | Características acústicas de ventanas: RMS, centroide, clipping, etc. | Activo; estas características no cuentan instrumentos |
| FFmpeg | Inspección, normalización, peaks, PCM, mezcla y práctica | Activo; actualmente escribe `original.wav` |
| Python 3.11 / NumPy / soundfile | Entorno numérico y lectura/escritura de audio | Activo; comparte recursos del equipo con Node y navegador |
| PyTorch 2.6.0+cpu / torchaudio | Ejecución de Demucs y Beat This! | Activo en CPU; CUDA/HIP ausentes en esta instalación |
| Demucs 4.0.1, `htdemucs_6s` | Separación en batería, bajo, otros, voz, guitarra y piano | Activo; seis categorías fijas, con filtraciones posibles |
| librosa 0.11.0 | HPSS, ataques, beat tracking, chroma, tonalidad y acordes | Activo; parte de este trabajo se repite con otros motores |
| Beat This! 1.1.0, `final0` | Pulsos y primeros tiempos de compás | Activo cuando se habilita detección; estimación conservadora de 3/4 o 4/4 |
| TensorFlow.js 4.22 / WASM | Inferencia de clasificación y notas | Activo en worker Node; un hilo y recarga por archivo |
| YAMNet / etiquetas AudioSet | Clasificación probable de instrumentos/sonidos | Activo **después de separar**; no consulta un repositorio remoto ni cuenta fuentes físicas |
| Spotify Basic Pitch | Eventos de notas polifónicas | Activo sobre mezcla y stems tonales; no transcribe batería |
| Escritor musical TypeScript | Cuantización, voces, registros, silencios, compases y ligaduras | Activo; construye MusicXML desde eventos detectados |
| OpenSheetMusicDisplay 2.2 | Partitura MusicXML en SVG | Activo; dibuja, no corrige la inferencia |
| VexFlow 5 | Vista de notación y tablatura sugerida | Activo para guitarra/bajo; afinación estándar y digitación propuesta |
| music21 9.9.1 | Auditoría de duración de compases del MusicXML | Activo a demanda/antes de MXL; no es el transcriptor ni el cuantizador principal |
| Tone.js / @tonejs/midi / MidiWriterJS | Escucha sintetizada, lectura y escritura MIDI | Activo; MIDI es una salida estructurada, no audio separado |
| fflate / Verovio 6 | Contenedor MXL y conversión PDF/MEI | Activo bajo demanda; comprimir XML no mejora las notas |
| FFmpeg Rubber Band | Cambio de velocidad y transposición para práctica | Activo bajo demanda; no altera automáticamente la partitura |
| Cloud Storage / Tasks / Cloud Run / Gemini / adaptadores HTTPS | Recorrido cloud y revisión/integraciones opcionales | Preparado en código; fuera del audio local auditado |
| FastAPI / Celery / Redis | APIs y cola distribuidas propuestas | No integrados; la cola local actual ya evita bloquear una petición HTTP durante toda la inferencia |
| AudioSep / MT3 / Omnizart / Madmom / Spleeter / Lyria | Alternativas mencionadas en conversaciones | No están ejecutándose en este pipeline |
| ONNX Runtime / DirectML / WinML | Alternativa de inferencia/aceleración a evaluar | Sin integración ni benchmark en este recorrido |

## 3. Modelo macro: del usuario al proyecto

| Proceso | Entrada | Salida y condición |
| --- | --- | --- |
| M1. Acceso | Correo/contraseña y sesión | Usuario activo y verificado; dashboard |
| M2. Carga | Archivo del usuario | Audio en trabajo temporal; no crea automáticamente un proyecto |
| M3. Análisis completo | Audio y opciones | Job en cola, estados de progreso, resultado o error/cancelación |
| M4. Revisión musical | Stems y documento musical | Escucha, selección de pista, piano roll, partitura, tablatura y correcciones |
| M5. Persistencia/exportación | Resultado revisado y elección del usuario | Proyecto local si pulsa Guardar; descargas según formato |

Los resultados terminados no guardados quedan físicamente como caché local pero no aparecen en Mis proyectos ni se abren al entrar al estudio. No hay política automática de limpieza del disco. El guardado no traslada esos audios a Firestore.

## 4. Modelo micro: secuencia actual del motor

| Etapa | Operación y dependencia | Resultado |
| --- | --- | --- |
| A0. Admisión | Autenticación, origen, propietario y capacidad local | ID de job; HTTP no espera toda la inferencia |
| A1. Preparación | Copia del original → FFmpeg inspecciona → WAV estéreo PCM16 44,1 kHz → peaks | `input.ext`, `original.wav`, onda reducida |
| A2. Ritmo/armonía | librosa carga mono 22,05 kHz, HPSS, ataques, beat tracking; Beat This! puede reemplazar esos beats; chroma y plantillas | Tempo, beats/downbeats, tonalidad y acordes estimados |
| A3. Separación | Python Demucs sobre el WAV; calidad equilibrada: 1 shift y 25% de solapamiento | Manifest y WAV alineados por categoría; descarte de señal casi nula |
| A4. Mezcla global | Nuevo worker Node; FFmpeg PCM mono 22,05 kHz; Basic Pitch + YAMNet + estimación de tempo | Documento global con notas e hipótesis de instrumentos |
| A5. Canales | Por cada stem tonal elegible, en serie: preparar PCM y repetir worker/modelos/notas/clasificación | Eventos por sourceId; percusión conserva audio sin notas |
| A6. Estructura | Sustituir eventos globales por los de canales; convertir segundos a ticks con tempo común; validar Zod | `MusicDocument`, MIDI y MusicXML |
| A7. Publicación | Persistir `result.json`, marcar completed; cliente solicita resultado | Canales y notación visibles juntos al terminar |
| A8. Acciones posteriores | Mezclar, practicar, editar, revisar compases o exportar | Nueva escucha/archivo; guardar es explícito |

Basic Pitch procesa ventanas de 12 segundos con contexto de un segundo a cada lado; YAMNet hace barridos de ventanas de clasificación. El contexto solapado tiene un costo útil para continuidad: no debe eliminarse sin medir precisión. Demucs también combina ventanas y solapamientos. No toda repetición es desperdicio; sí lo es transcribir una mezcla cuyas notas finales se sustituyen cuando se transcriben todos sus canales.

El backend de archivos permite entregar un archivo existente al propietario incluso antes de completed. Lo que falta para escucha temprana es **un contrato de resultado parcial y su consumo en la interfaz**; no basta con abrir el archivo en disco. Actualmente el cliente espera el resultado completo.

## 5. Dispersión y consumo innecesario identificados

1. **Instrumentos identificados demasiado tarde.** Demucs recibe cualquier audio sin una decisión previa de si realmente necesita separar. Un solo piano paga el separador de seis categorías.
2. **Notas duplicadas.** Se ejecuta Basic Pitch sobre la mezcla y nuevamente sobre cada stem tonal. Las notas globales se reemplazan; algunos metadatos sí se conservan y deben tener sustituto al retirar esa inferencia.
3. **Recarga por canal.** Cada llamada inicia WASM y carga Basic Pitch/YAMNet; termina el worker después. Python sí reutiliza sus modelos.
4. **Pulso duplicado.** Primero librosa; después Beat This! puede sustituir su resultado. La estimación JavaScript vuelve a calcular tempo en cada audio.
5. **Requisitos previos innecesarios.** Separar no necesita acordes ni compás. Sin embargo HPSS, armonía y ritmo deben terminar antes de empezar Demucs.
6. **Representaciones/copias de audio.** El navegador decodifica; el servidor escribe WAV; Python carga audio; la transcripción crea PCM. Esas vistas no tienen necesariamente la misma frecuencia ni finalidad y actualmente no existe un administrador común de buffers/caché.
7. **Progreso poco explicativo.** Porcentajes fijos por etapa, sin temporizadores internos ni progreso de ventanas del motor Python conectado a la UI.
8. **Modelo adecuado no implica salida exacta.** Filtraciones generan canales residuales y posibles notas falsas; contar WAV no mide precisión de separación ni reconocimiento.

La coordinación debe centralizarse en el orquestador existente. Python y el worker de notas deben recibir una operación concreta y devolver un contrato, sin repetir por defecto clasificación, ritmo y transcripción completos.

## 6. Qué falta en la fase de análisis previo de AUDIO

La fase solicitada todavía **no existe como operación independiente**. Para construirla antes de mejorar separación, el orden propuesto es el siguiente:

| Prioridad | Entrega pendiente | Tecnología y contrato | Cómo evita consumo en vano |
| --- | --- | --- | --- |
| P0 | Medición por etapas | Node/Python: tiempos de carga, lectura, inferencia, escritura; RAM, duración y versión | Identifica el costo real antes de sumar modelos o comprar hardware |
| P0 | Operación «Analizar audio» independiente | Proxy y cola existentes; contrato de inspección distinto de MusicDocument | No ejecuta Demucs, Basic Pitch, Beat This! ni acordes por el simple hecho de identificar instrumentos |
| P0 | Lectura sin WAV intermedio en inspección | FFmpeg: codec real → PCM por ventanas/buffers acotados | Conserva original y evita archivo normalizado y copia completa para esta fase |
| P0 | Clasificador residente independiente | YAMNet existente; únicamente clasificación | Evita cargar modelo de notas y clasificador por canal |
| P0 | Evidencia temporal y taxonomía agrupada | Agregar puntuaciones por ventanas; familias/tipos, regiones y señal desconocida | Evita contar etiquetas similares como instrumentos diferentes |
| P0 | Propuesta de canales revisable | Lista de candidatos con evidencia y estado confirmado/probable/desconocido | Un instrumento confirmado permite omitir separación; no produce canales ficticios |
| P1 | Caché reutilizable por usuario | Huella del original + versión de modelos + parámetros; invalidación y límites | Mismo audio/mismas opciones no repiten inspección; evita filtrar resultados entre usuarios |
| P1 | Ritmo con proveedor principal/fallback | Beat This! **o** librosa según modo/evidencia; mapa común | No paga ambos siempre; calcula ritmo cuando se van a escribir notas |
| P1 | Worker residente de notas, con límite de RAM | Worker Node reutilizable; clasificar stems solo si aporta valor | Quita recarga y transcripción global redundante cuando haya canales válidos |
| P1 | Resultados parciales | Estados `inspection_ready`, `audio_ready`, `notes_ready`, `score_ready` o equivalentes versionados | Permite escuchar sin esperar partituras; no obliga a pedir todo |
| P1 | Presupuesto y ciclo de vida | Una tarea pesada, cancelación, admisión, limpieza temporal/caché | Evita saturación de RAM y acumulación ilimitada de archivos/modelos |
| P1 | Evaluación musical y de clasificación | Audios etiquetados, mezclas conocidas y métricas por instrumento | Decide si otro modelo mejora el resultado antes de integrarlo |
| P2 | Cobertura adicional/aceleración | Evaluar modelo y hardware con benchmark propio | Solo añadir tecnología ante una carencia comprobada |

No hace falta instalar Celery/Redis/FastAPI para conseguir esta primera fase local. Son opciones para otra escala operativa, no soluciones a repetir inferencias. ONNX y modelos alternativos tampoco deberían añadirse simultáneamente: primero establecer contratos y línea base.

### Conservar el formato original

Hoy se aceptan MP3, WAV, FLAC, M4A, AAC, OGG y AIFF/AIF con validación de extensión/MIME. **No significa aceptar universalmente cualquier codec.** M4A puede contener AAC con pérdida o ALAC sin pérdida; la categoría debe obtenerse del codec inspeccionado, no del nombre del archivo. Hay que ampliar y probar formatos según los decodificadores disponibles, y comunicar corrupción, DRM o parámetros faltantes de PCM crudo.

Los modelos necesitan muestras numéricas de audio, no bytes comprimidos de MP3/FLAC. Conservar el original y evitar convertirlo a otro archivo **sí es viable**: decodificar a PCM en memoria, remuestrear solo la vista necesaria para inferencia y liberar ventanas después. YAMNet necesita mono 16 kHz; Basic Pitch usa otra entrada. Estas vistas internas no reescriben ni vuelven a comprimir el original. Las futuras pistas separadas serán nuevas señales y necesitarán un formato de reproducción/exportación elegido explícitamente. El pedido de eliminar `original.wav` no está todavía implementado.

### Instrumentos y cantidad de canales

Es viable obtener **una estimación de tipos presentes al inicio**. YAMNet entrega puntuaciones de clases, no el número de músicos, instancias ni fuentes independientes. Piano, guitarra y voz probables permiten proponer tres tipos de canal; no garantizan que se puedan aislar tres stems limpios.

Una etiqueta aislada no confirma un solo instrumento. Debe haber evidencia consistente a lo largo del audio, margen frente a alternativas y una salida «incierto». Dos guitarras o dos sintetizadores similares pueden aparecer como un mismo tipo. La procedencia analógica/digital del hardware no se establece con fiabilidad solo por la grabación.

Con un solo instrumento confirmado puede mantenerse **un canal del original**, sin Demucs, y después transcribirlo. Con varios, la lista es un plan de separación: Demucs solo cubre sus seis categorías; no puede producir violín, saxofón y flauta como tres canales arbitrarios. Para fuentes adicionales hace falta un separador compatible y evaluación. Nunca debe duplicarse la mezcla varias veces para simular stems separados.

## 7. Hardware: capacidad y reglas de ejecución

Equipo observado: i5-4590, cuatro núcleos/hilos, 16 GB RAM, Radeon RX 560 e Intel HD Graphics 4600. PyTorch CPU y el argumento explícito `device="cpu"` dejan la GPU fuera del proceso. Python utiliza dos hilos de cálculo; el worker WASM de notas utiliza uno. Aumentar hilos o trabajos concurrentes sin medir puede empeorar latencia por competencia y memoria.

El trabajo «Faded», 4:58 de audio, tomó **19:12**: preparación/metadatos 3:53, separación 8:35, resto de análisis/salida 6:44. Son tiempos reconstruidos de un caso, no un objetivo ni garantía. El MP3 de unos 4 MB produjo un WAV de unos 52,6 MB; seis salidas estéreo Float32 completas de esa duración representan unos 632 MB de muestras, antes de pesos, activaciones y copias. Se observó poca memoria libre, pero no se midió una tasa de paginación que permita atribuirle el retraso completo.

Reglas propuestas para este equipo:

- Mantener una sola tarea pesada; la cola actual limita cinco pendientes y cien registros, pero no es un plan para miles de usuarios.
- Medir pico de RAM por etapa; usar ventanas de decodificación y liberar buffers. Limitar también la memoria de los modelos residentes: mantener todos cargados no siempre es mejor.
- Reservar el clasificador ligero para inspección; no precargar Demucs/ritmo/notas en cada visita al estudio. Las tareas musicales completas se ejecutan solo cuando se piden.
- Usar un único mapa rítmico compartido; guardar notas en segundos permite aplazar/corregir la rejilla musical.
- Reutilizar inferencias válidas; limpiar caché temporal con una política distinta de los proyectos guardados.
- Evaluar aceleración con modelo exportable y GPU/driver compatibles. Instalar CUDA no convierte la Radeon en GPU NVIDIA ni acelera este paquete CPU.

Un balanceador de peticiones no crea capacidad de inferencia. En el modo local todos los procesos comparten esta máquina; varios análisis compiten por los mismos recursos. Para escala futura harían falta workers con presupuestos, cola distribuida y admisión por capacidad real, después de eliminar trabajo duplicado.

## 8. Contratos que deben ordenar la implementación

Estos contratos son **propuestos**, no interfaces ya añadidas:

- `AudioInspection`: huella, codec, clase de compresión, duración, frecuencia/canales originales, métricas de señal, tipos candidatos y sus intervalos/evidencia, versión del detector y tiempos de ejecución.
- `ChannelPlan`: una lista editable de destinos con estado de evidencia, referencia al original o necesidad de separación y cobertura del motor seleccionado. No contiene WAV ficticios.
- `SeparationResult`: manifest de señales realmente producidas, tiempos comunes, formato, advertencias y referencia al plan. Un detector no debe escribir este resultado.
- `MusicDocument`: contrato canónico existente; recibe las notas de fuentes reales con un mapa temporal compartido y procedencia. No se usa como sustituto del informe de inspección.
- `JobMetrics`: carga de modelos, decodificación, inferencia, escritura, memoria, cancelación y errores, separados por operación.

Cada job debe fijar versión y opciones antes de comenzar. Sus cambios invalidan solo etapas dependientes: editar una nota no vuelve a separar audio; cambiar el volumen no vuelve a clasificar instrumentos; pedir PDF no vuelve a transcribir. La identificación puede recomendar un flujo, pero no debe activar toda la cadena de manera implícita.

## 9. Archivos que sustentan esta revisión

| Responsabilidad | Código |
| --- | --- |
| Arranque de procesos | [scripts/start-local.mjs](../scripts/start-local.mjs) |
| Acceso y proxy | [app/api/local/[...segments]/route.ts](../app/api/local/[...segments]/route.ts), [auth-guard.ts](../lib/security/auth-guard.ts) |
| Cola y pipeline actual | [services/local/server.ts](../services/local/server.ts) |
| Canal Python | [services/local/python.ts](../services/local/python.ts), [local_engine.py](../services/separator/local_engine.py) |
| Separación y ritmo | [separate.py](../services/separator/separate.py), [metadata.py](../services/separator/metadata.py), [rhythm.py](../services/separator/rhythm.py) |
| Worker de notas/clasificación | [server.ts](../lib/audio/transcription/server.ts), [transcribe-audio.ts](../workers/transcribe-audio.ts), [inference.ts](../lib/audio/transcription/inference.ts) |
| Notas finales por canal | [stems.ts](../lib/audio/transcription/stems.ts) |
| Contratos y notación | [types.ts](../lib/music/types.ts), [score-layout.ts](../lib/music/score-layout.ts), [musicxml.ts](../lib/music/musicxml.ts) |
| Renderizado y tablatura | [ScoreViewer.tsx](../components/scores/ScoreViewer.tsx), [TablatureViewer.tsx](../components/scores/TablatureViewer.tsx) |
| Auditoría MusicXML | [notation.py](../services/separator/notation.py) |
| Persistencia por propietario | [ownership.ts](../lib/audio/local/ownership.ts) |
| Medición del caso real | [PERFORMANCE-AUDIT-2026-10-12.md](PERFORMANCE-AUDIT-2026-10-12.md) |

Referencias primarias para límites de modelos: [YAMNet](https://www.tensorflow.org/hub/tutorials/yamnet), [Demucs](https://github.com/facebookresearch/demucs), [Basic Pitch](https://github.com/spotify/basic-pitch), [Beat This!](https://github.com/CPJKU/beat_this). Las afirmaciones de conexión y secuencia proceden del código local, no de esas páginas.
