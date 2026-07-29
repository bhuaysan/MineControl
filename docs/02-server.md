# 02 – Server verwalten

Es gibt zwei grundverschiedene Server-Typen in MineControl:

- **Docker-Server** — MineControl erzeugt und steuert den Container selbst
  (Start/Stopp, Dateien, Mods, Welten, Backups — der volle Funktionsumfang).
- **Externe Server** — bereits laufende Server irgendwo im Netz, die
  MineControl nur über Ping/RCON beobachtet und fernsteuert (kein
  Datei-/Mod-/Welt-Zugriff, da kein Container vorhanden ist).

## Server hinzufügen

**Rolle:** ADMIN

Auf der Server-Liste über "Server hinzufügen" öffnet sich ein Wizard mit
Umschalter zwischen "Docker 🐳" und "Extern 🔌".

### Extern verbinden

`POST /api/servers/external`

| Feld           | Typ     | Constraints                                                            | Default |
| -------------- | ------- | ---------------------------------------------------------------------- | ------- |
| `name`         | Text    | 1–64 Zeichen                                                           | —       |
| `host`         | Text    | Pflicht                                                                | —       |
| `port`         | Zahl    | 1–65535                                                                | 25565   |
| `edition`      | Auswahl | VANILLA/PAPER/SPIGOT/FORGE/FABRIC/NEOFORGE/VELOCITY/BUNGEECORD/UNKNOWN | UNKNOWN |
| `rconPort`     | Zahl    | 1–65535, optional                                                      | —       |
| `rconPassword` | Text    | optional                                                               | —       |

Vor dem Anlegen gibt es einen **"Verbindung testen"**-Button
(`POST /api/servers/test`, MODERATOR+) — pingt Host:Port an und prüft bei
gesetzten RCON-Daten auch den RCON-Login. Zeigt Ping-Erreichbarkeit/Latenz
und RCON-Status an, legt aber noch nichts an.

### Docker-Server erstellen

`POST /api/servers/docker`

| Feld                 | Typ         | Constraints                                                          | Default    |
| -------------------- | ----------- | -------------------------------------------------------------------- | ---------- |
| `name`               | Text        | 1–64                                                                 | —          |
| `edition`            | Auswahl     | VANILLA/PAPER/SPIGOT/FORGE/FABRIC/NEOFORGE                           | —          |
| `version`            | Text        | `LATEST`, `SNAPSHOT`, oder beginnt mit einer Ziffer; max. 20 Zeichen | `LATEST`   |
| `memoryMb`           | Zahl        | 512–32768 (Regler in der UI 512–8192, Schritt 512)                   | —          |
| `port`               | Zahl        | 1024–55535                                                           | 25565      |
| `seed`               | Text        | max. 64, optional                                                    | —          |
| `difficulty`         | Auswahl     | peaceful/easy/normal/hard, optional                                  | —          |
| `gamemode`           | Auswahl     | survival/creative/adventure/spectator, optional                      | —          |
| `motd`               | Text        | max. 120, optional                                                   | Servername |
| `onlineMode`         | Ja/Nein     | —                                                                    | **Nein**   |
| `eula`               | Checkbox    | muss gesetzt sein                                                    | —          |
| Modpack (Modrinth)   | Text        | max. 200, optional                                                   | —          |
| Modpack (CurseForge) | Text        | max. 300, optional                                                   | —          |
| Welt importieren     | siehe unten | optional                                                             | —          |

**Beispiel:** Ein Survival-Server mit 4 GB RAM auf Port 25565:
Name = `Survival`, Edition = `PAPER`, Version = `1.21.1`, RAM = 4096,
Port = 25565, Schwierigkeit = `normal`, Modus = `survival`, EULA-Häkchen
setzen, "Erstellen" klicken. Der Server erscheint sofort in der Liste
(Status `STARTING`), die eigentliche Einrichtung (Image ziehen, Container
bauen, starten) läuft im Hintergrund und ist live in der Konsole zu
verfolgen.

⚠️ **Nicht offensichtlich:**

- Modpack (Modrinth) und Modpack (CurseForge) schließen sich gegenseitig aus
  und schließen auch den Welt-Import aus — ein Modpack bestimmt Loader und
  Version selbst, das Versionsfeld wird dann deaktiviert.
- Der RCON-Port wird automatisch aus dem MC-Port abgeleitet:
  `rconPort = port + 10000`. Ein Server auf Port 25565 bekommt also intern
  Port 35565 für RCON — das ist der Grund für die Obergrenze 55535 statt
  65535 beim Port-Feld.
- Speicher-Limit im Container ist `memoryMb + 1024 MB` (Puffer für JVM-
  Overhead außerhalb des Heaps) — die tatsächliche Container-Grenze liegt
  also etwas über dem eingegebenen Wert.
- Portkonflikte (mit anderen MineControl-Servern oder echten Host-Bindings)
  liefern `409 port_in_use`.
- `EULA=TRUE` wird immer gesetzt; ohne gesetzte MOTD wird der Servername
  verwendet.

### Bestehenden Server/Welt importieren

Teil des Docker-Wizards, Schalter "Importieren":

- **Hochladen**: `.tar.gz`-Archiv per Browser hochladen (Limit `IMPORT_MAX_MB`,
  Standard 10240 MB / 10 GiB — größer → `413 too_large`).
- **Pfad**: aus Archiven wählen, die serverseitig bereits im `IMPORT_DIR`
  liegen (Standard `./imports`), Dateiname muss auf `.tar.gz`/`.tgz` enden.

Das Archiv wird beim ersten Start in das neue Docker-Volume entpackt; wird
ein erkennbarer Weltordner gefunden, wird er automatisch als aktive Welt
gesetzt (`level-name` in `server.properties`). Import und Modpack schließen
sich gegenseitig aus; bei aktivem Import sind Seed/Schwierigkeit/Modus in
der UI deaktiviert (das Archiv bringt seine eigene `server.properties` mit).

## Server steuern (Lifecycle)

**Rolle:** MODERATOR+ · `POST /api/servers/:id/lifecycle` `{ action }`

| Aktion    | Bedeutung                  | Voraussetzung               |
| --------- | -------------------------- | --------------------------- |
| `start`   | Server starten             | nicht bereits laufend       |
| `stop`    | Sauber stoppen             | läuft gerade                |
| `restart` | Stopp + Start              | läuft gerade                |
| `kill`    | Hart abwürgen (Force-Kill) | Docker-Server, läuft gerade |

Stop/Restart zeigen einen Bestätigungsdialog, Kill einen zusätzlich rot
markierten "Gefahr"-Dialog. Während des Übergangs (`STARTING`/`STOPPING`)
zeigt die Oberfläche einen Lade-Indikator. `kill` ist bei externen Servern
nicht verfügbar (`422 unsupported`).

⚠️ Start/Restart unterdrücken kurzzeitig den automatischen "Server offline"-
Alarm, damit die gewollte Downtime keine Fehlmeldung auslöst.

### Auto-Restart (Absturzerkennung)

**Rolle:** ADMIN · `PATCH /api/servers/:id/auto-restart` `{enabled}` — nur
Docker-Server (`422` sonst). Ist der Schalter aktiv, startet MineControl den
Container automatisch neu, wenn er zu lange im Zustand `STARTING` hängt,
ohne erreichbar zu werden (Standard-Kulanzzeit 5 Minuten, konfigurierbar über
die Umgebungsvariablen `AUTO_RESTART_GRACE_MIN`/`AUTO_RESTART_MAX_ATTEMPTS`
— siehe [Haupt-README](../README.md#umgebungsvariablen-referenz), nicht über
die Oberfläche einstellbar). Nach der maximalen Anzahl Versuche gibt
MineControl auf und meldet das (siehe
[11 – Benachrichtigungen](11-benachrichtigungen.md)).

## `server.properties` bearbeiten

**Reiter "Einstellungen"**, nur Docker-Server.

- Lesen: MODERATOR+ (`GET /api/servers/:id/properties`)
- Schreiben: **ADMIN** (`PUT /api/servers/:id/properties`)

Die Oberfläche zeigt bewusst nur eine kuratierte Auswahl an Schlüsseln, keine
komplette Rohdatei:

`motd` (Text), `difficulty`, `gamemode` (Auswahl), `max-players`,
`view-distance`, `simulation-distance`, `spawn-protection` (Zahlen), sowie
die Ja/Nein-Felder `pvp`, `online-mode`, `allow-nether`, `allow-flight`,
`hardcore`, `white-list`, `enforce-whitelist`.

Es werden nur tatsächlich geänderte Werte übermittelt. Schlüssel müssen
`^[A-Za-z0-9._-]+$` entsprechen, Werte max. 200 Zeichen **ohne Zeilenumbruch**
(die Datei ist eine einfache `key=value`-pro-Zeile-Datei — ein Zeilenumbruch
im Wert würde zusätzliche, kaputte Zeilen erzeugen).

⚠️ **Änderungen wirken erst nach einem (Neu-)Start des Servers**, es gibt
kein Live-Reload.

## Server löschen

**Rolle:** ADMIN · `DELETE /api/servers/:id?keepWorld=true|false`

- Ist der Server der **Proxy eines Netzwerks**, wird das Löschen mit
  `409 network_proxy` verweigert — stattdessen muss das Netzwerk gelöscht
  werden (siehe [03 – Netzwerke](03-netzwerke.md)).
- Bei Docker-Servern fragt ein zweiter Dialog, ob die Weltdaten erhalten
  bleiben sollen (Volume behalten) oder mit gelöscht werden.
- Schlägt das Entfernen von Container/Volume fehl, bleibt der Datenbank-
  Eintrag bestehen (kein verwaister Container ohne DB-Eintrag) — Antwort
  `502 docker_teardown_failed`; einfach erneut versuchen.
- Löschen entfernt automatisch alle geplanten Aufgaben und Backups dieses
  Servers.
- War der Server Mitglied eines Netzwerks, wird die Proxy-Konfiguration im
  Hintergrund aktualisiert, um den verschwundenen Server zu entfernen
  (Best-Effort — Fehler landen nur im Audit-Log).

## Server-Konsole & Befehle

- `GET /api/servers/:id/players` — Online-Spieler (jede Rolle)
- `POST /api/servers/:id/command` — beliebigen RCON-Befehl senden
  (MODERATOR+), erscheint als kleine Konsolenbox im Übersichts-Reiter oder
  im eigenen "Konsole"-Reiter (wenn die Konsolen-Fähigkeit vorhanden ist).

Details zu Spieler-Aktionen (Kick/Ban/Whitelist) stehen in
[09 – Spieler](09-spieler.md).
