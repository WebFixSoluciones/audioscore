# AudioScore en este equipo

Dirección principal: **http://audioscore.localhost:3000/studio**. Alternativa: **http://localhost:3000/studio**. El subdominio `.localhost` apunta al equipo en navegadores compatibles; no requiere comprar dominio, editar `hosts` ni publicar el equipo en Internet.

## Inicio en Windows

Desde la carpeta del proyecto:

```powershell
npm run local:setup
npm run local
```

La preparación requiere `uv`, descarga Python 3.11 y dependencias en `.tmp/separator-venv`. Demucs y Beat This! descargan pesos oficiales la primera vez si no están en caché. El inicio ejecuta Next.js y un servicio privado de audio; ambos escuchan únicamente en loopback. Para cerrar, Ctrl+C en el terminal del iniciador. El servicio usa una credencial temporal compartida solo entre procesos. El usuario inicia sesión con Email/password de Firebase; la API comprueba sesión, correo verificado y estado activo.

## Qué está conectado

1. Iniciar sesión desde la landing con **Ingresar**. El estudio empieza con **Nuevo audio**, sin cargar análisis anteriores. Abrir audio, máximo 50 MB y 15 minutos. Pulsar **Separar y transcribir**.
2. El servicio valida y decodifica el archivo con FFmpeg. Python calcula cromas y armonía con librosa; Beat This! final0 estima pulsos y primeros tiempos. Se propone 3/4 o 4/4 solo con suficientes compases consistentes; otras métricas, anacrusa y cambios de métrica requieren revisión. Las puntuaciones son heurísticas, no probabilidades calibradas. **Opciones de análisis** permite desactivar la detección de compases o seguir variaciones de tempo por secciones de ocho pulsos.
3. Demucs `htdemucs_6s` produce hasta seis categorías alineadas: piano, guitarra, bajo, batería, voz y otros. Python mantiene el modelo cargado entre trabajos. El modo equilibrado usa una pasada y 25% de solapamiento; **Cuidadosa** usa dos y 50%, con mayor tiempo de proceso. No garantiza mayor calidad para toda mezcla. Se conserva el control de silencio y señal débil del separador existente.
4. Basic Pitch transcribe cada stem tonal con el mismo mapa de tempo; batería conserva su audio y requiere un transcriptor específico. «Otros» puede incluir varios instrumentos. **Reducir ruido para transcribir** aplica FFmpeg afftdn suave solo a la entrada de notas, preservando los WAV audibles. Está apagado inicialmente y puede suprimir notas suaves; no elimina reverberación ni chorus de forma inteligente. Los modelos de clasificación/notas se cargan desde el proyecto, sin APIs de análisis externas.
5. OSMD renderiza MusicXML en SVG; VexFlow proporciona notación y una vista de tablatura de posiciones para guitarra/bajo. La tablatura propone afinación estándar y digitaciones: no recupera la digitación original ni representa todas las voces/duraciones; para eso se consulta la partitura.
6. El panel Pulso y armonía permite desplazarse a hipótesis de acordes y primeros tiempos estimados. El metrónomo acentúa esos primeros tiempos; no garantiza su posición musical exacta. El inicio escrito se alinea a un pulso fuerte anterior al primer ataque si la métrica tiene evidencia suficiente. Las notas anteriores al primer pulso fuerte se conservan y pueden requerir una anacrusa manual.
7. Práctica genera una escucha independiente mediante el filtro Rubber Band de FFmpeg: velocidad 50–150% y transposición ±12 semitonos. Conserva el original y no reescribe la partitura. Pueden existir artefactos; no se promete transparencia total. Un FFmpeg alternativo debe incluir `rubberband`.
8. **Pistas separadas** presenta cada WAV con su onda real y controles de volumen, balance, Solo (S), Silenciar (M), escucha individual y descarga. Un transporte común coordina inicio, pausa, desplazamiento y repetición de región. Al tocar los controles se activa la mezcla separada. **Restablecer mezcla** devuelve los volúmenes al 75% y elimina solo/silencio/balance.
9. **Descargar mezcla** produce un WAV con los ajustes actuales de volumen, balance, solo y silencio. Puede usarse para crear un acompañamiento sin el instrumento que vas a tocar. **Guardar como proyecto** conserva también los ajustes de mezcla. La sincronización usa audio en streaming con corrección de deriva, sin prometer precisión de muestra para edición profesional.
10. Seleccionar una pista por su nombre o con **Pista de partitura** para ver sus notas. **Revisar compases** analiza el MusicXML con music21 y comprueba duración de los compases. **MusicXML comprimido (.mxl)** realiza esa revisión antes de descargar el contenedor estándar. La revisión comprueba estructura y no la exactitud respecto al audio. La cuantización, voces, claves, silencios y ligaduras se producen con el escritor existente; el archivo comprimido contiene la misma partitura.

## Guardado y capacidad

Audio, WAV separados, MIDI, MusicXML, documento y versiones de práctica se procesan en `.local-audio/jobs/JOB_ID/`, excluida de Git. Los resultados temporales quedan como caché de procesamiento, pero no aparecen como proyectos ni se abren automáticamente. Solo **Guardar como proyecto** añade el análisis a **Mis proyectos** del usuario; **Guardar cambios** actualiza el proyecto abierto. **Nuevo audio** limpia el estudio y la navegación a Estudio vuelve a un trabajo vacío. Un proyecto guardado se abre explícitamente desde Mis proyectos, conservando notas y mezcla. PDF/MEI se generan localmente con Verovio. No hay borrado automático de archivos: hay que gestionar y respaldar esa carpeta.

Los análisis antiguos sin propietario se conservan en disco, pero quedan ocultos y no se asignan automáticamente a otro usuario. Cada resultado, archivo y exportación exige el propietario autenticado. El navegador no puede elegir la identidad del propietario.

El motor procesa **un análisis a la vez**, admite cinco pendientes y hasta cien registros locales. Exportación y práctica esperan a que esté libre. Esto protege un equipo de desarrollo; no constituye infraestructura para 5.000 análisis simultáneos. Cancelar detiene Python o el motor de notas; una normalización breve en curso puede terminar antes de liberar la cola. Al reiniciar, los trabajos interrumpidos aparecen como fallidos y pueden volver a analizarse; los terminados se conservan.

El modo local utiliza **Firebase real** `audioscore-ca277` para Authentication y el perfil/estado/rol en Firestore. Requiere conexión para comprobar la cuenta; no se ha migrado a emuladores. Audio, análisis y catálogo de proyectos permanecen en este equipo; no utiliza Cloud Tasks, Storage ni Vercel Blob para ese flujo. No se activó facturación ni se desplegó el motor.

## Decisiones sobre las tecnologías propuestas

- Demucs ya combina espectrograma y forma de onda con una arquitectura híbrida Transformer. Añadir Spleeter no es necesario para disponer de MSS y no garantiza mejor calidad.
- No existe evidencia proporcionada de que los detalles descritos sobre Moises sean su implementación actual. No se presenta este trabajo como réplica de su modelo propietario.
- No se añaden modelos de difusión sin pesos adecuados y validación. La separación de seis categorías es experimental y no equivale a identificar/aislar cualquier instrumento. Piano puede presentar filtraciones.
- Se añade análisis armónico y Beat This! real, sin afirmar que las plantillas de acordes son una red RNN/CRF ni que detectan métricas complejas.
- AudioSep, MT3 y Omnizart no están activos: requieren pesos, entornos y evaluación separados antes de sustituir el transcriptor. La justificación y límites están en [ANALYSIS-QUALITY.md](ANALYSIS-QUALITY.md).

Referencias: [Demucs](https://github.com/facebookresearch/demucs), [OSMD](https://opensheetmusicdisplay.github.io/classdoc/), [VexFlow](https://github.com/vexflow/vexflow), [librosa beat tracking](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html), [chroma STFT](https://librosa.org/doc/0.11.0/generated/librosa.feature.chroma_stft.html), [FFmpeg Rubber Band](https://ffmpeg.org/ffmpeg-filters.html#rubberband).
