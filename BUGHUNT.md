# Bugsuche mit Opus — gezielte Prompts

Jeden Punkt in einer **frischen, eigenen Session** einsetzen (nicht alle
nacheinander in einer langen Session) — jeder Prompt ist in sich
abgeschlossen und braucht keinen Bezug zu den anderen. Das hält den Kontext
pro Session klein und spart Tokens.

Punkt 7 zuerst behandeln — betrifft den zuletzt (von Sonnet) geschriebenen,
noch ungeprüften Code.

---

## 1. Datei-Manager: Pfad-Traversal-Schutz

```
Prüfe apps/server/src/modules/files/service.ts (Funktion resolveDataPath) und
apps/server/src/modules/files/routes.ts auf Path-Traversal-Lücken. Bereits
bekannter Bug (behoben): posix.join("/data","/") ergab "/data/" mit Trailing-
Slash und umging den Löschschutz. Prüfe systematisch alle Stellen, die
Nutzer-Pfade entgegennehmen (Listing, Lesen, Schreiben, Upload, mkdir,
Löschen) mit Eingaben wie "..", "../..", "//", ".", URL-encoded Varianten,
NUL-Bytes, sehr langen Pfaden und Symlinks. Sind alle Endpunkte gleich robust
wie der Löschschutz, oder gibt es einen Endpunkt, der resolveDataPath nicht
oder anders nutzt?
```

## 2. Welt-Verwaltung: Löschschutz & Upload-Extraktion

```
Prüfe apps/server/src/modules/world/service.ts und routes.ts. Zwei
Risikobereiche: (1) Der Schutz der aktiven Welt vor dem Löschen — prüfe ob
Nether/End-Companion-Erkennung und der Active-World-Vergleich robust gegen
Groß-/Kleinschreibung, Sonderzeichen im level-name oder Race Conditions
(Welt wechseln während Löschvorgang läuft) sind. (2) Der .tar.gz-Upload-Pfad
(Entpacken, obersten Ordner umbenennen, uid/gid 1000 setzen) — kann ein
präparierter Tarball mit ".." in Dateinamen oder absoluten Pfaden aus dem
Zielverzeichnis ausbrechen (tar-slip)? Kann ein Upload während eines
laufenden Pregen-Vorgangs (Chunky) zu Inkonsistenzen führen?
```

## 3. Netzwerk-Provisionierung: Race Conditions & Secret-Handling

```
Prüfe apps/server/src/modules/networks/service.ts (641 Zeilen, größte Datei
im Projekt) zusammen mit velocity.ts, bungee.ts, moddedForwarding.ts. Fokus:
reprovisionServer() und configureBackendForwarding() — was passiert, wenn
zwei Anfragen gleichzeitig denselben Server an-/abhängen (kein Locking
sichtbar)? Wird das Forwarding-Secret bei jedem Reprovisioning neu generiert
oder wiederverwendet — und falls neu generiert, laufen alte Subserver mit
veralteten Secrets weiter, ohne dass es auffällt? Prüfe außerdem, ob der
BungeeCord-Platzhalter-Server (nötig gegen "No servers defined") beim
letzten Detach korrekt wieder eingesetzt wird, statt eine leere servers-Liste
zu erzeugen.
```

## 4. RCON-Verbindungsmanagement & WS-Ref-Counting

```
Prüfe apps/server/src/adapters/external.ts (openPersistentRcon,
connectRcon) und apps/server/src/ws/index.ts (beginMetrics, Ref-Counting
für Live-Streams). Bekannter Fix: fehlender error-Listener auf dem
rcon-client-Socket crashte früher den ganzen Prozess. Prüfe, ob JEDE Stelle,
die eine RCON-Verbindung öffnet (auch die ephemeren im 60s-Metrik-Sampler,
metrics/service.ts), einen error-Handler hat. Prüfe im WS-Hub, ob das
Ref-Counting beim Client-Disconnect (nicht nur beim expliziten Unsubscribe)
zuverlässig dekrementiert wird — sonst bleibt eine RCON-Verbindung nach
Browser-Tab-Schließen offen (Leak).
```

## 5. LuckPerms-Export: Nebenläufigkeit & Cleanup

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

## 6. Auth, 2FA, API-Tokens: Timing & Replay

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

## 7. Neues Feature — E-Mail-Benachrichtigungen (Selbstprüfung der letzten Session)

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

## 8. Docker-Adapter: Container-Lifecycle & Volume-Löschung

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
