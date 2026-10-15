# Revisión de AudioScore v0.03

Fecha: **14 de octubre de 2026**, America/Guayaquil.

**Dictamen:** la versión incorpora correcciones reales, pero todavía presenta defectos que alteran audio, metrónomo y exportación MIDI. Varias capacidades anunciadas en la publicación están representadas en los contratos y las pruebas de despacho, sin motores de procesamiento conectados que las produzcan. No consideraría validada la separación de una banda sinfónica ni el rendimiento de 4–5 minutos anunciado.

## Alcance y versión exacta

- Etiqueta solicitada: `v0.03`, commit `f5276115af4fadfbbe48737e7ec5fb149c3ee174`.
- Base de comparación: `v0.02` (`91086ba`).
- Checkout revisado: `main`, `15883d5`, con dos correcciones posteriores: `29cf65a` (inspección FFmpeg) y `15883d5` (carga universal y Audio2Beats).
- Los archivos de recorte, RoFormer, metrónomo, MIDI y despacho señalados debajo son iguales entre la etiqueta y HEAD. Las pruebas automatizadas se ejecutaron sobre HEAD; no se hizo checkout ni se modificó código de producción.
- La etiqueta es `v0.03`; `package.json` todavía declara `0.5.0`. Son identificadores diferentes que conviene unificar para identificar resultados y despliegues.

El repositorio estaba limpio al comenzar. Esta entrega añade documentación y evidencia de auditoría.

## Hallazgos

### V03-01 · P1 · El recorte dinámico elimina audio de baja intensidad

**Código:** `services/separator/slicing_engine.py:48, 96–109, 131–141`; integrado en Demucs por `services/separator/separate.py:61–65`.

El umbral se fija en 4% del RMS máximo de la canción. Los intervalos que quedan por debajo se reemplazan por ceros; no se conserva una señal residual. La decisión se aplica a la mezcla y afecta a todos sus stems. Un pasaje suave, reverberación o decaimiento puede tener contenido real y quedar fuera. Además, el fade de 100 ms se aplica incluso cuando el recorte empieza en la primera muestra del archivo: atenúa el ataque original sin compensación de pesos.

**Prueba reproducida:** señal estéreo de 24 s, primeros 5 s con amplitud 0,5 y resto con amplitud 0,005. Se usó un separador identidad, de modo que cualquier diferencia procede del recorte. Se conservó solo `[0, 5.8]` segundos. RMS del final: **0,0035355 antes, 0 después**. En los primeros 50 ms hubo error máximo de amplitud **0,4970** por el fade. No se ejecutó una red entrenada en esta prueba.

**Corrección:** distinguir silencio digital de música suave, conservar los intervalos excluidos como residual y no aplicar fade sobre bordes originales que contienen señal. Verificar reconstrucción de muestras con decaimientos y pasajes pianissimo antes de activar el recorte por defecto.

**Rendimiento:** con una señal continua de 24 s, el separador recibió los 24 s completos. El código hace bypass del slicing cuando la cobertura activa es alta. Es una optimización de silencios; no demuestra pasar una canción continua de 78 a 4–5 minutos. Esa cifra no tiene un benchmark adjunto a la publicación revisada.

### V03-02 · P1 · El metrónomo vuelve a programar el mismo pulso

**Código:** `components/editor/MusicEditor.tsx:164–167`; `lib/audio/metronome.ts:108–118, 132–142`.

Cada actualización del tiempo de reproducción llama a `seek()`. Este método reinicia `nextBeatIndex`, aunque ya se hubieran programado clics dentro de la ventana anticipada de 120 ms. La siguiente iteración los programa otra vez. El transporte actualiza el tiempo durante la reproducción normal, por lo que no es un caso limitado a arrastrar el cursor.

**Prueba reproducida:** a 120 BPM, avanzar el reloj por 0,38; 0,40; 0,42; 0,44 y 0,46 s produjo **cinco osciladores programados para el mismo pulso de 0,50 s**. La prueba usa un AudioContext controlado y los métodos reales del scheduler. Puede escucharse un clic más fuerte o distorsionado y aumenta trabajo de audio innecesario.

**Corrección:** separar progreso del reloj y salto explícito; conservar la posición ya programada. Al buscar, pausar o repetir región, cancelar también los osciladores pendientes. La grilla debe considerar el origen musical y no asumir que el primer downbeat ocurre siempre en cero.

### V03-03 · P1 · Los puertos MIDI A–D no se escriben en el archivo

**Código nuevo:** `lib/audio/transcription/stems.ts:66, 86–87`. **Integración ausente:** `lib/music/midi-writer.ts:32–66`.

Se guarda un atributo `port` en el documento y se repiten canales cada 16 pistas, pero el escritor no genera eventos de puerto MIDI. En consecuencia, A/1 y B/1 se exportan al mismo canal, con posibles cambios de programa cruzados. Además, la décima pista tonal recibe canal 10, reservado para batería en reproducción General MIDI; no se excluye de la asignación tonal.

**Prueba reproducida:** 17 stems tonales transcritos con programas diferentes. En memoria: pista 1=A/1 y pista 17=B/1. El archivo exportado contiene **cero eventos `portPrefix`**; ambas pistas usan el mismo canal. La pista tonal 10 usa canal 10.

**Corrección:** implementar puertos reales de exportación y reservar canales de percusión por puerto, o limitar explícitamente el formato a la capacidad implementada. Comprobar puertos, programas, canales y notas al reimportar. Aumentar los límites de Zod a 64 no implementa por sí mismo 64 destinos MIDI independientes.

### V03-04 · P1 · El ensamble sobrescribe los archivos de RoFormer

**Código:** `services/separator/bs_roformer_engine.py:235–241`. Problema heredado del recorrido de ensamble y todavía presente en v0.03.

Ambos motores escriben `vocals.wav`, `drums.wav`, `bass.wav` y `other.wav` en el mismo directorio. Demucs se ejecuta después y sobrescribe esos archivos. Se conserva el manifest de RoFormer, de modo que los IDs declaran un motor distinto del audio al que apuntan. El costo de la primera inferencia no aporta sus señales finales.

**Prueba reproducida:** motores controlados que escriben valores distintos, ejecutando la función real de ensamble. El manifest conserva `bs_roformer-vocals`, pero el archivo contiene el valor escrito por Demucs.

**Corrección:** salidas separadas por motor y un paso de combinación explícito con fuentes, ganancia y residual coherentes. También hay que evitar contar piano/guitarra dos veces dentro de «otros» y como pistas independientes.

### V03-05 · P2 · La llamada al slicing de RoFormer tiene un contrato incompatible

**Código:** `services/separator/bs_roformer_engine.py:141–150`; `services/separator/slicing_engine.py:85–91`.

Se pasan los argumentos `separator_fn` y `stem_names`, pero la función acepta `separate_fn` y no tiene parámetro `stem_names`. Además, el callback de RoFormer recibe un argumento mientras el slicer lo llama con audio y frecuencia. La llamada real reproduce:

```text
apply_dynamic_slicing() got an unexpected keyword argument 'separator_fn'
```

El `except` oculta la integración fallida y vuelve a ejecutar overlap-add completo. Por tanto, el recorte anunciado para RoFormer no está funcionando.

**Corrección:** unificar firma y callback y probar el adaptador completo con una entrada de más de 20 s. No basta con probar `apply_dynamic_slicing()` por separado.

### V03-06 · P1 · La API sigue examinando solo el comienzo al decidir si omitir separación

**Código:** `services/local/server.ts:113`; `lib/audio/iatpe/engine.ts:43–74`.

Existe una nueva rama de muestreo de introducción y cuerpo central, pero se habilita solo si no se recibe `maxDurationSeconds`. La API siempre pasa `maxDurationSeconds: 30`, por lo que esa rama no se ejecuta en el flujo principal. YAMNet distribuye sus ventanas dentro del audio decodificado, que sigue siendo los primeros 30 segundos; no conoce el centro ni el final de la canción.

Una introducción de piano puede terminar en bypass de separación para una mezcla cuya instrumentación cambia después. La corrección es parcial respecto al fallo detectado el 13 de octubre: mejoró el reparto de ventanas, pero no la cobertura efectiva del archivo desde la API.

**Corrección:** separar presupuesto de muestras y cobertura temporal; definir una lista explícita de intervalos distribuidos conservando sus tiempos originales. No declarar solista a toda la pista a partir de una muestra incompleta.

### V03-07 · P1 · El plan sinfónico y SATB no se convierte en las fuentes anunciadas

**Código:** `lib/audio/iatpe/channel-dispatcher.ts`, `services/separator/hierarchical_subseparator.py:187–204`, `lib/audio/transcription/stems.ts:23`.

El despachador crea destinos de maderas, instrumentos sinfónicos y voces SATB, pero el ejecutor jerárquico solo resuelve algunos filtros de batería y de «otros». No implementa el padre `vocals`; tampoco produce maderas o Sound FX desde sus planes. La función de separar voces por altura solo aparece como definición y en una prueba; no se invoca en el pipeline de transcripción.

**Prueba reproducida:** con archivos `vocals.wav` y `other.wav` existentes, solicitar coro, maderas y FX devolvió **una lista vacía** de subfuentes. Las pruebas de despacho verifican que se crean etiquetas en el plan, no que se generen sus audios/notas.

Las subfuentes de cuerdas/metales que sí existen se obtienen mediante filtros de frecuencia con confianza fija de 0,85, no con un modelo semántico que aísle instrumentos coincidentes en frecuencia. El sonido de un piano en esa banda puede acabar etiquetado como cuerdas o metales.

**Corrección:** declarar cobertura por motor y diferenciar destinos propuestos de señales obtenidas. Las bandas filtradas deben presentarse como bandas de frecuencia. Para instrumentos o SATB se requiere un motor compatible, integración real y validación con referencias.

### V03-08 · P2 · Letras, fonemas y notación de efectos están preparados como datos, sin su procesamiento

**Código:** `lib/music/types.ts:86–89`; `lib/music/musicxml.ts:132`; `lib/audio/transcription/stems.ts:99–103, 138`.

No se encontró ejecución de WhisperX, CREPE, SPICE ni AST en los motores, dependencias o workers revisados. Se añadió un campo `lyric` y su serialización XML, pero no un proceso que reconozca letras y las alinee a notas.

Para `sound_fx`, `transcribeStems()` entra en una rama que solo añade una advertencia y no crea eventos. La asignación de cabeza cruzada está dentro de otra rama que ese stem nunca alcanza. En consecuencia, la nueva notación FX tampoco se genera automáticamente.

**Corrección:** marcar esas funciones como pendientes. Para percusión/FX hacen falta eventos reales sin altura fija; para letras, transcripción y alineamiento verificados. La ordenación por altura de un único acorde no equivale a recuperar voces SATB con continuidad temporal.

## Correcciones comprobadas respecto a la revisión anterior

| Punto anterior | Estado observado |
| --- | --- |
| Demucs presentado como RoFormer | El fallback conserva `htdemucs_6s` e informa el motor real; el caso de ensamble con pesos sigue afectado por V03-04 |
| Argumentos inexistentes en constructor RoFormer | Corregidos a `stft_*`; no se certificó compatibilidad de un checkpoint entrenado concreto |
| Ventanas RoFormer dejaban colas vacías | **Corregido en overlap-add aislado:** reconstrucción exacta con modelo identidad para 2, 8, 9, 12, 16 y 30 s. El nuevo slicing exterior tiene otro defecto, V03-01/V03-05 |
| Bajo eléctrico tratado como guitarra | La resolución prioriza nombres específicos antes de genéricos |
| Silbido+piano tratado como solista | Se incorporó comprobación de acompañamiento; no resuelve la cobertura incompleta de V03-06 |
| Confianza 75% sin candidatos | Pasa a 0 y se informa la falta de evidencia |
| WAV/ADPCM tratado como lossless por el contenedor | Se retiró esa regla; ahora se consulta codec/metadatos |
| Lector AAC/M4A | `load_audio()` decodificó correctamente un M4A/AAC de prueba: 1 s, estéreo 44,1 kHz; HEAD añade su uso en metadatos/ritmo |
| SDR ficticio en el visor | Ahora indica que no está evaluado sin fuentes de referencia |

## Procesos y capacidades reales de v0.03

| Capacidad anunciada | Qué existe realmente |
| --- | --- |
| Separación troncal | Demucs activo; RoFormer condicionado a pesos/configuración compatibles |
| Recorte dinámico CLAP/IAD | Detector RMS global; no se ejecuta CLAP ni un detector por instrumento |
| Reducción 78 min → 4–5 min | Texto del commit/cabecera; no se encontró benchmark que lo demuestre |
| 30–40 instrumentos | Catálogo/plan ampliado y límites de 64; no aislamiento automático de 30–40 fuentes |
| 64 canales Multi-Port MIDI | Campo de puerto en el documento; exportación incompleta, V03-03 |
| Metrónomo anticipado y compás:tiempo | Implementados con defecto de reprogramación, V03-02 |
| Tempo variable | Rejilla derivada del mapa y opción adaptativa existentes; no se detecta tempo en vivo mientras se reproduce el archivo |
| Voice leading / SATB | Función auxiliar de agrupar ataques por altura, sin conexión al pipeline |
| WhisperX, letras/fonemas | Campos/exportación preparados; sin modelo ni alineamiento activo |
| CREPE/SPICE y AST | No integrados |
| Cabezas cruzadas para FX | Campo y XML preparados; no se crean eventos automáticamente |

## Verificación

- `npm run typecheck`: **pasa**.
- Vitest: **49 pruebas pasan**, seis archivos: IATPE, música, stems, separación, transcripción y FFmpeg. Ejecución sobre HEAD, que incluye los dos fixes posteriores a la etiqueta.
- ESLint dirigido al alcance: **4 errores y 12 advertencias**. Errores en `google-classifier.ts` y `services/local/server.ts`; todavía no está limpio el gate de lint.
- Pruebas de auditoría con funciones reales y modelos/dispositivos controlados: pérdida de señal suave, fade inicial, cobertura overlap-add reparada, firma de slicing, sobrescritura de archivos, puertos MIDI ausentes y duplicación de clics.
- Entorno de esta sesión: Node 26.7.0; el proyecto exige Node 22.x. Repetir checks en el runtime soportado antes de publicar.

No se ejecutó un benchmark de canción completa ni una evaluación de precisión de separación/partitura con stems de referencia. Las pruebas controladas aíslan errores de integración y reconstrucción; no miden calidad de redes entrenadas. No se reinició el servicio del usuario ni se desplegaron cambios.

La evidencia numérica y los hashes del código están en [v0.03-2026-10-14-evidence.json](audits/v0.03-2026-10-14-evidence.json).

## Orden de corrección

1. Conservar muestras y pasajes suaves; corregir el slicing y comprobar reconstrucción, bordes y silencio real.
2. Reparar el scheduler del metrónomo y cancelar clics pendientes en saltos/pausa.
3. Completar o limitar la exportación MIDI por puertos; reservar percusión y probar reimportación de más de 16 fuentes.
4. Separar carpetas por motor y definir una combinación de ensamble verificable.
5. Activar cobertura temporal real en la API y distinguir planes de instrumentación de fuentes obtenidas.
6. Ajustar la publicación y la interfaz a las funciones conectadas; integrar letras/SATB/FX solo con pruebas de resultado, después de estabilizar lo anterior.
