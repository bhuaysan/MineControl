# Bugsuche mit Opus — gezielte Prompts

Jeden Punkt in einer **frischen, eigenen Session** einsetzen (nicht alle
nacheinander in einer langen Session) — jeder Prompt ist in sich
abgeschlossen und braucht keinen Bezug zu den anderen. Das hält den Kontext
pro Session klein und spart Tokens.

> **Update:** Eine vorherige Opus-4.8-Session hat die ursprünglichen Punkte
> 1–4 (Pfad-Traversal/Symlinks, Welt-Upload/Löschschutz, Netzwerk-Races,
> WS-Ref-Counting-Leak) bereits behoben — siehe Commits `55c90ea`, `d17ff00`,
> `b064e87`, `93ea0ea` und die neue "Bekannte Einschränkungen" in
> PLANNING.md §11.
>
> **Update 2 (Commit `47737c5`):** Punkte **4, 5 und 6 unten sind erledigt**
> (Auth/2FA-Timing+Replay, E-Mail-Notifs-Selbstprüfung, Docker-Lifecycle).
> Behoben: TOTP-Replay (neues Feld `totpLastStep`), TOCTOU beim
> Letzter-Admin-Schutz, fehlendes SMTP-Timeout + Transport-Pooling +
> Anzeigenamen-Validierung, putArchive-root-Owner in files/mods-Service,
> verschluckte Docker-Teardown-Fehler. **Offen bleiben nur noch Punkt 1**
> (verbleibender Rest RCON-Fehlerbehandlung — ephemere Verbindungen im
> 60s-Sampler) **und Punkt 2** (bewusst zurückgestellte Netzwerk-Lücke aus
> §11, nur relevant bei Mehrbenutzer-/API-Betrieb) **und Punkt 3**
> (LuckPerms-Export-Cleanup/Nebenläufigkeit).
>
> **Update 3 (Review der ganzen Codebase am 2026-07-25, Commit `3552592`):**
> Behoben wurden drei Netzwerk-Konsistenzfehler: ein Proxy-Server ließ sich
> einzeln löschen und riss per Cascade das ganze Netzwerk mit; das Löschen
> eines Subservers ließ einen toten Alias in der Proxy-Config stehen;
> `reprovisionServer` verlor Modpack/Seed/Difficulty/Gamemode.
>
> Dabei wurden **Punkt 1 und Punkt 3 unten als bereits erledigt verifiziert**
> und brauchen keine eigene Session mehr: Es gibt genau _ein_ `new Rcon(...)`
> im Projekt (`adapters/external.ts`, in `connectRcon()`); der
> `error`-Listener hängt dort VOR `connect()`, und sowohl `sendCommand`
> (ephemer — u. a. der 60-s-Sampler über `sampleTps`) als auch
> `openPersistentRcon` gehen durch diese Funktion. Beim LuckPerms-Export läuft
> das `rm -f` unbedingt nach dem Poll-Loop, `readContainerFile` lehnt nie ab
> (löst im Fehlerfall mit `null` auf) — der Loop kann also nicht am Cleanup
> vorbeispringen — und ein unvollständiges/kaputtes JSON wird im Loop gefangen
> und endet in einem 409 statt in einem Crash. Dateinamens-Kollisionen sind
> durch `Date.now()` + 6 Zufallsstellen praktisch ausgeschlossen.
>
> **Offen bleibt aus der alten Liste damit nur Punkt 2.** Neu hinzu kommen die
> Punkte **7–14** — alle im Review diagnostiziert, aber bewusst nicht behoben
> (der Auftrag war auf die drei Netzwerk-Fehler begrenzt). Sie sind nach
> Schwere sortiert; die Prompts enthalten den Befund, damit jede Session ohne
> Vorwissen startet.

---

## 1. RCON-Fehlerbehandlung: verbleibende Lücken — ✅ ERLEDIGT (verifiziert 2026-07-25)

```
Prüfe apps/server/src/adapters/external.ts (openPersistentRcon,
connectRcon) sowie apps/server/src/modules/metrics/service.ts (60s-
Metrik-Sampler, nutzt ephemere RCON-Verbindungen). Bekannter, bereits
behobener Fix: fehlender error-Listener auf dem rcon-client-Socket crashte
früher den ganzen Prozess (persistente Verbindung, ws/index.ts). Prüfe
GEZIELT, ob auch die ephemeren Verbindungen im 60s-Sampler und an jeder
anderen Stelle, die adapter.sendCommand()/eine neue Rcon-Instanz nutzt,
denselben error-Handler VOR connect() angehängt haben — nicht nur die
bereits abgesicherte persistente Variante.
```

## 2. Netzwerk: bewusst zurückgestellte Lücke aus PLANNING.md §11

```
Lies PLANNING.md §11 "Bekannte Einschränkungen" — dokumentiert eine
bewusst NICHT behobene Lücke: zwei verschiedene, widersprüchliche
Netzwerk-Befehle auf demselben Server im selben Zeitfenster (z. B. Detach
aus Netz A gleichzeitig mit Attach an Netz B) können zu einem DB/Container-
Zustands-Mismatch führen, obwohl withResourceLock in
apps/server/src/modules/networks/service.ts alle GLEICHARTIGEN Races
(Doppelklick, doppeltes Detach) bereits abdeckt. Prüfe, ob dieser Mismatch-
Fall im Rahmen von Ben's aktuellem Nutzungsmuster (Einzel-Admin, kein API-
Automatisierungs-Betrieb) wirklich irrelevant ist, oder ob es einen
einfachen, kleinen Fix gibt (z. B. eine Server-Level-Statusmaschine mit nur
zwei Zuständen "idle"/"busy"), der die volle Lösung nicht braucht, aber die
Lücke schon schließt.
```

## 3. LuckPerms-Export: Nebenläufigkeit & Cleanup — ✅ ERLEDIGT (verifiziert 2026-07-25)

```
Prüfe apps/server/src/modules/luckperms/service.ts. Bekannte Einschränkung:
LuckPerms-Mutationen laufen asynchron ohne RCON-Rückmeldung; `lp export`
überschreibt keine existierende Datei (silent fail) — deshalb werden
eindeutige Dateinamen pro Aufruf verwendet. Prüfe: (1) Wird die Export-Datei
im Container auch bei einer Exception zwischen getArchive und Cleanup
zuverlässig gelöscht, oder sammeln sich bei Fehlern verwaiste Export-Dateien
im plugins/LuckPerms/-Ordner an? (2) Kann ein Nutzer durch schnelles
Doppel-Klicken (zwei parallele Export-Anfragen) Dateinamens-Kollisionen
erzeugen? (3) Wird der JSON-Parse-Fehlerfall (kaputtes/unvollständiges Export
durch Server-Crash mitten im Export) behandelt oder crasht die Route?
```

## 4. Auth, 2FA, API-Tokens: Timing & Replay — ✅ ERLEDIGT (47737c5)

```
Prüfe apps/server/src/modules/twofa/totp.ts, apps/server/src/modules/auth/
routes.ts und apps/server/src/modules/tokens/service.ts. Fragen: (1) Ist der
TOTP-Codevergleich mit einer konstanten Zeitfunktion (timing-safe) oder ein
simpler ===-Vergleich (Timing-Angriff)? (2) Wird ein einmal genutzter
TOTP-Code innerhalb desselben 30s-Fensters ein zweites Mal akzeptiert
(Replay)? (3) Ist der API-Token-Hash-Vergleich in tokens/service.ts
timing-safe? (4) Schützt users/routes.ts den "letzten Admin" auch gegen
Rollenänderung (nicht nur Löschen) — kann man den letzten Admin auf VIEWER
downgraden?
```

## 5. Neues Feature — E-Mail-Benachrichtigungen (Selbstprüfung der letzten Session) — ✅ ERLEDIGT (47737c5)

```
Review apps/server/src/modules/notifications/service.ts und routes.ts,
gerade neu für SMTP-Versand ergänzt (Commit 614bac6). Prüfe gezielt: (1)
Race Condition in updateNotificationSettings() — wenn ein Request nur
emailSmtpHost ändert während smtpPassEnc bereits gesetzt ist, aber
gleichzeitig ein anderer Request clearEmail auslöst, welcher Zustand
gewinnt (kein Transaction-Wrapping der mehreren Setting-Writes)? (2) Wird
bei jedem postToEmail() ein neuer SMTP-Transport aufgebaut statt
wiederverwendet — Performance-Problem bei vielen Benachrichtigungen in
kurzer Zeit? (3) Ist die E-Mail-Adressvalidierung in routes.ts (comma-split
+ z.string().email()) robust gegen Adressen mit Anzeigenamen
("Name <a@b.com>"), die manche SMTP-Server akzeptieren, oder schlägt das
Speichern dann grundlos fehl? (4) Timeout: postToDiscord hat ein
5s-AbortController-Timeout, postToEmail nicht — kann ein hängender SMTP-Server
den Aufrufer (z. B. den Metrik-Sampler) blockieren?
```

## 6. Docker-Adapter: Container-Lifecycle & Volume-Löschung — ✅ ERLEDIGT (47737c5)

```
Prüfe apps/server/src/adapters/docker.ts und
apps/server/src/modules/servers/docker.ts. Fokus: (1) Löschvorgang (Container
+ Volume entfernen, Welt optional behalten) — was passiert bei einem Fehler
zwischen Container-Stop und Volume-Löschung (halb gelöschter Zustand,
inkonsistente DB)? (2) Provisionierung: Wenn der Image-Pull mittendrin
abbricht (Netzwerkfehler), bleibt ein halb konfigurierter DB-Eintrag zurück?
(3) uid/gid-1000-Patch für server.properties/putArchive — gilt das
konsistent für ALLE putArchive-Aufrufe im Projekt (world/service.ts,
files/service.ts, networks/*.ts), oder nur an der ursprünglichen Stelle wo
der Bug zuerst gefunden wurde?
```

## 7. server.properties-Formular wird beim nächsten Start überschrieben

```
Bekannter Fund (diagnostiziert, nicht behoben). createContainer in
apps/server/src/modules/servers/docker.ts setzt MOTD und ONLINE_MODE IMMER ins
Container-Env (DIFFICULTY/MODE zusätzlich, wenn beim Anlegen gesetzt). itzg
schreibt diese Env-Werte bei OVERRIDE_SERVER_PROPERTIES=true (Default) bei
JEDEM Start in server.properties. Trotzdem bietet
apps/web/src/components/ServerPropertiesForm.tsx genau motd, online-mode,
difficulty und gamemode zum Bearbeiten an — mit dem Hinweis „Änderungen wirken
nach dem nächsten (Neu-)Start", also genau zu dem Zeitpunkt, an dem sie
verworfen werden. Der Server-Code kennt den Mechanismus bereits (Kommentar bei
reprovisionServer in modules/networks/service.ts). Aufgabe: (1) Verhalten am
laufenden Container verifizieren. (2) Einen Weg entscheiden und umsetzen —
entweder die betroffenen Felder aus dem Formular entfernen, oder (besser) beim
Speichern zusätzlich dockerConfig fortschreiben und den Container-Env-Wert
mitziehen, damit die Änderung einen Neustart übersteht. Die übrigen Felder
(max-players, pvp, view-distance, spawn-protection, …) stehen nicht im Env und
funktionieren korrekt — die nicht mit anfassen.
```

## 8. SSRF-Schutz per IPv6-mapped Hex-Form umgehbar

```
Bekannter Fund (diagnostiziert UND empirisch bestätigt, nicht behoben).
isBlockedIp in apps/server/src/modules/mods/service.ts erkennt bei IPv6 nur die
punktierte Mapped-Form (::ffff:127.0.0.1), nicht die Hex-Form (::ffff:7f00:1
bzw. 0:0:0:0:0:ffff:7f00:1). Der connect-zeitliche validatingLookup in
downloadJarSsrfSafe greift ebenfalls nicht, weil Node bei IP-Literalen
dns.lookup gar nicht aufruft — nachgemessen mit einem lokalen HTTP-Server:
http://[::ffff:7f00:1]:PORT/ lieferte den Body, der eigene lookup wurde nie
aufgerufen. Damit erreicht POST /api/servers/:id/mods/from-url localhost und
interne Adressen, obwohl der Schutz genau das verhindern soll (Admin-only, aber
der Control existiert und ist umgehbar). Aufgabe: v6-Adressen vor der Prüfung
normalisieren (die letzten 32 Bit von ::ffff:0:0/96 unabhängig von der Notation
als IPv4 prüfen) und dabei gleich mit abdecken: IPv4-compatible (::x.y.z.w),
NAT64 (64:ff9b::/96), ::/128. isBlockedIp ist eine reine Funktion — Unit-Test
dazu schreiben (Muster: src/rateLimit.test.ts).
```

## 9. Staging-Uploads werden nie aufgeräumt

```
Bekannter Fund. cleanupStagedImport läuft ausschließlich im finally von
provisionDockerServer (apps/server/src/modules/servers/docker.ts). Wer über
POST /api/servers/import/stage ein Archiv hochlädt und den Wizard dann abbricht
— oder wessen POST /api/servers/docker vorher am Port-Konflikt scheitert (in
modules/servers/routes.ts passiert die Import-Auflösung VOR der Port-Prüfung) —
hinterlässt die Datei dauerhaft in IMPORT_STAGING_DIR. Bei IMPORT_MAX_MB=10240
(Default) sind das bis zu 10 GiB pro Versuch, und es gibt keinerlei
Aufräum-Mechanismus. Aufgabe: (1) Staging-Datei sofort entfernen, wenn die
Server-Anlage vor dem Provisionieren fehlschlägt. (2) Zusätzlich periodisch
Dateien über einer Altersschwelle (z. B. 24 h) löschen — als Muster dient
prune() im Metrik-Sampler (modules/metrics/service.ts, setInterval mit
Aufbewahrungsfrist). Achte darauf, nur Dateien im Staging-Verzeichnis zu
löschen, nie in IMPORT_DIR (das sind vom Admin bereitgestellte Archive).
```

## 10. Geplanter RESTART-Task löst falschen „Server offline"-Alarm aus

```
Bekannter Fund. executeAction in apps/server/src/modules/tasks/service.ts ruft
bei action=RESTART adapter.restart() ohne suppressDownAlert(server.id). ALLE
anderen Restart-Pfade unterdrücken den Alarm: die Lifecycle-Route
(modules/servers/routes.ts), restart() in modules/world/service.ts, der
LuckPerms-Install, mehrere Stellen in modules/networks/service.ts und
maybeAutoRestart in modules/metrics/service.ts. Ein nächtlicher Restart-Task
kann deshalb je nach Sampler-Timing eine falsche
„Server offline"-Benachrichtigung per Discord/E-Mail auslösen. Aufgabe: prüfen,
ob RESTART (und ggf. BACKUP, das per save-all flush bremst) suppressDownAlert
setzen muss, und ob der Aufruf besser in eine adapter-nahe Hilfsfunktion
wandert, damit der nächste hinzugefügte Restart-Pfad ihn nicht wieder vergisst.
```

## 11. Content-Disposition mit ungeprüften Nutzereingaben

```
Bekannter Fund. apps/server/src/modules/world/routes.ts baut den Header
`attachment; filename="${server.name}-${level}.tar.gz"`. server.name ist beim
Anlegen nur z.string().min(1).max(64) und darf damit " sowie \r\n enthalten:
Ein Zeilenumbruch im Servernamen lässt Node beim Setzen des Headers mit
ERR_INVALID_CHAR scheitern → 500 statt Download, ein " zerlegt den Dateinamen.
Gleiches Muster in modules/files/routes.ts (Dateiname aus dem Pfad). Aufgabe:
Dateinamen für den Header sauber kodieren (RFC 5987/6266: filename*=UTF-8''…
plus ASCII-Fallback) oder auf einen unbedenklichen Zeichensatz reduzieren.
Prüfe bei der Gelegenheit, ob weitere Stellen Nutzereingaben ungeprüft in
Response-Header schreiben.
```

## 12. activeLevel()-Fallback kann den Schutz der aktiven Welt aushebeln

```
Bekannter Fund (Datenverlust-Potenzial, schmales Zeitfenster). activeLevel in
apps/server/src/modules/world/service.ts fängt JEDEN Fehler und liefert
"world". deleteWorld baut darauf seinen Guard „die aktive Welt (und ihre
Nether-/End-Dimensionen) darf nicht gelöscht werden". Scheitert
readServerProperties transient (Docker-/Tar-Störung, während exec noch
funktioniert), heißt die aktive Welt plötzlich "world" — und die echte aktive
Welt lässt sich per rm -rf löschen. Aufgabe: im Löschpfad den Fehler
durchreichen (409/502) statt zu defaulten; der tolerante Fallback ist nur fürs
Anzeigen gedacht (listWorlds, world/download in modules/world/routes.ts). Alle
activeLevel-Aufrufer durchgehen und pro Aufrufer entscheiden, ob tolerant oder
strikt richtig ist.
```

## 13. Admin sperrt sich beim eigenen Passwort-Reset aus

```
Bekannter Fund. PATCH /api/users/:id in apps/server/src/modules/users/routes.ts
erhöht bei einer Passwortänderung sessionVersion (Session-Widerruf), stellt
aber kein neues Cookie aus. Ändert ein Admin über die Benutzerverwaltung SEIN
EIGENES Passwort, ist seine Sitzung sofort ungültig und er wird ohne Erklärung
ausgeloggt. Die 2FA-Routen lösen genau dieses Problem bewusst mit
setSessionCookie(reply, updated) (modules/twofa/routes.ts, beide Stellen).
Aufgabe: bei id === request.user.id das Cookie neu ausstellen — oder, falls der
Logout gewollt ist, ihn im Frontend ehrlich ankündigen statt den Nutzer
kommentarlos rauszuwerfen. Nebenfrage: Es scheint gar keine „eigenes Passwort
ändern"-Route für Nicht-Admins zu geben (VIEWER/MODERATOR). Prüfen — wenn das
stimmt, ist es eine Lücke im Funktionsumfang, nicht nur ein Bug.
```

## 14. Spieler-Verlauf verliert Einträge

```
Bekannter Fund. getPlayerProfile in apps/server/src/modules/players/service.ts
vergleicht `details.player !== player.lastKnownName` groß-/kleinschreibungs-
sensitiv, während die Spieler-Identität sonst bewusst über playerKey()
(toLowerCase) normalisiert wird — ein als „steve" ausgeführter Kick fehlt
deshalb im Profil von „Steve". Zusätzlich werden nur die letzten 300
Audit-Einträge GLOBAL geladen (take: 300) und daraus höchstens 50 passende
gesammelt: bei regem Betrieb bleibt der Verlauf einzelner Spieler stumm leer,
ohne Hinweis in der UI. Aufgabe: (1) Vergleich über playerKey() normalisieren.
(2) Die Abfrage serverseitig auf den Spieler eingrenzen statt global zu
begrenzen — am saubersten mit einem eigenen, indexierten Spieler-Feld am
AuditLog, das recordAudit befüllt (Migration nötig; die Aktionen stehen in
HISTORY_ACTIONS). Beim Umbau die Altdaten im details-JSON weiter mitlesen,
sonst verschwindet der bisherige Verlauf.
```
