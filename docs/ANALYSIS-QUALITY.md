# Revisión de las propuestas de audio y ritmo

## Integración local actual

Next.js autentica al usuario y copia el audio al servicio privado. Este responde con un identificador y ejecuta una cola serial en segundo plano. Python mantiene modelos cargados: librosa analiza armonía, Beat This! final0 estima pulsos fuertes y Demucs separa categorías. Basic Pitch obtiene notas por canal tonal. El documento conserva tiempos interpretados; una vista legible cuantiza a semicorcheas, asigna voces/registros y escribe MusicXML. OSMD renderiza ese XML y VexFlow muestra tablatura. music21 revisa los compases escritos antes de descargar MXL.

### Qué se incorporó

| Propuesta                    | Resultado                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTDemucs avanzado            | Ya se usa la arquitectura híbrida Transformer `htdemucs_6s`. Se añadió Cuidadosa: dos pasadas y 50% de solapamiento. No es un reentrenamiento con Slakh.                           |
| Limpiar antes de transcribir | Reducción suave de ruido opcional con FFmpeg, aplicada solo a la entrada de notas. No se presenta como des-reverberación neuronal.                                                 |
| Tempo dinámico               | Seguimiento opcional y mapa compartido entre todos los canales; secciones de ocho pulsos atenúan la fluctuación de frames. Se mantiene rejilla estable cuando falta evidencia.     |
| Beat/downbeat                | Beat This! final0, PyTorch CPU, pesos oficiales. Navegación por primeros tiempos y metrónomo acentuado.                                                                            |
| Compás automático            | Inferencia conservadora de 3/4 o 4/4 contando pulsos entre primeros tiempos; se abstiene con pocos datos, cambios o agrupaciones ambiguas. No detecta todos los cambios de compás. |
| music21                      | Auditoría independiente de estructura, partes y duración de compases; no vuelve a cuantizar ni reemplaza silenciosamente las notas.                                                |
| MXL                          | Contenedor MusicXML 4 con MIME sin comprimir primero y META-INF/container.xml. Conserva notas, claves, voces y ligaduras del escritor MusicXML.                                    |

### Lo que la propuesta exagera

Demucs declara que el canal de piano del modelo de seis fuentes es experimental y puede contener artefactos. Sus categorías no distinguen automáticamente guitarra acústica de eléctrica ni sintetizador de piano. AudioSep admite consultas de texto y puede ser útil para extracción especializada, pero un prompt más largo no garantiza aislar un timbre que el clasificador no ha reconocido con certeza.

MT3 produce eventos de transcripción multitrack, no una partitura lista con todas sus decisiones editoriales. Su implementación oficial usa T5X y no es un producto de Google con soporte. Omnizart ofrece aplicaciones separadas para instrumentos, percusión, acordes, voz y pulsos; su tutorial indica que los instrumentos se exportan a MIDI y que el módulo beat recibe MIDI. Ninguno documenta precisión total ni inmunidad a notas falsas.

El ejemplo recibido de librosa omite que `beat_track` devuelve frames por defecto: hay que convertirlos a segundos o indicar `units="time"`. La extracción y escritura del proyecto utilizan conversiones explícitas.

El Madmom publicado en PyPI tiene restricciones antiguas de Python/NumPy. Beat This! funciona con PyTorch ya instalado en este Python 3.11 y no requiere el postprocesador DBN/Madmom. El equipo tiene 16 GB de RAM y Radeon RX 560; el entorno es PyTorch CPU, no CUDA.

### Siguiente evaluación para los motores de notas

AudioSep, MT3 y Omnizart deben probarse en entornos aislados con pesos oficiales, empezando por fragmentos con MIDI/MusicXML de referencia. Medir F1 de alturas/ataques/duraciones, notas adicionales, separación por instrumento y tiempo/memoria. Comparar el resultado con Basic Pitch y escuchar contaminación de canales. Instalar cuatro modelos sin esa comparación no demuestra una mejora y puede introducir dependencias incompatibles.

No se activan modelos adicionales ni se prometen instrumentos aislados que no estén disponibles. La transcripción de batería sigue pendiente de un motor de percusión. music21 y la compresión MXL no reparan alturas incorrectas producidas por un transcriptor.

## Cola e infraestructura

La cola actual ya responde antes de procesar y serializa tareas para limitar memoria. Para un único equipo no requiere Redis, Celery ni otro servidor HTTP. No ejecutar los modelos dentro de una petición. FastAPI puede sustituir el puente privado cuando se despliegue un servicio Python; Celery/Redis aportarían persistencia de cola, reintentos y varios workers, pero cada worker debe reservar RAM/GPU. `async` y un balanceador no multiplican la capacidad de inferencia. No se ha desplegado esta infraestructura ni utilizado Vercel Blob.

## Fuentes oficiales

- [Demucs: modelos y limitaciones de piano](https://github.com/facebookresearch/demucs).
- [AudioSep: inferencia mediante consultas de texto](https://github.com/Audio-AGI/AudioSep).
- [MT3: implementación T5X](https://github.com/magenta/mt3).
- [Omnizart: aplicaciones y formatos de entrada/salida](https://music-and-culture-technology-lab.github.io/omnizart-doc/tutorial.html).
- [Beat This!: instalación, CPU, modelos y downbeats](https://github.com/CPJKU/beat_this).
- [librosa beat_track: unidades, tempo variable y resultados](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html).
- [music21: conversión y cuantización](https://music21.org/music21docs/moduleReference/moduleConverter.html).
- [MusicXML 4: contenedor MXL](https://www.w3.org/2021/06/musicxml40/tutorial/compressed-mxl-files/).
