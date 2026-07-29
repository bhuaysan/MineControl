# 06 – Mods & Plugins

Reiter heißt "Plugins" bei Paper/Spigot/Velocity/BungeeCord und "Mods" bei
Fabric/Forge/NeoForge (unterschiedliche Ordner: `plugins` vs. `mods`).
**Der Reiter ist erst ab MODERATOR sichtbar** — ein VIEWER sieht ihn gar
nicht. Alle Aktionen erfordern einen Docker-Server mit moddable Edition,
sonst `422 unsupported`/`unsupported_edition`.

⚠️ **Wichtige Abgrenzung:** Dieser Reiter spricht ausschließlich mit
**Modrinth**. CurseForge kommt nur an einer ganz anderen Stelle vor — beim
**Erstellen** eines Servers als Modpack-Option (siehe unten
["Modpacks bei der Server-Erstellung"](#modpacks-bei-der-server-erstellung)).
Einmal erstellt, läuft laufende Mod-/Plugin-Verwaltung nur noch über
Modrinth — CurseForge ist ein einmaliger Bootstrap bei der Erstellung, keine
fortlaufende Quelle.

## Installierte Mods/Plugins ansehen

**Rolle:** MODERATOR+ · `GET /api/servers/:id/mods`

Jede Zeile zeigt Dateiname (durchgestrichen/abgeblendet, wenn deaktiviert),
Herkunfts-Badge (`modrinth`/`upload`/`url`, falls bekannt) und ein
"Update"-Abzeichen, falls eine neuere Modrinth-Version verfügbar ist.

## Nach Mods/Plugins suchen (Modrinth)

**Rolle:** MODERATOR+ · `GET /api/servers/:id/mods/search?q=`

Freitextsuche, automatisch nach Loader (aus der Server-Edition abgeleitet)
und erkannter Minecraft-Version gefiltert. Trefferliste zeigt Icon, Titel,
Downloadzahl, Beschreibung.

## Aus der Suche installieren

**Rolle:** ADMIN · `POST /api/servers/:id/mods/install` `{ projectId, versionId? }`

`versionId` optional — ohne Angabe wird die neueste kompatible Version
verwendet.

## Eigene `.jar`-Datei hochladen

**Rolle:** ADMIN · `POST /api/servers/:id/mods/upload` (Multipart)

Muss auf `.jar` enden, nicht leer sein, den ZIP-Magic-Bytes entsprechen
(`PK\x03\x04`/`\x05`/`\x07`) und **höchstens `MODS_MAX_MB`** groß sein
(Standard 200 MB, per Umgebungsvariable 1–10240 MB konfigurierbar) —
größer → `413`.

## Von einer beliebigen URL installieren

**Rolle:** ADMIN · `POST /api/servers/:id/mods/from-url` `{ url }`

Nur `http:`/`https:`. Dieselbe Größengrenze und ZIP-Prüfung wie beim Upload.
Der Dateiname wird aus dem `Content-Disposition`-Header oder der URL
abgeleitet.

⚠️ **SSRF-Schutz:** Die Zieladresse wird aufgelöst und private/
Loopback-/Link-Local-/CGNAT-/Metadaten-Adressbereiche (IPv4 und IPv6) werden
abgelehnt, die IP wird beim tatsächlichen Verbindungsaufbau erneut geprüft
(schützt vor DNS-Rebinding), und Weiterleitungen (3xx) werden **nicht**
verfolgt, sondern als Fehler behandelt.

## Aktivieren/Deaktivieren

**Rolle:** ADMIN · `POST /api/servers/:id/mods/toggle` `{ file, enabled }`

Technisch eine Umbenennung zwischen `<name>.jar` und `<name>.jar.disabled` —
kein Eingriff in Plugin-Konfiguration.

## Aktualisieren

**Rolle:** ADMIN · `POST /api/servers/:id/mods/update` `{ file }`

Funktioniert **nur für Dateien mit Modrinth-Herkunft** — bei
hochgeladenen oder per URL installierten Dateien gibt es keinen
Update-Mechanismus, sie müssen manuell ersetzt werden.

## Löschen

**Rolle:** ADMIN · `DELETE /api/servers/:id/mods?file=` — mit
Bestätigungsdialog.

## Plugin-Konfiguration bearbeiten

**Rolle:** Lesen MODERATOR+ (⚙-Symbol), **Speichern ADMIN**

- `GET /api/servers/:id/mods/config?file=` — listet den Konfigurationsordner
  des Plugins (ermittelt über den `name:`-Eintrag in dessen `plugin.yml`)
- `GET .../mods/config/file?file=&path=` — eine Datei lesen
- `PUT .../mods/config/file?file=&path=` `{content}` (max. 1.000.000 Zeichen)

⚠️ Funktioniert **nur für Plugins** (Paper/Spigot/Velocity/BungeeCord), nicht
für Mods (Fabric/Forge/NeoForge).

⚠️ **Änderungen (Installieren/Aktivieren/Aktualisieren) wirken erst nach
einem Server-Neustart.**

## Modpacks bei der Server-Erstellung

Beim Anlegen eines Docker-Servers (siehe
[02 – Server](02-server.md#docker-server-erstellen)) gibt es zwei optionale,
sich gegenseitig ausschließende Modpack-Felder:

- **Modrinth-Modpack** — Slug/URL eines `.mrpack`; setzt `TYPE=MODRINTH`.
- **CurseForge-Modpack** — Slug (z. B. `all-the-mods-9`) oder Link zur
  Modpack-Seite; setzt `TYPE=AUTO_CURSEFORGE`. Ist serverseitig ein eigener
  `CF_API_KEY` konfiguriert (Umgebungsvariable, siehe
  [Haupt-README](../README.md#umgebungsvariablen-referenz)), wird er
  verwendet — sonst greift der eingebaute Schlüssel des zugrunde liegenden
  itzg-Images.

Beide Felder deaktivieren die manuelle Edition/Version-Auswahl (das Modpack
bestimmt seinen eigenen Loader/Version) sowie den Welt-Import. Die Edition
sollte trotzdem zum tatsächlichen Loader des Packs passen (meist
FORGE/FABRIC/NEOFORGE), damit der Mods-Reiter danach funktioniert. Der erste
Start dauert wegen des Pack-Downloads länger.

## Häufige Fehler

| Fehler                                    | Bedeutung                                                 |
| ----------------------------------------- | --------------------------------------------------------- |
| `413`                                     | Datei/Download überschreitet `MODS_MAX_MB`                |
| `409 not_running`                         | Server muss laufen                                        |
| `422 unsupported` / `unsupported_edition` | Server ist kein Docker-Server oder keine moddable Edition |
| `400` bei Update                          | Datei hat keine Modrinth-Herkunft                         |
