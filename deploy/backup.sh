#!/usr/bin/env bash
# Sauvegarde quotidienne (base + fichiers). Cron : 0 3 * * * bash /opt/deutsch-platform/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
STAMP=$(date +%F)
docker compose exec -T app node -e "require('node:sqlite');const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/app.db').exec(\"VACUUM INTO '/data/backup.db'\")" 2>/dev/null
tar czf "backups/backup-$STAMP.tar.gz" -C data backup.db uploads && rm -f data/backup.db
find backups -name 'backup-*.tar.gz' -mtime +14 -delete
echo "✔ backups/backup-$STAMP.tar.gz"
