#!/bin/sh
# Entrypoint des MineControl-Backend-Containers:
#  1. Datenverzeichnisse anlegen (persistente Volumes unter /data, /db-backups)
#  2. Deren Eigentümer ggf. auf den unprivilegierten Laufzeit-User `node`
#     übertragen (einmalig — siehe Kommentar unten)
#  3. Datenbank-Migrationen anwenden (prisma migrate deploy)
#  4. Backend starten
# Schritte 3+4 laufen NICHT mehr als root (siehe setpriv unten).
set -e

cd /app/apps/server

# Ableiten, wohin Laufzeitdaten geschrieben werden (Defaults = docker-compose.yml).
mkdir -p "${BACKUP_DIR:-/data/backups}" \
         "${IMPORT_DIR:-/data/imports}" \
         "${IMPORT_STAGING_DIR:-/data/imports/.staging}" \
         "${DB_BACKUP_DIR:-/db-backups}"

# SQLite-Verzeichnis aus DATABASE_URL (file:/pfad/zur/db) sicherstellen.
case "${DATABASE_URL:-}" in
  file:*)
    db_path="${DATABASE_URL#file:}"
    mkdir -p "$(dirname "$db_path")"
    ;;
esac

# Der Container startet als root — nicht um produktiv als root zu laufen,
# sondern damit dieses Skript einmalig frisch gemountete Volumes (Erststart)
# bzw. Bestandsvolumes aus einer älteren, root-basierten Version dieses Images
# auf den Laufzeit-User `node` (uid/gid 1000, im node:22-Basis-Image bereits
# vorhanden) übertragen kann. Rekursiver chown nur, wenn das Verzeichnis nicht
# schon node gehört — sonst würde jeder Neustart einen potenziell großen
# Verzeichnisbaum (Welt-Backups!) unnötig erneut durchlaufen.
for dir in /data "${DB_BACKUP_DIR:-/db-backups}"; do
  [ -d "$dir" ] || continue
  owner="$(stat -c %u "$dir" 2>/dev/null || echo -1)"
  if [ "$owner" != "1000" ]; then
    echo "[entrypoint] Übernehme Eigentümerschaft von $dir für User node (einmalig)…"
    chown -R node:node "$dir"
  fi
done

# `setpriv` (Teil von util-linux, bereits im Basis-Image) ersetzt den
# Prozess per exec vollständig — kein Wrapper/Subshell, der Signale
# schlucken könnte. SIGTERM vom Graceful-Shutdown (index.ts) erreicht den
# Node-Prozess dadurch genauso direkt wie zuvor mit `exec node` als root.
echo "[entrypoint] Wende Datenbank-Migrationen an (prisma migrate deploy)…"
setpriv --reuid=node --regid=node --init-groups node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Starte MineControl-Backend…"
exec setpriv --reuid=node --regid=node --init-groups node --env-file-if-exists=.env dist/index.js
