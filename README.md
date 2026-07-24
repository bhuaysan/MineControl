# MineControl

[![CI](https://github.com/bhuaysan/MineControl/actions/workflows/ci.yml/badge.svg)](https://github.com/bhuaysan/MineControl/actions/workflows/ci.yml)
[![Release](https://github.com/bhuaysan/MineControl/actions/workflows/release.yml/badge.svg)](https://github.com/bhuaysan/MineControl/actions/workflows/release.yml)

Webbasiertes Verwaltungstool für Minecraft-Server (Java Edition) — verwaltet
**selbst erstellte Docker-Server** und **bereits laufende externe Server** in einer
Oberfläche. Erstellen, starten/stoppen, Konsole, Backups, Plugins/Mods, Import
bestehender Welten, Benutzerrollen, mehrsprachige Oberfläche (de/en).

> **Wer ist „Anwender"?** MineControl richtet sich an die Person, die den
> Verwaltungs-Server **selbst hostet** (Self-Hoster / Betreiber). Minecraft-
> _Spieler_ brauchen MineControl nicht — sie verbinden sich wie gewohnt per
> Client zur Server-Adresse.

---

## 🚀 Schnellstart (Betreiber)

Der schnellste Weg, MineControl produktiv laufen zu lassen — mit den
vorgebauten Images aus GHCR.

**Voraussetzungen:** ein **Linux**-Host mit **Docker** + **Docker Compose**.
(Host-Networking ist Linux-spezifisch — auf Windows/macOS läuft dieses Setup
nicht unverändert; dort den Entwicklungs-Modus weiter unten nutzen.)

```bash
# 1. Repo holen (liefert docker-compose.yml + .env.example)
git clone https://github.com/bhuaysan/MineControl.git
cd MineControl

# 2. Umgebung anlegen und Secrets erzeugen
cp .env.example .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=\"$(openssl rand -base64 48)\"|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=\"$(openssl rand -hex 32)\"|" .env

# 3. WICHTIG: Admin-Passwort für den ersten Login setzen (in .env)
#    Zeile  SEED_ADMIN_PASSWORD="..."  mit einem eigenen Wert füllen.
#    (Ohne dieses Passwort startet der Container bewusst nicht.)
${EDITOR:-nano} .env

# 4. Images ziehen und starten
docker compose pull
docker compose up -d
```

Dann öffnen: **<https://localhost>** — mit `admin` und dem gesetzten Passwort
einloggen. Bei `localhost` nutzt Caddy ein selbstsigniertes Zertifikat, die
einmalige Browser-Warnung also akzeptieren.

Ab jetzt kannst du in der Oberfläche Minecraft-Server anlegen und verwalten.
**Passwort nach dem ersten Login im UI ändern.**

<details>
<summary><strong>Öffentliche Domain statt localhost?</strong></summary>

Für den Zugriff über eine eigene Domain in der `.env` setzen:

```bash
MC_SITE_ADDRESS="mc.example.com"   # Caddy holt automatisch Let's-Encrypt-TLS
MC_WEB_ORIGIN="https://mc.example.com"
```

Port **80** und **443** müssen dafür aus dem Internet erreichbar sein.
</details>

<details>
<summary><strong>Fehler beim <code>docker compose pull</code> (Auth/Not found)?</strong></summary>

GHCR-Pakete sind anfangs **privat**. Entweder in den GitHub-Package-
Einstellungen auf _public_ stellen, oder auf dem Server einmalig
`docker login ghcr.io` mit einem PAT (Scope `read:packages`) ausführen.

Alternativ ganz ohne vorgebaute Images lokal aus dem Quellcode bauen:

```bash
docker compose up -d --build
```

</details>

### Aktualisieren

```bash
docker compose pull && docker compose up -d
```

Zieht die neuesten GHCR-Images und startet neu; DB-Migrationen
(`prisma migrate deploy`) laufen dabei automatisch. Auf eine feste Version
pinnen via `MC_IMAGE_TAG` in `.env` (z. B. `MC_IMAGE_TAG=1.2.0` oder
`MC_IMAGE_TAG=sha-abc1234`). Standard ist `latest` (folgt dem letzten
`main`-Push).

### Betriebshinweise (bitte lesen)

- **Vertrauenswürdige Umgebung:** Das Backend mountet `/var/run/docker.sock`
  (= Root-Äquivalent auf dem Host). MineControl daher nur im LAN/VPN bzw. in
  vertrauenswürdiger Umgebung betreiben.
- **Host-Networking (Linux):** Der `app`-Container nutzt `network_mode: host`.
  Die verwalteten Minecraft-Container binden ihre Ports bewusst nur an
  `127.0.0.1` (Security-Design, PLANNING.md §7); das Backend erreicht sie
  darüber per RCON/Ping und lauscht selbst nur auf `127.0.0.1:3000` — von außen
  kommt man ausschließlich über Caddy (TLS) rein.
- **TLS-Pflicht:** Session-Cookies werden produktiv mit `Secure` gesetzt — der
  Zugriff muss über HTTPS erfolgen (das erledigt Caddy).
- **Persistente Daten** (SQLite-DB, Backups, Import-Staging) liegen im Named
  Volume `mc-data`. Beim allerersten Start wird der Admin aus
  `SEED_ADMIN_USER`/`SEED_ADMIN_PASSWORD` angelegt.

<details>
<summary><strong>Wie ist das Deployment aufgebaut?</strong></summary>

MineControl läuft als zwei Container (siehe `docker-compose.yml`):

- **`app`** — Fastify-Backend (REST + WebSocket), erzeugt/steuert die
  Minecraft-Container über den gemounteten Docker-Socket.
- **`web`** — Caddy: liefert die SPA aus und terminiert TLS (Reverse-Proxy).

Die Images werden von GitHub Actions (`.github/workflows/release.yml`) bei
jedem Push auf `main` und bei Versions-Tags (`v*`) automatisch als **Multi-Arch**
(amd64 + arm64) nach GHCR gebaut: `ghcr.io/bhuaysan/minecontrol-app` und
`…/minecontrol-web`.
</details>

---

## 🛠️ Für Entwickler

Lokales Setup zum Weiterentwickeln (ohne Docker, mit Hot-Reload).

**Voraussetzungen:** Node.js 22+ · pnpm 11+

```bash
pnpm install

# Backend konfigurieren
cd apps/server
cp .env.example .env
# ENCRYPTION_KEY und SESSION_SECRET als Zufallswerte setzen:
#   sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=\"$(openssl rand -hex 32)\"/" .env
#   sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=\"$(openssl rand -hex 32)\"/" .env

# Datenbank + Admin-Benutzer anlegen (nutzt SEED_ADMIN_USER/PASSWORD)
pnpm db:migrate
```

Starten:

```bash
# Backend (Port aus .env, Standard 3000) und Frontend (Port 5173) parallel
pnpm dev

# oder einzeln
pnpm dev:server
pnpm dev:web
```

Frontend unter <http://localhost:5173> öffnen. Der Vite-Dev-Server proxyt
`/api` und `/ws` ans Backend, damit das Session-Cookie same-origin bleibt.
Standard-Login (aus `.env`): `admin` / `changeme` — **nach dem ersten Start
ändern.**

Läuft auf Port 3000 schon eine andere App, das Backend auf einen freien Port
legen: in `apps/server/.env` `PORT=3055` setzen **und** den Frontend-Proxy per
`MC_SERVER_PORT` darauf zeigen lassen:

```bash
MC_SERVER_PORT=3055 pnpm dev
```

### Monorepo-Struktur

```
apps/
  server/   Fastify-Backend (REST + WebSocket, Prisma/SQLite)
  web/      React-Frontend (Vite, Tailwind, TanStack Query)
packages/
  shared/   Geteilte TypeScript-Typen (API-DTOs, WS-Events, Rollen)
```

### Nützliche Skripte

| Befehl                                        | Wirkung                            |
| --------------------------------------------- | ---------------------------------- |
| `pnpm build`                                  | Alle Pakete bauen (topologisch)    |
| `pnpm typecheck`                              | TypeScript über alle Pakete prüfen |
| `pnpm db:migrate`                             | Prisma-Migration + Seed            |
| `pnpm --filter @minecontrol/server db:studio` | Prisma Studio                      |

Mehr Kontext: [PLANNING.md](PLANNING.md) · [FRONTEND.md](FRONTEND.md)

---

## Stand

Alle vier geplanten Phasen (PLANNING.md §5) sind umgesetzt — Details im
Projekt-Memory und in der Git-Historie. Produktiv-Deployment via
`docker-compose.yml` (siehe [Schnellstart](#-schnellstart-betreiber)).
