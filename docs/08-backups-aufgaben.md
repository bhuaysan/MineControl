# 08 – Backups & geplante Aufgaben

⚠️ Das hier sind **Welt-/Server-Backups**, nicht der automatische
Datenbank-Snapshot, den MineControl intern für sich selbst anlegt (siehe
[Haupt-README](../README.md#betriebshinweise-bitte-lesen)).

## Backups

Reiter "Backups", nur Docker-Server. Für **jede Rolle sichtbar** (lesend),
Aktionen ab MODERATOR.

| Aktion                                     | Route                                             | Rolle     |
| ------------------------------------------ | ------------------------------------------------- | --------- |
| Backups auflisten                          | `GET /api/servers/:id/backups`                    | VIEWER+   |
| Backup jetzt erstellen                     | `POST /api/servers/:id/backups`                   | MODERATOR |
| Backup wiederherstellen                    | `POST /api/servers/:id/backups/:backupId/restore` | ADMIN     |
| Backup löschen                             | `DELETE /api/servers/:id/backups/:backupId`       | ADMIN     |
| Welt herunterladen (kein Backup-Datensatz) | `GET /api/servers/:id/world/download`             | MODERATOR |

**"Backup jetzt erstellen" braucht keine Eingaben** — kein Name, keine
Beschreibung, keine Aufbewahrungsregel. Jede Zeile in der Liste zeigt
Zeitstempel, Größe und ein Abzeichen `manual`/`scheduled`.

⚠️ **Was ein Backup enthält:** ein `tar.gz` des **kompletten** Docker-
Datenverzeichnisses (`/data`), nicht nur der Weltordner. Läuft der Server
gerade, sendet MineControl vorher `save-all flush` per RCON, um die Welt auf
die Platte zu schreiben (Best-Effort — schlägt das fehl, wird trotzdem
gesichert).

⚠️ **Was "Wiederherstellen" wirklich macht** (unbedingt vorher verstehen):

1. Läuft der Server, wird er gestoppt (sauber, 60 s Timeout).
2. Das gewählte Archiv wird entpackt und in `/data` zurückgeschrieben.
3. **Bestehende Dateien werden überschrieben** — aber Dateien, die _nach_
   dem Backup neu hinzugekommen sind und im Archiv nicht vorkommen, werden
   **nicht gelöscht**. Wiederherstellen ist ein Überschreiben/Zusammenführen,
   kein Löschen-und-Ersetzen.
4. Der Server wird danach in jedem Fall neu gestartet, auch wenn das
   Entpacken fehlschlägt (damit ein vorher laufender Server nicht offline
   hängen bleibt).

⚠️ **Aufbewahrung (Retention) gilt nicht für manuelle Backups.** Alte
Backups werden nur automatisch gelöscht, wenn eine **geplante** Backup-
Aufgabe eine Aufbewahrungszahl mitbringt (siehe unten) — "Backup jetzt
erstellen" räumt nie auf, alte manuelle Backups müssen von Hand gelöscht
werden.

Ein fehlgeschlagenes Backup löst — falls aktiviert — eine Benachrichtigung
aus (siehe [11 – Benachrichtigungen](11-benachrichtigungen.md)). Wird der
Server gelöscht, werden alle seine Backup-Dateien mit gelöscht.

## Geplante Aufgaben (Cron)

Reiter "Aufgaben" — sichtbar für Docker-Server oder wenn RCON konfiguriert
ist. Auflisten ab VIEWER, Anlegen/Ändern/Löschen ADMIN, "Jetzt ausführen"
MODERATOR.

| Aktion             | Route                                     | Rolle     |
| ------------------ | ----------------------------------------- | --------- |
| Aufgaben auflisten | `GET /api/servers/:id/tasks`              | VIEWER+   |
| Aufgabe anlegen    | `POST /api/servers/:id/tasks`             | ADMIN     |
| Aufgabe ändern     | `PATCH /api/servers/:id/tasks/:taskId`    | ADMIN     |
| Aufgabe löschen    | `DELETE /api/servers/:id/tasks/:taskId`   | ADMIN     |
| Jetzt ausführen    | `POST /api/servers/:id/tasks/:taskId/run` | MODERATOR |

**Felder beim Anlegen:**

| Feld      | Typ     | Constraints                        | Default (UI) |
| --------- | ------- | ---------------------------------- | ------------ |
| `name`    | Text    | 1–64                               | —            |
| `cron`    | Text    | gültiger Cron-Ausdruck             | `0 4 * * *`  |
| `action`  | Auswahl | `RESTART` \| `COMMAND` \| `BACKUP` | `RESTART`    |
| `enabled` | Ja/Nein | optional                           | aktiv        |

Je nach `action` erscheint ein zusätzliches Feld:

- **COMMAND**: `payload.command` — der RCON-Befehl ohne führenden `/`, z. B.
  `say Neustart in 5 Minuten`.
- **BACKUP**: `payload.retention` — Zahl 1–100, Standard 7 in der UI. Ist
  gesetzt, werden nach diesem Backup ältere Backups (manuell **und**
  geplant, serverweit) auf die letzten N gekürzt.
- **RESTART** braucht keine weiteren Angaben.

Drei anklickbare Cron-Vorlagen in der UI: `0 4 * * *` (täglich 4:00),
`0 */6 * * *` (alle 6 h), `*/30 * * * *` (alle 30 min).

⚠️ **Cron-Syntax**: unterstützt ein optionales, führendes Sekundenfeld
zusätzlich zu den üblichen 5 Feldern, sowie Bereiche (`1-5`), Schritte
(`*/2`), Listen (`1,15`) und benannte Monate/Wochentage. **Es gibt kein
Zeitzonenfeld** — Aufgaben laufen in der Zeitzone des Servers, nicht
zwingend UTC.

⚠️ Die Aktion (`RESTART`/`COMMAND`/`BACKUP`) kann nach dem Anlegen nicht
mehr geändert werden — dafür die Aufgabe löschen und neu anlegen.

⚠️ **Überlappungsschutz:** Dieselbe Aufgabe kann nie parallel zweimal
laufen — läuft ein vorheriger Durchlauf noch, wenn der nächste Cron-Tick
fällig wäre, wird dieser Tick übersprungen, nicht in eine Warteschlange
gestellt.

Ein fehlgeschlagener Lauf setzt eine rote Fehlermeldung unter der Aufgabe
und löst — falls aktiviert — eine Benachrichtigung aus. Beim Deaktivieren/
Löschen wird der zugrunde liegende Cron-Job sofort wirklich abgemeldet, nicht
nur ausgeblendet.
