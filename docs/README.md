# MineControl — Nutzerhandbuch

Dieses Handbuch beschreibt **jede Funktion der Oberfläche** im Detail: was sie
tut, wer sie nutzen darf, welche Felder es gibt und was dabei nicht sofort
offensichtlich ist. Für Installation/Deployment (Docker Compose, `.env`,
Netbird/VPN-Zugriff, Umgebungsvariablen) siehe die [Haupt-README](../README.md)
— dieses Handbuch setzt eine laufende Installation voraus.

## Rollen-Modell

MineControl kennt drei Rollen, hierarchisch gestaffelt — jede höhere Rolle
darf alles, was die niedrigeren dürfen, plus mehr:

| Rolle         | Kurz gesagt                                                                                                                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VIEWER**    | Nur lesen: Dashboard, Server-Status, Spielerliste, Metriken-Verlauf, eigenen 2FA-Status einsehen. Keine Aktionen.                                                                                                                                               |
| **MODERATOR** | Alles von VIEWER, plus: Server starten/stoppen/neustarten, Konsole/RCON-Befehle, Backups erstellen, Aufgaben anlegen, Datei-Manager, Spieler kicken/bannen.                                                                                                     |
| **ADMIN**     | Alles von MODERATOR, plus: Server anlegen/löschen, `server.properties` bearbeiten, Netzwerke verwalten, Mods/Plugins installieren, LuckPerms bearbeiten, Benutzer/Tokens/Benachrichtigungen/Audit-Log — praktisch alles, was Struktur oder Sicherheit betrifft. |

Es gibt keine feinere Rechtevergabe pro Feature — jede Aktion prüft nur "hat
dieser Benutzer mindestens Rolle X". Ein Benutzer bekommt seine Rolle beim
Anlegen (oder nachträglich) von einem Admin zugewiesen, siehe
[10 – Benutzer & Zugriff](10-benutzer-zugriff.md).

Zusätzlich gibt es **API-Tokens** für Automatisierung, die selbst eine Rolle
tragen (siehe [10 – Benutzer & Zugriff](10-benutzer-zugriff.md#api-tokens)),
und die reguläre Session (Cookie-Login) — beide werden gleich behandelt,
mit einer Ausnahme: 2FA-Einstellungen lassen sich nur per Session ändern,
nie per Token.

## Inhaltsverzeichnis

| Kapitel                                                    | Worum es geht                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [01 – Oberfläche & Erste Schritte](01-oberflaeche.md)      | Login, Navigation, Sprache wechseln, Dashboard lesen                                            |
| [02 – Server verwalten](02-server.md)                      | Docker-Server anlegen, externen Server verbinden, starten/stoppen, `server.properties`, löschen |
| [03 – Netzwerke (Velocity/BungeeCord)](03-netzwerke.md)    | Proxy-Netzwerke aufbauen, Server anhängen, Forwarding verstehen                                 |
| [04 – Welten](04-welten.md)                                | Welt aktivieren, neu erstellen, hoch-/runterladen, Pregeneration                                |
| [05 – Dateien](05-dateien.md)                              | Datei-Manager: browsen, editieren, hoch-/runterladen                                            |
| [06 – Mods & Plugins](06-mods-plugins.md)                  | Mods/Plugins installieren, eigene Jars, Modpacks bei Server-Erstellung                          |
| [07 – LuckPerms](07-luckperms.md)                          | Gruppen, Rechte, Spieler-Zuweisungen                                                            |
| [08 – Backups & geplante Aufgaben](08-backups-aufgaben.md) | Backups erstellen/wiederherstellen, Cron-Aufgaben                                               |
| [09 – Spieler](09-spieler.md)                              | Spielerliste, Profile, Moderation (Kick/Ban/Whitelist)                                          |
| [10 – Benutzer & Zugriff](10-benutzer-zugriff.md)          | Benutzer/Rollen, API-Tokens, 2FA                                                                |
| [11 – Benachrichtigungen](11-benachrichtigungen.md)        | Discord/E-Mail-Alarme einrichten                                                                |
| [12 – Audit-Log](12-audit-log.md)                          | Was protokolliert wird und wie man es liest                                                     |
| [13 – Metriken & Dashboard](13-metriken.md)                | TPS/CPU/RAM-Verlauf, Zeiträume                                                                  |

## Konventionen in diesem Handbuch

- **Rollen-Tabellen** zeigen die _minimal_ nötige Rolle — höhere Rollen dürfen
  das natürlich auch.
- **Feld-Referenzen** listen exakte Namen, Typen, Grenzwerte und
  Standardwerte, wie sie das Formular in der Oberfläche verwendet.
- **⚠️ Nicht offensichtlich** markiert Verhalten, das überrascht, wenn man es
  vorher nicht weiß (z. B. was ein Restore wirklich überschreibt).
- Alle Beispiele gehen von einer laufenden Installation mit mindestens einem
  Admin-Konto aus.
