# SMS Outreach

Aplicación real de producción para sustituir el workflow de outreach SMS de GoHighLevel, usando [TextBee](https://textbee.dev) como gateway (Samsung Android + SIM española).

No es una demo: incluye base de datos con migraciones, API, worker/scheduler con locks de concurrencia reales, webhooks verificados con HMAC, reconciliación, circuit breaker, panel de administración y tests.

## Índice

1. [Arquitectura](#1-arquitectura)
2. [Requisitos](#2-requisitos)
3. [Instalación](#3-instalación)
4. [Base de datos y migraciones](#4-base-de-datos-y-migraciones)
5. [Configurar variables de entorno](#5-configurar-variables-de-entorno)
6. [Arrancar la aplicación (dev)](#6-arrancar-la-aplicación-dev)
7. [Configurar el webhook de TextBee](#7-configurar-el-webhook-de-textbee)
8. [Probar el webhook manualmente](#8-probar-el-webhook-manualmente)
9. [Enviar un SMS de prueba](#9-enviar-un-sms-de-prueba)
10. [Dry-run](#10-dry-run)
11. [Importar contactos por CSV](#11-importar-contactos-por-csv)
12. [Crear y activar una campaña](#12-crear-y-activar-una-campaña)
13. [Pausar / reanudar el envío global](#13-pausar--reanudar-el-envío-global)
14. [Revisar errores y notificaciones](#14-revisar-errores-y-notificaciones)
15. [Despliegue con Docker](#15-despliegue-con-docker)
16. [Backups](#16-backups)
17. [Cómo se garantiza "no duplicados"](#17-cómo-se-garantiza-no-duplicados)
18. [Tests](#18-tests)
19. [Despliegue en Vercel](#19-despliegue-en-vercel)
20. [Cron externo con cronjob.org (sin gastar Vercel Cron)](#20-cron-externo-con-cronjobora-sin-gastar-vercel-cron)
21. [Panel de administración — páginas](#21-panel-de-administración--páginas)

---

## 1. Arquitectura

Un único repositorio TypeScript/Node.js con dos procesos independientes que comparten la misma base de datos PostgreSQL:

- **API** (`src/api`): Fastify. Sirve el panel de admin, la API de administración, endpoints de salud, el webhook de TextBee y `/cron/tick` (disparador externo, ver [sección 20](#20-cron-externo-con-cronjobora-sin-gastar-vercel-cron)).
- **Worker** (`src/worker`): Bucle que cada ~60s ejecuta el scheduler (pacing global + envío), cada ~5min reconcilia con TextBee y cada ~5min detecta acciones "stalled". En despliegues sin proceso siempre activo (p. ej. Vercel), esta misma lógica se dispara vía `/cron/tick` en lugar del bucle (ver [sección 19](#19-despliegue-en-vercel)).

Ambos procesos son **stateless**: todo el estado importante (pacing, colas, circuit breaker, cursor de reconciliación) vive en Postgres, nunca en memoria. Esto permite:

- Reiniciar cualquiera de los dos procesos sin perder estado ni duplicar envíos.
- Ejecutar accidentalmente dos workers sin riesgo de doble envío (ver [sección 17](#17-cómo-se-garantiza-no-duplicados)).

Por qué esta arquitectura: es la más simple que cumple los requisitos de robustez (transacciones ACID de Postgres + `SELECT ... FOR UPDATE SKIP LOCKED` + advisory locks), sin añadir colas externas (Redis/SQS) que introducirían un segundo sistema de estado a mantener consistente con la DB.

Estructura de carpetas:

```
src/
  api/            Fastify app, rutas de admin, health, cron
  worker/         scheduler, reconciliación, detección de stalled
  services/       tags, pipeline, notificaciones, audit log, circuit breaker, import CSV
  textbee/        cliente HTTP de TextBee
  outreach/       enrollment, variantes, secuencia (follow-ups), inbound/opt-out
  webhooks/       verificación de firma + handlers de eventos TextBee
  db/             cliente Prisma singleton
  lib/            teléfono (E.164), horario/timezone, opt-out matcher, render de plantillas
  config/         env, plantillas por defecto
  admin/public/   panel de administración (HTML/JS estático): dashboard, importar leads,
                  contacts, oportunidades, kanban, queue, campaigns, settings,
                  notifications, execution log
api/index.ts      entrypoint serverless para Vercel (envuelve el mismo Fastify app)
vercel.json       configuración de despliegue en Vercel
prisma/           schema.prisma, seed.ts
tests/
  unit/           tests sin dependencia de DB
  integration/    tests contra una Postgres real
```

---

## 2. Requisitos

- Node.js 20+
- Docker + Docker Compose (recomendado para producción y para levantar Postgres en local)
- Una cuenta TextBee con un dispositivo Android emparejado y API key

Si no quieres usar Docker para desarrollo, necesitas una instancia de PostgreSQL 14+ accesible.

## 3. Instalación

```bash
npm install
cp .env.example .env
```

Edita `.env` con tus credenciales (ver [sección 5](#5-configurar-variables-de-entorno)).

## 4. Base de datos y migraciones

Con Docker (recomendado, arranca solo Postgres):

```bash
docker compose up -d db
```

Con Postgres local, asegúrate de que `DATABASE_URL` en `.env` apunta a una base de datos existente.

Aplicar migraciones y seed (plantillas de mensaje + campaña por defecto):

```bash
npx prisma migrate deploy   # o `npm run prisma:migrate` en desarrollo, crea+aplica migraciones
npm run prisma:seed
```

En desarrollo, para crear una nueva migración tras cambiar `prisma/schema.prisma`:

```bash
npm run prisma:migrate
```

## 5. Configurar variables de entorno

Ver `.env.example` para la lista completa. Las más importantes:

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | conexión Postgres |
| `TEXTBEE_API_KEY` | API key de TextBee (nunca la subas a git) |
| `TEXTBEE_DEVICE_ID` | ID del dispositivo Android emparejado |
| `TEXTBEE_WEBHOOK_SECRET` | secreto compartido para verificar HMAC de los webhooks |
| `APP_TIMEZONE` | siempre `Europe/Madrid` para las decisiones de horario |
| `SEND_WINDOW_START` / `SEND_WINDOW_END` | ventana de envío diaria, inclusive |
| `MIN_SEND_GAP_SECONDS` | pacing global (600 = 1 SMS cada 10 min, para TODO el sistema) |
| `MAX_SMS_PER_DAY` | límite diario, contado en horario Europe/Madrid |
| `OUTREACH_DRY_RUN` | si `true`, simula toda la lógica sin llamar a TextBee |
| `ENVIRONMENT` | `production` habilita el envío real a cualquier número; en cualquier otro valor solo se puede enviar a `TEST_ALLOWED_NUMBERS` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | credenciales HTTP Basic Auth del panel |
| `CRON_SECRET` | secreto para `/cron/tick` (solo necesario si no corres el worker como proceso siempre activo, p. ej. en Vercel) |

## 6. Arrancar la aplicación (dev)

En dos terminales:

```bash
npm run dev:api      # http://localhost:3000/admin
npm run dev:worker
```

El panel de admin pedirá usuario/contraseña (HTTP Basic Auth, definidos en `.env`).

## 7. Configurar el webhook de TextBee

En el panel de TextBee, configura la URL de webhook apuntando a:

```
https://TU_DOMINIO/webhooks/textbee
```

Usa el mismo secreto en TextBee y en `TEXTBEE_WEBHOOK_SECRET`. El endpoint verifica la firma `X-Signature` (HMAC-SHA256 sobre el cuerpo crudo) antes de procesar cualquier evento; si no es válida responde `401` sin ejecutar lógica.

## 8. Probar el webhook manualmente

```bash
BODY='{"event":"MESSAGE_SENT","idempotencyKey":"test-1","data":{"smsId":"abc","timestamp":"2025-01-01T10:00:00Z"}}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$TEXTBEE_WEBHOOK_SECRET" | sed 's/^.* //')
curl -X POST http://localhost:3000/webhooks/textbee \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
```

Repite la misma petición: la segunda vez debe responder `{"ok":true,"deduped":true}` sin volver a procesar nada.

## 9. Enviar un SMS test

Desde el panel: **Settings → Send test SMS**. También por API:

```bash
curl -u admin:tu_password -X POST http://localhost:3000/admin/api/test-sms \
  -H "Content-Type: application/json" \
  -d '{"phone":"+34600000000","message":"Prueba"}'
```

El mensaje se envía con el prefijo `[TEST]` y nunca se asocia a ninguna campaña real. Si `ENVIRONMENT != production`, el número debe estar en `TEST_ALLOWED_NUMBERS`.

## 10. Dry-run

Con `OUTREACH_DRY_RUN=true` (valor por defecto), el worker recorre toda la lógica de decisión (pacing, horario, cap diario, elegibilidad) pero **nunca llama a la API de TextBee**. Los envíos simulados quedan registrados como `DRY_RUN` en `sms_messages` y el panel lo indica claramente. Ideal para probar 500 contactos sin mandar nada real.

## 11. Importar contactos por CSV

Desde el panel: pestaña **Import CSV**, sube un archivo con estas columnas (ver más detalle en el propio código, `src/services/csvImport.ts`):

```
Contact Name,Phone,Company Name,City,Website,Category,Rating,Reviews Count,About,Review Sample,Review Sample Rating,Source Query,Maps Rank,Maps URL,Place ID,Address,Source,Tags
```

- Los teléfonos se normalizan automáticamente a E.164 (`612345678`, `34612345678` y `+34612345678` → `+34612345678`).
- Deduplica por `phone_e164`. Reimportar el mismo CSV **actualiza** datos no destructivos pero **nunca** borra: historial de respuestas, `do_not_contact_sms`, estado de outreach, mensajes ni tags de outreach existentes.

## 12. Crear y activar una campaña

Panel → **Campaigns** → crear con un nombre. Se crea inactiva; pulsa **Activate**. Los valores de horario/pacing/cap se pueden editar directamente en base de datos o (próximamente) desde el panel de settings avanzado; por defecto se seedán con los valores de `.env`.

Para inscribir contactos: en **Contacts**, marca los contactos elegibles (con tag `outreach-ready`, sin DNC, sin `outreach-stop`/`outreach-replied`) y aplica la acción bulk **Enroll campaign** con el `campaignId`.

## 13. Pausar / reanudar el envío global

Panel → **Settings** → **PAUSE ALL OUTBOUND** / **RESUME**. También se activa automáticamente (circuit breaker) ante fallos consecutivos, SMS "stalled" repetidos, o demasiados errores de API de TextBee en poco tiempo. Al reanudar, el envío continúa uno a uno respetando el pacing — nunca se manda un backlog de golpe.

## 14. Revisar errores y notificaciones

Panel → **Notifications**: respuestas nuevas, opt-outs, fallos de envío, SMS stalled, apertura de circuit breaker, errores de auth/cuota de TextBee, inbound sin contacto asociado. Todo evento relevante también queda en `audit_log` para trazabilidad completa.

## 15. Despliegue con Docker

```bash
cp .env.example .env   # rellena tus credenciales reales
docker compose up -d --build
```

Esto levanta: `db` (Postgres), `migrate` (aplica migraciones + seed y termina), `api` y `worker`. El panel queda en `http://TU_SERVIDOR:3000/admin`.

Para producción, pon la API detrás de un reverse proxy con TLS (Caddy/Nginx) y expón solo el puerto 443. Asegúrate de:

- `ENVIRONMENT=production`
- `OUTREACH_DRY_RUN=false` (solo cuando estés listo para enviar de verdad)
- `ADMIN_PASSWORD` fuerte y único
- `TEXTBEE_WEBHOOK_SECRET` configurado igual en TextBee y en `.env`

## 16. Backups

`docker compose exec db pg_dump -U sms_outreach sms_outreach > backup-$(date +%F).sql`

Automatiza esto con un cron/GitHub Action diario. El ledger de `sms_messages` y `audit_log` nunca se borra automáticamente — es tu fuente de verdad histórica.

## 17. Cómo se garantiza "no duplicados"

Esta es la prioridad #1 del sistema. Mecanismos, de extremo a extremo:

1. **Selección de la acción a enviar**: dentro de una transacción Postgres se toma un **advisory lock** (`pg_advisory_xact_lock`) que serializa esta sección crítica entre **todos** los workers/procesos conectados a la misma base de datos. Dentro de esa transacción se usa `SELECT ... FOR UPDATE SKIP LOCKED` para escoger como máximo una acción `PENDING`.
2. **Reclamar el turno global antes de la llamada HTTP**: al bloquear la acción (`LOCKED`), se actualiza `campaign_runtime_state.last_global_send_attempt_at` **dentro de la misma transacción**, antes de salir de la sección crítica. El siguiente tick (de este worker o de cualquier otro) compara contra este timestamp — no solo contra el último envío *confirmado* — así que un envío todavía en vuelo bloquea cualquier otro intento durante el gap configurado, incluso si tarda en responder.
3. **Constraint de unicidad estructural**: `outreach_actions` tiene `UNIQUE(campaign_id, contact_id, action_type)`. Es físicamente imposible crear dos `INITIAL`, dos `FOLLOWUP_1` o dos `FOLLOWUP_2` para el mismo contacto/campaña, incluso ante una condición de carrera — el segundo `INSERT` falla con `P2002` y se ignora de forma segura.
4. **HTTP fuera de la transacción**: la llamada real a TextBee ocurre *después* de liberar el advisory lock (nunca se mantiene un lock de DB abierto durante una llamada de red lenta).
5. **Nunca confundir "aceptado" con "enviado"**: un HTTP 2xx de TextBee solo mueve la acción a `API_ACCEPTED`. Solo un webhook `MESSAGE_SENT` confirmado (o la reconciliación) la mueve a `SENT`, que es lo único que dispara la creación del siguiente follow-up.
6. **Idempotencia de webhooks**: cada evento trae un `idempotencyKey`. Antes de procesar nada se hace `INSERT` en `processed_webhook_events` con esa clave como `UNIQUE`; si ya existe, se responde `200` sin ejecutar ninguna lógica de negocio.
7. **Ante ambigüedad, nunca se reintenta a ciegas**: timeouts de red, errores 5xx, o mensajes atascados en `DISPATCHED`/`API_ACCEPTED` más de `STALLED_AFTER_MINUTES` se marcan `UNKNOWN`/`STALLED` y requieren reconciliación o **confirmación manual explícita** desde el panel (que además avisa del riesgo de duplicado) — nunca se reenvían automáticamente.
8. **Reinicios no generan ráfagas**: el pacing se deriva siempre de datos en Postgres (nunca de `setTimeout`/memoria), así que tras un apagado de horas, al volver solo se envía un mensaje respetando el gap configurado, nunca el backlog acumulado.

## 18. Tests

```bash
npm test
```

- `tests/unit`: normalización de teléfono, detección de opt-out, ventana horaria (incluye DST CET/CEST), render de plantillas, distribución de variantes — no requieren base de datos.
- `tests/integration`: requieren una Postgres real apuntada por `DATABASE_URL` (usa una base de datos **desechable**, los tests hacen `DELETE` de todas las tablas antes de cada test). Cubren: enrollment y permanencia de variante, idempotencia de webhooks, creación de follow-ups, opt-out (incluye "PESADO" dentro de frase y el falso positivo de "PARA"), scheduler (pausa global, ventana horaria, cap diario, pacing, concurrencia con dos ticks simultáneos), e importación CSV no destructiva.

```bash
# ejemplo de base de datos de test dedicada
createdb sms_outreach_test
DATABASE_URL=postgresql://sms_outreach:sms_outreach@localhost:5432/sms_outreach_test npx prisma migrate deploy
DATABASE_URL=postgresql://sms_outreach:sms_outreach@localhost:5432/sms_outreach_test npm test
```

---

## 19. Despliegue en Vercel

La app corre de forma nativa en Docker (sección 15). Si prefieres Vercel (gratis para este volumen, sin gestionar servidor), esto es lo que cambia:

### 19.1 Qué se ejecuta y qué no

- `api/index.ts` envuelve el mismo Fastify app (`src/api/server.ts`) como una función serverless. `vercel.json` reescribe **todas** las rutas hacia ella: `/admin` (panel), `/admin/api/*`, `/webhooks/textbee` y `/cron/tick`.
- El proceso worker (`src/worker/index.ts`, bucle infinito con `setInterval`) **no puede correr en Vercel** (las funciones serverless no persisten entre peticiones). En su lugar, `/cron/tick` ejecuta una iteración puntual de scheduler + reconciliación + detección de stalled bajo demanda. Lo dispara un cron **externo** (ver sección 20) — así no necesitas Vercel Cron ni un servidor propio para el worker.

### 19.2 Base de datos

Vercel no incluye Postgres. Necesitas una instancia gestionada accesible por internet con **connection pooling** (imprescindible: cada invocación serverless abre su propia conexión; sin pooler agotas el límite de Postgres en minutos). Opciones habituales: Neon, Supabase, Railway o RDS + PgBouncer. Usa la cadena de conexión "pooled" que te dé el proveedor como `DATABASE_URL`.

### 19.3 Pasos

1. Conecta el repositorio de GitHub al proyecto de Vercel (Vercel → Add New → Project → importa `tommynabo/SMS---Outreach`).
2. En **Settings → Environment Variables**, añade todas las variables de `.env.example` con valores reales de producción (incluye `CRON_SECRET`, genera uno con `openssl rand -hex 32`). Pon `ENVIRONMENT=production` y `OUTREACH_DRY_RUN=false` solo cuando estés listo para enviar de verdad.
3. Antes del primer despliegue (o desde tu máquina), aplica las migraciones contra la base de datos de producción:
   ```bash
   DATABASE_URL="<tu-connection-string-de-produccion>" npx prisma migrate deploy
   DATABASE_URL="<tu-connection-string-de-produccion>" npm run prisma:seed
   ```
4. Despliega (push a `main` o `vercel --prod`). El `postinstall` de `package.json` ejecuta `prisma generate` automáticamente tras el `npm install` de Vercel (no uses `buildCommand` en `vercel.json` para esto — con un framework "Other" detectado, un `buildCommand` personalizado hace que Vercel espere un directorio de salida estático tipo `public/` y falle con "No Output Directory named public").
5. Verifica: `https://TU-PROYECTO.vercel.app/health` debe responder `{"status":"ok"}`, y `https://TU-PROYECTO.vercel.app/admin` debe pedir usuario/contraseña.

### 19.4 Webhook de TextBee en Vercel

Configura en TextBee la URL de webhook como `https://TU-PROYECTO.vercel.app/webhooks/textbee`, con el mismo `TEXTBEE_WEBHOOK_SECRET` que pusiste en las variables de entorno de Vercel.

---

## 20. Cron externo con cronjob.org (sin gastar Vercel Cron)

En vez de Vercel Cron (de pago fuera del plan gratuito para intervalos cortos), usa [cronjob.org](https://cronjob.org) para llamar a `/cron/tick` cada 10 minutos (coincide con el pacing por defecto de 1 SMS/10min, `MIN_SEND_GAP_SECONDS=600`):

1. Crea una cuenta en cronjob.org.
2. Crea un cronjob nuevo:
   - **URL**: `https://TU-PROYECTO.vercel.app/cron/tick?secret=TU_CRON_SECRET`
     (o, mejor, sin el secreto en la URL: usa el mismo endpoint sin query y añade una cabecera personalizada `X-Cron-Secret: TU_CRON_SECRET` en la sección "Advanced" del cronjob — evita que el secreto quede en logs de acceso).
   - **Método**: GET o POST (ambos soportados).
   - **Schedule**: cada 10 minutos (`*/10 * * * *`).
3. Guarda y activa. Cada ejecución devuelve un JSON `{ ok, scheduler, reconciliation, stalled }` que puedes revisar en el historial de ejecuciones de cronjob.org para confirmar que todo funciona (y también queda reflejado en la pestaña **Execution Log** del panel de admin).

Llamar a este endpoint más a menudo, más despacio, o dos veces en paralelo nunca duplica envíos — toda la lógica de pacing/cap/ventana se re-deriva de Postgres en cada llamada (ver sección 17).

---

## 21. Panel de administración — páginas

- **Dashboard**: estado global (pausado/activo), dry-run, contadores del día, cola pendiente por tipo de acción, resumen de contactos.
- **Importar Leads**: sube el CSV de prospección (mismo motor que la sección 11).
- **Contacts**: listado/búsqueda de contactos, acciones bulk (marcar `outreach-ready`, enroll en campaña, pausar, cancelar secuencia).
- **Oportunidades**: vista de tabla de cada contacto-en-campaña (`pipeline_entries`) con su etapa actual, filtrable por campaña/etapa/búsqueda; permite mover de etapa manualmente.
- **Kanban**: tablero estilo GoHighLevel con arrastrar-y-soltar entre 5 columnas — *Nuevo prospecto* → *Enviado* → *Respondido* → *Llamada agendada* / *Descartado*. Las tres primeras las mueve el sistema automáticamente (enrollment, envío confirmado, respuesta entrante); *Llamada agendada* y *Descartado* también se pueden fijar a mano arrastrando la tarjeta.
- **Queue**: cola global de envíos (`outreach_actions`) con cancelar/reintentar/reprogramar.
- **Campaigns**: alta y activación/desactivación de campañas.
- **Settings**: pausa/reanuda global, envío de SMS de prueba, edición de plantillas de mensaje.
- **Notifications**: alertas accionables (respuestas nuevas, opt-outs, fallos, stalled, circuit breaker, errores de TextBee).
- **Execution Log**: histórico completo de `audit_log` (cada envío solicitado/aceptado/enviado/fallido, cada respuesta entrante, cada cambio manual, pausas/reanudaciones, importaciones CSV...), filtrable por tipo de evento — la forma más rápida de verificar que todo el sistema está funcionando correctamente.

