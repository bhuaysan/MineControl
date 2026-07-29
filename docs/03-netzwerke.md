# 03 – Netzwerke (Velocity/BungeeCord-Proxy)

Ein "Netzwerk" in MineControl ist ein **Proxy-Server** (Velocity oder
BungeeCord) plus eine Reihe von **Backend-Servern** ("Subserver"), die
dahinter erreichbar sind. Spieler verbinden sich immer nur mit der Adresse
des Proxys; der Proxy leitet sie transparent an den richtigen Backend-Server
weiter (Lobby, Survival, Minigames, …).

**Rolle:** Der komplette Bereich ist **ADMIN-only** — VIEWER/MODERATOR sehen
die Netzwerke-Übersicht nur lesend (Status, Mitgliederliste), aber keine
Erstellen/Anhängen/Löschen-Buttons.

## Ein Netzwerk erstellen

`POST /api/networks`

| Feld           | Typ     | Constraints                                                                                      | Default  |
| -------------- | ------- | ------------------------------------------------------------------------------------------------ | -------- |
| `name`         | Text    | 1–64                                                                                             | —        |
| `proxyName`    | Text    | 1–64 (Anzeigename des Proxy-Servers)                                                             | —        |
| `proxyEdition` | Auswahl | `VELOCITY` \| `BUNGEECORD`                                                                       | VELOCITY |
| `version`      | Text    | Versionsangabe wie bei Docker-Servern (bei BungeeCord ignoriert — immer neueste stabile Version) | LATEST   |
| `memoryMb`     | Zahl    | 256–16384 (Regler 256–4096, Schritt 256)                                                         | —        |
| `port`         | Zahl    | 1024–65535 (Host-Port, unter dem Spieler sich verbinden)                                         | —        |

Beim Anlegen passiert automatisch:

1. Ein neuer **Server**-Datensatz für den Proxy selbst wird erzeugt.
2. Ein **Netzwerk**-Datensatz mit einem zufällig erzeugten, verschlüsselt
   gespeicherten **Forwarding-Secret** (24 Byte) wird angelegt.
3. Ein eigenes **Docker-Netzwerk** wird erstellt — dadurch erreicht der Proxy
   Subserver über deren Container-Namen (Alias), nicht über Host-Ports.
4. Eine leere `velocity.toml` (bzw. `config.yml` bei BungeeCord) wird
   geschrieben, der Proxy-Container gestartet.

Die Einrichtung läuft asynchron; Fehler erscheinen in der Proxy-Konsole und
im Audit-Log.

## Einen Subserver hinzufügen

`POST /api/networks/:id/subservers` — zwei Modi:

### Modus "Anhängen" (bestehenden Server aufnehmen)

| Feld       | Typ  | Constraints                                                                                                              |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| `serverId` | —    | ein bestehender, eigenständiger Docker-Server                                                                            |
| `alias`    | Text | `^[a-z][a-z0-9-]{0,31}$` — Kleinbuchstabe zu Beginn, danach Kleinbuchstaben/Ziffern/Bindestriche, **keine Unterstriche** |

⚠️ **Voraussetzungen, sonst Fehler:**

- Server darf noch in keinem anderen Netzwerk Mitglied sein und selbst kein
  Proxy sein (`409 already_member`).
- Erlaubte Edition hängt vom Proxy-Typ ab: **Velocity** erlaubt
  Paper/Spigot/Fabric/Forge/NeoForge; **BungeeCord** erlaubt nur
  Paper/Spigot (modifizierte Editionen brauchen ein Velocity-only
  Kompatibilitäts-Mod).
- Bei Paper/Spigot muss der Server **mindestens einmal gestartet worden
  sein** (sonst fehlt `paper-global.yml` und die Anfrage schlägt mit
  `409 not_initialized` fehl).

Beim Anhängen wird der Container **neu aufgebaut** (Welt/Volume bleiben
erhalten) und dem Docker-Netzwerk des Netzwerks beigetreten, `online-mode`
wird zwangsweise deaktiviert (Authentifizierung übernimmt jetzt der Proxy),
Forwarding wird eingerichtet (siehe unten), die Proxy-Konfiguration
neu geschrieben und der Proxy neu gestartet.

### Modus "Neu erstellen" (Subserver direkt im Netzwerk anlegen)

| Feld       | Typ     | Constraints                                                                                                                                                        |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `alias`    | Text    | wie oben                                                                                                                                                           |
| `name`     | Text    | 1–64                                                                                                                                                               |
| `edition`  | Auswahl | Velocity: Paper/Spigot/Fabric/Forge/NeoForge; BungeeCord: nur Paper/Spigot                                                                                         |
| `version`  | Text    | wie bei Docker-Servern, Default LATEST                                                                                                                             |
| `memoryMb` | Zahl    | 512–32768 (Regler 512–8192)                                                                                                                                        |
| `port`     | Zahl    | 1024–55535 (Standard 25566 in der UI) — auch hier braucht der Subserver einen eigenen Host-Port für RCON/Status-Pings, obwohl Spieler nur über den Proxy verbinden |
| `motd`     | Text    | max. 120, optional                                                                                                                                                 |

Dieselben Port-/Alias-Konfliktprüfungen wie bei "Anhängen", zusätzlich die
normale Docker-Portprüfung. `onlineMode` ist von Beginn an deaktiviert.

## Wie das Forwarding wirklich funktioniert

Das ist der Kern, den man verstehen muss, damit ein Netzwerk tatsächlich
funktioniert:

- **Velocity + Paper/Spigot**: nutzt Velocitys "Modern Forwarding". MineControl
  setzt in der `config/paper-global.yml` des Subservers
  `proxies.velocity.enabled: true`, `online-mode: true` und
  `secret: '<Forwarding-Secret des Netzwerks>'`, startet den Subserver neu.
  Der Proxy selbst hat immer `online-mode = true` und
  `player-info-forwarding-mode = "modern"` mit demselben Secret als Datei im
  Proxy-Volume. Beide Seiten müssen exakt dasselbe Secret teilen — es wird
  einmal pro Netzwerk erzeugt und für jedes Anhängen/Erstellen wiederverwendet.
- **Velocity + Fabric/Forge/NeoForge (modded)**: diese Server unterstützen
  Modern Forwarding nicht nativ — MineControl installiert automatisch ein
  Kompatibilitäts-Mod (`fabricproxy-lite` + `fabric-api` bei Fabric,
  `proxy-compatible-forge` bei Forge/NeoForge), startet neu, wartet bis zu
  ~60 Sekunden auf die generierte Konfigurationsdatei des Mods, trägt dort
  das Secret ein und startet erneut. **Forwarding entfernen** bedeutet hier:
  das Kompatibilitäts-Mod wird komplett deinstalliert (es gibt keinen
  universellen "Aus"-Schalter in diesen Mod-Configs).
- **BungeeCord + Paper/Spigot** (andere Editionen sind hier gar nicht
  erlaubt): einfaches IP-Forwarding ohne Secret — `ip_forward: true` beim
  Proxy, `settings.bungeecord: true` in der `spigot.yml` des Subservers.

In jedem Fall gilt das Muster "Config patchen → Alarm unterdrücken →
Container neu starten → Konsole/Status neu verbinden". Die Proxy-Konfiguration
(`velocity.toml`/`config.yml`) wird bei **jeder** Mitgliedschaftsänderung
**komplett neu geschrieben** — alle aktuellen Mitglieder werden als
Backend-Einträge (`<alias>:25565` über den internen Container-DNS-Namen,
nicht den Host-Port) eingetragen, danach wird der Proxy-Container neu
gestartet (weder Velocity noch BungeeCord unterstützen zuverlässiges
Hot-Reload ohne Plugin).

⚠️ **Jede von MineControl geschriebene Config-Datei trägt einen Hinweis-
Kommentar** ("verwaltet von MineControl — Änderungen werden bei
Netzwerk-Updates überschrieben"). Manuelle Anpassungen an diesen beiden
Dateien überleben die nächste Mitgliedschaftsänderung nicht.

## Beispiel: ein Velocity-Netzwerk mit zwei Backends aufbauen

1. **Netzwerke → "Netzwerk erstellen"**: Name = `SkyBlock Hub`,
   Proxy-Name = `hub-proxy`, Proxy-Software = Velocity, Version = `LATEST`,
   RAM = 1024 MB, Port = `25565`. Absenden. MineControl legt den Proxy-Server,
   ein eigenes Docker-Netzwerk und eine leere `velocity.toml` an und startet
   den Proxy — `dein-host:25565` ist ab jetzt die Adresse für Spieler.
2. Auf der Netzwerk-Kachel **"Subserver hinzufügen" → "Neu erstellen"**:
   Alias = `lobby`, Name = `Lobby`, Edition = `PAPER`, Version = `1.21.1`,
   RAM = 2048 MB, Port = `25566`. Absenden.
3. Im Hintergrund: ein neuer Docker-Server `Lobby` wird erstellt
   (`online-mode=false` von Anfang an), dem Docker-Netzwerk mit Alias `lobby`
   beigetreten, gestartet; sobald er läuft, patcht MineControl seine
   `paper-global.yml` (Velocity aktivieren, Secret eintragen) und startet ihn
   neu; die `velocity.toml` des Proxys wird neu geschrieben (`lobby =
"lobby:25565"`, `try = ["lobby"]`) und der Proxy neu gestartet.
4. **"Subserver hinzufügen" → "Anhängen"** für einen bestehenden
   Survival-Server, Alias = `survival` — vorausgesetzt er wurde mindestens
   einmal gestartet und ist noch in keinem Netzwerk. Er wird auf das
   Docker-Netzwerk umgebaut, Forwarding eingerichtet, erscheint in der
   `velocity.toml` als `survival = "survival:25565"`.
5. Spieler, die sich mit `dein-host:25565` verbinden, landen beim Proxy
   (Mojang-Authentifizierung passiert hier), werden mit ihrer echten
   Identität zu `lobby` oder `survival` weitergeleitet — die Backend-Server
   selbst laufen mit `online-mode=false` und vertrauen der vom Proxy
   weitergereichten Identität.
6. **"lobby" entfernen, ohne sie zu löschen**: auf dem Mitglied "Trennen"
   klicken — sie wird als eigenständiger Server außerhalb des Docker-Netzwerks
   neu aufgebaut, Forwarding deaktiviert, und verschwindet aus der
   Proxy-Konfiguration (die daraufhin neu geschrieben und der Proxy neu
   gestartet wird).
7. **Alles abbauen**: das **Netzwerk** löschen (nicht den Proxy-Server direkt
   — das ist blockiert). Das entfernt den Proxy, setzt `lobby`/`survival`
   zurück auf eigenständig (Forwarding rückgängig gemacht) und entfernt das
   eigene Docker-Netzwerk.

## Subserver trennen

`DELETE /api/networks/:id/subservers/:serverId` — ADMIN. Die Mitgliedschaft
wird sofort in der Datenbank aufgelöst und die Proxy-Konfiguration sofort neu
geschrieben (der Alias verschwindet beim Proxy, bevor der Container-Umbau
überhaupt fertig ist). Der Subserver wird eigenständig neu aufgebaut
(`online-mode` auf den ursprünglich konfigurierten Wert zurückgesetzt,
Forwarding entfernt) und bleibt danach als normaler Server bestehen.

## Netzwerk löschen

`DELETE /api/networks/:id` — ADMIN. Proxy-Container und -Volume werden sofort
entfernt. Im Hintergrund wird jedes Mitglied wie bei "Trennen" auf
eigenständig zurückgesetzt, danach das eigene Docker-Netzwerk entfernt.
Fehler in diesem Hintergrundschritt landen nur im Audit-Log, nicht als
Fehlermeldung bei der Löschanfrage (die bereits erfolgreich zurückgemeldet
wurde).

⚠️ Das direkte Löschen des Proxy-Servers über die normale
Server-Löschfunktion ist gesperrt (`409 network_proxy`) — der einzige Weg,
einen Proxy loszuwerden, ist das Löschen des Netzwerks.
