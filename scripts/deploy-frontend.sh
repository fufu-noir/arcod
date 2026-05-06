#!/bin/bash
# ============================================================
# ARCOD Frontend — Deploy Script
# Run from local machine: ./scripts/deploy-frontend.sh <server-ip>
# ============================================================
set -e

SERVER_IP="${1:?Usage: ./scripts/deploy-frontend.sh <server-ip>}"
SERVER_USER="root"
REMOTE_DIR="/opt/arcod-frontend"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "╔══════════════════════════════════════╗"
echo "║   Deploying ARCOD Frontend           ║"
echo "║   Target: ${SERVER_IP}               ║"
echo "╚══════════════════════════════════════╝"

# 1. Build locally
echo "[1/5] Building Next.js (standalone)..."
cd "$SCRIPT_DIR"
npm run build

# 2. Prepare standalone bundle (includes all deps)
echo "[2/5] Syncing standalone bundle to server..."
rsync -avz --delete \
    .next/standalone/ \
    ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/

# 3. Sync static assets
echo "[3/5] Syncing static assets..."
rsync -avz --delete \
    .next/static/ \
    ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/.next/static/

rsync -avz --delete \
    public/ \
    ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/public/

# 4. Setup logs dir + ecosystem config + restart PM2
echo "[4/5] Restarting PM2..."
ssh ${SERVER_USER}@${SERVER_IP} "mkdir -p /var/log/arcod-frontend"
rsync -avz \
    ecosystem.config.json \
    ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/ecosystem.config.json
ssh ${SERVER_USER}@${SERVER_IP} \
    "cd ${REMOTE_DIR} && pm2 restart ecosystem.config.json --update-env || pm2 start ecosystem.config.json"

# 5. Health check
echo "[5/5] Health check..."
sleep 3
ssh ${SERVER_USER}@${SERVER_IP} "curl -sf http://localhost:3002/ -o /dev/null && echo 'OK' || echo 'WARN: frontend not responding yet'"

echo ""
echo "✅ Frontend deployment complete!"
echo "   http://arcod.xyz should be live after nginx is configured."
