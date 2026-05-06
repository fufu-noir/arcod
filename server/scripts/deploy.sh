#!/bin/bash
# ============================================================
# ARCOD Server — Deploy Script
# Run from your local machine — deploys to Netcup
# Usage: ./deploy.sh <server-ip>
# ============================================================
set -e

SERVER_IP="${1:?Usage: ./deploy.sh <server-ip>}"
SERVER_USER="root"
REMOTE_DIR="/opt/arcod-server"

echo "╔══════════════════════════════════════╗"
echo "║   Deploying ARCOD Server             ║"
echo "║   Target: ${SERVER_IP}               ║"
echo "╚══════════════════════════════════════╝"

# 1. Build locally
echo "[1/5] Building TypeScript..."
cd "$(dirname "$0")/.."
npm run build

# 2. Sync files to server
echo "[2/5] Syncing files to server..."
rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude 'data/' \
    --exclude 'scripts/' \
    --exclude 'src/' \
    dist/ \
    package.json \
    package-lock.json \
    ecosystem.config.json \
    ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/

# 3. Install production dependencies on server
echo "[3/5] Installing dependencies on server..."
ssh ${SERVER_USER}@${SERVER_IP} "cd ${REMOTE_DIR} && npm ci --omit=dev"

# 4. Restart PM2
echo "[4/5] Restarting PM2..."
ssh ${SERVER_USER}@${SERVER_IP} "cd ${REMOTE_DIR} && pm2 restart ecosystem.config.json || pm2 start ecosystem.config.json"

# 5. Check health
echo "[5/5] Health check..."
sleep 3
ssh ${SERVER_USER}@${SERVER_IP} "curl -s http://localhost:3000/health"

echo ""
echo "✅ Deployment complete!"
