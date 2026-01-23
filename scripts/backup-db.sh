#!/bin/bash
# Confidex SQLite Backup Script
# Run as cron job: 0 2 * * * /app/scripts/backup-db.sh
# Or as Render cron job

set -e

# Configuration
DB_PATH="${CRANK_DB_PATH:-/app/data/crank.db}"
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="crank_backup_${TIMESTAMP}.db"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    log_warn "Database not found at $DB_PATH - nothing to backup"
    exit 0
fi

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

log_info "Starting backup of $DB_PATH"

# Use SQLite online backup API for safe backup while db is in use
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/$BACKUP_FILE'"

if [ $? -eq 0 ]; then
    log_info "Backup created: $BACKUP_DIR/$BACKUP_FILE"

    # Get backup size
    BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
    log_info "Backup size: $BACKUP_SIZE"

    # Compress backup
    gzip "$BACKUP_DIR/$BACKUP_FILE"
    log_info "Compressed: $BACKUP_DIR/${BACKUP_FILE}.gz"

    # Upload to S3/R2 if configured
    if [ -n "$BACKUP_S3_BUCKET" ]; then
        log_info "Uploading to S3: s3://$BACKUP_S3_BUCKET/backups/"
        aws s3 cp "$BACKUP_DIR/${BACKUP_FILE}.gz" "s3://$BACKUP_S3_BUCKET/backups/${BACKUP_FILE}.gz"
        if [ $? -eq 0 ]; then
            log_info "Upload successful"
        else
            log_error "Upload failed"
        fi
    fi

    # Cleanup old backups
    log_info "Cleaning up backups older than $RETENTION_DAYS days"
    find "$BACKUP_DIR" -name "crank_backup_*.db.gz" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

    # Count remaining backups
    BACKUP_COUNT=$(find "$BACKUP_DIR" -name "crank_backup_*.db.gz" | wc -l)
    log_info "Total backups retained: $BACKUP_COUNT"

    # Send success notification to Slack if configured
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -s -X POST "$SLACK_WEBHOOK_URL" \
            -H "Content-type: application/json" \
            --data-raw "{\"text\":\"[Backup] Crank database backup completed: ${BACKUP_FILE}.gz ($BACKUP_SIZE)\"}" \
            > /dev/null 2>&1 || true
    fi

else
    log_error "Backup failed!"

    # Send failure notification to Slack
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -s -X POST "$SLACK_WEBHOOK_URL" \
            -H "Content-type: application/json" \
            --data-raw "{\"text\":\"[Backup] FAILED: Crank database backup failed!\"}" \
            > /dev/null 2>&1 || true
    fi

    exit 1
fi

log_info "Backup complete"
