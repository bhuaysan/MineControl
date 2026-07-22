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

---

## 1. RCON-Fehlerbehandlung: verbleibende Lücken

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

## 3. LuckPerms-Export: Nebenläufigkeit & Cleanup

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
