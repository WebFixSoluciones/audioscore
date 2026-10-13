# Plan de Implementación: Motor de Procesador Integrado de Tecnologías de Audio (IATPE)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el **Integrated Audio Technology Processor Engine (IATPE)** como el control principal de análisis previo de audio: soporte universal de formatos sin renderizado intermedio a WAV, extracción de micro-sonidos y espectro tonal, clasificación con IA de Google (YAMNet AudioSet y Gemini), y despacho dinámico de canales (1 canal directo para instrumentos solistas con bypass de Demucs, o $N$ canales para ensambles).

**Architecture:** Módulos desacoplados en `lib/audio/iatpe/` que ejecutan un pipeline en streaming de memoria (zero-disk intermediate WAV):
1. `stream-decoder.ts`: Decodificación en pipes de memoria para audio comprimido (lossy/lossless) y sin compresión.
2. `spectral-engine.ts`: Extracción de micro-sonidos, envolventes de onsets, picos frecuenciales y transitorios sutiles.
3. `google-classifier.ts`: Identificación de fuentes tímbricas con Google YAMNet (87 clases musicales) y soporte semántico Google Gemini.
4. `channel-dispatcher.ts`: Matriz de decisión que genera el plan de despacho de canales (Solo vs Ensamble).
5. `engine.ts`: Fachada IATPE que orquesta el análisis y entrega `IatpeAnalysisResult`.
6. Integración en `services/local/server.ts`: Reemplazo del paso de preparación para usar IATPE y omitir separación en pistas solistas.

**Tech Stack:** Node.js 22, TypeScript, FFmpeg streaming pipes (`f32le`), `music-metadata`, `@tensorflow/tfjs`, YAMNet (AudioSet), `@google/genai` (Gemini), Zod, Vitest.

---

## Estructura de Archivos

```text
lib/audio/iatpe/
├── types.ts                  # Contratos Zod e interfaces (IatpeResult, ChannelPlan, SpectralProfile)
├── stream-decoder.ts         # Decodificación en memoria por streaming de FFmpeg (sin original.wav)
├── spectral-engine.ts        # Extracción de micro-sonidos, STFT y frecuencias fundamentales
├── google-classifier.ts      # Clasificador YAMNet AudioSet de Google + razonador Gemini
├── channel-dispatcher.ts     # Lógica de despacho dinámico: 1 canal (solo) vs N canales (mezcla)
└── engine.ts                 # Orquestador principal de IATPE

services/local/
└── server.ts                 # Integración de IATPE en el servidor local (elimina transcode a WAV)

tests/
└── iatpe.test.ts             # Tests unitarios y de integración de IATPE
```

---

## Tareas de Implementación

### Tarea 1: Contratos y Tipos de Dominio de IATPE (`lib/audio/iatpe/types.ts`)

**Files:**
- Create: `lib/audio/iatpe/types.ts`
- Test: `tests/iatpe.test.ts`

- [ ] **Paso 1: Escribir el test que valida los esquemas Zod de IATPE**
  - Crear `tests/iatpe.test.ts` con pruebas para `iatpeAnalysisResultSchema`, `channelPlanSchema` y `spectralProfileSchema`.
- [ ] **Paso 2: Ejecutar el test para comprobar que falla**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: FAIL ("Cannot find module '@/lib/audio/iatpe/types'").
- [ ] **Paso 3: Implementar `lib/audio/iatpe/types.ts`**
  - Definir esquemas para:
    - Formato de entrada: `codec`, `container`, `isLossless`, `durationSeconds`, `channels`, `sampleRate`.
    - Perfil espectral: `rms`, `dynamicRangeDb`, `spectralCentroid`, `subtleEventsCount`, `primaryFrequencies`.
    - Identificación Google AI: `candidates` (etiquetas AudioSet, activación, confianza temporal).
    - Despacho de canales: `mode` (`solo` | `ensemble`), `isSolo`, `channelCount`, `channels` (`id`, `label`, `instrument`, `sourceAction`).
- [ ] **Paso 4: Ejecutar el test para verificar que pasa**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: PASS.

---

### Tarea 2: Decodificador en Memoria sin Renderizado a WAV (`lib/audio/iatpe/stream-decoder.ts`)

**Files:**
- Create: `lib/audio/iatpe/stream-decoder.ts`
- Modify: `tests/iatpe.test.ts`

- [ ] **Paso 1: Escribir test para decodificación en memoria**
  - Probar lectura de audio fixture sin crear archivos `.wav` temporales en disco.
  - Verificar que genera `Float32Array` con el sample rate solicitado (ej. 16000 Hz para YAMNet, 22050 Hz para transcripción, 44100 Hz para espectro).
- [ ] **Paso 2: Ejecutar test y verificar fallo**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: FAIL ("streamAudioToFloat32 is not defined").
- [ ] **Paso 3: Implementar `streamAudioToFloat32` y `probeAudioFormat`**
  - Utilizar `music-metadata` para inspección de códec (soporta MP3, FLAC, ALAC, AAC, WAV, OGG, AIFF).
  - Utilizar `spawn(ffmpeg, [...])` con salida a `pipe:1` en formato `f32le` mono/estéreo.
  - Recoger buffers en memoria hasta el límite de duración solicitado sin tocar el disco.
- [ ] **Paso 4: Ejecutar test y verificar que pasa**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: PASS.

---

### Tarea 3: Motor de Extracción Espectral y Detección de Micro-Sonidos (`lib/audio/iatpe/spectral-engine.ts`)

**Files:**
- Create: `lib/audio/iatpe/spectral-engine.ts`
- Modify: `tests/iatpe.test.ts`

- [ ] **Paso 1: Escribir test para análisis espectral**
  - Verificar cálculo de RMS, rango dinámico, picos frecuenciales y onsets de mínima energía sobre una señal sinusoidal de prueba con armónicos.
- [ ] **Paso 2: Ejecutar test y verificar fallo**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: FAIL ("analyzeSpectralProfile is not defined").
- [ ] **Paso 3: Implementar `analyzeSpectralProfile`**
  - Algoritmo de ventanas STFT con ventana Hamming/Hann.
  - Detección de picos de energía frecuencial ($f_0$ y armónicos principales).
  - Mapeo de frecuencias a notas musicales estimadas ($f \rightarrow \text{MIDI pitch} = 69 + 12 \log_2(f / 440)$).
  - Umbral adaptable de detección de transitorios de micro-sonido para registrar incluso notas tenues o ataques sutiles.
- [ ] **Paso 4: Ejecutar test y verificar que pasa**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: PASS.

---

### Tarea 5: Despachador Dinámico de Canales (`lib/audio/iatpe/channel-dispatcher.ts`)

**Files:**
- Create: `lib/audio/iatpe/channel-dispatcher.ts`
- Modify: `tests/iatpe.test.ts`

- [ ] **Paso 1: Escribir test de decisión de canales**
  - Caso A: Audio con solo piano detectado $\rightarrow$ debe devolver `mode: 'solo'`, `isSolo: true`, `channelCount: 1`, canal único con `bypassSeparation: true`.
  - Caso B: Audio con mezcla de piano, batería y bajo $\rightarrow$ debe devolver `mode: 'ensemble'`, `isSolo: false`, `channelCount: 3` (o según stems).
- [ ] **Paso 2: Ejecutar test y verificar fallo**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: FAIL ("dispatchChannels is not defined").
- [ ] **Paso 3: Implementar `dispatchChannels`**
  - Lógica de decisión basada en márgenes de activación temporal, consistencia tímbrica y número de clases activas.
  - Generación de los canales con etiquetas en español, identificadores unificados y especificación de acción (`bypass_separation` vs `demucs_stem`).
- [ ] **Paso 4: Ejecutar test y verificar que pasa**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: PASS.

---

### Tarea 4: Clasificador Acústico con IA de Google YAMNet / Gemini (`lib/audio/iatpe/google-classifier.ts`)

**Files:**
- Create: `lib/audio/iatpe/google-classifier.ts`
- Modify: `tests/iatpe.test.ts`

- [ ] **Paso 1: Escribir test para clasificación instrumental**
  - Probar asignación de clases instrumentales sobre activaciones de YAMNet y fallback determinista.
- [ ] **Paso 2: Ejecutar test y verificar fallo**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: FAIL ("classifyAudioWithGoogleAI is not defined").
- [ ] **Paso 3: Implementar `classifyAudioWithGoogleAI`**
  - Carga optimizada del grafo YAMNet de Google (`public/models/yamnet/model.json`).
  - Barrido rápido sobre el audio (muestreado a 16 kHz en memoria).
  - Filtrado con las 87 categorías musicales compatibles de AudioSet (piano, guitarra, bajo, batería, voz, vientos, cuerdas, sintetizadores).
  - Integración opcional con Google GenAI (`@google/genai`) para enriquecimiento semántico si `GEMINI_API_KEY` está configurada.
- [ ] **Paso 4: Ejecutar test y verificar que pasa**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: PASS.

---

### Tarea 6: Orquestador Principal de IATPE (`lib/audio/iatpe/engine.ts`)

**Files:**
- Create: `lib/audio/iatpe/engine.ts`
- Modify: `tests/iatpe.test.ts`

- [ ] **Paso 1: Escribir test de integración del motor IATPE**
  - Verificar que `runIatpeAnalysis(filePath)` ejecuta el probe, streaming, perfil espectral, clasificación y despacho de forma coordinada y devuelve un `IatpeAnalysisResult` válido.
- [ ] **Paso 2: Ejecutar test y verificar fallo**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: FAIL ("runIatpeAnalysis is not defined").
- [ ] **Paso 3: Implementar `runIatpeAnalysis`**
  - Unificar las etapas 1 a 5 en un flujo asíncrono con telemetría de tiempos y eventos.
  - Asegurar liberación de memoria de tensores y buffers intermedios (`tf.engine().startScope() / endScope()`).
- [ ] **Paso 4: Ejecutar test y verificar que pasa**
  - Run: `npx vitest run tests/iatpe.test.ts`
  - Expected: PASS.

---

### Tarea 7: Integración de IATPE en `services/local/server.ts`

**Files:**
- Modify: `services/local/server.ts`
- Test: `tests/local-audio.test.ts`

- [ ] **Paso 1: Modificar `services/local/server.ts`**
  - Eliminar la transcodificación obligatoria a `original.wav` (`transcodeAudio`).
  - Ejecutar `runIatpeAnalysis(path)` como la primera fase del procesamiento (`A1`).
  - Si `iatpe.channelPlan.isSolo === true`:
    - Omitir la llamada a Demucs (`A3`).
    - Asignar la pista original al canal identificado (ej. `solo-piano`).
    - Despachar directamente a la transcripción de notas.
    - **Ahorro de ~8:35 minutos en pistas solistas**.
  - Si `iatpe.channelPlan.isSolo === false`:
    - Ejecutar Demucs solo para las fuentes requeridas.
  - Eliminar la transcripción redundante de la mezcla global (`E1`), utilizando los metadatos de IATPE y librosa.
- [ ] **Paso 2: Ejecutar suite de pruebas completa**
  - Run: `npm test`
  - Expected: Todos los tests pasan sin regresiones.
- [ ] **Paso 3: Verificar con `npm run typecheck`**
  - Run: `npm run typecheck`
  - Expected: Salida limpia sin errores de tipos TypeScript.

---

## Criterios de Aceptación y Verificación

1. **Zero-Disk WAV:** Ningún archivo `original.wav` es generado en disco. El audio original (MP3, FLAC, M4A, etc.) se preserva intacto y se decodifica en memoria mediante streams.
2. **Identificación IATPE:** El sistema detecta y documenta el espectro acústico, rango dinámico, picos frecuenciales y clases de AudioSet con Google YAMNet.
3. **Canal Único en Solistas:** Una pista de piano solo o guitarra sola produce exactamente **1 canal**, omite Demucs por completo y procesa las notas en una fracción del tiempo anterior.
4. **Respeto a Infraestructura:** Sin sobrecarga de RAM por tensores acumulados y sin procesos en vano.
