#!/bin/bash
# Backup SQLite DB to R2 (or local backup dir)
# Run via cron every 6 hours:
#   0 */6 * * * /opt/arcod-server/scripts/backup-db.sh >> /var/log/arcod-backup.log 2>&1

set -euo pipefail

DB_PATH="/opt/arcod-server/data/arcod.db"
BACKUP_DIR="/opt/arcod-server/backups"
MAX_BACKUPS=20  # Keep last 20 backups (= ~5 days at 6h intervals)

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="arcod_${TIMESTAMP}.db"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Use SQLite's .backup command for a safe, consistent copy
# (plain cp can corrupt if DB is being written to)
sqlite3 "$DB_PATH" ".backup '${BACKUP_DIR}/${BACKUP_FILE}'"

# Compress the backup
gzip "${BACKUP_DIR}/${BACKUP_FILE}"

echo "[$(date)] Backup created: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_DIR}/${BACKUP_FILE}.gz" | cut -f1))"

# Rotate old backups — keep only the last $MAX_BACKUPS
cd "$BACKUP_DIR"
ls -1t arcod_*.db.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f

REMAINING=$(ls -1 arcod_*.db.gz 2>/dev/null | wc -l)
echo "[$(date)] Backup rotation complete. $REMAINING backups retained."
