# Auditoría de los cambios IATPE y del muestreo de stems

Fecha: **13 de octubre de 2026**, America/Guayaquil. Revisión del código local posterior al informe de arquitectura del 12 de octubre. Git sigue en `bee20d1` (`main`, `v0.5.0`); los cambios examinados no tienen commits separados que permitan atribuir cada línea a un autor. No se modificó código de producción durante esta auditoría.

**Dictamen: hay mejoras útiles, pero la separación avanzada y la decisión automática de canales no están listas para considerarse verificadas.** El camino configurado puede ejecutar Demucs presentándolo como BS-RoFormer. El camino con checkpoint tiene un error de construcción y, detrás de él, fallos reproducidos en el ensamblado de ventanas. Las pruebas actuales no detectan estos problemas.

## Hallazgos prioritarios

### F01 · P1 · Demucs se presenta como BS-RoFormer y como ensamble

**Ubicación:** `services/separator/bs_roformer_engine.py:112–122, 164–169`; `components/audio/IatpeWorkflowViewer.tsx:164–167`.

Sin `BS_ROFORMER_CHECKPOINT`, el adaptador ejecuta `htdemucs_6s`, reemplaza `model` por `bs_roformer` y añade afirmaciones de aislamiento avanzado. `separate_ensemble()` llama una sola vez al mismo adaptador y cambia el nombre otra vez; no combina modelos ni estimaciones. En la configuración de shell y `.env.local` examinada no hay checkpoint configurado. La dependencia `bs-roformer==1.2.4` sí está instalada: instalar la arquitectura no equivale a cargar pesos entrenados.

El visor, además, muestra un SDR superior a 12,8 dB y ausencia de bleed como texto fijo. No se calcula esa métrica contra stems de referencia. Esto impide al usuario saber qué motor produjo realmente el audio o evaluar si ha mejorado.

**Corrección:** declarar capacidades y disponibilidad reales. Conservar `htdemucs_6s` y explicar el fallback; deshabilitar opciones sin pesos compatibles. Solo llamar ensamble a una combinación efectivamente ejecutada. Publicar identificador/hash del checkpoint y mediciones reales en el resultado.

### F02 · P1 · La rama real de RoFormer no puede construir su modelo

**Ubicación:** `services/separator/bs_roformer_engine.py:29–44`.

La llamada usa `linear_transformer_depth` y parámetros `spec_*` que no corresponden a la firma instalada. Invocar el constructor real produjo:

```text
TypeError: BSRoformer.__init__() got an unexpected keyword argument 'linear_transformer_depth'
```

La firma instalada utiliza `stft_n_fft`, `stft_hop_length` y `stft_win_length`. Aunque se corrigieran los argumentos, no hay todavía un contrato de configuración que garantice que dimensión, profundidad, cuatro salidas, nombres y frecuencia esperada coincidan con el checkpoint. La opción `variant` no selecciona una arquitectura Mel-Band distinta.

**Corrección:** usar la configuración exacta del checkpoint, validar pesos/configuración al arrancar y ejecutar un smoke test de inferencia antes de habilitar el motor. No basta con renombrar argumentos sin comprobar compatibilidad.

### F03 · P1 · El ensamblado de ventanas pierde muestras finales

**Ubicación:** `services/separator/bs_roformer_engine.py:87–109`.

Con calidad equilibrada se usan ventanas de 8 segundos y saltos de 6. El padding solo redondea a múltiplos del salto, sin garantizar una ventana completa para cubrir el final. El bucle omite la última ventana parcial. La ventana Hann también tiene peso cero en sus extremos; sustituir pesos cero por `1e-6` evita división por cero, pero no reconstruye audio nunca procesado.

Se ejecutó la función original con un modelo identidad controlado, que devuelve exactamente un cuarto de la entrada por cada stem. De ese modo la pérdida es atribuible al ensamblado, no a una red entrenada:

| Entrada | Resultado del ensamblado |
| --- | --- |
| 2 s | Todo el stem en silencio; ninguna ventana ejecutada |
| 8 s | Cobertura interior; primera muestra perdida y borde final atenuado |
| 9 s | Aproximadamente 1 s final en silencio |
| 12 s | Aproximadamente 4 s finales en silencio |
| 16 s | Aproximadamente 2 s finales en silencio |
| 30 s | Aproximadamente 4 s finales en silencio |

La duración del manifest sigue siendo la duración original: comprobar únicamente segundos o número de muestras no detecta que el final esté vacío. Para audio corto, los RMS nulos también pueden provocar rechazo del manifest.

**Límite de esta evidencia:** es una prueba determinista del código de ventanas. No se ejecutó un checkpoint entrenado RoFormer, porque no está configurado y su constructor falla. No demuestra que Demucs esté cortando esos finales: son ramas diferentes.

**Corrección:** padding de ambos bordes y de la última ventana, cobertura positiva de cada muestra original, normalización de overlap-add y recorte exacto al final. Probar longitudes menores, iguales y mayores que la ventana/salto; impulsos al inicio y al final, señal constante, silencio y reconstrucción por suma.

### F04 · P1 · Se decide sobre toda la canción escuchando como máximo 15 segundos

**Ubicación:** `lib/audio/iatpe/engine.ts:40–45`; `google-classifier.ts:74–81`; `services/local/server.ts:110–112, 142–162`.

La inspección decodifica los primeros 30 segundos. YAMNet toma hasta cinco ventanas consecutivas de tres segundos, desde el inicio: **su cobertura máxima es 0–15 s**. No hay muestreo del centro/final ni verificación de instrumentos que entren después. Una introducción solista puede ocasionar bypass de separación para una canción que luego incorpora una banda.

El cálculo de ventanas también usa `ceil(duración)` en lugar de `ceil(duración/3)`: en la prueba de dos segundos ejecutó dos ventanas de tres segundos; la segunda contiene solo relleno.

**Corrección:** ventanas distribuidas y/o barrido incremental con cobertura explícita. No confirmar «solo» para todo el archivo usando una muestra parcial. Devolver intervalos examinados, incertidumbre y una propuesta revisable; cubrir cambios de instrumentación antes del bypass automático.

### F05 · P1 · Una mezcla puede declararse solista y omitir separación

**Ubicación:** `lib/audio/iatpe/channel-dispatcher.ts:119–145`.

La rama de microsonidos solo exige que el candidato principal sea un microsonido y no haya bajo/batería. No exige ausencia de piano, voz, guitarra u otros candidatos. Caso reproducido con las funciones reales: `Whistling=0.85` y `Piano=0.80` devuelven un único canal de silbido con `bypass_separation`.

Los nombres desconocidos reciben automáticamente el prefijo `NUEVO /`, que también activa esta rama. Una etiqueta no catalogada puede convertirse así en evidencia de sonido aislado.

**Corrección:** agrupar clases relacionadas conservando el tipo de etiqueta; excluir técnicas de ejecución del conteo y exigir evidencia temporal de ausencia de acompañamiento. Introducir un resultado «incierto»; el prefijo de presentación no debe decidir si se omite un motor.

### F06 · P1 · La inferencia inicial bloquea el proceso que atiende la API

**Ubicación:** `lib/audio/iatpe/google-classifier.ts:15–58, 68–95`; `services/local/server.ts:110–112`.

El nuevo clasificador importa TensorFlow.js en el proceso del servidor, sin configurar WASM y sin Worker. En el ensayo real usó backend `cpu` de JavaScript. Para una señal sintética de dos segundos: 6.146 ms de clasificación y una pausa máxima de **5.905 ms** en un temporizador de 20 ms del mismo proceso. Una ejecución anterior tomó aproximadamente 9,9 s; no es un benchmark general ni una medición aislada de inferencia caliente.

Durante esas pausas, las rutas de estado/cancelación del mismo servidor no pueden responder oportunamente. `Promise.all` no mueve cálculo de CPU a otro hilo, y `signal` no llega al bucle de clasificación. El worker de transcripción anterior sí estaba separado y configuraba WASM.

**Corrección:** clasificador residente en Worker o proceso independiente, backend explícito, límites de memoria, cancelación entre ventanas y estados de progreso. Reutilizar el modelo sin bloquear el hilo de control.

### F07 · P1 · Los formatos comprimidos admitidos no tienen un camino de decodificación común

**Ubicación:** `services/separator/bs_roformer_engine.py:62`; `services/local/server.ts:122–130, 183`.

Quitar el WAV intermedio conserva mejor el archivo original, pero ahora se pasa ese archivo directamente a cada biblioteca. RoFormer intenta `soundfile.read()` antes incluso de decidir el fallback. Un M4A/AAC válido generado con FFmpeg produjo `soundfile.LibsndfileError: Format not recognised` con el paquete instalado. Por tanto, si ese formato llega a la separación predeterminada, esta falla antes de Demucs.

**Corrección:** una capa de decodificación FFmpeg compartida que entregue muestras a Python con frecuencia, canales y longitud explícitos, sin exigir un WAV temporal. Probar cada contenedor/codec admitido a través del recorrido completo, no solo el decodificador IATPE.

## Otros defectos de muestreo y de resultados

### F08 · P2 · El remuestreo para YAMNet introduce aliasing

**Ubicación:** `lib/audio/iatpe/google-classifier.ts:80`.

Se reduce de 22.050 Hz a 16.000 Hz tomando índices con `floor`, sin filtro antialias. Las frecuencias entre 8 y 11,025 kHz se pliegan sobre el espectro audible del clasificador. Reproducción matemática del mismo algoritmo: una senoide de 10 kHz a 22.050 Hz aparece con pico dominante a **6 kHz** tras la conversión. Esto altera información tímbrica.

**Corrección:** decodificar directamente a mono 16 kHz con remuestreo filtrado de FFmpeg para YAMNet, o utilizar un remuestreador de calidad. Mantener vistas distintas para modelos con diferentes frecuencias esperadas.

### F09 · P2 · La taxonomía transforma bajo en guitarra y sonidos desconocidos en piano

**Ubicación:** `lib/audio/iatpe/channel-dispatcher.ts:13–17, 51–54`; `services/local/server.ts:151–157`.

La búsqueda por subcadena encuentra `guitar` antes de `bass_guitar`. El caso real de función `Bass guitar=0.95` produjo `Guitarra Solo`, programa MIDI 24. También se pierde especificidad de piano/guitarra eléctricos por el orden de coincidencias.

Después, el servidor fuerza a `piano` cualquier instrumento solista fuera de cinco nombres permitidos. Un silbido, violín u otro sonido puede conservar su etiqueta visible pero recibir programa, categoría y disposición de piano en el documento. Se descarta el programa que había calculado el despachador y se marca siempre como transcribible tonalmente.

**Corrección:** tabla por identificador AudioSet exacto con jerarquía explícita y un contrato de fuente que conserve instrumento, programa, carácter tonal/percusivo y motor de notas compatible.

### F10 · P2 · Ausencia de evidencia se convierte en 75% de confianza

**Ubicación:** `lib/audio/iatpe/google-classifier.ts:97–99`; `channel-dispatcher.ts:242–248`.

Los errores del clasificador se silencian. Tanto un fallo como un archivo sin candidatos terminan en cuatro canales propuestos con `confidence=0.75` y el texto «Mezcla polifónica multi-instrumental detectada». Caso reproducido: lista de candidatos vacía → plan de voz/batería/bajo/otros con esa confianza.

Es válido ofrecer separación genérica como opción ante incertidumbre, pero no atribuirle una detección ni un porcentaje inventado. El plan, además, no gobierna las salidas del separador: se entregan las categorías del manifest, no N fuentes identificadas y aisladas de forma dinámica.

**Corrección:** estados diferentes para resultado incierto, clasificador no disponible y mezcla respaldada por evidencia; devolver la causa y permitir una decisión explícita.

### F11 · P2 · El límite de 1,5 GB no está implementado

**Ubicación:** `services/separator/bs_roformer_engine.py:62, 92–109`.

Aunque la inferencia use ventanas, se cargan el audio entero y todos los acumuladores de salida. A 15 minutos, estéreo, 48 kHz y cuatro stems, solo `output_acc` necesita **1.382.400.000 bytes**. `final_stems` crea otro bloque comparable: unos **2,57 GiB entre ambos**, antes de entrada, padding, pesos y activaciones. La cabecera promete menos de 1,5 GB sin control que lo garantice.

El decodificador IATPE sí evita WAV, pero acumula buffers y hace `Buffer.concat`; no entrega ventanas consumibles progresivamente. Actualmente su límite de 30 segundos mantiene pequeña esa parte, no la separación completa.

**Corrección:** acumulación/escritura progresiva con solapamiento retenido, o archivos mapeados; presupuesto de memoria medido y admisión por duración/frecuencia. No aumentar concurrencia antes de resolverlo.

### F12 · P2 · El formato WAV se clasifica automáticamente como sin pérdida

**Ubicación:** `lib/audio/iatpe/stream-decoder.ts:35–39`.

Se combina codec, contenedor y `lossless` con OR. Un WAV con ADPCM, que es compresión con pérdida, devolvió `codec: dvi_adpcm`, `container: wave`, `isLossless: true` en la prueba real. El contenedor no determina la compresión.

**Corrección:** usar codec y metadatos fiables; distinguir PCM sin compresión, compresión sin pérdida, con pérdida y desconocido.

### F13 · P2 · Práctica no acepta los nuevos canales solistas

**Ubicación:** `components/audio/PracticePanel.tsx:73`; `services/local/server.ts:903–916`.

La UI elimina únicamente el prefijo `demucs-`; un canal nuevo `solo-piano` se envía con ese nombre. La API de práctica solo acepta `original`, `piano`, `guitar`, `bass`, `drums`, `vocals`, `other`, por lo que rechaza la solicitud. Para un bypass tampoco existe `separated/piano.wav`.

**Corrección:** resolver el archivo por sourceId del manifest/result del propietario y permitir que una fuente solista referencie el original. Evitar reconstruir rutas a partir de nombres de instrumentos.

### F14 · P2 · El visor anuncia procesos y métricas que no ejecuta

**Ubicación:** `components/audio/IatpeWorkflowViewer.tsx:125–135, 160–181`.

Muestra Gemini Audio Multimodal, SDR fijo, ensamble y microservicios paralelos especializados de percusión. El servidor no habilita Gemini en la llamada IATPE; incluso al habilitarlo, el código le envía texto con candidatos, no audio. `transcribeStems()` sigue siendo serial y omite notas de batería. Los estados de la gráfica se deducen de umbrales de porcentaje que tampoco coinciden con las etapas del servidor.

**Corrección:** generar el visor desde eventos y capacidades reales del job; mostrar «no medido» cuando corresponda. No usar textos decorativos como telemetría.

## Observaciones adicionales sobre sincronización y calidad

- `transcribeStems.ts:69–74` amplía de 50 a 200 ms la tolerancia de duración y sobrescribe el metadato. Eso no realinea muestras ni resuelve padding/delay del codec. Conviene validar número de frames, frecuencia y offsets explícitos, con pruebas de impulsos entre original y stems. No se midió una deriva temporal de stems Demucs reales en esta auditoría.
- La rama RoFormer usa directamente la frecuencia nativa del archivo sin validarla contra la configuración de entrenamiento. Un checkpoint debe declarar su frecuencia esperada; variar `chunk_len` con la frecuencia del archivo no adapta el modelo.
- Su ganancia fija de 0,98 no evita clipping si el modelo produce picos mayores que 1/0,98. El camino Demucs calcula una ganancia común a partir del pico real. Hace falta conservar balance sin saturar al escribir PCM16.
- En el fallback de Demucs, un fallo de remuestreo con librosa se ignora mediante `except: pass` (`separate.py:61–67`); esa rama debe fallar explícitamente antes de inferir a una frecuencia incompatible.
- El perfil espectral reporta picos, no fundamentales validadas ni un número de instrumentos. `dynamicRangeDb` usa un suelo derivado de RMS: en condiciones habituales equivale a crest factor más 60 dB, no a una medida real del ruido de fondo. No debe utilizarse para afirmar aislamiento o cantidad de fuentes.

## Qué sí mejoró

- Se añadió una fase IATPE antes de la separación, con módulos y contratos explícitos.
- El flujo local conserva el archivo de entrada y ya no genera `original.wav` como paso obligatorio inicial.
- Se eliminó la transcripción Basic Pitch de toda la mezcla previa a la transcripción de los stems, reduciendo un cálculo redundante.
- YAMNet tiene caché de modelo en el proceso y se incorporaron tiempos de subetapas de inspección. Esos tiempos todavía no se publican íntegramente en `LocalResult`.
- Se adaptaron rutas/MIME y la exportación de mezcla para resolver archivos originales o separados.

Estos avances no verifican aún precisión de separación, clasificación ni partituras.

## Pruebas y alcance de la verificación

| Comprobación | Resultado |
| --- | --- |
| TypeScript (`npm run typecheck`) | Pasa |
| IATPE, contrato de separación y stems | 3 archivos, **22 pruebas pasan** |
| ESLint dirigido a los archivos revisados | **5 errores**, 11 advertencias TypeScript; el archivo Python no corresponde a ESLint |
| Constructor BS-RoFormer instalado | Falla por argumento no admitido |
| Overlap-add con modelo identidad | Reproduce stems mudos/cortes finales, tabla F03 |
| YAMNet real con señal sintética | Backend CPU; pausa del hilo de control de ~5,9 s en el ensayo descrito |
| Casos de despacho controlados | Reproduce solo incorrecto, bajo→guitarra y confianza sin evidencia |
| Remuestreo por índices | Reproduce alias 10 kHz→6 kHz |
| M4A/AAC real de prueba | FFmpeg lo genera; `soundfile.read` no lo reconoce |
| WAV/ADPCM real de prueba | Clasificado incorrectamente como sin pérdida |

Las pruebas existentes usan sobre todo esquemas y entradas sintéticas. El test integrado IATPE no exige una clasificación acústica correcta; el test RoFormer valida un manifest simulado, no carga el modelo. Por eso pueden pasar mientras falla el recorrido real.

La verificación se ejecutó con Node **26.7.0** disponible en esta sesión, aunque `package.json` declara Node 22.x; antes de publicar se deben repetir checks en el runtime soportado. Python: bs-roformer 1.2.4, torch 2.6.0+cpu, soundfile 0.13.1. No se reinició el servicio del usuario ni se lanzó separación completa de una canción para esta auditoría.

Los datos y hashes de los archivos revisados están en [stems-2026-10-13-evidence.json](audits/stems-2026-10-13-evidence.json). Si los archivos cambian después, las ubicaciones y el dictamen deben revisarse contra esa nueva versión.

## Orden recomendado de corrección

1. **Veracidad del motor:** declarar Demucs cuando se use, retirar métricas ficticias y bloquear RoFormer/ensamble hasta disponer de pesos/configuración y una inferencia comprobada.
2. **Integridad del audio:** reparar cobertura de ventanas/bordes y usar un decodificador/remuestreador común con contratos de frecuencia/canales/longitud. Validar AAC, FLAC, PCM, MP3 y distintas frecuencias.
3. **Decisión de canales:** evidencia distribuida a lo largo del archivo, estado incierto, catálogo por IDs y bypass solo cuando sea justificable. Conectar realmente el plan con las capacidades del separador.
4. **Recursos:** mover YAMNet a worker residente con cancelación, eliminar aliasing y medir memoria máxima. Mantener una tarea pesada por equipo mientras se valida.
5. **Integración y regresiones:** práctica de solistas, metadatos honestos, lint limpio y pruebas extremo a extremo con referencias conocidas. Después comparar tiempo, pérdida de muestras y precisión musical frente al estado anterior.

No incorporaría otro modelo pesado antes de resolver los puntos 1–4: hoy los defectos principales están en contratos, muestreo, ensamblado y coordinación.
