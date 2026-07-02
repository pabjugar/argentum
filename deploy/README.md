# Despliegue aomania-lambda — Corsair + Podman + Tailscale

Runbook para levantar el server web de Argentum (fork de lambdaclass) en el Corsair,
jugable en el navegador por amigos vía Tailscale. Ver `../../PLAN.md` y `../../ANALISIS.md`
para el contexto.

## El delta: qué faltaba desarrollar (verificado leyendo el código)

Respecto al estado actual del repo, para NUESTRO objetivo (levantarlo yo y jugar con amigos)
faltaba **sólo esto** — nada de lógica de juego:

| # | Hueco | Naturaleza | Estado |
|---|-------|-----------|--------|
| 1 | El `server/Dockerfile` no construye el cliente ni copia `resources/`+`client/dist` al runner → SPA/gráficos/map-pack darían 404 (el plug `StaticAssets` descarta rutas cuyo dir no existe). | Build/devops | **Resuelto** en `deploy/Containerfile` |
| 2 | No existe servicio de la app para levantarla (el compose de upstream sólo trae Postgres/Prometheus/Grafana). | Devops | **Resuelto** en `deploy/compose.yaml` |
| 3 | El release de prod no tenía comando de migración (sin Mix no hay `mix ecto.migrate`). | Código (mínimo) | **Resuelto**: `apps/game_backend/lib/game_backend/release.ex` (`GameBackend.Release.migrate/0`) |
| 4 | Anclar la resolución de rutas de assets en el contenedor. | Config | **Resuelto**: `ARGENTUM_PROJECT_ROOT=/app` en el Containerfile |
| 5 | GM/Dios para `pabjugar`. | Operativa (SQL) | Paso manual (§4). El personaje con columna `gm=true` se trata como `:admin` |
| 6 | Exponer HTTP (3000) + WS (7667) por Tailscale. | Operativa | §3. MVP = HTTP plano (sin cambios de cliente) |

**Fuera de alcance** (del ROADMAP de lambdaclass, no lo necesitamos): parity harness, load/soak,
observabilidad, anti-cheat, Google OAuth, i18n, multi-realm. Ver `../../PLAN.md`.

### Arquitectura de red (por qué dos puertos)
- **Puerto 3000 (HTTP, endpoint Phoenix):** sirve la SPA, la API `/api/*` (login/registro/lobby/
  ranking) y los **assets del juego** (gráficos, índices, sonidos, map-pack) vía el plug
  `ArenaWeb.StaticAssets`.
- **Puerto 7667 (WebSocket, gateway Cowboy, path `/ao`):** el transporte del juego (protocolo AO20).
  El cliente arma `ws://<hostname>:7667/ao` derivando el host de `window.location.hostname`
  (`client/src/app/appReducer.ts`), así que apuntando el navegador al nombre Tailscale, el WS
  resuelve solo.
- (7666 TCP = cliente legacy VB6; no lo necesitamos para jugar en navegador.)

## 1. Build de la imagen (en el Corsair)

Clonar el fork y construir con contexto = raíz del repo:

```bash
git clone https://github.com/pabjugar/argentum.git ~/aomania-lambda
cd ~/aomania-lambda
git checkout deploy/corsair-podman
podman build -f deploy/Containerfile -t aomania-lambda:latest .
```

> Build pesado (Elixir + Rust NIF + Node + genera el map pack de 843 mapas). Primera vez tarda.
> Es la fase con más riesgo de fricción Podman ↔ multi-stage; iterar aquí si algo falla.

## 2. Configurar y arrancar

```bash
cp deploy/env.example deploy/.env
# editar deploy/.env: POSTGRES_PASSWORD, SECRET_KEY_BASE, PHX_HOST
# generar SECRET_KEY_BASE:
podman run --rm aomania-lambda:latest \
  bin/argentum eval 'IO.puts(Base.encode64(:crypto.strong_rand_bytes(48)))'

podman compose -f deploy/compose.yaml --env-file deploy/.env up -d

# migraciones (primera vez y tras actualizar):
podman compose -f deploy/compose.yaml --env-file deploy/.env \
  exec app bin/argentum eval 'GameBackend.Release.migrate()'
```

Verificar salud: `curl http://localhost:3000/api/health` → OK; `podman ps` app+db sanos.

## 3. Exponer por Tailscale

**MVP (recomendado): HTTP plano, cero cambios de cliente.** Los amigos abren:

- `http://corsair.tailc48014.ts.net:3000/`

Y el cliente conecta el WS a `ws://corsair.tailc48014.ts.net:7667/ao` automáticamente. Los puertos
3000 y 7667 ya escuchan en `0.0.0.0`; Tailscale los alcanza dentro del tailnet. No hace falta abrir
nada al internet público.

> **HTTPS/WSS (más adelante, opcional):** si se sirve por `https://` (p. ej. `tailscale serve`),
> el navegador **bloqueará** el `ws://` por mixed-content y habrá que: (a) un reverse-proxy que
> haga TLS y upgrade del WS, y (b) parchear el cliente para usar `wss://`
> (`client/src/app/appReducer.ts` / `SessionClient.ts`). No es necesario para el MVP.

## 4. Hacerme GM/Dios (pabjugar)

1. Abrir el cliente, registrarme y **crear el personaje `pabjugar`**.
2. Marcarlo como GM en la DB (se trata como tier `:admin`):

```bash
podman compose -f deploy/compose.yaml --env-file deploy/.env exec db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "UPDATE characters SET gm = true WHERE name = 'pabjugar';"
```

3. Reconectar. Los comandos GM en chat requieren `is_gm == true` (derivado de `gm`).

## 5. On / Off del server (sin perder datos)

```bash
podman compose -f deploy/compose.yaml --env-file deploy/.env stop app   # off (DB intacta)
podman compose -f deploy/compose.yaml --env-file deploy/.env start app   # on
```

Los personajes viven en el volumen `aomania_db_data` (Postgres); parar la app no los borra.

## Pendiente de verificar en la primera pasada
- Que el `podman build` completa (NIF Rust + protobuf + Node) sin tocar el Containerfile.
- Que `npm run build` genera el map pack sin mapas "skipped" relevantes.
- Que el endpoint sirve `/graficos`, `/indices`, `/data` y la SPA (no 404) desde `/app`.
- Migración limpia y creación de cuenta/personaje end-to-end.
