# MineControl

Webbasiertes Verwaltungstool für Minecraft-Server (Java Edition) — verwaltet
**selbst erstellte Docker-Server** und **bereits laufende externe Server** in einer
Oberfläche.

Planung: [PLANNING.md](PLANNING.md) · Frontend: [FRONTEND.md](FRONTEND.md)

## Monorepo-Struktur

```
apps/
  server/   Fastify-Backend (REST + WebSocket, Prisma/SQLite)
  web/      React-Frontend (Vite, Tailwind, TanStack Query)
packages/
  shared/   Geteilte TypeScript-Typen (API-DTOs, WS-Events, Rollen)
```

## Voraussetzungen

- Node.js 22+
- pnpm 11+

## Einrichtung

```bash
pnpm install

# Backend konfigurieren
cd apps/server
cp .env.example .env
# ENCRYPTION_KEY und SESSION_SECRET setzen (Zufallswerte):
#   sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=\"$(openssl rand -hex 32)\"/" .env
#   sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=\"$(openssl rand -hex 32)\"/" .env

# Datenbank + Admin-Benutzer anlegen (nutzt SEED_ADMIN_USER/PASSWORD)
pnpm db:migrate
```

## Entwicklung

```bash
# Backend (Port aus .env, Standard 3000) und Frontend (Port 5173) parallel
pnpm dev

# oder einzeln
pnpm dev:server
pnpm dev:web
```

Frontend unter <http://localhost:5173> öffnen. Der Vite-Dev-Server proxyt `/api`
und `/ws` ans Backend, damit das Session-Cookie same-origin bleibt.

Läuft auf Port 3000 schon eine andere App, das Backend auf einen freien Port
legen: in `apps/server/.env` `PORT=3055` setzen **und** den Frontend-Proxy per
`MC_SERVER_PORT` darauf zeigen lassen:

```bash
MC_SERVER_PORT=3055 pnpm dev
```

Standard-Login (aus `.env`): `admin` / `changeme` — **nach dem ersten Start ändern.**

## Nützliche Skripte

| Befehl | Wirkung |
|---|---|
| `pnpm build` | Alle Pakete bauen (topologisch) |
| `pnpm typecheck` | TypeScript über alle Pakete prüfen |
| `pnpm db:migrate` | Prisma-Migration + Seed |
| `pnpm --filter @minecontrol/server db:studio` | Prisma Studio |

## Deployment (Produktivbetrieb)

MineControl läuft als zwei Container (siehe `docker-compose.yml`): das
**Backend** (`app`) und **Caddy** (`web`), das die SPA ausliefert und TLS
terminiert. Voraussetzung: Docker + Docker Compose auf einem **Linux**-Host.

```bash
# 1. Umgebung anlegen und Secrets setzen
cp .env.example .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=\"$(openssl rand -base64 48)\"|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=\"$(openssl rand -hex 32)\"|" .env
# SEED_ADMIN_PASSWORD in .env eintragen (Erststart-Admin).
# Für eine öffentliche Domain zusätzlich MC_SITE_ADDRESS=mc.example.com setzen.

# 2. Bauen und starten
docker compose up -d --build

# 3. Öffnen: https://<MC_SITE_ADDRESS>  (bei localhost: Browser-Warnung des
#    selbstsignierten Zertifikats akzeptieren)
```

Der `app`-Container wendet beim Start automatisch die DB-Migrationen an
(`prisma migrate deploy`) und legt beim allerersten Start den Admin aus
`SEED_ADMIN_USER`/`SEED_ADMIN_PASSWORD` an. Persistente Daten (SQLite-DB,
Backups, Import-Staging) liegen im Named Volume `mc-data`.

**Wichtige Betriebshinweise:**

- **Host-Networking (Linux):** Der `app`-Container nutzt `network_mode: host`.
  Grund: die verwalteten Minecraft-Container binden ihre Ports bewusst nur an
  `127.0.0.1` des Hosts (Security-Design, PLANNING.md §7); das Backend erreicht
  sie darüber per RCON/Ping. Das Backend selbst lauscht nur auf `127.0.0.1:3000`
  — von außen kommt man ausschließlich über Caddy (TLS) rein.
- **Docker-Socket:** Das Backend mountet `/var/run/docker.sock` (= Root-
  Äquivalent auf dem Host). MineControl daher nur in vertrauenswürdiger
  Umgebung betreiben, idealerweise im LAN/VPN.
- **TLS-Pflicht:** Session-Cookies werden im Produktivbetrieb mit `Secure`
  gesetzt — der Zugriff muss über HTTPS erfolgen (das erledigt Caddy).
- **Updates:** `git pull && docker compose up -d --build`. Migrationen laufen
  beim Neustart automatisch.

## Stand

Alle vier geplanten Phasen (PLANNING.md §5) sind umgesetzt — Details im
Projekt-Memory und in der Git-Historie. Produktiv-Deployment via
`docker-compose.yml` (siehe oben).
