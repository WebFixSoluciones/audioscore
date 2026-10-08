# Verificación de transcripción y canales — 8 de octubre de 2026

El sistema ya implementa transcripción musical automática, MusicXML y visualización de partituras. El problema pendiente es obtener audio aislado y atribuir notas a instrumentos concretos en una mezcla. No equivale a la ausencia de un traductor audio→MIDI.

## Lo que existe actualmente

| Etapa | Implementación | Límite actual |
| --- | --- | --- |
| Identificación | YAMNet, categorías aprendidas de AudioSet; `lib/audio/transcription/instruments.ts` | Candidatos con activaciones, no identificaciones confirmadas ni prueba de hardware analógico/digital. |
| Audio→notas polifónicas | Basic Pitch, `lib/audio/transcription/inference.ts` | Se aplica a la mezcla; no asigna sus notas a instrumentos individuales. En este recorrido se ejecuta antes de YAMNet. |
| Documento musical/MIDI | `lib/audio/transcription/document.ts` y `lib/music/midi-writer.ts` | Todas las notas de la transcripción integrada se agrupan en una fuente «Audio transcrito». |
| Ritmo y escritura | `lib/music/score-layout.ts` y `lib/music/musicxml.ts` | Cuantización, acordes, voces, silencios, compases, armadura, ligaduras y piano con dos pentagramas; tempo y 4/4 estimados requieren revisión. |
| Partitura en pantalla | OpenSheetMusicDisplay, `components/scores/ScoreViewer.tsx` | Antes el análisis dejaba abierta la vista de piano roll. Se corregió para abrir la partitura cuando hay notas. |
| Render/exportación | MusicXML, MIDI y Verovio para SVG/PDF en servidor | Un XML válido y dibujable no certifica que las notas sean musicalmente correctas. |
| Separación | Adaptador `SEPARATION_PROVIDER_URL`, `lib/audio/adapters.ts` | No hay motor de separación configurado; una etiqueta YAMNet no genera un WAV aislado. |
| Procesamiento cloud | Recorrido de jobs en `lib/jobs/process-project.ts` | No hay worker de audio externo configurado. El motor integrado transcribe el original incluso si se obtuvieran stems; falta conectar el análisis de cada stem y unir sus eventos por fuente. |

Backend actual: Next.js/Node.js con TypeScript. Inferencia local en navegador mediante TensorFlow.js/WASM y un worker; ejecución Node disponible fuera de Vercel. No se usan Python, music21, Omnizart ni Klangio actualmente. Los adaptadores genéricos existentes no son una integración con la API comercial de Klangio.

La transcripción en navegador admite hasta 50 MB y 15 minutos por archivo. No hay garantía de transcribir correctamente cualquier mezcla musical; la percusión, los efectos y los timbres sintéticos requieren tratamiento y evaluación específicos. En la configuración de producción se verificó que no existen `SEPARATION_PROVIDER_URL`, `TRANSCRIPTION_PROVIDER_URL` ni `WORKER_URL`.

## Comprobación con «Faded»

Se cargó el resultado guardado del análisis anterior de «Alan Walker - Faded - Piano Tutorial.mp3» y se regeneraron MusicXML y SVG con el código actual. No se volvió a ejecutar la inferencia ni se usó el PDF original para modificar las notas.

- 2.062 eventos en una única fuente musical.
- MusicXML regenerado de 460.646 bytes; 2.370 elementos de pitch escritos, incluyendo notas repetidas por ligaduras/división rítmica, y dos pentagramas.
- SVG renderizado por Verovio de 556.122 bytes.
- El clasificador guardó candidatos «Piano eléctrico», «Arpa», «Guitarra acústica», «Rasgueo» y «Vibráfono». Esta lista no demuestra que todos estén presentes: incluye hipótesis que requieren validación.

Esto demuestra que existe salida de partitura. No demuestra una transcripción exacta de toda la canción ni la separación por instrumentos.

## Cambios de interfaz

- Instrumentos candidatos visibles en el panel lateral, sin crear notas ficticias ni copiar la mezcla como si fuera un stem.
- Canales candidatos marcados «Separación pendiente · sin notas individuales».
- Apertura automática de la partitura tras una transcripción con eventos.
- Una pista vacía muestra «Esta pista no tiene notas» y permite elegir otra pista o la partitura global; no muestra una partitura de silencios como si fuera un resultado transcrito.

La pista «Batería» de la captura del usuario está marcada «Pista manual». Su nombre puede elegirse desde el editor; no constituye evidencia de que el modelo haya identificado o transcrito batería.

Las filas horizontales del piano roll son alturas musicales (C5, C6, etc.), no canales de instrumento. Cada instrumento debe tener su pista en el panel lateral y su propio conjunto de eventos; al seleccionar la pista se mostrarían sus notas en ese mismo registro.

## Qué falta para partituras y stems por instrumento

1. Ejecutar un separador real y guardar cada archivo aislado con su identidad, duración y referencia temporal al original. Un separador de voces/batería/bajo/otros no equivale a aislar cualquier instrumento o sintetizador.
2. Revisar los instrumentos de cada stem y elegir la transcripción adecuada: notas tonales polifónicas para piano/guitarra, y un modelo de eventos de percusión para batería. Basic Pitch no sustituye al transcriptor de batería.
3. Transcribir cada stem; asignar sus eventos a su propia fuente; conservar un tempo, compás y eje temporal comunes. No duplicar las notas de la mezcla en todos los canales.
4. Generar un MusicXML con una parte por fuente y permitir revisar/corregir; activar solo, volumen y exportación de stem únicamente para archivos reales.
5. Medir precisión de pitch, ataques, duración, asignación de instrumento y calidad de notación con audios y referencias conocidas. Ver una partitura en pantalla no basta para validar la transcripción.

No hace falta añadir music21 solo para disponer de MusicXML: la implementación existente ya produce ese formato. Omnizart o una API especializada son alternativas de motor que requieren integración y evaluación, no soluciones automáticas por instalarlas.

Fuentes primarias: [Basic Pitch](https://github.com/spotify/basic-pitch) (polifonía y mejor resultado con un instrumento a la vez), [Omnizart](https://github.com/Music-and-Culture-Technology-Lab/omnizart), [Demucs](https://github.com/facebookresearch/demucs), [OSMD](https://opensheetmusicdisplay.org/).
