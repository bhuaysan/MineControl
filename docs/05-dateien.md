# 05 – Dateien

Reiter "Dateien", nur für Docker-Server. Das angezeigte Wurzelverzeichnis ist
immer `/data` im Container (Breadcrumb zeigt "/data" als Basis).

Alle Operationen sind gegen Pfad-Traversal **und** Symlink-Flucht abgesichert
— ein Pfad, der (auch über einen Symlink) außerhalb von `/data` zeigen würde,
wird abgelehnt, egal ob der Container läuft oder gestoppt ist.

## Verzeichnis durchsuchen

**Rolle:** MODERATOR+ · `GET /api/servers/:id/files?path=<rel>`

Listet eine Ebene (Ordner zuerst, dann alphabetisch), mit Typ, Größe und
Änderungsdatum. ⚠️ **Erfordert einen laufenden Container** — bei gestopptem
Server erscheint statt der Dateiliste ein Hinweis, dass der Server laufen
muss (`409 not_running`).

## Datei ansehen/bearbeiten

**Rolle:** Lesen MODERATOR+, **Speichern nur ADMIN**

- `GET /api/servers/:id/files/content?path=<rel>`
- `PUT /api/servers/:id/files/content` `{ path, content }` (ADMIN)

Ein Klick auf eine Datei öffnet einen Text-Editor als Modal (für Moderatoren
nur lesend, für Admins bearbeitbar).

⚠️ Grenzen:

- Dateien über **1 MiB** können nicht im Browser bearbeitet werden
  (`413 too_large`) — nur herunterladen.
- Wird in den ersten 8000 Bytes ein Null-Byte gefunden, gilt die Datei als
  binär und kann nicht als Text geöffnet werden (`415 binary`).
- Lesen funktioniert **auch bei gestopptem Container** (anders als das
  Durchsuchen von Verzeichnissen) — nur Speichern braucht keinen laufenden
  Container, da direkt ins Volume geschrieben wird.

## Datei herunterladen

**Rolle:** MODERATOR+ · `GET /api/servers/:id/files/download?path=<rel>`

Lädt die Rohdatei (egal ob Text oder Binär) mit ihrem Originalnamen herunter
— kleines Download-Symbol neben jeder Datei in der Liste.

## Datei hochladen

**Rolle:** ADMIN · `POST /api/servers/:id/files/upload?path=<Ordner>`
(Multipart)

Landet unter dem Dateinamen der hochgeladenen Datei im gerade geöffneten
Ordner. "Hochladen"-Button öffnet den nativen Dateiauswahl-Dialog.

## Ordner anlegen

**Rolle:** ADMIN · `POST /api/servers/:id/files/mkdir` `{ path }`

Fragt per Eingabedialog nach einem Ordnernamen und legt ihn im aktuell
geöffneten Verzeichnis an.

## Datei/Ordner löschen

**Rolle:** ADMIN · `DELETE /api/servers/:id/files?path=<rel>`

Löscht rekursiv (`rm -rf`-artig), erfordert einen laufenden Container
(`409 not_running` sonst). Zeigt vorher einen Bestätigungsdialog
("`<Name>` löschen?", rot markiert).

## Bedienelemente in der Liste

Breadcrumb-Navigation ab "/data"; 📁 für Ordner, 📄 für Dateien, andere
Einträge (Symlinks, Geräte usw.) als Punkt ohne Klickmöglichkeit; jede
Dateizeile zeigt Größe + Änderungsdatum (Datum auf kleinen Bildschirmen
ausgeblendet) sowie Download- (↓) und Löschen-Symbol (✕); eine
".."-Zeile navigiert eine Ebene nach oben.
