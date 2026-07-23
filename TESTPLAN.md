# Test-Plan: Deployment-Fixes (Caddy-Routing + WebSocket-Session-Auth)

Dieser Plan verifiziert die zwei Fixes aus dem produktiven `docker-compose`-Setup:

- **`9eb1bbf`** — Caddy proxyt `/api` und `/ws` wieder ans Backend (SPA-Routing)
- **`9cca689`** — WebSocket-Auth versteht das `sessionVersion`-Cookie

Zusätzlich ein kurzer Smoke-Test der Kernfunktionen und eine Regressionsprobe
(Session-Widerruf über `sessionVersion` trennt auch Live-Verbindungen).

> **Für das ausführende Modell:** Arbeite die Abschnitte der Reihe nach ab.
> Führe die `curl`-Befehle aus, vergleiche mit „Erwartet" und trage bei jedem
> Schritt **PASS/FAIL** samt tatsächlicher Ausgabe ein. Bei FAIL: Ausgabe,
> `docker compose logs app --tail=50` und `docker compose logs web --tail=50`
> anhängen und **nicht** stillschweigend weitermachen. Nichts am Code ändern —
> dies ist ein reiner Verifikationslauf.

---

## 0. Voraussetzungen & Umgebung

| Sache | Wert |
|---|---|
| Projekt-Root | `/home/ben/Projects/MineControl` |
| Web (TLS, öffentlich) | `https://localhost` (Port 443) |
| Backend (nur Loopback) | `http://127.0.0.1:3000` |
| Admin-Benutzer | `admin` |
| Admin-Passwort | steht in `.env` (`SEED_ADMIN_PASSWORD`) — **nicht** in diesem Dokument |

**Setup prüfen / herstellen:**

```bash
cd /home/ben/Projects/MineControl

# Läuft der Stack? Beide Container müssen "Up" sein.
docker compose ps

# Falls nicht gestartet:
docker compose up -d

# Admin-Passwort für die Tests in eine Variable laden (nicht ausdrucken).
PW=$(grep -E '^SEED_ADMIN_PASSWORD=' .env | cut -d= -f2-)
```

> Alle `curl`-Aufrufe nutzen `-k`, weil `localhost` ein Zertifikat der internen
> Caddy-CA hat (erwartete „Warnung", kein Fehler). Für WebSocket-Handshakes
> `--http1.1` erzwingen — Browser nutzen für WS ohnehin HTTP/1.1; über HTTP/2
> liefert der Handshake sonst irreführend 404.

---

## 1. Grund-Erreichbarkeit

| # | Schritt | Befehl | Erwartet |
|---|---|---|---|
| 1.1 | SPA lädt | `curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/` | `200` |
| 1.2 | HTTP→HTTPS-Redirect | `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost/` | `308 https://localhost/` |
| 1.3 | index.html ausgeliefert | `curl -sk https://localhost/ \| head -c 40` | beginnt mit `<!doctype html>` |

---

## 2. Fix 9eb1bbf — API-/WS-Routing durch Caddy

Kern des Bugs: Vorher schrieb das SPA-Fallback (`try_files`) API-Pfade auf
`/index.html` um → `/api/*` landete im file_server (405 bei POST, HTML statt
JSON). Nach dem Fix müssen API-Requests am Backend ankommen.

| # | Schritt | Befehl | Erwartet |
|---|---|---|---|
| 2.1 | `GET /api/me` liefert **JSON**, nicht HTML | `curl -sk https://localhost/api/me -w "\n%{http_code}\n"` | `{"error":"unauthorized",...}` + `401` (JSON!), **kein** `<!doctype html>` |
| 2.2 | `POST /api/login` falsches PW | `curl -sk -X POST https://localhost/api/login -H "Content-Type: application/json" -d '{"username":"admin","password":"falsch"}' -w "\n%{http_code}\n"` | JSON `unauthorized` + `401` (**nicht** 405, **nicht** HTML) |
| 2.3 | `POST /api/login` korrektes PW | `curl -sk -X POST https://localhost/api/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"$PW\"}" -w "\n%{http_code}\n"` | JSON mit `"role":"ADMIN"` + `200` |

**Negativprobe (Bug wäre zurück, wenn):** 2.1 liefert `<!doctype html>` oder
2.2 liefert `405`.

---

## 3. Fix 9cca689 — WebSocket-Session-Auth

Kern des Bugs: Die WS-Route nahm den Cookie-Wert `userId:sessionVersion`
komplett als User-ID → fand nie einen User → schloss jede Verbindung sofort mit
`Nicht angemeldet`. Nach dem Fix bleibt die WS-Verbindung mit gültigem Cookie
offen.

**Cookie besorgen (in Jar speichern):**

```bash
JAR=$(mktemp)
curl -sk -c "$JAR" -X POST https://localhost/api/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$PW\"}" >/dev/null
grep -q mc_session "$JAR" && echo "Cookie gesetzt" || echo "FEHLER: kein Cookie"
```

| # | Schritt | Befehl | Erwartet |
|---|---|---|---|
| 3.1 | Cookie gilt für HTTP | `curl -sk -b "$JAR" https://localhost/api/me -w "\n%{http_code}\n"` | JSON mit `"username":"admin"` + `200` |
| 3.2 | WS **ohne** Cookie wird abgewiesen | siehe Skript A | `101` Handshake, dann Frame `{"type":"error","message":"Nicht angemeldet"}`, Verbindung schließt |
| 3.3 | WS **mit** Cookie bleibt offen | siehe Skript B | `101` Handshake, **kein** `Nicht angemeldet`-Frame, Verbindung bleibt bestehen |

**Skript A (ohne Cookie — muss abgewiesen werden):**

```bash
curl -sk --http1.1 -i -N -o - \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Origin: https://localhost" --max-time 4 https://localhost/ws | head -14
# Erwartet: "HTTP/1.1 101" UND danach der Text 'Nicht angemeldet'
```

**Skript B (mit Cookie — muss offen bleiben):**

```bash
curl -sk --http1.1 -b "$JAR" -i -N -o - \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Origin: https://localhost" --max-time 4 https://localhost/ws | head -14
# Erwartet: "HTTP/1.1 101" und KEIN 'Nicht angemeldet' (curl läuft in --max-time 4 aus,
# weil die Verbindung offen bleibt — das ist der Erfolgsfall).
```

**Negativprobe (Bug wäre zurück, wenn):** 3.3 zeigt trotz Cookie den
`Nicht angemeldet`-Frame.

---

## 4. Regression — Session-Widerwiderruf trennt auch WS

Erhöht sich `sessionVersion` (z. B. bei Passwortänderung), müssen alte Cookies
sowohl bei HTTP als auch beim WebSocket ungültig werden (gemeinsame
`resolveSessionUser()`-Logik).

> Diese Probe verändert das Admin-Passwort und **setzt es wieder zurück**.
> Sorgfältig ausführen; das aktuelle Passwort steht in `$PW`.

| # | Schritt | Erwartet |
|---|---|---|
| 4.1 | Mit `$JAR` (alte Session) Passwort ändern (`POST /api/users/me/password` o. ä. — echten Endpoint aus `apps/server/src/modules/users/routes.ts` bzw. `auth`-Routen ermitteln) | `200` |
| 4.2 | `curl -sk -b "$JAR" https://localhost/api/me` mit **altem** Jar nach der Änderung | `401` (Session widerrufen) — falls das Backend die handelnde Sitzung per Cookie-Neuausstellung erhält, stattdessen mit einem *zweiten*, vorher gespeicherten Jar prüfen |
| 4.3 | WS mit **altem** Cookie (Skript B, alter Jar) | `Nicht angemeldet` (Verbindung abgewiesen) |
| 4.4 | Passwort auf ursprünglichen Wert zurücksetzen | `200`, Login mit `$PW` klappt wieder |

> Wenn der Endpunkt/Ablauf für 4.1 unklar ist: Schritt überspringen und als
> „nicht ausgeführt" markieren, statt zu raten. Der Kern (Fix 1–3) ist auch ohne
> Abschnitt 4 vollständig verifiziert.

---

## 5. Manueller UI-Smoke-Test (Browser)

| # | Schritt | Erwartet | Ergebnis |
|---|---|---|---|
| 5.1 | `https://localhost` öffnen, Zertifikatswarnung akzeptieren | Login-Seite erscheint | ☑ PASS — Login funktioniert; keine Zertifikatswarnung erschienen (Zertifikat vom Browser bereits akzeptiert/vertraut, kein Fehlverhalten des Fixes) |
| 5.2 | Mit `admin` + Passwort aus `.env` anmelden | Weiterleitung aufs Dashboard, **keine** JSON-Parse-/405-Fehler in der Browser-Konsole | ☑ PASS — keine JSON-Parse-/405-Fehler; einzige Konsolenmeldung: „Request for font 'Symbola' blocked at visibility level 2 (requires 3)" — kosmetische Font-Warnung, unabhängig von den geprüften Fixes |
| 5.3 | Dashboard beobachten | Meldung „Live-Verbindung getrennt" erscheint **nicht** (bzw. verschwindet nach Reconnect) | ☑ PASS — Meldung erscheint nicht |
| 5.4 | Browser-DevTools → Network → WS | `/ws` mit Status `101`, bleibt offen, Frames laufen | ☑ PASS |
| 5.5 | Hard-Reload (Strg+Shift+R) | Session bleibt erhalten, Dashboard lädt weiter | ☑ PASS |

---

## 6. Automatisierte Tests & Typecheck

```bash
cd /home/ben/Projects/MineControl
pnpm --filter @minecontrol/server exec tsc --noEmit   # Erwartet: exit 0, keine Ausgabe
pnpm --filter @minecontrol/server test                # Erwartet: alle Tests pass, 0 fail
```

---

## Ergebnis-Zusammenfassung (vom ausführenden Modell auszufüllen)

| Abschnitt | Ergebnis | Notiz |
|---|---|---|
| 1. Erreichbarkeit | ☑ PASS | 1.1 `200`, 1.2 `308 https://localhost/`, 1.3 beginnt mit `<!doctype html>` |
| 2. API-/WS-Routing | ☑ PASS | 2.1 JSON `unauthorized` + `401` (kein HTML), 2.2 JSON `unauthorized`/„Ungültige Anmeldedaten" + `401` (kein 405), 2.3 JSON mit `"role":"ADMIN"` + `200` |
| 3. WS-Session-Auth | ☑ PASS | 3.1 JSON mit `"username":"admin"` + `200`; 3.2 `101` + Frame `Nicht angemeldet`, Verbindung schließt; 3.3 `101`, kein `Nicht angemeldet`-Frame, Verbindung blieb bis `--max-time 4` offen |
| 4. Session-Widerruf (Regression) | ☑ PASS | 4.1 PATCH `/api/users/:id` (echter Endpoint, `requireRole("ADMIN")`) mit temp. Passwort → `200`; 4.2 altes Cookie → `401` „Sitzung ungültig oder widerrufen"; 4.3 WS mit altem Cookie → `Nicht angemeldet`; 4.4 Passwort per frischem Login+PATCH zurückgesetzt → `200`, Login mit `$PW` funktioniert wieder. Cookie-Jars nach Testlauf gelöscht. |
| 5. UI-Smoke-Test | ☑ PASS | Manuell vom Nutzer im Browser durchgeführt (kein Browser-Tool in dieser Umgebung verfügbar). Login, Dashboard, WS `101`, Hard-Reload alle unauffällig. Einzige Abweichung: keine Zertifikatswarnung (Browser vertraut Caddy-CA bereits) und eine kosmetische „Symbola"-Font-Warnung in der Konsole — beide ohne Bezug zu den geprüften Fixes |
| 6. Tests & Typecheck | ☑ PASS | `tsc --noEmit`: exit 0, keine Ausgabe. `pnpm test`: 13/13 Tests pass, 0 fail |

**Gesamturteil:** ☑ Alles grün (alle 6 Abschnitte PASS). Keine Regressionen, keine Codeänderung vorgenommen (reiner Verifikationslauf).
