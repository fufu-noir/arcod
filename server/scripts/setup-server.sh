#!/bin/bash
# ============================================================
# ARCOD Server — Netcup Setup Script
# Run as root on a fresh Debian 12 server
# ============================================================
set -e

echo "╔══════════════════════════════════════╗"
echo "║   ARCOD Server Setup — Netcup        ║"
echo "╚══════════════════════════════════════╝"

# 1. System update
echo "[1/8] Updating system..."
apt-get update -y && apt-get upgrade -y

# 2. Install Node.js 22 LTS
echo "[2/8] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 3. Install ffmpeg
echo "[3/8] Installing ffmpeg..."
apt-get install -y ffmpeg

# 4. Install Nginx
echo "[4/8] Installing Nginx..."
apt-get install -y nginx

# 5. Install Certbot
echo "[5/8] Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# 6. Install PM2
echo "[6/8] Installing PM2..."
npm install -g pm2

# 7. Setup application directory
echo "[7/8] Setting up application..."
mkdir -p /opt/arcod-server/data
mkdir -p /var/log/arcod

# 8. Configure firewall
echo "[8/8] Configuring firewall..."
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
echo "y" | ufw enable

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Setup complete!                    ║"
echo "║                                      ║"
echo "║   Next steps:                        ║"
echo "║   1. Copy server files to            ║"
echo "║      /opt/arcod-server/              ║"
echo "║   2. Copy .env to                    ║"
echo "║      /opt/arcod-server/.env           ║"
echo "║   3. npm install --production        ║"
echo "║   4. npm run build                   ║"
echo "║   5. Copy nginx config               ║"
echo "║   6. Get SSL cert with certbot       ║"
echo "║   7. pm2 start ecosystem.config.json ║"
echo "║   8. pm2 save && pm2 startup         ║"
echo "╚══════════════════════════════════════╝"
