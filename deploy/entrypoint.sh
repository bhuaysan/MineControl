#!/bin/sh
# Entrypoint des MineControl-Backend-Containers:
#  1. Datenverzeichnisse anlegen (persistentes Volume unter /data)
#  2. Datenbank-Migrationen anwenden (prisma migrate deploy)
#  3. Backend starten
set -e

cd /app/apps/server

# Ableiten, wohin Laufzeitdaten geschrieben werden (Defaults = docker-compose.yml).
mkdir -p "${BACKUP_DIR:-/data/backups}" \
         "${IMPORT_DIR:-/data/imports}" \
         "${IMPORT_STAGING_DIR:-/data/imports/.staging}"

# SQLite-Verzeichnis aus DATABASE_URL (file:/pfad/zur/db) sicherstellen.
case "${DATABASE_URL:-}" in
  file:*)
    db_path="${DATABASE_URL#file:}"
    mkdir -p "$(dirname "$db_path")"
    ;;
esac

echo "[entrypoint] Wende Datenbank-Migrationen an (prisma migrate deploy)…"
node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Starte MineControl-Backend…"
exec node --env-file-if-exists=.env dist/index.js
