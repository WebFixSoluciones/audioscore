# AudioScore: auditoría del rendimiento del análisis local

Fecha: 12 de octubre de 2026, zona America/Guayaquil. Auditoría del código y del trabajo real «Alan Walker - Faded - Piano Tutorial». Las mejoras de este informe son propuestas; no se realizaron cambios en el motor durante la medición.

## Resultado del trabajo observado

El procesamiento terminó al 100%, sin error de ejecución. Una pista de aproximadamente 4 min 58 s tardó **19 min 12 s**. Produjo cuatro canales y 3.181 eventos musicales:

| Canal | Eventos |
| --- | ---: |
| Batería | 0 |
| Otros sonidos | 1.685 |
| Guitarra | 90 |
| Piano | 1.406 |

La separación produce categorías estimadas; esos nombres no confirman que haya cuatro instrumentos físicos. En una grabación de piano pueden aparecer armónicos y filtraciones en Otros o Guitarra. Batería conserva audio, pero el motor actual no transcribe percusión. El número de eventos no demuestra precisión musical.

### Tiempos obtenidos

Se reconstruyeron con createdAt, los cambios de etapa observados y las fechas de escritura. No hay todavía temporizadores internos que separen carga de modelo, inferencia y cada cálculo de armonía.

| Hito, hora local | Tiempo del bloque |
| --- | ---: |
| Creación del trabajo: 20:03:39 | — |
| WAV normalizado escrito: 20:03:48 | Aproximadamente 9 s desde la creación |
| Inicio de separación: 20:07:32 | 3 min 53 s de preparación y metadatos acumulados |
| Separación terminada: 20:16:07 | **8 min 35 s** de separación y escritura asociada |
| Finalización: 20:22:51 | **6 min 44 s** de análisis de mezcla, canales y generación final |

Con duración normalizada de aproximadamente 298,4 s, el factor de tiempo real fue **RTF total ≈ 3,86** y **RTF de separación ≈ 1,73**. RTF = segundos de procesamiento / segundos de audio. Son mediciones de este caso y de esta carga del equipo, no un benchmark general del modelo.

## Recursos y configuración comprobados

| Recurso | Estado |
| --- | --- |
| Procesador | Intel Core i5-4590 a 3,30 GHz, cuatro núcleos y cuatro procesadores lógicos |
| Memoria instalada | 16 GB |
| Memoria libre observada | Aproximadamente 1–2,4 GiB durante la auditoría |
| GPU | Radeon RX 560 e Intel HD Graphics 4600 |
| PyTorch | 2.6.0+cpu, sin CUDA ni HIP en esta instalación |
| Demucs | htdemucs_6s, CPU, dos hilos de PyTorch, num_workers=0 |
| Opciones del trabajo | Equilibrada, reducción de ruido apagada, tempo estable, detección de compases activada |
| Transcripción | TensorFlow.js/WASM en Node, un hilo, worker nuevo por llamada |

El proceso Python acumuló tiempo de CPU durante la espera; había actividad de cálculo. Llegó a aproximadamente 1,4 GiB de memoria residente y 2,9 GiB de memoria privada comprometida. Esto, junto con la poca RAM libre, acredita presión de memoria. **La paginación es una hipótesis plausible, no una tasa medida:** los contadores WMI de rendimiento consultados no estaban disponibles.

La GPU instalada no interviene. Además del paquete CPU, el worker local pasa explícitamente device="cpu". Cambiar una variable de entorno a cuda no habilitaría aceleración en este recorrido ni convertiría la Radeon en un dispositivo CUDA.

## Recorrido actual completo

1. **Navegador.** Decodifica el audio para medir duración/características y mostrar la onda. El MP3 se copia al servicio local después de verificar la sesión de Firebase. La aplicación entrega un identificador y procesa en una cola serial; no mantiene la petición de subida abierta durante la inferencia.
2. **Preparación con FFmpeg.** Valida el archivo, lo convierte a WAV estéreo de 44,1 kHz/PCM16 y calcula una onda reducida de hasta 2.000 puntos. Para transcripción se preparará después PCM mono Float32 de 22,05 kHz.
3. **Metadatos Python.** librosa carga el audio completo, calcula HPSS, obtiene una envolvente de ataques y ejecuta beat tracking. Con detección de compases activada, Beat This! final0 vuelve a estimar pulsos y primeros tiempos. Después se calcula chroma STFT, tonalidad y acordes mediante plantillas. Todo este bloque termina antes de iniciar Demucs.
4. **Separación Python.** HTDemucs estima seis categorías: batería, bajo, otros, voz, guitarra y piano. Divide la inferencia en ventanas del tamaño del checkpoint y las mezcla con solapamiento. El modo actual usa una pasada y 25% de solapamiento. Se omiten canales casi silenciosos y se evalúa qué canales tienen señal suficiente para transcribir.
5. **Análisis de la mezcla completa.** Se ejecutan Basic Pitch y YAMNet sobre el original. Basic Pitch calcula notas polifónicas; YAMNet procesa ventanas de tres segundos para hipótesis de instrumentos. También se vuelve a estimar tempo. La identificación usa un modelo local entrenado con AudioSet; no busca ni descarga grabaciones similares de ese repositorio.
6. **Transcripción de los canales en serie.** Por cada canal tonal elegible se vuelve a preparar PCM, iniciar un worker, cargar Basic Pitch y YAMNet, inferir notas, clasificar instrumentos y estimar tempo. Batería y canales débiles se omiten. El orden procede del manifest del separador: en el trabajo observado Otros y Guitarra preceden a Piano.
7. **Documento musical.** Se conservan tiempos en segundos y se transforman a ticks con un mapa común de tempo. El escritor distribuye voces/registros, aplica la vista de cuantización legible, agrega silencios y ligaduras y genera MIDI/MusicXML.
8. **Interfaz y exportación.** Solo cuando todo termina se obtiene result.json y se muestran los canales. OSMD dibuja partituras. VexFlow dibuja posiciones sugeridas de tablatura para guitarra/bajo. music21 revisa estructura al solicitar revisión o exportación MXL; no está dentro de la primera separación/transcripción.

El núcleo es mixto: Python realiza separación y análisis de ritmo/armonía; **las notas todavía se obtienen con JavaScript/WASM**. AudioSep, MT3 y Omnizart no están ejecutándose.

## Problemas concretos de la implementación

### 1. Trabajo global de notas que se vuelve a hacer

El orquestador transcribe el original y posteriormente reemplaza los eventos finales por las notas de los stems. Conserva metadatos del análisis global, pero no usa sus notas como las notas finales. Hace falta separar las operaciones de clasificar instrumentos, medir ritmo y transcribir notas.

Con N canales tonales se realizan 1 + N transcripciones completas. Para tres canales elegibles, pasar de cuatro a tres elimina una ejecución de Basic Pitch. Bajo costos iguales, eso representa 25% del trabajo de esa parte, **no 25% garantizado de reducción del tiempo total**. Los metadatos de respaldo deben seguir calculándose a partir de la señal o de las notas de los canales.

### 2. Recarga de modelos por canal

Python ya conserva Demucs y Beat This! entre trabajos, salvo cancelación/reinicio. El worker de notas hace lo contrario: inicia WASM, lee pesos, construye los modelos y los destruye por cada archivo. También repite YAMNet sobre canales cuyo destino ya se conoce como categoría estimada. La clasificación adicional debe reservarse para canales ambiguos o refinamientos que la necesiten.

### 3. Ritmo pesado como requisito previo para escuchar stems

HPSS, pulso, primeros tiempos, chroma y acordes se ejecutan antes de separar. Demucs no necesita conocer BPM, compás o acordes para producir WAV. Beat This! sustituye los pulsos de librosa cuando obtiene evidencia suficiente, después de que se haya pagado el cálculo inicial de ambos.

La solución es un único proveedor principal de pulso con fallback bajo demanda, y aplazar análisis armónico detallado. Una rejilla para notas y compases debe seguir siendo coherente; los tiempos en segundos permiten construir o corregir esa rejilla después.

### 4. Resultados retenidos hasta el final

Los WAV estaban disponibles alrededor de las 20:16, pero la interfaz todavía esperaba las transcripciones. El cliente devuelve el resultado musical únicamente cuando job.status === completed. Así se agrega a la espera de escuchar los stems todo el bloque posterior de notas.

Publicar audio_ready y notes_ready por canal reducirá el tiempo hasta un resultado útil. No acelera por sí solo los cálculos, pero permite escuchar, descargar y trabajar antes. Los archivos deben publicarse cuando estén completos, conservando el control de propietario.

### 5. Barra de progreso sin avance interno

10%, 18%, 45% y los porcentajes por canal son marcas fijas de etapa. Demucs se ejecuta con progress=False y el puente Python entrega un resultado al finalizar. El 10% no significa haber consumido 10% del tiempo total. Existen eventos internos de notas, pero el orquestador local no conecta sus callbacks a la persistencia del progreso del trabajo.

Hace falta mostrar segundos/bloques procesados, canal actual, tiempo transcurrido y último heartbeat. Una ETA solo debe calcularse con suficientes bloques medidos; al cargar un modelo no puede extrapolarse como si estuviera haciendo inferencia.

### 6. Memoria de canción completa aunque la inferencia tenga ventanas

El MP3 de este caso ocupa unos 4 MB, pero el WAV normalizado ocupa unos 52,6 MB. Una representación estéreo Float32 ocupa aproximadamente 105 MB. La salida de seis fuentes Float32 ocupa unos **632 MB**, antes de añadir copias de normalización, máscaras, buffers de solapamiento, tensores intermedios y modelos.

split=True limita la inferencia de cada ventana, pero Demucs sigue acumulando la salida completa de las seis fuentes en RAM. Una implementación con acumulación de bloques en disco/memmap puede reducir el pico de memoria. Debe conservar normalización común, contexto, alineación y overlap-add: cortar archivos independientes puede causar discontinuidades y notas duplicadas en los bordes.

### 7. Parámetros conservadores y secuencialidad

Dos hilos de PyTorch y cero workers de fragmentos protegen memoria, pero limitan el aprovechamiento del CPU de cuatro núcleos. Debe medirse 1/2/3/4 hilos con un único trabajo activo. Paralelizar todos los modelos o canales con apenas 1 GiB libre puede empeorar tiempos y estabilidad.

El modo Cuidadosa añade dos pasadas y 50% de solapamiento. Aproximadamente, el trabajo de ventanas es proporcional a shifts/(1-overlap): para pistas largas puede aproximarse a **tres veces el trabajo de separación** del modo equilibrado. En este trabajo ya estaba seleccionado Equilibrada; Cuidadosa no explica su demora.

### 8. Prioridad de canal y especificidad del audio

Para una grabación confirmada de piano solo, ejecutar siempre separación de seis categorías puede ser innecesario y generar canales con filtraciones. Hace falta un modo explícito de instrumento aislado y un modo de mezcla completa. El nombre del archivo o una única activación del clasificador no bastan para decidir que hay piano solo.

También se debería transcribir primero el instrumento elegido por el usuario o el canal principal y publicar su partitura, antes de procesar residuales menos útiles. La tablatura no corresponde a todos los instrumentos: la vista actual la ofrece para guitarra/bajo, con afinación estándar y posiciones sugeridas. Piano usa pentagramas.

## Plan de optimización propuesto

| Orden | Cambio | Beneficio y condición |
| --- | --- | --- |
| 1 | Instrumentar tiempos por operación, carga/inferencia separadas y memoria pico | Permite atribuir los costos y medir regresiones; no promete aceleración |
| 2 | Publicar stems al terminar la separación y notas por canal | Evita esperar toda la transcripción para escuchar o trabajar |
| 3 | Separar clasificación, ritmo y AMT; eliminar AMT global redundante | Reduce trabajo manteniendo metadatos/fallbacks |
| 4 | Worker de notas persistente, cola acotada y modelos reutilizados | Evita recargas; medir RAM al conservarlos |
| 5 | Clasificación global una vez y clasificación por stem bajo demanda | Reduce YAMNet repetido sin quitar los refinamientos necesarios |
| 6 | Pulso con proveedor principal/fallback; acordes detallados diferidos | Reduce el bloqueo anterior a la separación |
| 7 | Modo de instrumento aislado y prioridad del canal elegido | Evita separación innecesaria y entrega antes la partitura importante |
| 8 | Caché por usuario, contenido, modelo, parámetros y etapa | Reutiliza separación/notas al repetir un archivo; invalidación por opciones y versión |
| 9 | Acumulación de audio por bloques, presupuesto de memoria y ajuste de hilos | Reduce presión de RAM; validar bordes y conservar balance |
| 10 | Evaluar Basic Pitch con ONNX Runtime nativo en Python | Alternativa al WASM de un hilo; comparar tiempos y exactitud antes de sustituirlo |
| 11 | Evaluar aceleración GPU compatible | Requiere runtime/modelo/operaciones compatibles; no es una variable de entorno |

Beat This! publica small0, de unos 8,1 MB, además de final0, de unos 78 MB. El modelo pequeño es un candidato para un perfil rápido, con validación de primeros tiempos y métricas. Un tamaño menor no demuestra por sí solo una reducción proporcional de tiempo ni igual precisión.

Basic Pitch publica una serialización ONNX. Se propone evaluarla primero en CPU con una sesión persistente y mantener posprocesamiento, umbrales y tiempos equivalentes. En Windows, ONNX Runtime dispone de DirectML/WinML para hardware compatible; la Radeon exige comprobar controladores, operaciones, conversiones y precisión. Demucs/PyTorch no se acelera automáticamente por instalar el runtime de ONNX.

Reducir el solapamiento de Demucs a 10% puede disminuir trabajo de ventanas, con posible deterioro de bordes. Seleccionar --two-stems no evita la separación completa del modelo y no constituye una solución de velocidad. Sustituir el modelo por uno de cuatro fuentes también cambia las categorías y no entrega automáticamente piano y guitarra separados.

## Arquitectura que conviene alcanzar

Subida y autenticación → preparación → clasificación ligera/elección de modo → separación si corresponde → publicación de stems → pulso común → transcripción prioritaria y publicación de primera partitura → demás canales → análisis armónico detallado/revisión/exportación.

Cada canal debe tener estado propio: pending, audio_ready, notes_running, notes_ready o failed. Una sola cola de inferencia pesada sigue siendo apropiada para este equipo. Next.js puede continuar como interfaz y puerta autenticada; Python y un runtime nativo resuelven la inferencia. FastAPI/Celery/Redis aportarían distribución y gestión de trabajos al usar varios workers/servidores, pero no reducen los cálculos de una canción ni la convierten en inferencia GPU.

## Validación de las mejoras

Primero medir fragmentos de 15 y 60 segundos, y luego la canción completa. Separar arranque frío de motor caliente. Registrar tiempo hasta stems, tiempo hasta primera partitura, tiempo total, RTF por fase, número de cargas de modelos y pico de memoria. Comparar bajo condiciones equivalentes de CPU, hilos y RAM disponible.

Validar también alineación de WAV, contaminación entre canales, alturas/ataques/duraciones frente a una referencia anotada, notas adicionales y compases. Las pruebas recientes de Faded con 12 segundos verificaban funcionamiento; no establecían el rendimiento del recorrido nuevo sobre esta pista completa de casi cinco minutos. La mejora se acepta cuando reduce latencia medida manteniendo una calidad musical comparable.

## Evidencias del código y fuentes

- Orquestación y orden de etapas: [server.ts](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/services/local/server.ts:95>).
- Metadatos completos y proveedores de pulso: [metadata.py](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/services/separator/metadata.py:6>).
- CPU, pasadas, solapamiento y WAV: [separate.py](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/services/separator/separate.py:29>).
- Worker nuevo por transcripción: [server.ts de transcripción](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/lib/audio/transcription/server.ts:83>).
- WASM de un hilo y cargas de modelos: [transcribe-audio.ts](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/workers/transcribe-audio.ts:32>).
- Notas y clasificación de cada archivo: [inference.ts](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/lib/audio/transcription/inference.ts:22>).
- Espera del resultado completo: [client.ts](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/lib/audio/local/client.ts:102>).
- [Demucs oficial: limitaciones, shifts, overlap y two-stems](https://github.com/facebookresearch/demucs).
- [Beat This! oficial: modelos, CPU y primeros tiempos](https://github.com/CPJKU/beat_this).
- [Basic Pitch oficial: runtimes y reutilización del modelo](https://github.com/spotify/basic-pitch).
- [ONNX Runtime: DirectML y compatibilidad](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html).
