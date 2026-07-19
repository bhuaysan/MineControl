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

## Stand

**Phase 1 (MVP) — Grundgerüst steht:** Login/Rollen, externer Server-Adapter
(Server List Ping + RCON), Dashboard mit Live-Status via WebSocket, Server-Detail
mit RCON-Befehlen, Audit-Log. Nächste Schritte siehe PLANNING.md §5.
