# End-User-Testplan: MineControl

Ein **manueller Akzeptanztest aus Nutzersicht** — alles im Browser, keine `curl`-Befehle, kein Blick in den Code. Ziel: bestätigen, dass ein Anwender alle Funktionen über die Oberfläche bedienen kann und sich die App erwartungsgemäß verhält (Anzeige, Rückmeldungen, Fehlermeldungen, Live-Updates, Rollenrechte).

> Der Deployment-/Fix-Verifikationsplan liegt getrennt in `TESTPLAN.md`.


## Wie dieser Plan benutzt wird

- Abschnitte **der Reihe nach** durcharbeiten — spätere Tests bauen teils auf angelegten Objekten (Server, Nutzer) auf.

- Jeden Schritt ausführen, mit „Erwartet" vergleichen, in der Spalte **Ergebnis** eintragen: `✅ PASS`, `❌ FAIL` oder `⏭️ übersprungen`.

- Bei `FAIL`: Was passiert ist + ggf. Screenshot + Meldung aus der Browser-Konsole (F12 → Console) notieren. Nicht stillschweigend weitermachen.

- Optionale/umgebungsabhängige Tests sind mit **(optional)** markiert (z. B. echter Minecraft-Client, SMTP-Server, externer Server).


## 0. Vorbedingungen & Umgebung

| Sache | Wert |
| - | - |
| Testumgebung | Dev: [http://localhost:5173](http://localhost:5173/) (`MC\_SERVER\_PORT=3055 pnpm dev`) **oder** Prod: [https://localhost](https://localhost/) (`docker compose up -d`) |
| Admin-Login | `admin` / Passwort aus `apps/server/.env` bzw. Root-`.env` |
| Docker | Läuft, `itzg/minecraft-server`-Image vorhanden (sonst dauert der erste Serverstart lange durch den Image-Pull) |
| Browser | Aktueller Chrome/Firefox, DevTools griffbereit (F12) |


**Vor dem Test:**

1. App im Browser öffnen, ggf. Zertifikatswarnung akzeptieren (nur Prod/`localhost`-CA).

2. F12 → Tab **Console** offen lassen, um auf rote Fehler zu achten.

3. F12 → Tab **Network → WS** offen lassen, um die Live-Verbindung (`/ws`, Status `101`) zu beobachten.

> **Hinweis Ports:** Von MineControl erstellte Docker-Server binden bewusst nur an `127.0.0.1`. Ein echter Minecraft-Client-Login (Abschnitt 14) funktioniert daher nur vom selben Rechner wie Docker.


## 1. Login & Sitzung

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 1.1 | App öffnen ohne angemeldet zu sein | Weiterleitung zur **Login-Seite** | `✅` |
| 1.2 | Falsches Passwort eingeben | Fehlermeldung „ungültige Anmeldedaten" o. ä.; **kein** Absturz, bleibt auf Login | `✅` |
| 1.3 | Korrekt als `admin` anmelden | Weiterleitung zum **Dashboard**, keine roten Fehler in der Konsole | `✅` |
| 1.4 | Seite hart neu laden (Strg+Shift+R) | Bleibt angemeldet, Dashboard lädt erneut | `✅` |
| 1.5 | Netzwerk-Tab → WS prüfen | `/ws`-Verbindung `101`, bleibt offen | `✅` |
| 1.6 | Abmelden (Logout) | Zurück zur Login-Seite; geschützte Seite direkt aufrufen führt zurück zum Login | `✅` |



## 2. Dashboard & Live-Status

*(Voraussetzung: mind. ein Server existiert — ggf. erst Abschnitt 4 machen und hierher zurückkehren.)*

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 2.1 | Dashboard öffnen | Server als Karten mit Name, Status-Badge (ONLINE/OFFLINE/…), Spielerzahl | ✅ |
| 2.2 | Einen Server starten (Abschnitt 5) und Dashboard beobachten | Status-Badge wechselt **live** ohne manuelles Neuladen |  |
| 2.3 | Auf eine Serverkarte klicken | Öffnet die **Server-Detailseite** |  |
| 2.4 | Kurz die Live-Verbindung trennen (Backend/WS kurz stören, optional) | Hinweis „Live-Verbindung getrennt" erscheint und verschwindet nach Reconnect |  |



## 3. Navigation & Rollen-Sichtbarkeit

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 3.1 | Als Admin: Navigation prüfen | Zugänglich: Dashboard, Netzwerke, Spieler, Benutzer, Audit-Log, Einstellungen |  |
| 3.2 | Menüpunkte durchklicken | Jede Seite lädt ohne Fehler |  |


*(Rollen-Einschränkungen für Moderator/Viewer werden in Abschnitt 12 geprüft.)*


## 4. Server erstellen (Docker-Wizard)

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 4.1 | „Server hinzufügen" → Docker | Wizard mit Feldern Edition/Version/RAM/Port/Seed/EULA |  |
| 4.2 | Ohne EULA-Zustimmung absenden | Wird verhindert / Hinweis |  |
| 4.3 | Paper 1.21.1, RAM/Port ausfüllen, EULA anhaken, erstellen | Server wird angelegt; **Provisionierung** mit Image-Pull-Fortschritt als Konsolenzeilen sichtbar |  |
| 4.4 | Warten bis fertig | Status geht auf `ONLINE` (ggf. kurzer `STARTING`/`UNKNOWN`-Blip) |  |
| 4.5 | Port bewusst doppelt vergeben (zweiter Server, gleicher Port) | Klare Fehlermeldung, kein doppelt belegter Port |  |
| 4.6 | **(optional)** Modpack-Server: im Wizard einen Modrinth- **oder** CurseForge-Modpack angeben | Beide Felder gegenseitig gesperrt; Server bootet mit dem Modpack |  |
| 4.7 | **(optional)** Import: bestehendes `.tar.gz` (world/plugins/…) als Quelle | Wird entpackt, Server startet mit importierten Daten; Import + Modpack schließen sich aus |  |



## 5. Server-Lifecycle (Detailseite → Aktionen)

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 5.1 | Detailseite → Übersicht | Zeigt Version, Typ (Docker), Host:Port, Status-Badge |  |
| 5.2 | **Stop** | Status → `OFFLINE`, Badge aktualisiert live |  |
| 5.3 | **Start** | Status → `STARTING` → `ONLINE` |  |
| 5.4 | **Restart** | Server fährt runter und wieder hoch, endet `ONLINE` |  |
| 5.5 | **Kill** | Server sofort `OFFLINE` |  |
| 5.6 | Auto-Restart-Schalter umlegen (Admin, nur Docker) | Zustand wird gespeichert (bleibt nach Reload erhalten) |  |



## 6. Konsole & Metriken (Übersicht)

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 6.1 | Server online, Tab **Konsole** | Live-Log läuft ein (xterm) |  |
| 6.2 | Befehl absetzen, z. B. `say hallo` | Ausgabe erscheint in der Konsole |  |
| 6.3 | Übersicht → Metrik-Karte | Live CPU/RAM; bei Paper/Spigot zusätzlich **TPS** (farbcodiert) |  |
| 6.4 | Metrik-Historie-Chart | Zeigt Verlauf; Zeitfenster 1h–7d umschaltbar; Serien Spieler/CPU/RAM/TPS |  |



## 7. Spieler-Verwaltung

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 7.1 | Detailseite → Tab **Spieler** | Liste online (Kopf/Avatar, Name); Zähler im Tab-Titel stimmt |  |
| 7.2 | **(optional, echter Spieler online)** Aktion Kick/Ban/Whitelist/OP | Aktion greift; Rückmeldung sichtbar |  |
| 7.3 | Nav → **Spieler** (globale Liste) | Suchbare Spielerliste über alle Server |  |
| 7.4 | Auf einen Spieler → Profil | Kennzahlen (Spielzeit, Sessions), Moderations-Verlauf, Notizfeld |  |
| 7.5 | Notiz speichern (Moderator+) | Notiz bleibt nach Reload erhalten |  |



## 8. Dateien, Plugins/Mods, server.properties

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 8.1 | Tab **Dateien** (Docker, Moderator+) | Datei-Browser des `/data`-Volumes, Breadcrumb-Navigation |  |
| 8.2 | Textdatei öffnen, ändern, speichern (Admin) | Änderung wird übernommen |  |
| 8.3 | Datei hoch-/herunterladen | Up-/Download funktioniert |  |
| 8.4 | Übersicht → **server.properties**-Editor | Formular zeigt Werte; Speichern erhält Reihenfolge/Kommentare |  |
| 8.5 | Tab **Plugins** (Paper) → Modrinth suchen, z. B. „luckperms" | Trefferliste kompatibel zur Version |  |
| 8.6 | Plugin installieren | Erscheint in der Liste; nach Neustart aktiv |  |
| 8.7 | Plugin **deaktivieren/aktivieren** (Toggle) | Status wechselt (`.disabled`), Liste zeigt Zustand |  |
| 8.8 | **Eigene .jar** per Upload oder URL installieren | Datei erscheint als installiertes Plugin |  |
| 8.9 | Plugin-**Config** bearbeiten (Config-Overlay) | Config-Datei lesen/schreiben funktioniert |  |
| 8.10 | **Update-Check** (Modrinth-Herkunft) | Zeigt verfügbares Update-Badge; Update ersetzt alte Datei |  |



## 9. Welten & Rechte (LuckPerms)

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 9.1 | Tab **Welten** (Docker, Nicht-Proxy, Moderator+) | Listet vorhandene Welten mit Größe |  |
| 9.2 | Neue Welt erstellen (+ Seed) | Welt wird angelegt |  |
| 9.3 | Aktive Welt wechseln | Server startet neu mit neuer Welt |  |
| 9.4 | Welt löschen (nicht die aktive) | Wird entfernt; aktive Welt ist geschützt |  |
| 9.5 | **(optional)** Welt-Upload `.tar.gz` | Welt erscheint nach Upload |  |
| 9.6 | **(optional)** Pregen (Chunky), Radius setzen, Start | Fortschritt in der Konsole; Abbrechen möglich |  |
| 9.7 | Welt-**Download** | Lädt `.tar.gz` herunter |  |
| 9.8 | Tab **Rechte** (LuckPerms, Paper) | Auto-Install falls nötig; Gruppen/Spieler/Meta sichtbar |  |
| 9.9 | Gruppe anlegen, Permission setzen, Prefix vergeben (Admin) | Änderung wird gespeichert (nach Reload sichtbar) |  |



## 10. Backups & Zeitpläne

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 10.1 | Tab **Backups** → Backup erstellen (Moderator+) | Backup erscheint in der Liste (Größe/Datum) |  |
| 10.2 | Backup wiederherstellen (Admin) | Server stoppt, spielt Backup ein, startet neu |  |
| 10.3 | Backup löschen | Wird entfernt |  |
| 10.4 | Tab **Zeitpläne** → Task anlegen (RESTART/COMMAND/BACKUP, Cron) | Task erscheint; ungültiger Cron wird abgelehnt |  |
| 10.5 | „Jetzt ausführen" | Task läuft, `lastRunAt` aktualisiert; Fehler landen in `lastError` |  |



## 11. Netzwerke (Proxy)

*(Umfangreich — optional als Ganzes, falls Proxy-Setup getestet werden soll.)*

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 11.1 | Nav → **Netzwerke** | Liste der Netzwerke (leer möglich) |  |
| 11.2 | Velocity-Netzwerk erstellen | Proxy-Server (mc-proxy) wird angelegt |  |
| 11.3 | Paper-Subserver anhängen | Subserver wird neu provisioniert und dem Netz zugeordnet |  |
| 11.4 | **(optional)** BungeeCord-Netzwerk mit Paper-Subserver | Analog, bootet ohne „No servers defined" |  |
| 11.5 | Subserver abhängen | Wird sauber aus dem Netz gelöst |  |



## 12. Benutzerverwaltung & Rollen (wichtig!)

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 12.1 | Nav → **Benutzer** (Admin) | Nutzerliste mit Rollen |  |
| 12.2 | Neuen Nutzer `mod1` (Moderator) anlegen | Erscheint in der Liste |  |
| 12.3 | Neuen Nutzer `view1` (Viewer) anlegen | Erscheint in der Liste |  |
| 12.4 | Als `mod1` anmelden (anderes Browserfenster/Inkognito) | Kann Server bedienen (Start/Stop, Backup erstellen), aber **nicht**: Nutzer verwalten, Restore, Einstellungen, Löschen |  |
| 12.5 | Als `view1` anmelden | Nur lesen: Status/Spieler/Profile sichtbar, keine Aktionsbuttons |  |
| 12.6 | Letzten Admin herabstufen/löschen versuchen | Wird verhindert („letzter Admin"-Schutz) |  |
| 12.7 | Testnutzer wieder löschen | Entfernt |  |



## 13. Einstellungen: 2FA, Tokens, Benachrichtigungen

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 13.1 | Einstellungen → **2FA** einrichten | QR-Code erscheint; mit Authenticator-App scannen |  |
| 13.2 | Enrollment-Code eingeben, aktivieren | 2FA aktiv |  |
| 13.3 | Abmelden, neu anmelden | Nach Passwort wird **2FA-Code** verlangt; falscher Code → Fehler, richtiger → Login |  |
| 13.4 | 2FA wieder deaktivieren | Login danach ohne Code |  |
| 13.5 | **API-Token** erstellen (Admin) | Token wird **einmalig** angezeigt; erscheint in der Tokenliste |  |
| 13.6 | Token löschen | Entfernt |  |
| 13.7 | **Discord**-Webhook-URL eintragen + Testnachricht (optional) | Testnachricht kommt an / klare Fehlermeldung bei ungültiger URL |  |
| 13.8 | **(optional)** **E-Mail (SMTP)** konfigurieren + Testmail | Testmail versendet / Fehlermeldung bei falscher Konfiguration |  |
| 13.9 | Down-Benachrichtigung: Server extern stoppen und warten | Nach Erkennung Alarm über aktive Kanäle |  |



## 14. Externer Server & echter Login (optional)

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 14.1 | **(optional)** Externen Server (Host/Port/RCON) hinzufügen | Erscheint mit Live-Ping-Status; nur RCON/Ping-Funktionen (kein Start/Dateien) |  |
| 14.2 | **(optional)** Mit echtem Minecraft-Client verbinden (gleicher Rechner) | Join klappt; Spieler taucht online in MineControl auf |  |



## 15. Audit-Log & Aufräumen

| \# | Schritt | Erwartet | Ergebnis |
| - | - | - | - |
| 15.1 | Nav → **Audit-Log** | Zeigt die im Test durchgeführten Aktionen (Login, Start/Stop, Anlegen/Löschen …) mit Nutzer + Zeit |  |
| 15.2 | Testserver wieder entfernen (Admin) | Container/Volume entfernt (Welt-Behalten-Option beachten); saubere Rückmeldung |  |
| 15.3 | Abschließend: Browser-Konsole auf rote Fehler durchsehen | Keine unerwarteten Fehler über den gesamten Testlauf |  |



## Ergebnis-Zusammenfassung

| Abschnitt | Ergebnis | Notiz |
| - | - | - |
| 1. Login & Sitzung |  |  |
| 2. Dashboard & Live-Status |  |  |
| 3. Navigation & Rollen |  |  |
| 4. Server erstellen |  |  |
| 5. Lifecycle |  |  |
| 6. Konsole & Metriken |  |  |
| 7. Spieler |  |  |
| 8. Dateien/Plugins/Properties |  |  |
| 9. Welten & Rechte |  |  |
| 10. Backups & Zeitpläne |  |  |
| 11. Netzwerke |  |  |
| 12. Benutzer & Rollen |  |  |
| 13. 2FA/Tokens/Notifs |  |  |
| 14. Extern & echter Login |  |  |
| 15. Audit & Aufräumen |  |  |


**Gesamturteil:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

**Getestet von / Datum:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

