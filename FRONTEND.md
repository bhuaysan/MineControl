# MineControl — Frontend-Plan

Ergänzt [PLANNING.md](PLANNING.md). Stack: React + Vite + TypeScript, Tailwind CSS + shadcn/ui, xterm.js.

---

## 1. Design-Grundsätze

- **Admin-Dashboard, kein Marketing:** Informationsdichte vor Weißraum. Wichtigste Frage
  „Läuft alles? Wer ist online?" muss ohne Klick beantwortet sein.
- **Dark Mode als Standard** (Theme-Toggle vorhanden) — passt zum Umfeld und zur Konsole.
- **Live statt Refresh:** Status, Spielerlisten und Konsole aktualisieren sich über
  WebSocket von selbst. Nirgendwo ein „Aktualisieren"-Button nötig.
- **Rollen-bewusste UI:** Was die Rolle nicht darf, wird ausgeblendet (nicht nur disabled) —
  ein Viewer sieht keine Ban-Buttons.
- **Destruktives ist immer zweistufig:** Kick/Ban → Bestätigungsdialog mit Grund-Eingabe.
  Server löschen → Servername muss eingetippt werden.
- **UI-Sprache Deutsch**, alle Strings zentral in einem Modul (`i18n-ready`, Übersetzung später möglich).

### Status-Farbsystem (überall identisch)

| Status | Farbe | Verwendung |
|---|---|---|
| Online | Grün | Badge, Karten-Rand, Dot |
| Startet / Stoppt | Gelb, pulsierend | Übergangszustände |
| Offline | Grau | neutral, kein Alarm |
| Fehler / Crash | Rot | Container exited, RCON unerreichbar obwohl erwartet |

---

## 2. Sitemap & Routen

```
/login
/                              → Dashboard (Server-Übersicht)
/servers/new                   → Wizard: Server erstellen (Docker) / Extern verbinden
/servers/:id                   → Server-Detail, Tab „Übersicht"
/servers/:id/console           →   Tab „Konsole"
/servers/:id/players           →   Tab „Spieler" (online + Whitelist/Bans/OPs)
/servers/:id/files             →   Tab „Dateien" (Phase 3, nur Docker)
/servers/:id/backups           →   Tab „Backups" (Phase 3)
/servers/:id/schedule          →   Tab „Zeitpläne" (Phase 3)
/servers/:id/settings          →   Tab „Einstellungen" (server.properties, Docker-Konfig)
/players                       → Globale Spieler-Datenbank (alle Server)
/players/:uuid                 → Spieler-Profil (Sessions, Playtime, Bans, Notizen)
/users                         → Benutzerverwaltung (nur Admin)
/audit                         → Audit-Log (nur Admin)
/settings                      → App-Einstellungen (Theme, Benachrichtigungen, Discord-Webhook)
```

Layout: schmale **Sidebar links** (Navigation + Serverliste mit Status-Dots),
Content rechts. Sidebar auf Mobile einklappbar.

---

## 3. Wireframes der Kernseiten

### Dashboard `/`

```
┌────────┬──────────────────────────────────────────────────────────┐
│ ⛏ Mine │  Dashboard                          [+ Server hinzufügen]│
│ Control│                                                          │
│        │  ┌─ Gesamt ──────────────────────────────────────────┐   │
│ ▣ Dash │  │ 3/4 Server online · 17 Spieler · RAM 9,2/16 GB    │   │
│ ☰ Srv  │  └───────────────────────────────────────────────────┘   │
│  ●SMP  │                                                          │
│  ●Créa │  ┌─ SMP ── ●Online ─────┐  ┌─ Creative ── ●Online ───┐   │
│  ●Mods │  │ Paper 1.21.6         │  │ Paper 1.21.6            │   │
│  ○Test │  │ 👥 12/50   RAM 4,1GB │  │ 👥 3/20    RAM 2,0GB    │   │
│        │  │ ▂▄▆▅▇ Spieler 24h    │  │ ▂▂▃▂▂                   │   │
│ 👥 Spie│  │ [Konsole] [⏻ Stop]   │  │ [Konsole] [⏻ Stop]      │   │
│ 👤 User│  └──────────────────────┘  └─────────────────────────┘   │
│ 📋 Audit│ ┌─ Modpack ● Online ───┐  ┌─ Test ── ○ Offline ─────┐   │
│ ⚙ Einst│ │ NeoForge 1.21 (ATM10)│  │ Extern · zuletzt: gestern│  │
│        │  │ 👥 2/10    RAM 3,1GB │  │ 👥 –        [▶ Start n/v]│  │
│ 🌙 ben │  │ [Konsole] [⏻ Stop]   │  │ [Verbindung testen]     │   │
└────────┴──────────────────────────────────────────────────────────┘
```

- Server-Karten: Name, Typ-Badge (Docker/Extern), Status, Spielerzahl, RAM,
  Mini-Sparkline (Spieler 24h), Schnellaktionen.
- Klick auf Karte → Server-Detail.

### Server-Detail `/servers/:id` (Tab Übersicht)

```
┌──────────────────────────────────────────────────────────────────┐
│ ● SMP  Paper 1.21.6 · Docker · mc.beispiel.de:25565   [⟳][⏻ Stop]│
│ ─ Übersicht ─ Konsole ─ Spieler ─ Backups ─ Zeitpläne ─ Einstell.│
│                                                                  │
│ ┌ Spieler online (12) ─────────┐ ┌ Metriken ───────────────────┐ │
│ │ 🙂 Steve       2h 14m  [⋮]   │ │ CPU  ▁▂▃▂▅▃▂  34 %          │ │
│ │ 🙂 Alex        0h 47m  [⋮]   │ │ RAM  ▃▄▄▅▅▅▅  4,1/6 GB      │ │
│ │ 🙂 Notch       5h 02m  [⋮]   │ │ TPS  ▇▇▇▇▆▇▇  19,8         │ │
│ │   [⋮] → Kick·Ban·Whitelist·OP│ │ Spieler (7 Tage) 📈         │ │
│ └──────────────────────────────┘ └─────────────────────────────┘ │
│ ┌ Letzte Ereignisse ───────────────────────────────────────────┐ │
│ │ 18:42 Steve ist beigetreten · 18:30 Backup OK · 17:55 Restart│ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Konsole (Tab)

- xterm.js füllt den Tab, Farb-Logs (Log-Level einfärben), Auto-Scroll mit
  „Follow"-Toggle, Suchfeld.
- Eingabezeile unten mit Befehls-Historie (↑/↓) und Autocomplete für
  Standardbefehle (`/ban`, `/whitelist add`, …).
- Nur Moderator+; Viewer sieht den Tab nicht.

### Spieler (Tab) — Unterreiter: Online · Whitelist · Bans · OPs

```
│ [Online 12] [Whitelist 34] [Bans 5] [OPs 3]      [Spieler suchen]│
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 🙂 Steve      online · 2h 14m     [Kick] [Ban] [OP] [Profil] │ │
│ │ 🙂 Herobrine  gebannt 12.07. „Griefing"          [Entbannen] │ │
│ └──────────────────────────────────────────────────────────────┘ │
```

- Ban-Dialog: Grund (Pflicht), optional Dauer → landet im Audit-Log.
- „Profil" → globales Spieler-Profil `/players/:uuid`.

### Wizard `/servers/new` (2 Wege)

```
Schritt 0:  ( ) Neuen Server erstellen (Docker)   ( ) Externen Server verbinden

Docker:  1. Typ & Version (Paper/Vanilla/Forge/Fabric + MC-Version-Dropdown)
         2. Ressourcen (RAM-Slider, Port, Auto-Start)
         3. Welt (Name, Seed, Schwierigkeit, Gamemode) + EULA-Checkbox
         4. Zusammenfassung → [Erstellen] → Live-Fortschritt (Image-Pull, erster Start)

Extern:  1. Host, Port → automatischer Ping-Test mit Sofort-Feedback
         2. RCON-Port + Passwort → RCON-Test
         3. Fertig (Hinweis, welche Features ohne RCON fehlen)
```

---

## 4. Komponenten-Inventar

**Layout:** `AppShell` (Sidebar + Header), `ServerTabs`, `PageHeader`, `RequireRole` (Guard)

**Server:** `ServerCard`, `StatusBadge`, `ServerActions` (Start/Stop/Restart mit Confirm),
`MetricSparkline`, `MetricChart` (Recharts), `EventFeed`

**Spieler:** `PlayerAvatar` (Skin-Kopf via crafatar, mit Fallback), `PlayerRow`,
`PlayerActionMenu`, `BanDialog`, `PlayerSearchCombobox`

**Konsole:** `ConsoleView` (xterm.js-Wrapper), `CommandInput` (Historie + Autocomplete)

**Allgemein:** `ConfirmDialog` (Varianten: normal / destruktiv-mit-Tippen),
`Toast`-System (sonner), `EmptyState`, `SkeletonCard`, `RelativeTime`, `RoleBadge`

shadcn/ui liefert die Basis (Button, Dialog, Tabs, Table, DropdownMenu, Form) —
wir bauen nur die Domänen-Komponenten selbst.

---

## 5. State & Datenfluss

```
REST (CRUD, Aktionen)          WebSocket (Live)
─────────────────────          ────────────────────────────
TanStack Query                 ein globaler WS-Client
· Server-Liste/-Detail         · server.status_changed
· Spieler, Users, Audit        · server.players_changed
· Mutations: kick/ban/start…   · console.line  (pro Abo)
                               · metrics.update (pro Abo)
```

- **TanStack Query** ist der Cache. WebSocket-Events schreiben direkt in den Query-Cache
  (`queryClient.setQueryData`) → UI aktualisiert sich, ohne neu zu fetchen.
- **Abo-Modell:** Konsole und Metriken sind teuer → Client subscribed nur, solange der
  Tab offen ist (`subscribe:console:{serverId}` / `unsubscribe`).
- **Mutations optimistisch** nur bei Kleinkram (Whitelist-Toggle); Start/Stop zeigt
  ehrlich den Übergangszustand „stopping…" bis das WS-Event den neuen Status bestätigt.
- **UI-State** (Sidebar auf/zu, Theme): Zustand-Store oder Context — klein halten.
- **Auth:** Session-Cookie; `/api/me` beim App-Start → User + Rolle in Context;
  401-Interceptor leitet auf `/login`.
- **Geteilte Typen:** API-DTOs und WS-Event-Typen aus `packages/shared` — Frontend und
  Backend können nie auseinanderlaufen.

Reconnect-Verhalten: WS-Verbindungsverlust → gelber Banner „Live-Verbindung
getrennt, versuche erneut…", automatischer Reconnect mit Backoff, danach Cache-Refetch.

---

## 6. Responsive-Strategie

- **Desktop-first** (Admin-Tool), aber Mobile muss die Notfall-Fälle können:
  Status checken, Spieler kicken/bannen, Server neu starten.
- Breakpoints: Karten-Grid 3 → 2 → 1 Spalte; Sidebar wird Burger-Menü;
  Tabellen werden auf Mobile zu Karten-Listen (keine horizontalen Scroll-Tabellen).
- Konsole auf Mobile: read-only Log-Ansicht reicht (Eingabe optional).

---

## 7. Frontend-Reihenfolge (an Backend-Phasen gekoppelt)

| Backend-Phase | Frontend-Arbeit |
|---|---|
| 1 (MVP) | AppShell, Login, Dashboard mit ServerCards, Server-Detail (Übersicht + Spieler-Tab), Extern-Wizard, Audit-Seite |
| 2 (Docker) | Docker-Wizard, Konsole (xterm.js + WS-Abo), Start/Stop-Actions, Metrik-Anzeige, settings-Tab |
| 3 (Betrieb) | Backups-Tab, Zeitpläne-Tab, Datei-Manager, Metrik-Historie (Charts), Spieler-Profile, Benachrichtigungs-Settings |
| 4 (Ausbau) | Plugin-Browser (Modrinth), Netzwerk-Ansicht (Proxy-Gruppen), Agent-Status |

Erster Meilenstein zum „Anfassen": Login → Dashboard mit einer echten Server-Karte
(externer Server, Live-Status via Ping) — dafür braucht es nur AppShell, ServerCard,
StatusBadge und den WS-Client.
