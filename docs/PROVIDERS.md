# Contratos de los adaptadores

La transcripción base ya está integrada: Basic Pitch y YAMNet se ejecutan dentro del sistema, sin estos endpoints. El navegador procesa el audio local y el worker Node utiliza los mismos modelos para proyectos cloud. Límite del motor integrado: 15 minutos por análisis. La clasificación de instrumentos describe sonidos probables de la mezcla y no crea stems ni asigna cada nota a un instrumento.

Los contratos siguientes permiten motores adicionales opcionales y separación de fuentes. Los endpoints se llaman desde Node, vía HTTPS, sin redirects, con `Authorization: Bearer AUDIO_PROVIDER_API_KEY` si se configura. Timeout por llamada: 120 segundos. Para un proveedor que funciona por polling, implementa el polling dentro de un adaptador compatible con este contrato o adapta `lib/audio/adapters.ts` con idempotencia y tiempos acotados. No se simulan respuestas.

## Separación — `SEPARATION_PROVIDER_URL`

Entrada JSON:

```json
{
  "audioUrl": "URL firmada temporal",
  "outputPrefix": "temporary/UID/PROJECT/stems/",
  "maxSources": 12
}
```

Salida:

```json
{
  "sources": [
    {
      "id": "source-id",
      "storagePath": "temporary/UID/PROJECT/stems/source-id.wav",
      "confidence": 0.82,
      "label": "Fuente tonal"
    }
  ],
  "warnings": ["La fuente puede contener contaminación de otros instrumentos."]
}
```

El servicio debe escribir archivos WAV reales en el bucket temporal del mismo proyecto con una cuenta de servicio restringida al prefijo. No envíes credenciales de GCS en el payload. El worker comprueba propiedad, tamaño, metadatos, silencio y decodificación de cada stem. No se aceptan URLs arbitrarias ni paths de otro usuario.

Si no se configura separación o el plan no la permite, se transcribe el original y se señala expresamente que no se generaron stems aislados.

## Transcripción — `TRANSCRIPTION_PROVIDER_URL`

Entrada: URL firmada del audio normalizado, `title`, `sources` conocidas, `maxSources`, `ppq: 128` y `evidenceRequired: true`. En reprocesamiento regional se envía audio recortado; el motor debe conservar IDs de fuentes del análisis original. El timing de respuesta es relativo a la región. No se reemplazan notas que cruzan los bordes.

Salida: `MusicDocument`, definido en `lib/music/types.ts`. Todos los campos obligatorios, Zod estricto en tipos y límites, tempo inicial en segundo cero, ticks compatibles con PPQ128, duración consistente con el archivo, IDs únicos y notas dentro de la duración.

- `provenance`: `transcription`.
- `evidence`: `detected`, `inferred`, `estimated` o `unknown`; nunca `human` para una detección automática.
- `analogOrDigital`: `unknown`.
- Fuentes y eventos tienen confianza entre 0 y 1.
- `storagePath` solo puede apuntar a uno de los stems realmente producidos y validados por el adaptador de separación.
- Una detección no concluyente usa advertencias y `unknown`, no instrumentos o notas fabricados.
- Notas de batería usan tipo `drum` y canal 10 al exportar MIDI.
- Chords pueden expresarse con `pitches` o como notas simultáneas.

El backend valida las relaciones, los límites de fuentes, el timing y la duración antes de guardar. Gemini no modifica este documento: solo marca IDs existentes como ambiguos y añade advertencias.

## Capacidades que requieren ampliar el contrato

Jobs de proveedor de más de dos minutos, callbacks autenticados, detección avanzada de compás, score engraving con tresillos explícitos, pitch bend continuo, transposición instrumental y notación de batería especializada. No deben representarse como implementadas por instalar una dependencia.
