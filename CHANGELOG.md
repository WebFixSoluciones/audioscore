# Historial de versiones

## 0.1.0 — 2026-10-06

Primera versión del proyecto AudioScore AI.

- Estudio local de audio, transcripción integrada con Basic Pitch y YAMNet, editor MIDI, partitura y exportaciones.
- Base SaaS con Firebase, planes, consumo, procesamiento asíncrono y administración; las funciones cloud requieren configuración.
- Refinamiento de piano: revisión del pulso al doble, candidatos débiles recuperables y separación estimada por registro en dos pentagramas.
- Escritura legible con figuras rítmicas, acordes, silencios, ligaduras y alteraciones acordes con la armadura.
- Vista interpretada y reproducción/MIDI con los tiempos del audio; ajuste manual de BPM sin desincronizar eventos.
- Controles de notación adaptados a pantallas pequeñas y recuperación de candidatos con deshacer.

La evaluación de Faded conserva 43 coincidencias de 48 ataques escritos en sus primeros cuatro compases y reduce detecciones adicionales sin pareja de 48 a 28. Esta comprobación no mide la exactitud de la canción completa ni de otros repertorios. No se detectan automáticamente manos, anacrusas ni repeticiones, y los resultados requieren revisión.

Los audios y las partituras personales, informes de evaluación, credenciales y archivos temporales no se incluyen en el repositorio.
