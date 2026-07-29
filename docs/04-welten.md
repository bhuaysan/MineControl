# 04 – Welten

Reiter "Welten", nur für Docker-Server, die keine Proxy-Edition sind
(Velocity/BungeeCord haben keine eigene Welt und bekommen `422 unsupported`
bei jedem Versuch).

Alle verändernden Aktionen (Aktivieren/Erstellen/Löschen/Hochladen) sind pro
Server intern serialisiert — zwei gleichzeitige Aktionen auf derselben Welt
können sich nicht gegenseitig ins Gehege kommen.

## Welten auflisten

**Rolle:** MODERATOR+ · `GET /api/servers/:id/worlds`

Zeigt jeden Top-Level-Ordner im Datenverzeichnis, der eine `level.dat`
enthält, mit Größe und Kennzeichnung, welcher davon aktiv ist (aus
`server.properties` → `level-name`, Standard `world`). Nether/End-Begleit-
ordner (`<name>_nether`, `<name>_the_end`) werden nicht einzeln aufgeführt —
sie gehören zur Basiswelt.

⚠️ Der Server muss dafür **laufen** — sonst `409 not_running`.

## Aktive Welt wechseln

**Rolle:** ADMIN · `POST /api/servers/:id/worlds/switch` `{ name }`

Setzt `level-name` in `server.properties` auf die gewählte Welt und
**startet den Server neu**. In der Oberfläche: "Aktivieren"-Button pro
nicht-aktiver Welt mit Bestätigungsdialog.

## Neue (leere) Welt erstellen

**Rolle:** ADMIN · `POST /api/servers/:id/worlds` `{ name, seed? }`

- `name`: `^[A-Za-z0-9_.-]{1,48}$` — ein einzelnes Pfadsegment, kein `.`/`..`.
- Schlägt fehl (`409 exists`), wenn der Name schon existiert.

Setzt `level-name` auf den neuen Namen und `level-seed` auf den angegebenen
Seed (leer = zufällig), dann **Neustart** — die eigentliche Generierung
passiert beim Hochfahren in den noch nicht existierenden Ordner.

## Welt löschen

**Rolle:** ADMIN · `DELETE /api/servers/:id/worlds/:name`

Die **aktive** Welt (oder ihre Nether-/End-Begleitordner) kann nicht gelöscht
werden (`409 active`) — vorher auf eine andere Welt wechseln. Löscht den
Basisordner samt Nether-/End-Begleitordnern.

## Welt hochladen

**Rolle:** ADMIN · `POST /api/servers/:id/worlds/upload?name=<neuerName>`
(Multipart, eine Datei)

- `name` als Query-Parameter, gleiche Regel wie oben; darf noch nicht
  existieren (`409 exists`).
- Das `.tar.gz` wird gestreamt entpackt, mit mehreren Schutzmechanismen:
  **2 GiB Obergrenze** für die entpackte Größe (`413 too_large` sonst), nur
  reguläre Dateien/Ordner werden übernommen (Symlinks/Hardlinks werden
  verworfen), der oberste Ordner im Archiv wird unabhängig von seinem
  ursprünglichen Namen in `<name>` umbenannt, Pfade werden normalisiert und
  müssen innerhalb dieses Ordners bleiben (`400 tar_slip` sonst), und das
  Archiv **muss irgendwo eine `level.dat` enthalten** (`400 no_level` sonst
  — es muss also wirklich ein Weltordner sein, kein beliebiges Archiv).

⚠️ **Hochladen aktiviert die Welt nicht automatisch** — danach separat
"Aktivieren" klicken.

## Welt herunterladen

**Rolle:** MODERATOR+ · `GET /api/servers/:id/world/download`

Lädt die aktive Welt als `<server>-<level>.tar.gz` herunter.

⚠️ Bei Paper-artigen Servern liegen Nether und End in eigenen
Top-Level-Ordnern, die dieser Download **nicht** mit einschließt — für eine
vollständige Sicherung (inkl. Nether/End) das reguläre Server-Backup nutzen
(siehe [08 – Backups & geplante Aufgaben](08-backups-aufgaben.md)), nicht
diesen Download.

## Pregeneration (Chunky)

Nur für moddable Editionen (Paper/Spigot/Fabric/Forge/NeoForge); Vanilla und
Proxys bekommen `422 unsupported_edition`.

- **Starten** — MODERATOR+ · `POST /api/servers/:id/worlds/pregen`
  `{ radius, world? }`. `radius`: 100–50000 Blöcke um den Spawnpunkt (0,0);
  `world` optional, Standard ist die aktive Welt.
  - Ist das Chunky-Plugin/-Mod noch nicht installiert, installiert
    MineControl es **automatisch und startet den Server neu** —
    Antwort `{installed: true, started: false}` mit Hinweis, die
    Pregeneration in ca. einer Minute erneut zu starten. **Kein
    automatischer erneuter Versuch.**
  - Ist es schon installiert, führt MineControl `chunky world <level>`,
    `chunky center 0 0`, `chunky radius <radius>`, `chunky start` per RCON
    aus und gibt die Ausgabe zurück.
- **Abbrechen** — MODERATOR+ · `POST /api/servers/:id/worlds/pregen/cancel`
  — sendet `chunky cancel`, danach `chunky confirm` (von Chunky verlangt).

## Häufige Fehler

| Fehler                                    | Bedeutung                                                           |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `409 not_running`                         | Server muss laufen, um Welten aufzulisten/zu bearbeiten             |
| `409 exists`                              | Name bereits vergeben (Erstellen/Hochladen)                         |
| `409 active`                              | Aktive Welt kann nicht gelöscht werden                              |
| `413 too_large`                           | Hochgeladenes Archiv überschreitet die 2-GiB-Grenze                 |
| `400 no_level`                            | Archiv enthält keine `level.dat`, ist also keine Welt               |
| `400 tar_slip`                            | Archiv versucht, außerhalb des Zielordners zu schreiben — abgelehnt |
| `422 unsupported` / `unsupported_edition` | Feature gilt nicht für Proxy-Server bzw. nicht-moddable Editionen   |
