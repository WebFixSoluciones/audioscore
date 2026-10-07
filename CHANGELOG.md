# Historial de versiones

## 0.4.1 — 2026-10-06

- Firestore Standard `(default)` creado en `nam5`, con cuota gratuita; reglas e índices desplegados y cinco planes inicializados.
- Primera cuenta administradora aprovisionada con identidad verificada del propietario y enlace privado de configuración de contraseña.
- Comprobaciones contra Firebase real: ingreso por rol, edición de cuotas, rechazo de suspensión propia, protección de datos entre usuarios y bloqueo de escrituras directas en perfiles y planes.
- Contadores de solicitudes acotados, sin TTL de pago; rutas desconocidas rechazadas antes de escribir contadores.
- Catálogo público sincronizado con Firestore, lista de usuarios paginada y búsqueda por correo exacto.
- Inicialización de planes sin sobrescribir ajustes existentes.

## 0.4.0 — 2026-10-06

- Landing pública con Ingresar, dashboard protegido, estudio dentro de la cuenta y cierre de sesión.
- Administración visible por rol; edición de precios, límites, exportaciones y funciones de los planes, asignación de planes y estado de suscripción, suspensión y reactivación de usuarios.
- Habilidades oficiales de Firebase instaladas y proyecto existente `audioscore-ca277` seleccionado; aplicación web registrada y Email/password activado en Firebase.
- Configuración local y credenciales excluidas de Git; herramienta explícita para asignar la primera cuenta administradora verificada.
- Firestore aún pendiente de ubicación/edición y cuenta administradora pendiente de correo del propietario. No se han habilitado cobros ni conexiones de IA.

## 0.3.0 — 2026-10-06

- Configuración de importación GitHub → Vercel con Node 22 y compilación Next.js específica de la plataforma.
- Se conservan los modelos públicos para análisis en navegador; las funciones web excluyen archivos exclusivos del worker.
- Trabajos cloud largos destinados a Cloud Run; las rutas internas se rechazan en Vercel.
- Cloud Tasks utiliza credenciales explícitas fuera de Google Cloud; guía de variables y conexión inicial.
- Preparación local verificada; no se afirma haber vinculado ni desplegado en una cuenta Vercel.

## 0.2.0 — 2026-10-06

- AudioSet: catálogo oficial con 87 categorías musicales compatibles con YAMNet, identificadores y referencias para comparar ejemplos.
- Identificación de instrumentos en toda la pista con ventanas acotadas, en lugar de ocho fragmentos.
- Distinción entre instrumentos, familias, técnicas y voces; se evitan etiquetas redundantes de padres e hijos.
- Metadatos de origen y licencia CC BY-SA 4.0; el audio del usuario se procesa localmente.

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
