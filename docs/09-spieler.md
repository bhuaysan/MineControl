# 09 – Spieler

Zwei Ansichten: eine **globale, serverübergreifende Spielerliste** mit
Verlauf, und **Online-Aktionen pro Server** (im Reiter "Spieler" der
Serverdetailseite).

## Globale Spielerliste

**Rolle:** VIEWER+ · `GET /api/players`

Zeigt jeden je gesehenen Spieler mit Avatar, Online-Punkt, "zuletzt gesehen"
(relativ) bzw. "Online", Gesamtspielzeit (über alle Server summiert),
durchsuchbar nach Namen, sortiert nach zuletzt gesehen.

⚠️ **Der Schlüssel ist der kleingeschriebene Name, keine echte Mojang-UUID**
— RCONs `list`-Befehl liefert keine UUIDs. Das heißt: "Steve" und "steve"
sind dieselbe Person, aber eine echte Namensänderung bei Mojang erzeugt ein
**neues** Profil in MineControl (keine automatische Zusammenführung).

## Spielerprofil

**Rolle:** VIEWER+ · `GET /api/players/:key`

Zeigt: erstes/letztes Gesehen, Notizen, Gesamtspielzeit, Sitzungsanzahl,
aktuellen Online-Status (+ auf welchem Server), die letzten 20 Sitzungen
(Beitritt/Verlassen je Server, "läuft noch" falls offen), sowie die letzten
50 **Moderationsaktionen** (Kick/Ban/Unban/Op/Deop/Whitelist).

⚠️ Die Moderationshistorie wird über den zuletzt bekannten Namen mit dem
Audit-Log verknüpft — eine Namensänderung trennt die Verbindung zu älteren,
unter dem alten Namen geloggten Einträgen.

### Notiz setzen

**Rolle:** MODERATOR+ · `PATCH /api/players/:key` `{ notes }`

Freitext, max. 2000 Zeichen; leer/nur Leerzeichen löscht die Notiz. VIEWER
sieht die Notiz nur lesend.

## Online-Spieler pro Server

**Rolle:** VIEWER+ (ansehen) · `GET /api/servers/:id/players`

Live-Momentaufnahme per RCON `list` (Ping-Stichprobe als Rückfallebene ohne
RCON).

## Spieler-Aktionen (Kick/Ban/Whitelist/Op)

**Rolle:** MODERATOR+ · `POST /api/servers/:id/players/action`
`{ name, action, reason? }`

| Feld     | Constraints                                                               |
| -------- | ------------------------------------------------------------------------- |
| `name`   | `^[A-Za-z0-9_]{3,16}$` (gültige Minecraft-Namensform)                     |
| `action` | `kick`, `ban`, `unban`, `whitelist_add`, `whitelist_remove`, `op`, `deop` |
| `reason` | **Pflicht bei `ban`**, optional bei `kick`, sonst ignoriert               |

Jede Aktion entspricht einem echten Minecraft-Befehl: `kick <name>
[Grund]`, `ban <name> [Grund]`, `pardon <name>` (unban), `whitelist
add/remove <name>`, `op <name>`, `deop <name>`.

In der Oberfläche: "⋮"-Menü neben jedem Online-Spieler, nur sichtbar ab
MODERATOR **und** wenn RCON für den Server konfiguriert ist. Kick/Ban sind
rot markiert und öffnen einen Dialog für den Grund (bei Ban ist das Feld
Pflicht); die übrigen Aktionen feuern sofort ohne Dialog.

Jede Aktion wird im Audit-Log als `player.<action>` festgehalten — das ist
genau die Datenquelle für die Moderationshistorie im Spielerprofil.
