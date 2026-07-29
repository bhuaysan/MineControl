# 01 – Oberfläche & Erste Schritte

## Anmelden

MineControl öffnet auf der Login-Seite. Anmeldung mit Benutzername und
Passwort; ist für das Konto **Zwei-Faktor-Authentifizierung (2FA)** aktiviert,
erscheint nach korrektem Passwort automatisch ein zweites Feld für den
6-stelligen Code aus der Authenticator-App — siehe
[10 – Benutzer & Zugriff](10-benutzer-zugriff.md#zwei-faktor-authentifizierung-2fa).

Der Erststart-Admin (`SEED_ADMIN_USER`/`SEED_ADMIN_PASSWORD` aus der `.env`)
existiert automatisch, sobald noch kein Benutzer in der Datenbank ist. Das
Passwort sollte nach dem ersten Login geändert werden — siehe
[10 – Benutzer & Zugriff](10-benutzer-zugriff.md#eigenes-passwort-ändern).

## Navigation (Seitenleiste)

Links befindet sich die Hauptnavigation. Sichtbare Einträge hängen von der
eigenen Rolle ab:

| Bereich                                                          | Sichtbar ab Rolle |
| ---------------------------------------------------------------- | ----------------- |
| Dashboard, Server-Liste, Spieler, Metriken                       | VIEWER (alle)     |
| Netzwerke                                                        | ADMIN             |
| Benutzer, API-Tokens, Audit-Log, Benachrichtigungs-Einstellungen | ADMIN             |

Ein VIEWER oder MODERATOR sieht die administrativen Menüpunkte (Benutzer,
Audit-Log usw.) also gar nicht erst — nicht nur ausgegraut, sondern komplett
ausgeblendet.

Am unteren Rand der Seitenleiste stehen: der eigene Benutzername (mit
Rollenangabe in Klammern, z. B. `admin (ADMIN)`), der Sprachumschalter und
"Abmelden". Das Mond-Emoji 🌙 neben dem Namen ist rein dekorativ — es gibt
kein Dunkel/Hell-Umschalten, die Oberfläche ist grundsätzlich dunkel gehalten.

## Sprache wechseln

Über das 🌐-Symbol in der Seitenleiste lässt sich die Oberflächensprache
zwischen **Deutsch** und **Englisch** umschalten. Die Wahl wird im Browser
gespeichert (nicht am Benutzerkonto) und bleibt bei künftigen Besuchen
erhalten; ist noch nichts gespeichert, errät MineControl die Sprache anhand
der Browser-Einstellung, mit Deutsch als Rückfallwert.

⚠️ **Nicht zu verwechseln** mit der Sprache der Discord/E-Mail-Benachrichtigungen
(`notifyLocale` in den Benachrichtigungs-Einstellungen) — das sind zwei
getrennte Einstellungen. Man kann die Oberfläche z. B. auf Englisch nutzen,
während Alarme weiterhin auf Deutsch verschickt werden.

## Dashboard (Startseite)

Oben eine Zusammenfassung: `<online>/<gesamt> Server online · <N> Spieler`,
live aktualisiert über eine WebSocket-Verbindung. Darunter eine Kachel pro
Server mit:

- Name, Edition/Version, Badge "Docker" oder "Extern"
- Farbiger Rahmen + Status-Badge: `ONLINE`, `STARTING`, `STOPPING`, `OFFLINE`,
  `ERROR`, `UNKNOWN`
- Aktuelle Spielerzahl (`online/max`)
- Adresse (`host:port`) und MOTD, falls gesetzt

CPU/RAM/TPS stehen hier **nicht** — die gibt es erst auf der Detailseite eines
Servers (siehe [13 – Metriken & Dashboard](13-metriken.md)).

Fällt die Live-Verbindung aus, zeigt ein Banner das an; die zuletzt bekannten
Zustände bleiben sichtbar, aktualisieren sich aber nicht mehr, bis die
Verbindung zurückkommt.

## Serverdetailseite — Reiter-Übersicht

Ein Klick auf eine Server-Kachel öffnet die Detailseite mit Reitern, die je
nach Servertyp, Edition und eigener Rolle ein- oder ausgeblendet werden:

| Reiter        | Voraussetzung                                                                                |
| ------------- | -------------------------------------------------------------------------------------------- |
| Übersicht     | immer                                                                                        |
| Konsole       | Server unterstützt Konsole (Docker oder RCON) **und** MODERATOR+                             |
| Spieler       | immer (Aktionen wie Kick/Ban erst ab MODERATOR)                                              |
| Dateien       | Docker-Server **und** MODERATOR+                                                             |
| Mods/Plugins  | moddable Edition (Paper/Spigot/Fabric/Forge/NeoForge/Velocity/BungeeCord) **und** MODERATOR+ |
| Welten        | Docker-Server, keine Proxy-Edition, MODERATOR+                                               |
| LuckPerms     | Paper/Spigot/Fabric/Forge/NeoForge, MODERATOR+                                               |
| Backups       | Docker-Server (für alle Rollen sichtbar, Aktionen ab MODERATOR)                              |
| Aufgaben      | Docker-Server oder RCON konfiguriert                                                         |
| Einstellungen | Docker-Server, MODERATOR+ (Bearbeiten nur ADMIN)                                             |

Die genauen Inhalte jedes Reiters stehen in den jeweiligen Kapiteln dieses
Handbuchs.
