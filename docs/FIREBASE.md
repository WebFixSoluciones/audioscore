# Firebase de AudioScore

Proyecto existente: `audioscore-ca277`.
Aplicación web registrada: `AudioScore Web`, ID `1:350926561452:web:492bd12a586996f30bbf09`.
Proveedor Email/password activado y desplegado desde `firebase.json`.

Las habilidades oficiales de Firebase se encuentran en `.agents/skills/`. El servidor MCP de Firebase está configurado en Codex para próximas sesiones. Usa estas habilidades antes de cambiar Firebase.

## Configuración local

Los valores del SDK web están en `.env.local`, excluido de Git. Las credenciales locales del servidor también están excluidas de Git y se usan mediante `GOOGLE_APPLICATION_CREDENTIALS`. Son credenciales de desarrollo; no deben copiarse a Vercel.

Para el arranque local, `APP_CHECK_ENFORCED=false` permite crear sesiones sin un proveedor App Check registrado. La sesión Firebase, la verificación del correo, los permisos administrativos, la comprobación de origen y los límites de peticiones siguen aplicándose. Si llega un token App Check, siempre se verifica. El valor por defecto en el código y `.env.example` exige App Check.

Se creó la base `(default)` de Firestore Standard en `nam5` (Estados Unidos, varias regiones), con cuota gratuita. Las reglas e índices están desplegados y los cinco planes están inicializados. Se comprobó el ingreso real de administrador y usuario, la edición de cuotas y la protección de datos entre cuentas. Las cuentas de prueba se eliminaron al terminar.

Los contadores de solicitudes reutilizan un documento por usuario y operación. Así no se necesita TTL, que requiere facturación. Las rutas desconocidas se rechazan antes de escribir contadores.

`npm run seed` crea únicamente los planes y ajustes que falten; conserva los cambios hechos desde administración. El catálogo público de precios lee los planes vigentes de Firestore. La lista de usuarios admite paginación y búsqueda por correo exacto.

## Usuarios y administración

La landing abre `/auth/login` con el botón **Ingresar**. Las cuentas nuevas se registran con correo y contraseña y verifican su correo. El servidor crea su perfil con plan Free. Los usuarios entran a `/dashboard`; las cuentas con el claim `admin: true` entran a `/admin`.

La administración permite asignar planes, suspender o reactivar cuentas y editar los cinco planes iniciales. No integra cobros ni proveedores de IA todavía. No se concede administración a la primera cuenta que se registre.

Para asignar la primera cuenta administradora, después de que esté registrada y verificada:

```powershell
npm run admin:grant -- correo@ejemplo.com
```

Cierra sesión y vuelve a ingresar. El rol se comprueba desde un claim de Firebase Auth firmado; editar un campo de Firestore no concede permisos.

La primera cuenta administradora se aprovisionó con la identidad de Google ya verificada del propietario autenticado en Firebase CLI. El enlace inicial para configurar la contraseña y cualquier credencial de comprobación permanecen fuera de Git. No se debe reutilizar esa confianza para verificar automáticamente otras cuentas registradas.

## Vercel

Configura en Vercel los valores públicos `NEXT_PUBLIC_FIREBASE_*` obtenidos para esta aplicación y `FIREBASE_PROJECT_ID=audioscore-ca277`. Producción utiliza identidad federada OIDC con `GCP_WORKLOAD_IDENTITY_AUDIENCE` y `GCP_SERVICE_ACCOUNT_EMAIL`. Como alternativa, el servidor admite credenciales de una cuenta de servicio mediante `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY`, o una identidad federada válida. Nunca publiques credenciales privadas en GitHub ni en variables `NEXT_PUBLIC_*`.

Configura `NEXT_PUBLIC_APP_URL` con la URL pública real. Registra el proveedor App Check y su clave `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` antes de exigir App Check en ese dominio. El inicio por Google queda oculto hasta que se configure explícitamente `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true` y se habilite ese proveedor.

Ver también [despliegue en Vercel](VERCEL.md).
