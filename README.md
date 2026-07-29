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
<summary><strong>Zugriff nur über VPN/Mesh (z. B. Netbird/Tailscale) statt öffentlichem Internet?</strong></summary>

Empfohlen, wenn ein öffentlicher Server (z. B. bei Netcup) nur für die eigenen,
bereits per VPN verbundenen Geräte erreichbar sein soll — keine öffentliche
Domain nötig, kein Port 80/443 im Internet-Firewall des Hosters.

Da `app`/`web`/`docker-proxy` mit `network_mode: host` laufen, hört Caddy
automatisch auch auf dem VPN-Interface (z. B. `netbird0`/`wt0`) — **ohne
Änderung an `docker-compose.yml`**. Nötig ist nur:

1. Beim Hoster (z. B. Netcup) **nur den VPN-Port freigeben**
   (Netbird/WireGuard-Standard: `51820/UDP`) — **Port 80/443 in der externen
   Firewall geschlossen lassen**. VPN-Traffic kommt getunnelt über den
   freigegebenen UDP-Port an und landet lokal auf dem VPN-Interface; der
   Hoster-Edge sieht den entschlüsselten HTTPS-Traffic gar nicht.
2. `MC_SITE_ADDRESS` unverändert bei `"localhost"` lassen (oder auf die
   VPN-IP setzen — funktional identisch). Eine echte Let's-Encrypt-Domain
   funktioniert hier ohnehin nicht: Zertifikate für private/CGNAT-Adressen
   (Netbirds `100.64.0.0/10`-Range) stellt Let's Encrypt nicht aus.
3. Von jedem VPN-verbundenen Gerät: `https://<vpn-ip-des-servers>` öffnen.

Einziger Nachteil: Browser-Warnung wegen des selbstsignierten Zertifikats
(wie bei `localhost`). Lässt sich ohne öffentliche Domain sauber vermeiden,
indem man Caddys eigenes Root-Zertifikat einmalig auf die zugreifenden
Geräte verteilt:

```bash
docker compose cp web:/data/caddy/pki/authorities/local/root.crt ./minecontrol-ca.crt
```

`minecontrol-ca.crt` danach als vertrauenswürdige CA in den Zertifikatsspeicher
jedes Geräts importieren (Windows/macOS/Linux-Systemspeicher oder
Firefox-eigener Store) — danach ist `https://<vpn-ip>` ohne Warnung grün.
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

- **Vertrauenswürdige Umgebung:** Nur der `docker-proxy`-Container mountet
  `/var/run/docker.sock`, gibt aber nur die von MineControl genutzten
  API-Gruppen durch (Container/Exec/Netzwerke/Volumes/Images — nicht
  Swarm/Secrets/Build/System). `app` selbst hat keinen Socket-Zugriff mehr und
  läuft als unprivilegierter User. Das schließt die Kernfunktion aber nicht
  vollständig ein: Container mit beliebigen Bind-Mounts/`--privileged` zu
  erzeugen ist genau das, wofür MineControl den Socket braucht, und bleibt
  root-äquivalent. MineControl daher weiterhin nur im LAN/VPN bzw. in
  vertrauenswürdiger Umgebung betreiben.
- **Host-Networking (Linux):** Der `app`-Container nutzt `network_mode: host`.
  Die verwalteten Minecraft-Container binden ihre Ports bewusst nur an
  `127.0.0.1` (Security-Design, PLANNING.md §7); das Backend erreicht sie
  darüber per RCON/Ping und lauscht selbst nur auf `127.0.0.1:3000` — von außen
  kommt man ausschließlich über Caddy (TLS) rein.
- **TLS-Pflicht:** Session-Cookies werden produktiv mit `Secure` gesetzt — der
  Zugriff muss über HTTPS erfolgen (das erledigt Caddy).
- **Persistente Daten** (SQLite-DB, Welt-Backups, Import-Staging) liegen im
  Named Volume `mc-data`. Beim allerersten Start wird der Admin aus
  `SEED_ADMIN_USER`/`SEED_ADMIN_PASSWORD` angelegt.
- **DB-Snapshots:** Zusätzlich zu den Welt-Backups (im UI) sichert MineControl
  täglich (`DB_BACKUP_CRON`, Default 03:00) einen konsistenten Snapshot der
  Control-Plane-DB selbst — Benutzer, Secrets, Servertopologie — in ein
  eigenes Volume `mc-db-backups`, getrennt von `mc-data`. Für eine echte
  Ausfallsicherheit trotzdem regelmäßig beide Volumes extern sichern, z. B.:
  `docker run --rm -v mc-db-backups:/from -v /pfad/auf/host:/to alpine cp -a /from/. /to/`.

<details>
<summary><strong>Wie ist das Deployment aufgebaut?</strong></summary>

MineControl läuft als drei Container (siehe `docker-compose.yml`):

- **`app`** — Fastify-Backend (REST + WebSocket), erzeugt/steuert die
  Minecraft-Container über `docker-proxy` (nicht mehr direkt über den Socket).
  Läuft als unprivilegierter User `node`; nur beim allerersten Start bzw. bei
  einem Upgrade übernimmt der Entrypoint kurz als root die Eigentümerschaft
  neuer/bestehender Volumes, bevor er per `setpriv` dauerhaft auf `node`
  wechselt (siehe `deploy/entrypoint.sh`).
- **`docker-proxy`** — einziger Container mit Zugriff auf
  `/var/run/docker.sock`, reicht nur eingeschränkte API-Gruppen durch
  ([tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)).
- **`web`** — Caddy: liefert die SPA aus und terminiert TLS (Reverse-Proxy).

Die Images werden von GitHub Actions (`.github/workflows/release.yml`) bei
jedem Push auf `main` und bei Versions-Tags (`v*`) automatisch als **Multi-Arch**
(amd64 + arm64) nach GHCR gebaut: `ghcr.io/bhuaysan/minecontrol-app` und
`…/minecontrol-web`.
</details>

### Umgebungsvariablen (Referenz)

**Produktiv (`.env` im Repo-Root, wirkt über `docker-compose.yml`):**

| Variable                    | Pflicht | Default             | Beschreibung                                                                                                                             |
| --------------------------- | ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`            | ✅ Ja   | –                   | Signiert Session-Cookies. ≥32 Zeichen, zufällig (`openssl rand -base64 48`).                                                             |
| `ENCRYPTION_KEY`            | ✅ Ja   | –                   | 64 Hex-Zeichen (32 Byte), verschlüsselt gespeicherte Secrets (RCON-Passwörter, SMTP, TOTP). **Nicht nachträglich änderbar.**             |
| `SEED_ADMIN_USER`           | Nein    | `admin`             | Benutzername des Erststart-Admins.                                                                                                       |
| `SEED_ADMIN_PASSWORD`       | ✅ Ja   | –                   | Passwort des Erststart-Admins. Darf nicht `changeme` sein — Container startet sonst produktiv nicht.                                     |
| `MC_SITE_ADDRESS`           | Nein    | `localhost`         | Domain/Adresse für Caddys Auto-HTTPS. `localhost` → interne CA (Browser-Warnung); echte Domain → automatisches Let's-Encrypt-Zertifikat. |
| `MC_WEB_ORIGIN`             | Nein    | `https://localhost` | CORS-Origin (→ `WEB_ORIGIN` im `app`-Container). Bei gleicher Herkunft (Standard) unkritisch.                                            |
| `MC_IMAGE_TAG`              | Nein    | `latest`            | GHCR-Image-Tag, z. B. `1.2.0` oder `sha-abc1234`, statt `latest`.                                                                        |
| `IMPORT_MAX_MB`             | Nein    | `10240`             | Obergrenze (MB) für Server-Import-Uploads/entpackte Archivgröße.                                                                         |
| `MODS_MAX_MB`               | Nein    | `200`               | Obergrenze (MB) für Plugin-/Mod-Uploads.                                                                                                 |
| `AUTO_RESTART_GRACE_MIN`    | Nein    | `5`                 | Minuten, die ein Docker-Server unerreichbar sein darf, bevor Auto-Restart greift.                                                        |
| `AUTO_RESTART_MAX_ATTEMPTS` | Nein    | `3`                 | Max. aufeinanderfolgende Auto-Restart-Versuche, bevor aufgegeben wird.                                                                   |
| `DB_BACKUP_CRON`            | Nein    | `0 3 * * *`         | Cron-Ausdruck für den täglichen Snapshot der Control-Plane-DB.                                                                           |
| `DB_BACKUP_RETENTION`       | Nein    | `14`                | Anzahl aufgehobener DB-Snapshots, bevor die ältesten gelöscht werden.                                                                    |
| `CF_API_KEY`                | Nein    | leer                | Eigener CurseForge-API-Key für Modpacks. Leer = eingebauter Key des itzg-Images.                                                         |
| `APP_MEM_LIMIT`             | Nein    | `1g`                | Memory-Limit des `app`-Containers.                                                                                                       |
| `APP_CPU_LIMIT`             | Nein    | `2`                 | CPU-Limit des `app`-Containers.                                                                                                          |
| `WEB_MEM_LIMIT`             | Nein    | `256m`              | Memory-Limit des `web`-Containers (Caddy).                                                                                               |
| `WEB_CPU_LIMIT`             | Nein    | `1`                 | CPU-Limit des `web`-Containers (Caddy).                                                                                                  |

<details>
<summary><strong>Intern in <code>docker-compose.yml</code> fest verdrahtet (nicht über <code>.env</code> änderbar)</strong></summary>

Diese Variablen bekommt der `app`-Container ebenfalls gesetzt, aber mit
festem Wert statt `${...}`-Platzhalter — bewusst kein Betreiber-Tuning, da
sie die Container-Topologie selbst beschreiben. Nur relevant, wenn man
`docker-compose.yml` direkt anpasst:

| Variable             | Wert (fest)              | Beschreibung                                                                        |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `NODE_ENV`           | `production`             | Schaltet die Produktiv-Validierungen scharf (Platzhalter-Secrets, `Secure`-Cookie). |
| `HOST`               | `127.0.0.1`              | Backend lauscht nur auf Loopback — von außen kommt man nur über Caddy rein.         |
| `PORT`               | `3000`                   | Backend-Port.                                                                       |
| `DOCKER_HOST`        | `tcp://127.0.0.1:2375`   | Ziel für dockerode — der `docker-proxy`-Container, nicht der rohe Socket.           |
| `DATABASE_URL`       | `file:/data/dev.db`      | Prisma-Connection-String (SQLite).                                                  |
| `BACKUP_DIR`         | `/data/backups`          | Ablage der Welt-Backups (tar.gz je Server).                                         |
| `IMPORT_DIR`         | `/data/imports`          | Server-seitig bereitgestellte Import-Archive.                                       |
| `IMPORT_STAGING_DIR` | `/data/imports/.staging` | Staging für per Browser hochgeladene Import-Archive.                                |
| `DB_BACKUP_DIR`      | `/db-backups`            | Ablage der automatischen DB-Snapshots (eigenes Volume `mc-db-backups`).             |

</details>

**Lokale Entwicklung (`apps/server/.env`, nur `pnpm dev` — nicht docker-compose):**

Dieselben inhaltlichen Regeln wie oben (Secrets, Limits, Backups), aber
direkt von `config.ts` gelesen statt über `docker-compose.yml` gereicht —
daher auch ein paar zusätzliche, hier sinnvolle Variablen:

| Variable                                                                                                                                     | Pflicht  | Default                                                           | Beschreibung                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                                                                                                                       | Nein     | `3000`                                                            | Backend-Port. Bei Kollision z. B. `3055` setzen.                                                                                                 |
| `HOST`                                                                                                                                       | Nein     | `127.0.0.1`                                                       | Bind-Adresse des Backends.                                                                                                                       |
| `DATABASE_URL`                                                                                                                               | ✅ Ja    | –                                                                 | Prisma-Connection-String, i. d. R. `file:./dev.db`.                                                                                              |
| `WEB_ORIGIN`                                                                                                                                 | Nein     | `http://localhost:5173`                                           | CORS-Origin des Vite-Dev-Servers.                                                                                                                |
| `BACKUP_DIR` / `IMPORT_DIR` / `IMPORT_STAGING_DIR` / `DB_BACKUP_DIR`                                                                         | Nein     | `./backups` / `./imports` / `./imports/.staging` / `./backups-db` | Lokale Pfade statt Volumes.                                                                                                                      |
| Alle übrigen (`SESSION_SECRET`, `ENCRYPTION_KEY`, `SEED_ADMIN_*`, `*_MAX_MB`, `AUTO_RESTART_*`, `DB_BACKUP_CRON`/`_RETENTION`, `CF_API_KEY`) | wie oben | wie oben                                                          | Gleiche Bedeutung wie im Produktiv-Abschnitt.                                                                                                    |
| `MC_SERVER_PORT`                                                                                                                             | Nein     | `3000`                                                            | **Keine `.env`-Variable** — Shell-Variable für `pnpm dev`, zeigt den Vite-Proxy auf einen abweichenden Backend-Port (`apps/web/vite.config.ts`). |

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
