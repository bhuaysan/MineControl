# 10 – Benutzer & Zugriff

Dieses Kapitel deckt drei Bereiche ab, die alle mit "wer darf was" zu tun
haben: Benutzerverwaltung, API-Tokens und Zwei-Faktor-Authentifizierung.

## Benutzer & Rollen

Menüpunkt "Benutzer", **komplett ADMIN-only** — es gibt keine
Selbstbedienung für andere Rollen.

| Aktion                                    | Route                   |
| ----------------------------------------- | ----------------------- |
| Alle Benutzer auflisten                   | `GET /api/users`        |
| Benutzer anlegen                          | `POST /api/users`       |
| Benutzer ändern (Rolle und/oder Passwort) | `PATCH /api/users/:id`  |
| Benutzer löschen                          | `DELETE /api/users/:id` |

**Benutzer anlegen:**

| Feld       | Constraints                  | Default               |
| ---------- | ---------------------------- | --------------------- |
| `username` | `^[A-Za-z0-9_.-]{3,32}$`     | —                     |
| `password` | 8–200 Zeichen                | —                     |
| `role`     | `VIEWER`/`MODERATOR`/`ADMIN` | UI-Vorauswahl: VIEWER |

Benutzername muss eindeutig sein (`409 conflict` sonst).

### Eigenes Passwort ändern

Es gibt **keine** separate "Mein Profil"-Seite für Passwortänderungen —
auch das eigene Passwort wird über die Benutzertabelle geändert: Auf die
eigene Zeile klicken → "Passwort" → neuer Wert in den Eingabedialog
(mind. 8 Zeichen).

⚠️ **Ein Passwort-Reset (egal ob eigenes oder fremdes Konto) meldet alle
bestehenden Sitzungen dieses Benutzers ab** — nach einer Änderung muss sich
das betroffene Konto überall neu einloggen.

### Rollen ändern

Inline-Auswahlfeld in der Benutzertabelle, wirkt sofort bei Auswahl.

⚠️ **Schutz des letzten Admins:** Eine Rollen-Herabstufung oder Löschung,
die keinen Admin mehr übrig ließe, wird abgelehnt (`409 conflict`).

⚠️ **Sich selbst löschen ist gesperrt** (`409` — der Löschen-Button ist für
die eigene Zeile deaktiviert).

## API-Tokens

Menüpunkt in den Einstellungen, **ADMIN-only**.

| Aktion           | Route                    |
| ---------------- | ------------------------ |
| Tokens auflisten | `GET /api/tokens`        |
| Token erstellen  | `POST /api/tokens`       |
| Token widerrufen | `DELETE /api/tokens/:id` |

**Erstellen:**

| Feld            | Constraints                                    | Default             |
| --------------- | ---------------------------------------------- | ------------------- |
| `name`          | 1–64 Zeichen, Freitext (z. B. "Backup-Skript") | —                   |
| `role`          | `VIEWER`/`MODERATOR`/`ADMIN`                   | —                   |
| `expiresInDays` | 1–3650, optional                               | leer = läuft nie ab |

Der rohe Token-Wert (`mc_` + 48 Hex-Zeichen) wird **nur direkt nach dem
Erstellen einmal angezeigt** — danach nur noch als Präfix + `…` sichtbar,
nie wieder abrufbar (nur widerrufen und neu erstellen).

⚠️ **Wichtig für die Rechteplanung:** Die tatsächliche Berechtigung eines
Tokens ist immer das **Minimum** aus der beim Erstellen vergebenen Rolle
**und** der aktuellen Rolle des erstellenden Benutzers. Wird der Ersteller
später herabgestuft, verliert jeder seiner Tokens sofort dieselbe
Berechtigung mit — ein Token kann seinen Besitzer nie überholen, auch wenn
in der Anzeige noch "ADMIN" steht.

⚠️ Tokens können **niemals** für 2FA-Einstellungen verwendet werden (siehe
unten) — ein gestohlener Automatisierungs-Token kann 2FA des Besitzers weder
deaktivieren noch verändern.

Verwendung: HTTP-Header `Authorization: Bearer <token>`.

## Zwei-Faktor-Authentifizierung (2FA)

Jeder Benutzer verwaltet **nur sein eigenes** 2FA — es gibt keine
Admin-Funktion, um 2FA für ein fremdes Konto ein-/auszuschalten.

| Aktion                 | Route                   | Voraussetzung                  |
| ---------------------- | ----------------------- | ------------------------------ |
| Eigenen Status abrufen | `GET /api/2fa/status`   | angemeldet                     |
| Einrichtung starten    | `POST /api/2fa/setup`   | **aktive Sitzung**, kein Token |
| Bestätigen/aktivieren  | `POST /api/2fa/enable`  | **aktive Sitzung**, kein Token |
| Deaktivieren           | `POST /api/2fa/disable` | **aktive Sitzung**, kein Token |

### Einrichtung — Schritt für Schritt

1. In den Einstellungen unter "Zwei-Faktor-Authentifizierung" auf
   **"2FA einrichten"** klicken.
2. Ein QR-Code erscheint — mit einer Authenticator-App scannen (Google
   Authenticator, Aegis, 1Password, …). Alternativ den daneben angezeigten
   Text-Schlüssel manuell eingeben.
3. Den 6-stelligen Code aus der App ins Feld "Bestätigungscode" eintragen
   und **"Aktivieren"** klicken.
4. Bei richtigem Code ist 2FA ab sofort aktiv. **Alle anderen aktiven
   Sitzungen dieses Kontos werden dabei abgemeldet** — nur der gerade
   agierende Browser bleibt eingeloggt.

### Deaktivieren

Aktuellen Code eingeben, "Deaktivieren" klicken. Ebenfalls werden dabei alle
anderen Sitzungen abgemeldet (die aktuelle bleibt bestehen).

⚠️ **Es gibt keine Wiederherstellungscodes.** Wird das Gerät mit der
Authenticator-App verloren, führt kein Weg über die normale Oberfläche
zurück ins Konto — nur ein Eingriff durch einen anderen Admin (z. B.
Passwort-Reset ändert `totpEnabled` **nicht**; ein direkter
Datenbankeingriff wäre nötig). **Es empfiehlt sich dringend, den geheimen
Schlüssel beim Einrichten zusätzlich sicher zu hinterlegen** (Passwort-
Manager), falls das Gerät verloren geht.

### Beim Login

Ist 2FA aktiv und wird beim Login kein Code mitgeschickt, erscheint
automatisch ein zweites Eingabefeld — kein Fehler, sondern eine normale
Zwischenstufe des Logins. Ein tatsächlich falscher Code zeigt eine
Fehlermeldung.

Sowohl Passwort- als auch Code-Fehlversuche sind pro Benutzername **und**
pro IP-Adresse rate-limitiert (gegen Brute-Force).
