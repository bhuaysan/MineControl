# 12 – Audit-Log

Menüpunkt "Audit-Log", **ADMIN-only** · `GET /api/audit`

Zeigt die letzten **200** Einträge, neueste zuerst. Es gibt aktuell **keine
Filter-, Such- oder Exportfunktion** — die Liste zeigt einfach alle
protokollierten Aktionen.

Jede Zeile enthält:

| Spalte   | Inhalt                                                                     |
| -------- | -------------------------------------------------------------------------- |
| Zeit     | relativ (z. B. "vor 3 Min."), genauer Zeitstempel per Mouseover            |
| Benutzer | Name, oder "System" bei Hintergrundaktionen (z. B. automatischer Neustart) |
| Aktion   | technischer Bezeichner wie `user.create`, nicht übersetzt                  |
| Details  | Rohes JSON mit aktionsspezifischen Zusatzinfos                             |

⚠️ Das Protokollieren ist "Best-Effort" — schlägt das Schreiben eines
Audit-Eintrags fehl, wird die eigentliche Aktion **nicht** blockiert, der
Fehler landet nur im Server-Log.

## Was wird protokolliert (vollständige Liste)

| Bereich                         | Aktionen                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anmeldung                       | `auth.login`, `auth.logout`                                                                                                                                                        |
| Benutzer                        | `user.create`, `user.update`, `user.delete`                                                                                                                                        |
| Tokens                          | `token.create`, `token.revoke`                                                                                                                                                     |
| 2FA                             | `2fa.enable`, `2fa.disable`                                                                                                                                                        |
| Benachrichtigungs-Einstellungen | `settings.notifications_update`                                                                                                                                                    |
| Server                          | `server.create`, `server.delete`, `server.command`, `server.properties_update`, `server.autoRestart.config`, `server.autoRestart`, `server.autoRestartGaveUp`                      |
| Backups                         | `backup.create`, `backup.restore`, `backup.delete`                                                                                                                                 |
| Dateien                         | `file.write`, `file.upload`, `file.mkdir`, `file.delete`                                                                                                                           |
| Mods/Plugins                    | `mod.config_write`, `mod.install`, `mod.upload`, `mod.install_url`, `mod.update`, `mod.delete`                                                                                     |
| Geplante Aufgaben               | `task.create`, `task.update`, `task.delete`                                                                                                                                        |
| Welten                          | `world.create`, `world.delete`, `world.upload`, `world.pregen`, `world.download`, `world.switch`                                                                                   |
| Netzwerke                       | `network.create`, `network.subserver_attach`, `network.subserver_create`, `network.subserver_detach`, `network.delete` (plus interne Fehler-Varianten wie `network.attach_failed`) |
| LuckPerms                       | `luckperms.install`, `luckperms.group.*`, `luckperms.user.*`                                                                                                                       |
| Spieler                         | `player.notes_update`, sowie jede Moderationsaktion (`player.kick`, `player.ban`, …)                                                                                               |

Diese Liste ist auch die Datenquelle für die Moderationshistorie im
Spielerprofil (siehe [09 – Spieler](09-spieler.md)).
