# 13 – Metriken & Dashboard

**Rolle:** VIEWER+ — Metriken sind für jede Rolle sichtbar, auch reine
Betrachter.

| Aktion          | Route                                                        |
| --------------- | ------------------------------------------------------------ |
| Verlauf abrufen | `GET /api/servers/:id/metrics/history?range=1h\|6h\|24h\|7d` |
| Live-Werte      | WebSocket-Thema `metrics:<serverId>`                         |

## Was aufgezeichnet wird (alle 60 Sekunden)

| Metrik                        | Voraussetzung                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Spieleranzahl                 | immer                                                                                              |
| CPU %, RAM belegt/max         | nur Docker-Server, nur während der Server läuft                                                    |
| TPS (Ticks pro Sekunde, 0–20) | **nur Paper/Spigot** — bei Vanilla, Forge/Fabric-only, externen oder Proxy-Servern nicht verfügbar |

Aufzeichnungen älter als **7 Tage** werden stündlich automatisch gelöscht.

## Wo das in der Oberfläche zu sehen ist

**Dashboard** (Startseite): nur Statuskarten, **keine** CPU/RAM/TPS-Werte.

**Serverdetailseite → Übersicht:**

- Details-Box: MOTD, Version, Spieler (online/max), RCON-Latenz in ms.
- Metriken-Box (nur bei Servern mit Metriken-Fähigkeit): CPU % (Balken), RAM
  belegt/max (Balken), TPS von 20 mit Farbcodierung — grün ab 19, gelb ab
  15, sonst rot. Live per WebSocket, solange der Server läuft; sonst
  Platzhalter "Server offline"/"warte auf Daten".
- Verlaufs-Diagramm: Auswahl zwischen Spieler/CPU/RAM/TPS und Zeitraum
  1h/6h/24h/7d, Aktualisierung alle 30 Sekunden. Y-Achse: fest 0–100 bei
  CPU, fest 0–20 bei TPS, sonst automatisch auf den beobachteten
  Höchstwert skaliert. Zeigt "noch nicht genug Daten", wenn weniger als 2
  Messpunkte im gewählten Zeitraum vorliegen.

## Zusammenhang mit Auto-Restart

Dieselbe 60-Sekunden-Erfassungsschleife erkennt auch, wenn ein Server
"hängt" (Status `STARTING`, aber nicht erreichbar) und löst — falls
aktiviert — die automatische Neustart-/Absturzerkennung aus, siehe
[02 – Server](02-server.md#auto-restart-absturzerkennung).
