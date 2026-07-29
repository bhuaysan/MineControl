# 11 – Benachrichtigungen

Einstellungsseite, **ADMIN-only**. MineControl kann bei bestimmten
Ereignissen automatisch einen Discord-Webhook und/oder eine E-Mail
verschicken.

| Aktion                       | Route                                   |
| ---------------------------- | --------------------------------------- |
| Einstellungen abrufen        | `GET /api/settings/notifications`       |
| Einstellungen speichern      | `PUT /api/settings/notifications`       |
| Test-Benachrichtigung senden | `POST /api/settings/notifications/test` |

## Discord einrichten

| Feld        | Beschreibung                                                   |
| ----------- | -------------------------------------------------------------- |
| Webhook-URL | muss mit `https://` beginnen; leer lassen entfernt den Webhook |

In Discord: Servereinstellungen → Integrationen → Webhooks → neuer Webhook →
URL kopieren → hier einfügen. Das Feld zeigt "(konfiguriert)", solange schon
ein Webhook hinterlegt ist, ohne die URL selbst erneut preiszugeben.

## E-Mail (SMTP) einrichten

| Feld                | Typ     | Constraints                                          | Default                     |
| ------------------- | ------- | ---------------------------------------------------- | --------------------------- |
| `emailSmtpHost`     | Text    | z. B. `smtp.example.com`                             | —                           |
| `emailSmtpPort`     | Zahl    | 1–65535                                              | **587**                     |
| `emailSmtpSecure`   | Ja/Nein | "Direkt TLS verwenden (Port 465)"                    | **Nein** (STARTTLS auf 587) |
| `emailSmtpUser`     | Text    | optional (SMTP-Login)                                | —                           |
| `emailSmtpPassword` | Text    | wird nie zurückgegeben, nur "konfiguriert" angezeigt | —                           |
| `emailFrom`         | Text    | `Name <adresse@host>` oder `adresse@host`            | —                           |
| `emailTo`           | Text    | eine oder mehrere Adressen, kommagetrennt            | —                           |

⚠️ Alle Felder zusammen leer lassen (`emailTo=""`) **entfernt die komplette
E-Mail-Konfiguration** (Host, Port, Zugangsdaten, Absender, Empfänger) auf
einmal, nicht nur die Empfängerliste.

## Wann wird gesendet? (Ereignis-Schalter)

Alle drei Standard **aktiviert**, gelten für Discord **und** E-Mail
gleichzeitig (kein getrennter Schalter pro Kanal):

| Schalter             | Löst aus bei                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notifyServerDown`   | Server wechselt unerwartet von ONLINE zu OFFLINE/ERROR; ebenso bei ausgelöstem Auto-Restart und wenn Auto-Restart nach der Maximalzahl Versuche aufgibt |
| `notifyBackupFailed` | Ein Backup (manuell, geplant, oder der interne Datenbank-Snapshot) schlägt fehl                                                                         |
| `notifyTaskFailed`   | Eine geplante Aufgabe schlägt fehl                                                                                                                      |

⚠️ Ein absichtliches Stoppen/Neustarten/Wiederherstellen unterdrückt den
"Server offline"-Alarm für ein kurzes Zeitfenster (180 Sekunden) — normale
Admin-Aktionen lösen also keine Fehlalarme aus.

## Sprache der Benachrichtigungen

`notifyLocale` — `de` (Standard) oder `en`. Betrifft **nur den Text der
ausgehenden Discord-/E-Mail-Nachrichten**, nicht die Sprache der
Oberfläche (siehe [01 – Oberfläche](01-oberflaeche.md#sprache-wechseln)) —
beides ist bewusst unabhängig voneinander.

## Testen

Zwei Buttons "Discord-Test senden" / "E-Mail-Test senden", jeweils erst
aktiv, sobald der jeweilige Kanal konfiguriert ist. Der Test versucht eine
echte Zustellung und meldet tatsächlichen Erfolg oder Misserfolg zurück,
nicht nur "eine URL ist eingetragen".

## Häufige Fehler

| Fehler                         | Bedeutung                                      |
| ------------------------------ | ---------------------------------------------- |
| `422 not_configured` beim Test | Der gewählte Kanal ist noch nicht eingerichtet |
