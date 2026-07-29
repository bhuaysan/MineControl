# 07 – LuckPerms (Rechteverwaltung)

Reiter "LuckPerms" — nur für Docker-Server der Editionen
Paper/Spigot/Fabric/Forge/NeoForge, **erst ab MODERATOR sichtbar**.

## Installation

**Rolle:** ADMIN · `POST /api/servers/:id/luckperms/install`

Ist LuckPerms noch nicht installiert, zeigt die Oberfläche eine Karte
"LuckPerms nicht installiert" mit Erklärtext. Der Installieren-Button
installiert das Plugin über Modrinth und **startet den Server neu**
(Hinweis: "LuckPerms wurde installiert — der Server startet neu. In ~1
Minute erneut öffnen.").

Ist es installiert, aber der Server läuft noch nicht oder das Plugin ist
noch nicht geladen, erscheint "LuckPerms ist installiert, antwortet aber
noch nicht" — der Status wird alle 5 Sekunden neu geprüft.

## Gruppen

**Rolle:** Lesen MODERATOR+, **Ändern ADMIN**

| Aktion                                        | Route                                                |
| --------------------------------------------- | ---------------------------------------------------- |
| Gruppen auflisten                             | `GET .../luckperms/groups`                           |
| Gruppe anlegen                                | `POST .../luckperms/groups`                          |
| Gruppendetails (Gewicht/Prefix/Suffix/Rechte) | `GET .../luckperms/groups/:name`                     |
| Gruppe löschen                                | `DELETE .../luckperms/groups/:name`                  |
| Recht setzen                                  | `POST .../luckperms/groups/:name/permission`         |
| Recht entfernen                               | `DELETE .../luckperms/groups/:name/permission?node=` |
| Meta setzen (Prefix/Suffix/Gewicht)           | `POST .../luckperms/groups/:name/meta`               |

**Feld-Referenz:**

| Feld          | Constraints                                                      |
| ------------- | ---------------------------------------------------------------- |
| Gruppenname   | `^[a-z0-9_-]{1,36}$` — Eingabe wird automatisch kleingeschrieben |
| Rechte-Node   | `^[A-Za-z0-9_.*:\-/#]{1,128}$`, z. B. `essentials.fly`           |
| Wert          | `true` (erlauben) / `false` (verweigern)                         |
| Prefix/Suffix | max. 64 Zeichen, kein `"`/Zeilenumbruch; leer = entfernen        |
| Gewicht       | Ganzzahl 0–10000                                                 |

⚠️ Die Gruppe **`default`** kann nicht gelöscht werden (`422 protected`) —
der Löschen-Button ist dafür ausgeblendet. Prefix/Suffix werden von
MineControl immer mit fester Priorität 100 gesetzt — bestehende
Prefix-/Suffix-Einträge auf anderen Prioritäten (z. B. von woanders gesetzt)
bleiben unberührt.

## Spieler

**Rolle:** Lesen MODERATOR+, **Ändern ADMIN**

| Aktion                            | Route                                               |
| --------------------------------- | --------------------------------------------------- |
| Spielerdetails (Gruppen + Rechte) | `GET .../luckperms/users/:name`                     |
| Zu Gruppe hinzufügen              | `POST .../luckperms/users/:name/groups`             |
| Aus Gruppe entfernen              | `DELETE .../luckperms/users/:name/groups/:group`    |
| Recht setzen                      | `POST .../luckperms/users/:name/permission`         |
| Recht entfernen                   | `DELETE .../luckperms/users/:name/permission?node=` |

Suche nach Spielername in der Oberfläche zeigt primäre Gruppe,
Gruppenzugehörigkeiten (als entfernbare Chips) und direkte Rechte-Nodes. Der
Spieler muss LuckPerms bereits bekannt sein (schon einmal verbunden gewesen
oder online auflösbar).

## Wie das Lesen technisch funlktioniert (Hintergrundwissen)

LuckPerms gibt über RCON keine Befehlsausgabe zurück — Antworten gehen nur an
den ursprünglichen Absender im Spiel. Deshalb löst **jede** Leseoperation
(Gruppen-/Spielerliste, Details) einen `lp export <Zufallsname>` per RCON
aus, MineControl wartet bis zu ~10 Sekunden auf die entstehende
`.json.gz`-Datei im Container, liest und entpackt sie, und **löscht sie
danach wieder**. Das bedeutet:

- Jede Ansicht/Aktualisierung kann bis zu einigen Sekunden dauern.
- **Erfordert einen laufenden Server mit geladenem LuckPerms** — sonst
  `409 not_available` ("LuckPerms-Export nicht erhalten — Server muss laufen
  und LuckPerms geladen sein").
- Änderungen (Gruppe anlegen/löschen, Rechte setzen, Zuweisungen) laufen als
  einfache `lp ...`-RCON-Befehle ohne Rückmeldung — MineControl aktualisiert
  danach einfach die Ansicht (was wiederum einen frischen Export auslöst).

## Häufige Fehler

| Fehler                         | Bedeutung                                       |
| ------------------------------ | ----------------------------------------------- |
| `409 not_available`            | Server läuft nicht oder LuckPerms nicht geladen |
| `422 protected`                | Gruppe `default` kann nicht gelöscht werden     |
| `409 exists` / `404 not_found` | Gruppe existiert bereits / nicht gefunden       |
