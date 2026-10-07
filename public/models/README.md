# Modelos incluidos en AudioScore AI

Estos archivos son pesos de modelos de análisis, no archivos de usuarios.

- `basic-pitch/`: modelo de transcripción polifónica incluido en `@spotify/basic-pitch` 1.0.1, de Spotify. Apache-2.0. [Código y descripción](https://github.com/spotify/basic-pitch-ts).
- `yamnet/`: YAMNet de Google, variación TensorFlow.js `tfjs`, versión 1. Apache-2.0. [Modelo oficial](https://www.kaggle.com/models/google/yamnet/tfJs/tfjs/1), [mapa oficial de clases](https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/yamnet_class_map.csv). Descarga inicial desde `https://www.kaggle.com/api/v1/models/google/yamnet/tfJs/tfjs/1/download`.
- `tfjs/`: runtime WebAssembly de TensorFlow.js, copiado desde el paquete instalado. Apache-2.0.

`npm run prepare:transcription` copia Basic Pitch y los binarios WASM desde los paquetes y compila el worker Node. No descarga audio ni envía audio a Spotify, Google o un proveedor. La inferencia local lee estos archivos desde la propia aplicación.

Basic Pitch detecta alturas y tiempos; no separa instrumentos. YAMNet estima clases de sonido en fragmentos representativos de la mezcla; no asigna cada nota a una fuente ni confirma un instrumento. Los resultados necesitan revisión, especialmente en canciones mezcladas, batería, voz, efectos y cambios de tempo. No se infiere procedencia analógica/digital.
