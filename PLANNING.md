# MineControl — Planungsdokument

Webbasiertes Verwaltungstool für Minecraft-Server (Java Edition).
Läuft als Docker-Container auf einem Homeserver/VM, verwaltet sowohl **selbst erstellte
Server (Docker)** als auch **bereits laufende externe Server** (via RCON/Query).

Stand: 2026-07-18 · Frontend-Detailplanung: [FRONTEND.md](FRONTEND.md)

---

## 1. Grundentscheidungen

| Thema | Entscheidung |
|---|---|
| Backend | TypeScript / Node.js |
| Frontend | Web-App (React), gleiche Sprache wie Backend |
| Nutzer | Multi-User mit Rollen (Admin, Moderator, Viewer) |
| Servertypen | Vanilla, Paper/Spigot, Modded (Forge/Fabric/NeoForge), Proxy (Velocity/BungeeCord) |
| Deployment | Docker-Container auf Homeserver, Zugriff per Browser |

---

## 2. Architektur

```
┌─────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                    │
│  Dashboard · Konsole · Spieler · Einstellungen          │
└───────────────┬─────────────────────────────────────────┘
                │ REST (CRUD) + WebSocket (Live-Daten)
┌───────────────▼─────────────────────────────────────────┐
│  MineControl Backend (Node.js / Fastify)                │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐  │
│  │ Auth &   │ │ Server-  │ │ Scheduler │ │ Backup-   │  │
│  │ Rollen   │ │ Manager  │ │ (Cron)    │ │ Service   │  │
│  └──────────┘ └────┬─────┘ └───────────┘ └───────────┘  │
│                    │                                    │
│         ┌──────────┴──────────┐                         │
│         ▼                     ▼                         │
│  ┌──────────────┐      ┌──────────────┐                 │
│  │ DockerAdapter│      │ExternalAdapter│                │
│  │ (dockerode)  │      │ (RCON/Query) │                 │
│  └──────┬───────┘      └──────┬───────┘                 │
└─────────┼─────────────────────┼─────────────────────────┘
          ▼                     ▼
   Docker-Container      Externe MC-Server
   (itzg/minecraft-      (beliebiger Host,
    server Image)         RCON aktiviert)
```

### Kernkonzept: Server-Adapter

Jeder verwaltete Server implementiert dasselbe Interface — egal ob Docker oder extern.
Das Frontend merkt keinen Unterschied; nur der Funktionsumfang variiert.

```ts
interface ServerAdapter {
  // Lifecycle — nur Docker kann wirklich starten/stoppen
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;

  // Für beide Typen verfügbar
  getStatus(): Promise<ServerStatus>;      // online, Spieler, Version, MOTD
  sendCommand(cmd: string): Promise<string>; // via RCON
  getPlayers(): Promise<Player[]>;
  streamLogs(): AsyncIterable<LogLine>;    // Docker: logs · Extern: nicht verfügbar

  capabilities(): Capability[];            // UI blendet Nicht-Verfügbares aus
}
```

| Fähigkeit | Docker-Server | Externer Server |
|---|---|---|
| Status, Spielerliste (Query/Ping) | ✅ | ✅ |
| Befehle, Kick/Ban/Whitelist (RCON) | ✅ | ✅ (RCON nötig) |
| Start / Stop / Restart | ✅ | ⚠️ nur Stop via RCON, Start nicht möglich |
| Live-Konsole / Logs | ✅ | ❌ |
| Dateizugriff, Backups, server.properties | ✅ | ❌ |
| CPU-/RAM-Metriken | ✅ | ❌ |

> **Bewusste Abgrenzung:** Externe Server werden ausschließlich über RCON/Ping
> verwaltet (Status, Spieler, Befehle, Kick/Ban/Whitelist). Die ❌-Lücken
> (Start, Logs, Dateien, Metriken) bleiben Docker-Servern vorbehalten. Ein
> früher angedachter „MineControl Agent" auf dem externen Host wurde als zu
> aufwendig **verworfen** — RCON-Verwaltung reicht aus.

### Relevante Protokolle & Bausteine

- **RCON** — Befehle an laufende Server senden (`rcon-client` npm-Paket). Muss in
  `server.properties` aktiviert sein (`enable-rcon=true`).
- **Server List Ping / Query** — Status & Spielerliste ohne Auth (`minecraft-protocol`
  oder eigene Implementierung, ist simpel).
- **Docker** — `dockerode` npm-Paket, Zugriff über `/var/run/docker.sock`.
- **itzg/minecraft-server** — das Standard-Docker-Image; unterstützt per Env-Variablen:
  Vanilla, Paper, Spigot, Forge, Fabric, NeoForge, Modpacks (CurseForge/Modrinth),
  Auto-Download der Server-JAR, RCON out-of-the-box. Spart uns enorm viel Arbeit.
- **mc-router / Velocity** — später für Netzwerk-Setups mit mehreren Servern hinter einem Port.

---

## 3. Tech-Stack (konkret)

| Schicht | Wahl | Begründung |
|---|---|---|
| Runtime | Node.js 22 LTS + TypeScript | Ein Stack für alles |
| HTTP-Framework | Fastify | Schnell, gutes TS-Typing, Plugin-System |
| WebSockets | `@fastify/websocket` | Live-Konsole, Status-Updates, Metriken |
| ORM + DB | Prisma + SQLite | Kein DB-Server nötig; Migration auf PostgreSQL später möglich |
| Auth | Sessions (Cookie) + `argon2` Passwort-Hashing | Einfach & sicher für Self-Hosting |
| Frontend | React + Vite + TypeScript | Standard, schnelles Tooling |
| UI | Tailwind CSS + shadcn/ui | Schnell hübsche, konsistente UI |
| Konsole | xterm.js | Echtes Terminal-Feeling für die Server-Konsole |
| Docker-API | dockerode | De-facto-Standard |
| RCON | rcon-client | Bewährt, TS-Typen |
| Jobs/Cron | node-cron o. BullMQ (später) | Geplante Restarts, Backups |
| Monorepo | pnpm workspaces: `apps/server`, `apps/web`, `packages/shared` | Geteilte Typen zwischen Front- und Backend |

---

## 4. Datenmodell (Entwurf)

```
User          id, username, passwordHash, role (ADMIN|MODERATOR|VIEWER), createdAt
Server        id, name, type (DOCKER|EXTERNAL), edition (PAPER|VANILLA|FORGE|FABRIC|VELOCITY|...),
              host, port, rconPort, rconPassword (verschlüsselt),
              dockerContainerId?, dockerConfig? (JSON: Version, RAM, Env, Volumes)
Player        uuid, lastKnownName, firstSeen, lastSeen, notes
PlayerSession playerId, serverId, joinedAt, leftAt          → Playtime-Statistiken
AuditLog      id, userId, serverId?, action, details (JSON), timestamp
BackupJob     id, serverId, schedule (cron), retention, targetPath
Backup        id, serverId, path, sizeBytes, createdAt, trigger (MANUAL|SCHEDULED)
ScheduledTask id, serverId, cron, action (RESTART|COMMAND|BACKUP), payload
```

---

## 5. Features

### Phase 1 — MVP „Sehen & Steuern" ✅ abgeschlossen
- [x] Login, User-Verwaltung, Rollen (Admin/Moderator/Viewer)
- [x] Server hinzufügen: **extern** (Host, Port, RCON-Daten) — der einfachere Adapter zuerst
- [x] Dashboard: alle Server mit Status, Version, MOTD, Spieleranzahl (Live via WebSocket)
- [x] Server-Detailseite: Online-Spieler mit Köpfen (Avatar via `mc-heads.net`/`crafatar`)
- [x] Befehle senden (RCON) + Antwort anzeigen
- [x] Spieler-Aktionen per Klick: Kick, Ban/Unban, Whitelist add/remove, OP/De-OP
- [x] Audit-Log: wer hat wann was gemacht

### Phase 2 — Docker: eigene Server erstellen ✅ abgeschlossen
- [x] Server-Erstellen-Wizard: Edition (Paper/Vanilla/Forge/Fabric), MC-Version, RAM,
      Port, EULA, Welt-Seed → erstellt Container mit `itzg/minecraft-server`
- [x] Start / Stop / Restart / Kill mit Statusanzeige
- [x] Live-Konsole (xterm.js): Logstream (WS-Abo) + Eingabe via RCON
- [x] CPU-/RAM-Anzeige pro Server (Docker stats, WS-Abo)
- [x] `server.properties`-Editor mit Formular (nicht nur Rohtext)
- [x] Server löschen (mit Sicherheitsabfrage, Welt optional behalten)

### Phase 3 — Betrieb & Komfort ✅ abgeschlossen
- [x] Backups: manuell + Zeitplan (Cron), Retention, Restore per Klick
- [x] Geplante Tasks: automatische Restarts, wiederkehrende Befehle (z.B. Broadcast)
- [x] Metrik-Historie: Spielerzahlen, RAM, CPU, **TPS** über Zeit (Graphen)
- [x] Benachrichtigungen: Discord-Webhook (Server down, Backup/Task fehlgeschlagen) — *E-Mail offen*
- [x] Datei-Manager für Docker-Server (Volumes browsen, Dateien editieren/hochladen)
- [x] Spieler-Profile: Playtime, Sessions-Historie, Admin-Notizen, Ban-Historie

### Phase 4 — Ausbau (in Arbeit)
- [x] Plugin-/Mod-Verwaltung: Suche & Install via **Modrinth-API** (offene API, gut dokumentiert)
- [x] Modpack-Support im Wizard (Modrinth- **und CurseForge**-Packs via itzg-Image; CF_API_KEY optional, itzg-Image bringt eigenen Key mit)
- [x] Netzwerk: Velocity- oder BungeeCord-Proxy + Subserver als Gruppe verwalten (Velocity: Modern-Forwarding + Paper/Spigot/Fabric/Forge/NeoForge; BungeeCord: IP-Forwarding + Paper/Spigot), eigenes Docker-Netz — echter Premium-Login mit Mojang-Account verifiziert
- [x] LuckPerms-Integration für feingranulare In-Game-Berechtigungen (Gruppen, Prefix/Suffix/Weight, Berechtigungen, Spieler; Auto-Install via Modrinth)
- ~~MineControl-Agent für externe Server (Start/Stop, Logs, Dateien)~~ — **gestrichen** (Aufwand zu hoch; RCON-Verwaltung externer Server genügt)
- [x] Welt-Verwaltung: Download, mehrere Welten (auflisten/wechseln/erstellen/löschen), Upload (.tar.gz), Pregen via Chunky
- [x] 2FA (TOTP) + API-Tokens für Automatisierung

---

## 6. Rollen & Rechte

| Aktion | Viewer | Moderator | Admin |
|---|---|---|---|
| Dashboard, Status, Spieler sehen | ✅ | ✅ | ✅ |
| Kick / Ban / Whitelist | ❌ | ✅ | ✅ |
| Befehle senden (Konsole) | ❌ | ✅ (eingeschränkt) | ✅ |
| Server start/stop/restart | ❌ | ✅ | ✅ |
| Server erstellen/löschen, Konfig ändern | ❌ | ❌ | ✅ |
| User verwalten, Audit-Log | ❌ | ❌ | ✅ |

Optional später: Rechte pro Server (Moderator nur für Server X).

---

## 7. Sicherheit (wichtig, da Docker-Socket-Zugriff!)

- Zugriff auf `/var/run/docker.sock` = Root auf dem Host → das Backend ist
  sicherheitskritisch. Konsequenzen:
  - Auth für **jede** Route, keine anonymen Endpunkte außer Login
  - RCON-Passwörter verschlüsselt in der DB (nicht nur gehasht — sie werden gebraucht)
  - Rate-Limiting auf Login, argon2-Hashing
  - Kein direktes Durchreichen von User-Input in Shell-Befehle (nur Docker-API/RCON)
  - Empfehlung im Setup: hinter Reverse-Proxy mit HTTPS (Caddy/Traefik), ggf. nur im LAN/VPN
- Audit-Log von Anfang an — bei Multi-User Pflicht

---

## 8. Abgrenzung: Warum nicht Pterodactyl/Crafty nehmen?

Existierende Tools (Pterodactyl, Pufferpanel, Crafty Controller, AMP) sind
Inspirationsquellen — es lohnt sich, ihre UIs anzuschauen. Eigenbau lohnt sich hier weil:
- Kombination **externe Server + Docker-Server in einer Oberfläche** bietet kaum ein Tool
- Fokus auf Minecraft-spezifische Workflows (Spielerverwaltung, Whitelist, Bans)
  statt generischem Game-Hosting
- Lernprojekt mit voller Kontrolle über Features

---

## 9. Projektstruktur (geplant)

```
MineControl/
├── apps/
│   ├── server/            # Fastify-Backend
│   │   ├── src/
│   │   │   ├── adapters/  # DockerAdapter, ExternalAdapter, ServerAdapter-Interface
│   │   │   ├── modules/   # auth, servers, players, backups, tasks, audit
│   │   │   ├── ws/        # WebSocket-Handler (Konsole, Status-Broadcast)
│   │   │   └── prisma/
│   │   └── package.json
│   └── web/               # React-Frontend (Vite)
│       └── src/
│           ├── pages/     # Dashboard, ServerDetail, Players, Users, Settings
│           └── components/
├── packages/
│   └── shared/            # Geteilte TS-Typen (API-DTOs, ServerStatus, ...)
├── docker-compose.yml     # MineControl selbst als Container
└── PLANNING.md            # dieses Dokument
```

---

## 10. Nächste Schritte

1. Monorepo-Grundgerüst aufsetzen (pnpm, TS, Fastify, Vite, Prisma)
2. Auth + User-Verwaltung (Phase 1 Basis)
3. ExternalAdapter: Status-Ping + RCON — damit gibt's schnell erste sichtbare Ergebnisse
   gegen einen bestehenden Server
4. Dashboard mit Live-Status
5. Danach Phase 1 abarbeiten, dann Docker (Phase 2)
