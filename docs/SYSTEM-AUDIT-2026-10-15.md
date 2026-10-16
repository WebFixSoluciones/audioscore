# AudioScore — Auditoría técnica del sistema actual

**Fecha:** 15 de octubre de 2026, America/Guayaquil.  
**Código auditado:** main, 3c489e0feae8d4dfaf14fd796fc838bf85ca310f.  
**Comparación:** 15883d5, base de los informes del 14 de octubre.  
**GitHub:** la referencia main remota consultada coincide con el checkout. Árbol limpio al iniciar.

## Dictamen

**Hay mejoras reales en el procesamiento Python, pero las entregas 1–4 no están terminadas de extremo a extremo.** El nuevo código conserva mejor las muestras y separa carpetas de ensamble. La aplicación continúa utilizando el preanálisis inicial, los trabajos sin resultados parciales y el worker de notas que se crea por cada canal.

Se incorporaron también regresiones: RoFormer devuelve un nombre de modelo que el servidor rechaza; puede ejecutar una arquitectura sin entrenamiento; y el subseparador espera un campo distinto al producido por el planificador. Estos defectos pueden pasar TypeScript y las pruebas existentes porque se producen entre contratos o fuera del alcance de esas pruebas.

El recorrido Demucs estándar tiene más cobertura funcional que las opciones RoFormer/ensamble. **No se certifica esta revisión como una versión estable para todas las opciones de análisis.**

Esta es una auditoría: no se modificó código de aplicación, no se desplegó, no se cambió Firebase ni se inició el localhost. Se prepararon artefactos de prueba y compilación locales.

## 1. Cambios recibidos y alcance

El último commit modifica **9 archivos de producción**, con aproximadamente 1.504 líneas añadidas y 416 retiradas. El commit anterior incorpora los informes de auditoría. La etiqueta v0.03 permanece en f527611; package.json continúa en **0.5.0**. Es necesario alinear la identificación de releases, paquete y contratos de motores.

Revisión realizada:

- Código de ingesta, clasificación, despacho, separación, transcripción y generación musical.
- Comparación de invocaciones reales con las nuevas funciones exportadas.
- Pruebas controladas de reconstrucción, manifiestos, eventos, caché, MIDI y metrónomo.
- Suite existente, TypeScript, lint, dependencias Python, auditoría npm y compilación.
- Reglas publicadas Firestore, metadatos de la base, registro web Firebase y configuración de acceso.
- Estado de puertos y agregados de almacenamiento local, sin publicar datos de usuarios ni títulos de sus audios.

No se ejecutó una canción completa con modelos entrenados durante esta auditoría. Los resultados numéricos de diagnóstico no equivalen a un benchmark de precisión o velocidad musical.

## 2. Comparación con el informe anterior

| Punto | Estado actual | Evidencia y alcance |
| --- | --- | --- |
| Pérdida de audio suave en slicing | Mejorado | Caso identidad de 24 s, estéreo en oposición de fase y cola tenue: error máximo 0; la señal no inferida se conserva en other |
| Atenuación en los extremos del slicer | Mejorado | Nuevo núcleo con ganancia unitaria y contexto; falta batería extensa de señales/estados de modelos |
| Saturación al subdividir stems | Mejorado, no completamente resuelto | Señal cuadrada de amplitud 0,98: error pos-IO 0 en llamada directa; existe un caso de error sin rollback |
| Sobrescritura entre motores de ensamble | Corregido en prueba controlada | Carpetas roformer/ y demucs/ separadas; el WAV vocal final conserva el motor elegido |
| Unión musical coherente del ensamble | Pendiente | Seleccionar fuentes de dos estimaciones no garantiza que su suma corresponda a la mezcla |
| Actividad distribuida en el archivo | No conectada | Nuevos helpers presentes; el servidor sigue pasando maxDurationSeconds=30 a la función anterior |
| Resultados audibles incrementales | No conectados | Python emite eventos; el puente activo los trata como diagnóstico y la UI espera completed |
| Telemetría de separación | Parcial | Python genera campos; Zod los elimina y LocalResult no los conserva |
| Worker AMT persistente | No implementado como worker real | Nueva clase de caché de callbacks; camino activo sigue creando y terminando Worker por archivo |
| Compatibilidad RoFormer ↔ Node | Regresión | Python devuelve bs_roformer_v2; enum Node acepta bs_roformer |
| Seguridad frente a modelos sin pesos | Regresión | Se retiró el fallback seguro y se permite inferencia con inicialización sin entrenamiento |
| Subextracción jerárquica planificada | Regresión | Node emite targetInstruments; Python lee targets |
| Metrónomo / 64 destinos MIDI / FX XML | Pendientes | Se reprodujeron los problemas anteriores; estos módulos no cambiaron |

## 3. Hallazgos priorizados

P1: debe corregirse antes de habilitar/publicar la función afectada. P2: integración, integridad, rendimiento o mantenimiento que requiere corrección. La prioridad no implica que se haya demostrado un ataque.

### A15-01 · P1 · RoFormer termina su cálculo y su manifiesto es rechazado

**Condición:** seleccionar el motor RoFormer en el estudio.

[RoFormer][rof] devuelve model = bs_roformer_v2, o el equivalente con variante. [El esquema Node][sep] admite bs_roformer y mel_band_roformer, sin sufijo v2. El [servidor local][srv] valida el resultado antes de iniciar la transcripción.

**Reproducción:** se ejecutó el adaptador Python real con un modelo controlado de cuatro salidas. Su manifiesto fue rechazado por separationManifestSchema en el campo model. Es un fallo de contrato independiente de la calidad de los pesos.

**Consecuencia:** puede consumirse toda la inferencia y terminar el trabajo en failed, sin entregar partitura. Demucs estándar no está afectado por este nombre.

**Corrección:** identificador canónico estable de motor; versión separada; esquema compartido o prueba de contrato con salidas reales de cada adaptador.

### A15-02 · P1 · Se permite inferencia RoFormer sin entrenamiento y se aceptan pesos incompletos

**Condición:** RoFormer/ensamble sin checkpoint válido, o con checkpoint incompatible.

get_roformer_model() construye la arquitectura aunque no exista un archivo de pesos. Posteriormente separate_bs_roformer() la ejecuta y publica fuentes con confianza fija 0,50. Si hay pesos, utiliza strict=False e ignora las claves faltantes/sobrantes; marca el checkpoint como cargado y asigna 0,92.

**Reproducción:** el cargador real aceptó la ausencia de pesos. Un cargador controlado que devolvió parámetros faltantes también quedó marcado como cargado. No se evaluó la salida sonora de una red aleatoria: la prueba demuestra la falta de barrera de validación.

**Consecuencia:** inferencia costosa sin separación musical aprendida, o modelo parcialmente inicializado presentado como operativo. El error A15-01 oculta parte de sus resultados actualmente, pero no elimina el gasto ni protege el ensamble.

**Corrección:** fallar antes de inferir o usar Demucs explícitamente; comprobar arquitectura, configuración, sample rate, orden de stems, checksum y compatibilidad completa de pesos. La confianza no se obtiene de la existencia de un archivo.

### A15-03 · P1 · La subseparación recibe un plan que ya no entiende

**Condición:** IATPE solicita subfuentes de drums u other.

[El despachador][dispatch] y su esquema generan targetInstruments. [El ejecutor Python][sub] ahora busca targets. La lista queda vacía sin emitir error.

**Reproducción:** un other.wav válido con el plan real {parentStem: other, targetInstruments: [strings]} devolvió cero subfuentes. La función directa con la lista correcta sí generó la subfuente.

**Corrección:** unificar el contrato; probar el planificador conectado al ejecutor; rechazar campos desconocidos/planes sin destinatarios. Las bandas filtradas deben describirse por su método, sin presentarlas como aislamiento semántico validado.

### A15-04 · P1 · La decisión de solista sigue basada en el inicio de la canción

**Camino activo:** runIatpeAnalysis(path, {maxDurationSeconds: 30}). La rama de introducción+cuerpo de esa función requiere que no se pase dicho límite. Los nuevos buildDistributedWindowRanges() y evaluateDistributedPreanalysis() no tienen consumidores fuera de sus definiciones.

**Consecuencia:** una introducción aislada puede decidir el bypass para una canción que después incorpora otros instrumentos. Los helpers agregados no corrigen este caso en producción.

**Además:** el nuevo evaluador considera suficiente tener tres ventanas; una prueba con tres copias de los mismos seis segundos iniciales fue declarada solista para un archivo de 300 s. Al integrarlo hay que validar cobertura, tiempos, duplicación y evidencia; el número de ventanas no demuestra representatividad.

**Corrección:** decodificar ventanas distribuidas reales conservando su posición; agregar sus evidencias; mantener incertidumbre. No usar ventanas muestreadas como máscara exhaustiva para eliminar audio no inspeccionado.

### A15-05 · P2 · Los eventos, la telemetría y la UI incremental no están conectados

Python emite stem_ready en stderr. El [puente activo][bridge] solo conserva los últimos 3.000 caracteres de stderr para errores; no procesa esos eventos. El servidor entrega result cuando el estado es completed. El cliente consulta cada 1,5 s y también espera completed.

El esquema de manifiestos elimina campos no declarados: en la prueba desaparecieron telemetry y sha256. LocalJob/LocalResult no incorporan el nuevo contrato. Los archivos nuevos no convierten por sí mismos una pista escrita en un audio accesible por la consola.

**Corrección:** protocolo de eventos con lectura por líneas persistente, identificación del trabajo, persistencia de hitos, esquema completo y publicación por canal; cliente capaz de mezclar mientras siguen las notas. Conservar autenticación y propiedad para todo resultado parcial.

### A15-06 · P2 · El pool AMT no contiene ni reutiliza un worker/modelo

[La nueva clase][amt] cambia un booleano al ejecutar ensureWarm() y llama al callback inferFn proporcionado. No crea un Worker, sesión de inferencia ni modelo. Los flags skippedRedundantClassification/TempoEstimation describen opciones; no suprimen esas operaciones dentro del callback.

El camino real transcribeLocalAudio() sigue preparando PCM, creando un Worker y terminándolo. El worker carga Basic Pitch/YAMNet y los descarta al terminar.

**Prueba adicional:** dos stems de igual hash y distinto id/checkpoint devolvieron el stemId del primero, con una sola llamada al callback. La clave no incluye checkpoint ni versión de inferencia y la caché no tiene límite ni expiración.

**Corrección:** proceso persistente con protocolo de trabajos, modelos cargados una vez, límites de memoria/concurrencia y cancelación definida. Cachear resultados neutrales al usuario/id; invalidar por modelo, versión y parámetros; reasignar identidad al consumidor actual.

### A15-07 · P2 · El nuevo wrapper de separación ignora el motor pedido y pierde eventos fragmentados

runAudioSeparation(), hoy sin invocaciones en el flujo local, siempre lanza separate.py. Todo modelo distinto de htdemucs se convierte en htdemucs_6s en sus argumentos, aunque se solicite bs_roformer o iatpe_ensemble.

El parser separa cada chunk de stderr por saltos de línea, sin conservar el fragmento pendiente. Una línea JSON válida repartida entre dos chunks se pierde.

**Reproducción:** solicitud bs_roformer → proceso htdemucs_6s; evento dividido → cero callbacks. Una segunda solicitud con otra carpeta recibió el resultado cacheado sin otro proceso ni materialización de sus archivos en esa carpeta.

También faltan un timeout propio, límites de salida y la terminación de árbol que usa el puente activo en Windows. Spawn no especifica windowsHide. Un aborto de un consumidor compartido no tiene política independiente para los demás.

**Corrección:** integrar un único adaptador según capacidades reales; usar el worker persistente; framing por líneas, publicación de artefactos por trabajo/propietario, caché acotada y cancelación probada. No conectar el wrapper tal como está solo para activar las nuevas entregas.

### A15-08 · P2 · El fallo de reconstrucción deja el padre modificado

_write_and_verify_subseparation() preserva una copia del padre, escribe subfuentes y reemplaza el padre por el residual; después verifica la suma. La atenuación se ajusta con un máximo de doce iteraciones y aún puede resultar insuficiente. Si falla, se lanza excepción sin restaurar el archivo. Los llamadores capturan la excepción y continúan sin incorporar las subfuentes al manifest.

**Reproducción controlada:** candidato de signo opuesto al padre produjo error 0,118041992, activó la excepción y dejó el padre cambiado. La copia de respaldo permaneció disponible. Es un caso adversarial del helper, no una tasa de error observada sobre canciones.

**Consecuencia al activar la subseparación:** podría reproducirse solo el residual, dejando fuera las subfuentes descartadas por el error.

**Corrección:** escribir en una zona de preparación, validar y confirmar todos los archivos/manifiestos juntos; restaurar al fallar. Resolver la ganancia mediante restricciones verificadas, no asumir que doce reducciones son suficientes.

### A15-09 · P2 · El ensamble ya no sobrescribe, pero no verifica consistencia de mezcla

Se corrigieron las carpetas. La fusión selecciona voz/bajo/batería de RoFormer y otros/piano/guitarra de Demucs. Son estimaciones diferentes, con posibles ganancias y filtraciones diferentes.

**Reproducción:** dos motores controlados cuyas fuentes sumaban 0,5 cada uno produjeron una selección final que sumaba 0,65. La diferencia máxima fue 0,15. Esto demuestra que elegir fuentes no conserva por construcción la mezcla; no mide la calidad de pesos reales.

La telemetría del ensamble usa el tiempo hasta la primera escritura interna de RoFormer, aunque no copia/publica esa fuente raíz hasta después de Demucs. El primer resultado disponible puede ser mucho más tardío.

**Corrección:** sincronización, ganancia y residual explícitos; consistencia después de IO; tiempo hasta la publicación accesible al cliente, además de tiempo interno.

### A15-10 · P1 · Exportación multi-puerto MIDI todavía incompleta

Se reprodujo el caso de 17 fuentes: el documento declara A…B, pero el archivo contiene **cero eventos de puerto**. El canal se reutiliza y no se reserva el canal 10 exclusivamente para percusión. El escritor MusicXML también permite emitir midi-channel=64, fuera de 1–16.

**Estado:** pendiente anterior; no lo modificó el último commit.

**Corrección:** separar índice visual, puerto y canal local. Validar programas, percusión, notas y puertos al reimportar. Si no se completa, limitar explícitamente las exportaciones admitidas.

### A15-11 · P1 · El transporte sigue programando clics repetidos

Cada actualización del tiempo llama seek() sobre el metrónomo y reinicia el índice de pulso, incluso cuando ese pulso futuro ya fue programado. La prueba repitió **cinco clics a 0,5 s** para un único tiempo. Pausa/salto tampoco cancela todos los osciladores ya pendientes.

**Estado:** pendiente anterior. La rejilla comienza desde cero, sin recibir el origen de downbeats/anacrusa.

**Corrección:** separar avance normal del reloj de saltos explícitos; mantener identidad de eventos programados y cancelar pendientes al cambiar transporte.

### A15-12 · P2 · FX, letras y partes orquestales siguen sin completar su procesamiento

El escritor sigue generando pitch para un evento FX con cabeza cruzada; no unpitched. Los campos nuevos tienen problemas de orden MusicXML y el validador comprueba XML básico, no todo el esquema. WhisperX/CREPE/SPICE/AST/MT3 no están conectados; SATB y voice leading siguen como planificación/función auxiliar.

MusicDocument permite 64 fuentes pero **10.000 eventos totales**. La identificación entrega como máximo 20 candidatos. Esos límites tampoco acreditan la plantilla orquestal exhaustiva prometida. Falta transposición por parte para instrumentos en Sib/Fa y demás casos.

**Corrección:** completar por entregas verificables, con eventos reales, validación MusicXML e importación externa. Ampliar límites solo después de medir memoria, renderizado e inferencia.

### A15-13 · P2 · El monitor visual sigue declarando capacidades no observadas

El visor IATPE obtiene sus etapas a partir de porcentajes fijos. Describe «microservicios paralelos» y transcripción de percusión, pero el camino local procesa notas en serie y no transcribe batería.

Una confianza 0 se convierte en «Alta» por una condición booleana; una confianza de tonalidad 0 puede mostrar 80%. El motor se deduce por prefijo bs_roformer, mientras el adaptador nuevo emite ids bs-roformer; además muestra htdemucs_6s aunque se haya utilizado otro modo.

**Corrección:** mostrar datos persistidos del motor/trabajo y estado desconocido cuando falta evidencia. La topología debe proceder del recorrido ejecutado.

### A15-14 · P2 · Temporales acumulados y capacidad local finita

Se observaron **27 trabajos**, **246 archivos**, **3.543.731.022 bytes ≈ 3,30 GiB**, **cero proyectos guardados**. Los estados históricos son 18 completados, 8 fallidos y 1 cancelado; no se atribuyen estos resultados al nuevo commit.

El servidor limita a 100 registros, pero cancelar no borra los archivos ni libera el registro. No hay limpieza TTL local integrada. La limpieza cloud no cubre esta carpeta. Las copias de padres y carpetas de ensamble incrementan el almacenamiento necesario.

**Corrección:** distinguir persistencia temporal y proyecto guardado; TTL o borrado explícito seguro para temporales, cachés con referencias y presupuesto de disco. Ningún archivo fue eliminado en esta auditoría.

### A15-15 · P2 · Telemetría de memoria incompleta en Windows y mayor costo de buffers

_peak_rss_mb() devuelve 0 cuando resource no está disponible, como en este Windows. Ese 0 significa «sin medición», no ausencia de consumo. En sistemas compatibles ru_maxrss es un máximo de vida del proceso, no necesariamente del trabajo actual.

El slicing usa buffers Float64 completos por fuente y luego crea sus salidas Float32. Por tanto, puede conservar más audio a costa de mayor RAM. maxMemoryMb=1536 del contrato RoFormer no impone un límite real.

**Corrección:** medición portable por proceso/trabajo; presupuesto antes de asignar; memmap/acumulación de bloques o escritura progresiva validando contexto, mezcla y tiempos.

### A15-16 · P2 · Controles de publicación y dependencias pendientes

El lint completo termina con **6 errores y 22 advertencias**. No existe un workflow GitHub Actions dentro del repositorio. El último commit no añade pruebas de contrato que reproduzcan las nuevas integraciones.

La auditoría npm de producción señala **10 paquetes afectados**: 4 de severidad alta y 6 moderada, incluyendo cadenas transitivas de grpc-js, sprintf-js y uuid. La cantidad incluye paquetes ascendentes afectados; no son diez exploits independientes demostrados.

Los avisos de grpc-js describen condiciones de servidor/configuración específicas. No se demostró su explotación desde AudioScore. Se requiere analizar alcanzabilidad y actualizar de manera compatible; la solución automática propuesta para Firebase incluye un downgrade mayor y no debe aplicarse a ciegas. [Aviso del mantenedor sobre certificados](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j), [aviso sobre errores del servidor](https://github.com/grpc/grpc-node/security/advisories/GHSA-f596-whhp-79r4).

La configuración npm del entorno intentó inicialmente HTTP y recibió 426. Repetir con HTTPS permitió obtener el informe. No se modificó la configuración global ni se instalaron actualizaciones del proyecto.

## 4. Arquitectura real, desde el macroproceso

~~~mermaid
flowchart TD
    U["Navegador: landing, login, dashboard y estudio"] --> N["Next.js / React · puerto 3000"]
    N --> A["Firebase Auth: sesión y correo verificado"]
    N --> F["Firestore: perfil, estado, rol y planes"]
    N --> P["Proxy local: UID verificado + token privado"]
    P --> L["Servicio Node en 127.0.0.1:8765"]
    L --> Q["Cola en memoria: 1 análisis activo"]
    Q --> I["IATPE: muestra inicial, espectro, YAMNet y plan"]
    I --> R["Worker Python persistente: ritmo/armonía"]
    R --> D{"Solista o mezcla"}
    D -->|solista| O["Audio original como canal"]
    D -->|mezcla| S["Demucs / adaptador RoFormer / ensamble"]
    S --> T["WAVs, manifiesto y eventos internos"]
    T --> B["Basic Pitch + YAMNet en Worker nuevo por stem tonal"]
    O --> B
    B --> M["MusicDocument: notas, tempo, fuentes"]
    M --> X["MIDI / MusicXML / result.json"]
    X --> V["Resultado completed: ondas, mezclador y partituras"]
    L --> DISK["Disco local: originales, temporales y proyectos"]
    H["Helpers nuevos: muestreo distribuido, wrapper y caché AMT"] -. sin conexión al camino activo .-> L
~~~

Es una aplicación local con frontend Next y dos procesos de backend de audio. **No hay balanceador de carga, cola distribuida, Celery, Redis ni Kubernetes en este recorrido.** El proceso Python utiliza stdin/stdout y diagnósticos por stderr; no es un servidor FastAPI independiente.

Existe un segundo recorrido cloud basado en proyectos, Cloud Tasks, Storage, workers e integraciones por URL. Comparte módulos, pero no es la infraestructura que ejecuta el estudio local. No debe usarse como evidencia de escalabilidad ya desplegada.

## 5. Inventario de tecnologías y responsabilidad

Versiones instaladas observadas; el JSON de evidencia contiene el inventario Node completo.

| Tecnología | Versión | Uso efectivo |
| --- | --- | --- |
| Node.js | Normal: 26.7.0; validación adicional: 22.23.3 | El proyecto exige 22.x; se utilizó Node 22 aislado para la comprobación compatible |
| Next.js / React / React DOM | 16.3.8 / 19.3.0 / 19.3.0 | Rutas, proxy, interfaz, renderizado |
| TypeScript / Zod / Zustand | Declarado 6.0.3 / 4.6.5 / 5.0.15 | Tipos, validación de documentos, estado del editor/mezclador |
| Firebase web / Admin | 12.19.0 / 14.5.0 | Identidad, cookies, perfiles, administración |
| Python | 3.11.16 | Worker de separación, ritmo, armonía y auditoría de notación |
| PyTorch / torchaudio | 2.6.0+cpu / 2.6.0+cpu | Modelos y lectura/remuestreo; CUDA no disponible, HIP ausente |
| Demucs | 4.0.1 | htdemucs, htdemucs_6s; fuentes fijas estimadas |
| bs-roformer | 1.2.4 | Arquitectura BSRoformer, cuatro salidas fijadas; revisión de pesos/contrato pendiente |
| NumPy / SciPy / soundfile | 1.26.4 / 1.17.1 / 0.13.1 | Tensores, filtros SOS, lectura/escritura y verificación WAV |
| librosa / Beat This! | 0.11.0 / 1.1.0 | Ataques, cromas, acordes por plantillas, beats/downbeats |
| FFmpeg / fluent-ffmpeg | Paquete binario 5.3.0 / 2.1.3 | Inspección, PCM, ondas, reducción de ruido opcional y práctica; el paquete binario no indica la versión upstream exacta |
| Basic Pitch / TensorFlow.js / WASM | 1.0.1 / 4.22.0 / 4.22.0 | AMT tonal y clasificación YAMNet, worker con un hilo WASM |
| YAMNet / catálogo AudioSet | 521 etiquetas; catálogo musical derivado de 87 categorías | Clasificación de eventos; hasta 20 candidatos publicados. No cuenta intérpretes |
| WaveSurfer | 8.0.1 | Onda y selección temporal |
| Tone | 15.1.22 | Audición y reproducción de eventos con sintetizador triangular; no SoundFont por instrumento |
| OSMD / VexFlow | 2.2.0 / 5.0.0 | Partitura SVG y tablatura sugerida |
| Verovio / pdfkit / svg-to-pdfkit | 6.3.0 / 0.20.2 / 0.1.8 | Conversión de notación y PDF en servidor |
| music21 | 9.9.1 | Auditoría estructural solicitada; no transcriptor ni separador automático de atriles |
| MidiWriterJS / tonejs-midi | 3.2.1 / 2.0.28 | Escritura y lectura/verificación de MIDI |
| Google GenAI | 2.27.0 | Revisión semántica cloud condicionada a configuración; no sustituye la AMT |
| Google Tasks/Storage/Firestore | 7.2.1 / 8.2.0 / 9.3.1 | Código cloud separado; no almacenamiento de los audios locales |

requirements fija los principales paquetes Python pero no todos los transitivos. uv pip check verificó **73 paquetes compatibles**. Esta comprobación de dependencias no es un escaneo de vulnerabilidades Python.

CLAP, WhisperX, CREPE, SPICE, AST, MT3, Omnizart, AudioSep y Spleeter **no están integrados como motores ejecutables en el flujo auditado**. La variante mel_band_roformer usa el mismo constructor BSRoformer en el adaptador; no hay una implementación diferenciada por ese nombre.

## 6. Microproceso de un análisis

1. **Acceso.** Email/password Firebase; cookie HTTP-only; correo verificado y perfil activo. El navegador accede al estudio local autorizado.
2. **Subida.** Se copia el original al disco. Límite local de 50 MiB, extensión/MIME admitidos y tamaño declarado verificado. Se responde 202 y se encola; la solicitud no espera toda la inferencia.
3. **Onda.** FFmpeg obtiene picos de la mezcla. Es trabajo previo adicional al preanálisis.
4. **IATPE.** Inspección de formato; PCM mono 16 kHz de hasta 30 s al inicio; perfil espectral; hasta cinco ventanas de YAMNet dentro de esa muestra; candidatos y plan.
5. **Ritmo/armonía.** Python carga/remuestrea audio, calcula onset y pulso librosa; con detectBars=true, Beat This! final0 vuelve a estimar beats/downbeats; luego cromas, tonalidad y acordes mayores/menores por plantillas.
6. **Despacho.** Una heurística de solista puede evitar MSS. En mezcla se elige motor y cuatro/seis categorías. El servicio no envía device, así que Python usa CPU aunque acepte CUDA en su nueva interfaz.
7. **Separación.** Audio estéreo a la frecuencia del motor. Demucs ejecuta ventanas internas y, para duración >20 s, el nuevo slicer RMS exterior. RoFormer usa su propio bucle de intervalos/ventanas y no el mismo helper de reconstrucción.
8. **Stems.** Ganancia común para evitar picos, archivos PCM16, hashes y eventos internos. Los metadatos adicionales no sobreviven actualmente al contrato Node.
9. **Notas.** Por cada stem tonal elegible: FFmpeg escribe transcription.pcm mono Float32 a 22.050 Hz; nuevo worker; carga de modelos; Basic Pitch en bloques de 12 s con contexto de 1 s, clasificación YAMNet y nueva estimación de tempo.
10. **Omisiones deliberadas.** Batería/percusión no se convierte con AMT tonal; FX no genera notas; señal débil puede excluirse. Esto evita inventar notas pero deja esas partes vacías.
11. **Documento.** Eventos en segundos y ticks PPQ=128, tempo global común, compás y tonalidad. El origen puede corregirse con downbeats antes de escribir.
12. **Publicación.** Se generan result.json, score.musicxml y score.mid. Solo entonces completed permite al cliente recuperar todo y mostrar canales.
13. **Edición/guardado.** Piano roll, inspector, cuantización y vistas. Guardar como proyecto es explícito; los temporales existen aunque no se guarde.
14. **Exportación/práctica.** MIDI, MusicXML/MXL, JSON y PDF/MEI local según la ruta. FFmpeg Rubber Band genera variantes de velocidad/tono. Algunas operaciones esperan el motor libre.

## 7. Formatos, muestreo y límites musicales

| Contrato | Valor/estado |
| --- | --- |
| Formatos admitidos por subida | MP3, WAV, FLAC, M4A, AAC, OGG, AIFF/AIF con sus MIME previstos |
| Duración local de análisis | 900 s |
| Tamaño local | 50 MiB |
| Ingesta | Original conservado; decodificación para cálculo, sin WAV normalizado inicial en el camino local |
| Preanálisis | Mono Float32 16 kHz; buffers acumulados en RAM, no memoria constante |
| MSS | Demucs según samplerate del checkpoint; RoFormer solicita 44,1 kHz |
| AMT | Mono Float32 22,05 kHz; PCM temporal en disco |
| Archivos de stems | WAV PCM16; precisión de exportación cuantizada |
| Número interno de fuentes | Hasta 64 |
| Eventos musicales por documento | Hasta 10.000 en total |
| Candidatos de instrumentos | Hasta 20 |
| Compás automático | Propuesta 3/4 o 4/4 con evidencia; sin cambios de métrica por secciones |
| Tempo | steady predeterminado; adaptive opcional; no seguimiento de entrada en vivo |
| Tablatura | Guitarra/bajo con afinación y posiciones sugeridas; no digitación original garantizada |
| PDF | Conversor limitado a 100 páginas |
| Automatización/pitch bend MIDI | El escritor los rechaza explícitamente |

«Cualquier audio» no está implementado literalmente: WAV/FLAC/MP3 son familias de codecs; no hay soporte automático de todas las variantes, DSD, multicanal arbitrario o archivos corruptos.

El cargador Python duplica mono y recorta entradas de más de dos canales a los dos primeros; no aplica una matriz surround para conservar centro/ambientes. Si fallan los remuestreadores, una rama captura el error sin exigir la frecuencia solicitada. Estos son límites de compatibilidad a corregir antes de certificar preservación multicanal y contrato de checkpoint.

Evitar un WAV intermedio no elimina la necesidad de decodificar a PCM. Un MP3 se sigue decodificando para inferencia; la información perdida durante su compresión original no se recupera por usar Float32.

## 8. Rendimiento e infraestructura de hardware

**Equipo observado:** Intel Core i5-4590 a 3,30 GHz, cuatro núcleos/lógicos; aproximadamente 16 GiB instalados. Durante una lectura puntual había unos 3,18 GiB de memoria física libre. RX 560/Intel HD no tienen aceleración habilitada en este PyTorch CPU.

El script local establece DEMUCS_THREADS, pero la nueva función separate() ya no aplica esa variable mediante torch.set_num_threads. El ritmo sí fija dos hilos en el proceso compartido. La configuración de hilos efectiva depende por tanto del recorrido; el valor de la variable no demuestra el paralelismo usado.

### Qué mejoró y qué aún cuesta tiempo

- El slicer conserva señal suave y trata la energía multicanal sin promediar L/R para detectar actividad.
- La prueba de 24 s solo envió 6,55 s al callback, conservando el resto en other. Es ahorro de recorrido sintético; **no una medición Demucs ni una separación correcta de la cola por instrumento**.
- Si la canción es continua, la cobertura supera los umbrales y se procesa completa.
- El análisis de ritmo/armonía bloquea el comienzo de separación.
- Basic Pitch/YAMNet continúan recargándose y repitiendo clasificación/tempo por stem.
- El ensamble ejecuta dos modelos en serie; no es una optimización de velocidad.
- Escribir/copiar/hash de stems y sus padres agrega IO. Los hashes son útiles para procedencia, pero deben entrar en el presupuesto medido.
- Los resultados se muestran al finalizar AMT, por lo que el usuario espera más que la separación.
- La clasificación IATPE corre en el proceso Node coordinador. Ceder el event loop entre ventanas no transforma cada inferencia en un worker separado.

### Memoria: estimación de buffers, no medición de pico

Para 300 s estéreo a 44,1 kHz:

| Representación | Tamaño aproximado |
| --- | ---: |
| Entrada Float32 estéreo | 101 MiB |
| Seis salidas Float32 | 606 MiB |
| Seis acumuladores Float64 | 1.211 MiB |
| Acumuladores + salidas Float32 al convertir | 1.817 MiB |

A ello se suman pesos, activaciones, normalización, máscaras y otros buffers. En una ruta de slicing que retenga todos esos acumuladores, el pico crece con duración y fuentes. A 900 s los tamaños se triplican. El modo por ventanas limita activaciones de inferencia, pero no elimina por sí mismo los buffers de canción completa.

### Simultaneidad

El servicio admite **un análisis activo y hasta cinco pendientes**, con 100 registros totales; exportación/práctica tienen sus propias exclusiones. Es una protección local, no infraestructura para 5.000 análisis.

La capacidad depende de la duración de trabajo T: aproximadamente 60/T trabajos por hora por worker, con T en minutos y condiciones estables. No se ha medido T para el commit actual con un conjunto de canciones. Usuarios conectados, trabajos en cola e inferencias simultáneas son cantidades diferentes.

El polling cada 1,5 s requiere verificación de sesión y lectura de perfil. Miles de clientes activos convertirían ese patrón en miles de solicitudes/lecturas por segundo; el límite local impide aceptar miles de inferencias, pero no es un diseño de distribución de carga.

**No hay benchmark nuevo que respalde 78→4 min.** Los 19 min 12 s del informe del 12 de octubre corresponden al código y carga de aquel momento. No deben publicarse como rendimiento actual.

## 9. Seguridad, identidad, usuarios y planes

### Firebase comprobado en vivo

| Recurso | Resultado |
| --- | --- |
| Proyecto | audioscore-ca277 |
| App web registrada | AudioScore Web, estado ACTIVE |
| Firestore | (default), STANDARD, FIRESTORE_NATIVE, nam5 |
| Nivel gratuito | freeTier=true; facturación del proyecto reportada desactivada |
| Concurrencia transaccional | PESSIMISTIC |
| PITR / protección de borrado | Desactivados según metadatos; no se modificaron |
| Reglas Firestore publicadas | Coinciden con firestore.rules local |
| Compilación de reglas | OK, sin errores |
| Storage | La consulta no encontró reglas activas en el proyecto; el archivo local deniega todo |
| Emuladores | Hay configuración, pero no se confirmó un backend Firebase local en ejecución |

El estudio local usa **Firebase real** para identidad/perfil; no es totalmente offline. Los audios locales no pasan por Storage, Cloud Tasks ni Vercel Blob.

### Controles implementados

- Cookie de sesión HTTP-only, SameSite=Lax, Secure en producción, vigencia de cinco días.
- Intercambio de token con comprobación de autenticación reciente; verificación de sesión revocada.
- Correo verificado, estado de perfil activo y rol administrativo desde custom claims, no desde el payload del usuario.
- Operaciones administrativas con validación, registro y protección para no suspender la propia cuenta administrativa.
- El proxy local valida host/origen y transmite UID verificado más token interno aleatorio.
- Servicio privado ligado a loopback; token comparado mediante timingSafeEqual; archivos y trabajos ligados a propietario.
- Reglas cliente Firestore sin escrituras; lecturas restringidas por propiedad/rol y deny por defecto.
- Ruta cloud con cuotas/reservas transaccionales, límites por plan, rate limit, URLs temporales y OIDC/secreto en tareas internas.
- .env.local y audios temporales están ignorados. La revisión de archivos versionados encontró .env.example, sin .env.local ni archivos de cuenta de servicio por sus nombres.

### Límites del control actual

El proxy local usa requireAccount() sin pasar request; por ello no ejecuta el chequeo App Check de esa función. Su protección adicional es la restricción local de origen/host y el token entre procesos. La API cloud sí utiliza requireAccount(request) y sus controles.

El servicio local aplica límites fijos de equipo, **no consulta el plan para limitar minutos, fuentes, formatos o proyectos**. Administrar planes en Firestore no implica que estas cuotas se descuenten o impongan en la ruta local.

No se auditó la contraseña de ninguna cuenta, no se publicaron secretos y no se ejecutaron ataques contra producción. No se realizó una evaluación exhaustiva IAM ni de dependencias Python. El JSON específico de reglas delimita su evaluación estática; no es una certificación de seguridad de toda la aplicación.

## 10. Administración, cloud y despliegue

La administración permite listar/buscar usuarios, modificar estado/plan/suscripción, editar planes, ver trabajos/consumo/logs cloud y reintentar trabajos autorizados. Los ajustes leídos desde system/config no equivalen a un gestor de secretos ni a un panel operativo para todos los modelos.

Hay cinco planes: Free, Starter, Pro, Studio y Enterprise. El catálogo publica límites que en algunos niveles superan los 15 minutos del motor integrado. El código cloud comprueba el límite del motor y puede requerir proveedor para archivos mayores. No se verificaron cobros automáticos ni suscripciones pagadas activas.

Vercel está preparado para Next y Git, pero la separación local está deshabilitada allí. El recorrido cloud requiere configurar y desplegar worker, cola, identidad, Storage y proveedores. La facturación desactivada y ausencia de reglas Storage activas no acreditan esa infraestructura desplegada.

**El localhost estaba apagado:** ambos puertos 3000/8765 rechazaron conexión. Esto describe el estado de esta revisión; no prueba un fallo de arranque. La auditoría no lo reinició.

El script start-local hereda variables del proceso y define las suyas; no carga .env.local para el servicio privado. Next sí carga ese archivo durante build/dev. Una configuración guardada solo allí no debe suponerse disponible en Python; requiere un mecanismo explícito de configuración compartida, sin exponer secretos al cliente.

## 11. Pruebas y calidad

| Comprobación | Resultado |
| --- | --- |
| TypeScript con Node normal | Pasa |
| Suite existente con Node 26.7.0 | 107 pruebas, 24 archivos, todas pasan |
| Suite existente con Node 22.23.3 | 107 pruebas, 24 archivos, todas pasan |
| TypeScript con Node 22 | Pasa |
| Compilación producción Next/webpack con Node 22 | Pasa: compila, comprueba tipos, genera 10 páginas estáticas y completa trazas |
| Lint completo | Falla: 6 errores, 22 advertencias, 178 archivos examinados |
| unittest Python de ritmo | 2 pruebas pasan |
| Compatibilidad dependencias Python, uv | 73 paquetes compatibles |
| Diagnósticos adicionales de integración | 5 pruebas reproducen comportamientos observados; no son un sello de aceptación |
| Auditoría npm producción por HTTPS | 10 paquetes señalados: 4 high y 6 moderate |
| Reglas Firestore | Validación correcta y coincidencia con publicación |

Los errores lint se localizan en IatpeWorkflowViewer.tsx, google-classifier.ts, local/client.ts y services/local/server.ts. El estado de lint anterior dirigido no es comparable numéricamente al lint completo actual por diferencia de alcance.

La suite existente cubre permisos, cuotas, validación, documentos, exportación y heurísticas. No verifica todos los contratos Python↔Node, un checkpoint RoFormer completo, continuidad de voces, precisión con stems de referencia ni entrega parcial real. Por eso puede pasar mientras fallan las funciones descritas.

No se realizaron pruebas E2E sobre una sesión autenticada, pruebas de carga, evaluación orquestal o benchmark completo. La compilación no demuestra que los motores de audio trabajen correctamente.

## 12. Plan de estabilización recomendado

1. **Restaurar barreras de RoFormer:** pesos entrenados obligatorios o fallback explícito, compatibilidad estricta y nombre canónico aceptado.
2. **Cerrar el contrato jerárquico:** targetInstruments común, capacidades reales y resultado vacío explícito; escritura transaccional de subfuentes.
3. **Probar todos los cruces:** plan→worker→manifest→Node→documento→UI para cada motor, incluyendo cancelación y errores.
4. **Integrar el preanálisis distribuido real:** ventanas decodificadas con tiempos originales y decisión conservadora; quitar el bypass basado solo en introducción.
5. **Entregar audio antes de notas:** persistir/publicar stem_ready, mantener hashes/telemetría y consumirlos desde la consola.
6. **Implementar el worker AMT persistente real:** protocolo de inferencia reutilizable, caché neutral y acotada; reducir tareas duplicadas bajo medición.
7. **Resolver exportación/transporte:** MIDI por puertos, percusión, MusicXML válido, origen de compases y cancelación de clics.
8. **Gestionar recursos:** medir RAM/hilos/IO, limpieza de temporales y presupuesto de buffers. Mantener un trabajo pesado a la vez en este equipo hasta medir otra configuración.
9. **Alinear producto con evidencia:** monitor basado en eventos reales; no mostrar confianza alta ni motores/funciones no ejecutados.
10. **Cerrar la publicación:** lint, contratos en CI, revisión compatible de dependencias y benchmark reproducible antes de ampliar motores o prometer tiempos.

Para el siguiente benchmark deben fijarse canción, hardware, modelo/checkpoint, parámetros, ejecución fría/caliente, tiempo al primer audio, tiempo total, memoria pico, segundos inferidos, calidad auditiva y referencias de notas/stems. Reducir espera de interfaz y reducir inferencia son objetivos distintos.

## 13. Evidencia y fuentes de código

[JSON de evidencia de esta auditoría](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/docs/audits/system-2026-10-15-evidence.json>)  
[Evaluación de reglas Firebase](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/docs/audits/firebase-rules-2026-10-15.json>)  
[Informe anterior de cumplimiento](<E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/docs/V0.03-PLAN-COMPLIANCE-2026-10-14.md>)

Los hashes fijan las fuentes revisadas. Los resultados controlados usan funciones reales y sustituyen únicamente modelos/procesos externos donde se indica. No se confunden esos resultados con la precisión de redes entrenadas ni con los trabajos históricos del disco.

[srv]: <E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/services/local/server.ts:102>
[bridge]: <E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/services/local/python.ts:52>
[rof]: <E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/services/separator/bs_roformer_engine.py:64>
[sep]: <E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/lib/audio/separation.ts:37>
[sub]: <E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/services/separator/hierarchical_subseparator.py:294>
[dispatch]: <E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/lib/audio/iatpe/channel-dispatcher.ts:358>
[amt]: <E:/CLOUD WEBFIX/WEBFIX/SISTEMAS/kdusound/lib/audio/transcription/server.ts:171>

