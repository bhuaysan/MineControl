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
>
> **Update 4 (Backend-Audit am 2026-07-28):** Punkte 7–14 sind noch offen und
> unverändert gültig. Neu hinzu kommen die Punkte **15–23** (Punkt 23 bündelt
> zehn Kleinfunde, die einzeln keine eigene Session lohnen), ebenfalls nach
> Schwere sortiert und ebenfalls nur diagnostiziert, nicht behoben. Punkt 15 ist
> der schwerste Fund des Audits (Prozess-Absturz durch fehlende
> Stream-`error`-Listener) und wurde gegen den Quellcode von `docker-modem`
> gegengeprüft, nicht nur vermutet. Die bestehende Test-Suite (20 Tests) läuft
> dabei grün durch — keiner der Funde ist von ihr abgedeckt.
>
> **Update 5 (2026-07-28):** **Punkt 15 ist behoben** (Details im Punkt selbst),
> und dabei fiel bei **Punkt 16** die Hälfte mit weg — der fehlende
> `'error'`-Listener in `exec()`; das Timeout bleibt offen. Die Suite umfasst
> jetzt 29 Tests. Offen sind damit: **2, 7–14, 16 (Rest), 17–23.**

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

## 15. Fehlende `error`-Listener auf Docker-Streams reißen den ganzen Prozess mit — ✅ ERLEDIGT (2026-07-28)

> **Behoben.** Neuer gemeinsamer Helfer `apps/server/src/adapters/tarStream.ts`
> (`readTarSingleFile` / `readTarSingleFileOrNull`) ersetzt die drei fast
> identischen, handgeschriebenen Extraktoren in `modules/servers/docker.ts`,
> `modules/files/service.ts` und `modules/luckperms/service.ts` und nutzt
> `stream.pipeline()`. `listInstalledMods` (mods), der Welt-Download
> (`world/routes.ts`) und `restoreBackup` (backups) laufen ebenfalls über
> `pipeline()`. Im `DockerAdapter` kapselt neu `guardLiveStream()` die
> Fehlerbehandlung für Log-/Stats-Streams; `exec()` horcht jetzt vor allem
> anderen auf `'end'`/`'error'` (das behebt dort auch das „Promise wird nie
> erfüllt"-Hängen, siehe Punkt 16).
>
> Beim Umsetzen kamen **zwei weitere Stellen derselben Klasse** dazu, die in der
> Liste oben fehlten: `docker.run()` in `modules/files/service.ts`
> (`resolveViaOneShot`) — dockerode pipet dort seinen Attach-Stream ungeschützt,
> deshalb jetzt die Callback-Form mit `hub.on("stream", …)` — und der in
> `worldExists` (`modules/world/service.ts`) geöffnete, aber nie konsumierte
> `getArchive`-Stream, der nun sauber abgeräumt wird.
>
> Zusätzlich behoben, weil der reine Fehler-Handler sonst eine dauerhaft stumme
> Konsole hinterlassen hätte: Live-Streams melden über `onClose` zurück, dass sie
> von selbst weggefallen sind, und `ManagedStream` (ws/index.ts) gilt dann wieder
> als „nicht angehängt" — `reattachServerStreams()` baut sie beim nächsten
> Start/Restart neu auf. Das behebt nebenbei, dass die Konsole schon vorher nach
> einem simplen Stop/Start stumm blieb (der Log-Stream endet beim Container-Stop,
> der Stream galt aber weiter als aktiv).
>
> Regressionstests: `adapters/tarStream.test.ts` (5) und vier neue Fälle in
> `ws/index.test.ts` für die Zustandslogik von `ManagedStream`. Suite jetzt 29
> Tests, grün; `tsc`, `eslint` und `prettier` ebenfalls.

<details>
<summary>Ursprünglicher Befund</summary>

```
Bekannter Fund (schwerster des Audits, diagnostiziert und gegen den
docker-modem-Quellcode gegengeprüft, nicht behoben). Kein einziger der von
dockerode gelieferten Streams hat einen `error`-Listener. `docker-modem`
hängt selbst KEINEN an: `Modem.prototype.demuxStream` registriert
ausschließlich `'data'` (node_modules/.pnpm/docker-modem@5.0.7/.../modem.js
~Zeile 440); nur `followProgress` registriert `'error'` — deshalb ist
`ensureImage` in modules/servers/docker.ts sicher und `createBackup` (nutzt
`pipeline()`) ebenfalls. Alle übrigen Stellen sind es nicht, und weil
index.ts `uncaughtException` bewusst in einen vollständigen Shutdown
übersetzt, beendet JEDES dieser Events das Backend (alle Sessions,
Konsolen-Streams und laufenden Provisionierungen fallen mit).

Betroffene Stellen:
 - apps/server/src/adapters/docker.ts `followLogs` — Stream aus
   `container.logs({follow:true})`, nur demuxStream + eigene 'data'-Handler.
 - apps/server/src/adapters/docker.ts `followStats` — Stream aus
   `container.stats({stream:true})`, nur ein 'data'-Handler.
 - apps/server/src/adapters/docker.ts `exec` — der gehijackte Duplex hat
   weder 'error'-Listener NOCH ein Timeout (siehe Punkt 16).
 - Alle `getArchive`-Quellstreams, die in einen tar-extract gepiped werden:
   `.pipe()` leitet Fehler NICHT weiter, der vorhandene
   `extract.on("error", …)` deckt die Quelle also nicht ab —
   modules/servers/docker.ts `extractSingleFile`, modules/files/service.ts
   `extractSingleFileBuffer`, modules/mods/service.ts `listInstalledMods`,
   modules/luckperms/service.ts `readContainerFile`.
 - modules/world/routes.ts `world/download` — `archive.pipe(createGzip())`;
   Fastify hängt seinen Handler nur an das gzip-Ende der Kette, nicht an
   `archive`.
 - modules/backups/service.ts `restoreBackup` —
   `createReadStream(backup.path).pipe(createGunzip())`: fehlt die
   Backup-Datei auf der Platte (manuell gelöscht, Mount weg), ist der
   ENOENT-Fehler unhandled.

Reproduzierbare Auslöser: `systemctl restart docker`, während irgendwo eine
Konsole/ein Metrik-Stream offen ist (ECONNRESET auf dem Log-Socket); oder ein
Restore auf ein Backup, dessen Datei nicht mehr existiert.

Aufgabe: An JEDER dieser Stellen einen `error`-Handler vor dem ersten
Datenfluss anhängen (Muster: `rcon.on("error", …)` VOR `connect()` in
adapters/external.ts, das genau dieselbe Bug-Klasse für RCON schon behoben
hat). Für die pipe-Ketten am saubersten auf `stream.pipeline()` umstellen,
das Fehler über alle Glieder propagiert — so wie es backups/service.ts beim
Erstellen schon macht. Danach prüfen, ob ein Regressionstest möglich ist
(ein PassThrough, der `emit("error")` auslöst, statt eines echten Daemons).
```

</details>

## 16. `DockerAdapter.exec()` ohne Timeout — hängender Request statt Fehler (Teil erledigt)

```
TEILWEISE ERLEDIGT (2026-07-28, mit Punkt 15): exec() hat jetzt einen
'error'-Listener, der VOR demuxStream/jedem Schreiben hängt — der Fall
„Stream-Fehler → Promise wird nie erfüllt → Aufrufer hängt für immer" ist
damit weg (die Operation scheitert stattdessen sauber). OFFEN bleibt der
eigentliche Punkt: das TIMEOUT sowie die Reaktion auf 'close' ohne 'end'.

Bekannter Fund. apps/server/src/adapters/docker.ts kapselt `inspect` (6 s) und
alle Lifecycle-Operationen (75 s) bewusst in `withTimeout`, mit ausführlicher
Begründung im Kommentar — `exec()` aber NICHT. Zusätzlich wartet exec mit
`await new Promise<void>((resolve) => stream.on("end", resolve))` auf genau ein
Event: endet der Stream nicht mit 'end' (Fehler, hartes Schließen), wird die
Promise nie erfüllt und der Aufrufer hängt unbegrenzt. Über exec laufen
praktisch alle Dateioperationen — listDirectory/deletePath/canonicalize
(modules/files/service.ts), setModEnabled/deleteMod/readPluginYml
(modules/mods/service.ts), das Löschen der Export-Datei
(modules/luckperms/service.ts), `rm -rf` beim Welt-Löschen
(modules/world/service.ts). Ein Hänger blockiert damit den jeweiligen
HTTP-Request dauerhaft. Aufgabe: exec in `withTimeout` fassen (eigenes,
großzügigeres Limit — `du -sb` über eine große Welt darf nicht abgeschnitten
werden) und zusätzlich auf 'close' reagieren, nicht nur auf 'end' ('error' ist
inzwischen abgedeckt, s. o.). Vorsicht bei 'close': es darf den Erfolgspfad
nicht verkürzen, solange der Readable-Teil noch ungelesene Ausgabe hat — sonst
liefert exec() stillschweigend abgeschnittene Dateiinhalte.
```

## 17. Welt-Upload ist faktisch auf 50 MB begrenzt und meldet 502 statt 413

```
Bekannter Fund. index.ts registriert @fastify/multipart global mit
`limits: { fileSize: 50 * 1024 * 1024 }`. Zwei Routen heben das per Request
bewusst an — modules/mods/routes.ts (`config.modsMaxBytes`, 200 MB) und
modules/servers/routes.ts `import/stage` (`config.importMaxBytes`, 10 GiB, mit
Kommentar „per-Request angehoben"). modules/world/routes.ts `worlds/upload`
und modules/files/routes.ts `files/upload` rufen dagegen `request.file()` OHNE
`limits` auf und erben damit die 50 MB. Für einen Welt-Upload ist das die
falsche Größenordnung (die Welt-Obergrenze im Service ist
`MAX_UNCOMPRESSED = 2 GiB`). Verifiziert: @fastify/multipart@10.1.0 hat
`throwFileSizeLimit` per Default true und lässt `toBuffer()` mit
FST_REQ_FILE_TOO_LARGE (statusCode 413) ablehnen — world/routes.ts `fail()`
kennt diesen Fall nicht und mappt ihn auf **502 „world_failed"**,
files/routes.ts `fail()` auf 400 „file_error". Der Nutzer sieht also einen
Serverfehler statt „Datei zu groß". Aufgabe: (1) beide Routen mit einem
passenden, aus der Config abgeleiteten `limits`-Wert versehen; (2) den
413-Fall wie in mods/routes.ts und import/stage explizit behandeln
(`statusCode === 413 || file.file.truncated` → 413). Achtung beim Anheben:
`toBuffer()` puffert die komplette Datei im RAM, und `repackWorld` legt beim
Umpacken eine zweite Kopie an — deshalb nicht blind auf 2 GiB stellen,
sondern entweder streamen (Muster: import/stage schreibt auf Platte) oder
ein bewusst gewähltes, dokumentiertes Limit setzen.
```

## 18. Zeilenumbruch im Proxy-Namen erzeugt eine unparsebare Proxy-Config

```
Bekannter Fund (gleiche Wurzel wie Punkt 11: Namensfelder erlauben
Steuerzeichen). `createNetworkSchema` in modules/networks/routes.ts validiert
`name`/`proxyName` nur als `z.string().min(1).max(64)`. Der Proxy-Name wird als
MOTD in die generierte Config geschrieben: `renderVelocityToml` (velocity.ts)
setzt `motd = "${tomlString(opts.motd)}"`, `renderBungeeConfig` (bungee.ts)
setzt `motd: '${yamlString(opts.motd)}'`. Beide Escape-Funktionen behandeln
laut eigenem Kommentar NUR Quotes (`"`/`\` bzw. `'`) — Zeilenumbrüche nicht.
Ein `\n` im Proxy-Namen beendet damit den TOML-Basic-String bzw. den
YAML-Scalar: velocity.toml ist unparsebar (Velocity bootet nicht mehr), in
config.yml lassen sich weitere Schlüssel einschleusen. Betroffen ist jeder
Aufruf von `rewriteProxyConfig`, also auch jedes spätere Attach/Detach —
das Netzwerk ist danach dauerhaft kaputt, nicht nur einmal. Aufgabe:
Steuerzeichen in `name`/`proxyName` (und konsistent in `server.name`, siehe
Punkt 11) per Zod ausschließen, UND zusätzlich in `tomlString`/`yamlString`
defensiv escapen/entfernen — die Renderer sollen nicht auf saubere Eingaben
vertrauen müssen. Unit-Tests dazu schreiben (Muster:
networks/service.test.ts).
```

## 19. `motd` landet ungeprüft im Container-Env (server.properties-Injection)

```
Bekannter Fund. `createDockerSchema` (modules/servers/routes.ts) erlaubt
`motd: z.string().max(120)` ohne jede Zeichenprüfung, und `createContainer`
(modules/servers/docker.ts) schreibt daraus `MOTD=${p.motd ?? server.name}`
ins Container-Env. itzg schreibt diesen Wert bei OVERRIDE_SERVER_PROPERTIES
(Default) bei JEDEM Start in server.properties. Direkt daneben verbietet
`propertiesSchema` in derselben Datei Zeilenumbrüche in Property-Werten
ausdrücklich, mit der Begründung „server.properties ist ein naives
key=value-je-Zeile-Format" — genau diese Begründung gilt hier auch, nur ist
sie nicht umgesetzt. Der Fallback `server.name` ist ebenfalls ungeprüft
(`z.string().min(1).max(64)`). Aufgabe: erst empirisch klären, ob itzg/
mc-image-helper den Env-Wert beim Schreiben escaped (dann ist es nur
Kosmetik) oder 1:1 durchschreibt (dann ist es eine echte Injection in
server.properties). Danach `motd` und `name` auf denselben Zeichenvorrat
einschränken wie `propertiesSchema`. Zusammen mit Punkt 18 und Punkt 11 am
besten in EINER Session als „Namens-/Freitextfelder konsistent validieren"
angehen.
```

## 20. Benutzer löschen löscht rückwirkend seine Audit-Zuordnung

```
Bekannter Fund. prisma/schema.prisma deklariert `AuditLog.user` als optionale
Relation ohne `onDelete` — Prisma erzeugt daraus SET NULL, verifiziert in
prisma/migrations/20260718170535_init/migration.sql:54:
`AuditLog_userId_fkey … ON DELETE SET NULL`. `DELETE /api/users/:id`
(modules/users/routes.ts) löscht die Zeile also, und ALLE Audit-Einträge
dieses Benutzers verlieren ihren Urheber; modules/audit/routes.ts zeigt sie
danach als `"System"` an (`e.user?.username ?? "System"`). Ein Admin kann
damit durch Anlegen → Handeln → Löschen eines Zweitkontos die Spur
verwischen, und ganz ohne Absicht verliert das Log bei jedem normalen
Personalwechsel die Nachvollziehbarkeit. Genau dafür existiert das Log aber.
Aufgabe: Urheber unabhängig von der Relation festhalten — sauberste Variante
ist ein zusätzliches, denormalisiertes `actorName`-Feld, das `recordAudit`
beim Schreiben mitfüllt (Migration nötig; Altdaten weiter über die Relation
anzeigen, sonst verschwindet der bisherige Verlauf). Alternativ die Relation
auf `Restrict` stellen und Benutzer nur deaktivieren statt löschen — das ist
aber der größere Eingriff, weil es ein neues „deaktiviert"-Konzept braucht.
```

## 21. `filenameFromResponse` kann mit URIError statt 400 abbrechen

```
Bekannter Fund. modules/mods/service.ts (~Zeile 457) macht
`decodeURIComponent(match[1]!)` auf dem aus `Content-Disposition` gezogenen
Dateinamen. Bei kaputtem Prozent-Encoding (z. B.
`Content-Disposition: attachment; filename="%zz.jar"`) wirft
`decodeURIComponent` einen `URIError`. Der ist keine `ModInputError`, also
mappt `fail()` in modules/mods/routes.ts ihn auf 502 „mod_error" — bzw. der
globale Error-Handler auf 500 —, obwohl es ein sauber diagnostizierbarer
Eingabefehler des Ziel-Servers ist. Der Rest der Funktion ist bewusst
defensiv (`JAR_NAME_RE`-Prüfung danach), nur dieser eine Aufruf nicht.
Aufgabe: den `decodeURIComponent` in try/catch fassen und im Fehlerfall auf
`posix.basename(url.pathname)` zurückfallen (das ist ohnehin schon der
Pfad-Fallback). Kleiner Fund, kleiner Fix — gut als Beifang zu Punkt 8, das
dieselbe Datei betrifft.
```

## 22. `/api/servers/test` ist ein ungeprüfter Outbound-Connect für Moderatoren

```
Bekannter Fund (bewusst als „by design?" zu klären, nicht blind zu fixen).
`POST /api/servers/test` (modules/servers/routes.ts) ist nur mit MODERATOR
geschützt und baut mit `new ExternalAdapter({host, port, …})` eine
TCP-Verbindung zu einem frei wählbaren `host:port` auf; `testConnection`
meldet Erfolg/Fehler und die Latenz getrennt für Ping und RCON zurück. Damit
ist die Route ein brauchbarer Portscanner fürs interne Netz — mit genau der
Trefferauskunft, die modules/mods/service.ts über `isBlockedIp`/
`assertPublicHost` für `mods/from-url` bewusst verhindert (siehe Punkt 8).
Dieselbe Lücke gilt für `POST /api/servers/external` (Admin) und in der Folge
für jeden 60-s-Sampler-Ping auf diesen Host. Aufgabe: entscheiden, ob das im
Bedrohungsmodell überhaupt zählt — bei externen Servern ist „beliebiger Host"
ja der Zweck der Funktion, und der Zugriff ist authentifiziert. Falls ja,
liegt der minimale Fix darin, `assertPublicHost` aus mods/service.ts in einen
gemeinsamen Helper zu ziehen und wenigstens auf `/api/servers/test`
anzuwenden (nicht auf bereits angelegte Server, sonst brechen legitime
LAN-Server im Heimnetz). Ergebnis der Entscheidung in PLANNING.md §11
festhalten, so wie es dort mit der Netzwerk-Lücke schon gemacht wurde.
```

## 23. Kleinere Korrektheitsfunde (sammelbar in einer Session)

```
Bekannte Funde, alle einzeln klein, alle diagnostiziert und nicht behoben:

(1) modules/mods/service.ts `updatePlugin`: schreibt die neue Jar immer als
    aktive `.jar` und löscht danach die alte Variante über `deleteMod` (die
    `.jar` UND `.jar.disabled` entfernt). Ein bewusst DEAKTIVIERTES Plugin ist
    nach dem Update also stillschweigend wieder aktiv. Vorher den
    Aktiv-Status ermitteln (`listInstalledMods`) und danach wiederherstellen.

(2) modules/tasks/service.ts `updateTask`: `payload: input.payload ?
    JSON.stringify(input.payload) : undefined` — `undefined` heißt bei Prisma
    „nicht ändern", ein Payload lässt sich also nie wieder leeren. Für
    „löschen" muss explizit `null` geschrieben werden.

(3) modules/networks/service.ts `parseDockerCfg`: Default
    `onlineMode: (c.onlineMode as boolean) ?? true` widerspricht dem
    Wizard-Default `onlineMode: false` (`createDockerSchema`). Bei fehlendem
    oder kaputtem `dockerConfig`-JSON schaltet ein Detach den Subserver
    dadurch auf online-mode TRUE — also strenger als der Nutzer ihn angelegt
    hat. Default auf `false` ziehen oder aus `server.edition` ableiten.

(4) modules/metrics/service.ts `maybeAutoRestart`: der `catch` um
    `adapter.restart()` loggt nur; danach laufen `recordAudit` und
    `notifyAutoRestart` unbedingt weiter und behaupten einen erfolgreichen
    Neustart, der nie stattgefunden hat. Bei Fehlschlag anders melden.

(5) Speicher, der nie geräumt wird: `prevStates`, `suppressedUntil` und
    `autoRestartTracks` (modules/metrics/service.ts) behalten Einträge
    gelöschter Server für immer; `detachServerStreams` (ws/index.ts) ruft
    `detach()`, entfernt den ManagedStream aber NICHT aus
    `consoleStreams`/`metricsStreams` — bleibt ein Client auf die Konsole
    eines gelöschten Servers abonniert, überlebt der Eintrag mit refs > 0
    dauerhaft. Beim Server-Löschen (modules/servers/routes.ts) aufräumen.

(6) modules/servers/import.ts: der Doc-Kommentar verspricht „Streaming
    (gunzip → tar → putArchive), kein GB-Buffer im RAM", aber `stream.on
    ("data")` sammelt jeden Tar-Eintrag vollständig in `bufs` und übergibt
    ihn erst am Stück an `pack.entry`. Eine einzelne große Datei im Archiv
    geht damit 1:1 in den Heap — begrenzt erst durch `config.importMaxBytes`
    (Default 10 GiB). Entweder `pack.entry(header)` als Schreib-Stream nutzen
    (tar-stream kann das) oder den Kommentar korrigieren.

(7) modules/world/service.ts `repackWorld`: ersetzt das erste Pfadsegment
    durch den Zielnamen (`header.name.indexOf("/")`). Bei einem FLACHEN
    Archiv (`tar czf w.tgz *` im Welt-Ordner: Einträge `level.dat`,
    `region/…`) hat `level.dat` keinen Slash → `rest = ""` → der Eintrag
    landet als DATEI namens `<name>`, und `region/r.0.0.mca` verliert sein
    `region/`. Der `sawLevel`-Check greift nicht (`/\/level\.dat$/` matcht
    nicht) und der Upload endet in „Archiv enthält keine level.dat" — obwohl
    genau eine drin ist. Fehlermeldung oder Behandlung des Wrapper-losen
    Falls korrigieren (Muster: `scanArchive` in servers/import.ts erkennt
    einen fehlenden Wrapper-Ordner bereits korrekt).

(8) modules/mods/routes.ts `installSchema`: `projectId: z.string().min(1)
    .max(64)` ohne Zeichenvorrat, interpoliert in modules/mods/service.ts
    ungeprüft in den URL-Pfad (`/project/${projectId}/version`). Auf einen
    Modrinth-Slug/ID-Zeichenvorrat einschränken.

(9) modules/auth/routes.ts `/api/logout`: löscht nur das Cookie, widerruft die
    Sitzung serverseitig nicht (`sessionVersion` bleibt). Ein vor dem Logout
    kopiertes Cookie bleibt die vollen 7 Tage gültig. Der Mechanismus zum
    Widerrufen existiert schon und wird von 2FA/Passwortänderung genutzt —
    entscheiden, ob Logout ihn auch nutzen soll (Nachteil: meldet ALLE
    Geräte ab) oder ob das dokumentiert akzeptiert wird.

(10) modules/tokens/routes.ts: `/api/tokens` hängt nur `authenticate` +
     `requireRole("ADMIN")` ein, NICHT `requireSession`. Ein gestohlenes
     Admin-Token kann sich damit selbst weitere Tokens ausstellen und so
     überleben, dass das ursprüngliche widerrufen wird. `requireSession`
     existiert genau für diesen Fall (siehe modules/twofa/routes.ts) und
     sollte mindestens auf POST/DELETE gelten.
```
