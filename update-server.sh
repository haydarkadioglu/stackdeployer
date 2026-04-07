#!/usr/bin/env bash
set -euo pipefail

# StackDeployer Server Update Script
# Run this on the deployment server: sudo bash update-server.sh

APP_ROOT="${APP_ROOT:-/opt/stackdeployer}"
SERVICE_NAME="stackdeployer"
REPO_URL="${REPO_URL:-https://github.com/haydarkadioglu/stackdeployer.git}"

log() {
  echo "[stackdeployer-update] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

if [[ "$EUID" -ne 0 ]]; then
  log "ERROR: This script must run as root"
  exit 1
fi

log "Starting StackDeployer update..."

# Backup current code
if [[ -d "$APP_ROOT/backend" ]]; then
  log "Backing up current backend"
  cp -a "$APP_ROOT/backend" "/tmp/backend.backup.$(date +%s)"
fi

if [[ -d "$APP_ROOT/frontend" ]]; then
  log "Backing up current frontend"
  cp -a "$APP_ROOT/frontend" "/tmp/frontend.backup.$(date +%s)"
fi

# Clone latest code to temp dir
TMP_DIR="/tmp/deployer-update-$$"
mkdir -p "$TMP_DIR"
log "Cloning from $REPO_URL to $TMP_DIR"
git clone "$REPO_URL" "$TMP_DIR"

# Update backend
if [[ -d "$TMP_DIR/backend" ]]; then
  log "Updating backend"
  rm -rf "$APP_ROOT/backend"
  mv "$TMP_DIR/backend" "$APP_ROOT/"
  
  # Install/update Python dependencies if .venv exists
  if [[ -d "$APP_ROOT/backend/.venv" ]]; then
    log "Updating Python dependencies"
    "$APP_ROOT/backend/.venv/bin/pip" install --upgrade pip
    "$APP_ROOT/backend/.venv/bin/pip" install -r "$APP_ROOT/backend/requirements.txt"
    
    # Run migrations
    log "Running database migrations"
    pushd "$APP_ROOT/backend" >/dev/null
    "$APP_ROOT/backend/.venv/bin/alembic" upgrade head
    popd >/dev/null
  fi
fi

# Update frontend
if [[ -d "$TMP_DIR/frontend" ]]; then
  log "Updating frontend"
  rm -rf "$APP_ROOT/frontend"
  mv "$TMP_DIR/frontend" "$APP_ROOT/"
  
  # Build frontend if node_modules or package.json exist
  if [[ -f "$APP_ROOT/frontend/package.json" ]]; then
    log "Building frontend"
    pushd "$APP_ROOT/frontend" >/dev/null
    npm install
    npm run build
    popd >/dev/null
  fi
fi

# Cleanup
rm -rf "$TMP_DIR"

# Restart service
log "Restarting $SERVICE_NAME service"
systemctl restart "$SERVICE_NAME"

# Verification
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "✓ Service restarted successfully"
else
  log "✗ ERROR: Service failed to restart. Check logs:"
  systemctl status "$SERVICE_NAME"
  exit 1
fi

log "Update complete!"
