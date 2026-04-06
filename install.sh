#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/stackdeployer}"
APP_PORT="${APP_PORT:-8001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_SRC_DIR="${SCRIPT_DIR}/backend"
BACKEND_DST_DIR="${APP_ROOT}/backend"
SERVICE_NAME="stackdeployer"

log() {
  echo "[stackdeployer-install] $*"
}

ensure_linux() {
  if [[ "${OSTYPE:-}" != linux* ]]; then
    echo "This installer only supports Linux (Ubuntu/Debian)." >&2
    exit 1
  fi

  if [[ ! -f /etc/os-release ]]; then
    echo "Cannot detect Linux distribution." >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
    echo "Unsupported distro: ${ID:-unknown}. Use Ubuntu/Debian." >&2
    exit 1
  fi
}

have_command() {
  command -v "$1" >/dev/null 2>&1
}

require_root_or_sudo() {
  if [[ "${EUID}" -eq 0 ]]; then
    SUDO=""
    return
  fi

  if have_command sudo; then
    SUDO="sudo"
  else
    echo "Run as root or install sudo." >&2
    exit 1
  fi
}

version_ge() {
  local current="$1"
  local minimum="$2"
  [[ "$(printf '%s\n%s\n' "$minimum" "$current" | sort -V | tail -n1)" == "$current" ]]
}

ensure_apt_dependency() {
  local package_name="$1"
  if ! dpkg -s "$package_name" >/dev/null 2>&1; then
    log "Installing package: $package_name"
    $SUDO apt-get install -y "$package_name"
  fi
}

ensure_python() {
  if ! have_command python3; then
    ensure_apt_dependency python3
  fi
  ensure_apt_dependency python3-venv
  ensure_apt_dependency python3-pip

  local py_ver
  py_ver="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
  if ! version_ge "$py_ver" "3.10.0"; then
    echo "Python 3.10+ is required. Current: $py_ver" >&2
    exit 1
  fi
  log "Python version OK: $py_ver"
}

ensure_node() {
  if have_command node; then
    local node_ver
    node_ver="$(node -v | sed 's/^v//')"
    if version_ge "$node_ver" "18.0.0"; then
      log "Node version OK: $node_ver"
      return
    fi
  fi

  log "Installing Node.js 18.x from NodeSource"
  $SUDO apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_18.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs

  local node_ver
  node_ver="$(node -v | sed 's/^v//')"
  if ! version_ge "$node_ver" "18.0.0"; then
    echo "Node.js 18+ install failed. Current: $node_ver" >&2
    exit 1
  fi
}

ensure_core_tools() {
  ensure_apt_dependency git
  ensure_apt_dependency nginx
  ensure_apt_dependency certbot
  ensure_apt_dependency python3-certbot-nginx
}

ensure_pm2() {
  if ! have_command npm; then
    echo "npm is required for PM2 installation." >&2
    exit 1
  fi

  if ! have_command pm2; then
    log "Installing PM2 globally"
    $SUDO npm install -g pm2
  fi
}

generate_secret() {
  if have_command openssl; then
    openssl rand -hex 32
  else
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  fi
}

sync_backend_files() {
  log "Syncing backend source to ${BACKEND_DST_DIR}"
  $SUDO mkdir -p "$APP_ROOT"
  $SUDO mkdir -p "$BACKEND_DST_DIR"
  $SUDO cp -a "${BACKEND_SRC_DIR}/." "$BACKEND_DST_DIR/"
}

setup_python_env() {
  log "Setting up Python virtual environment"
  if [[ ! -d "${BACKEND_DST_DIR}/.venv" ]]; then
    $SUDO python3 -m venv "${BACKEND_DST_DIR}/.venv"
  fi

  $SUDO "${BACKEND_DST_DIR}/.venv/bin/pip" install --upgrade pip
  $SUDO "${BACKEND_DST_DIR}/.venv/bin/pip" install -r "${BACKEND_DST_DIR}/requirements.txt"
}

write_env_file() {
  local env_file="${BACKEND_DST_DIR}/.env"
  if [[ -f "$env_file" ]]; then
    log "Keeping existing .env at ${env_file}"
    return
  fi

  local jwt_secret
  jwt_secret="$(generate_secret)"

  log "Creating backend .env"
  $SUDO tee "$env_file" >/dev/null <<EOF
app_env=production
database_url=sqlite:///${BACKEND_DST_DIR}/stackdeployer.db
jwt_secret=${jwt_secret}
jwt_algorithm=HS256
jwt_access_token_expire_minutes=60
EOF
}

run_migrations() {
  log "Running Alembic migrations"
  pushd "$BACKEND_DST_DIR" >/dev/null
  $SUDO "${BACKEND_DST_DIR}/.venv/bin/alembic" upgrade head
  popd >/dev/null
}

write_systemd_service() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"

  log "Writing systemd service: ${SERVICE_NAME}"
  $SUDO tee "$service_file" >/dev/null <<EOF
[Unit]
Description=StackDeployer FastAPI Control Plane
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${BACKEND_DST_DIR}
EnvironmentFile=${BACKEND_DST_DIR}/.env
ExecStart=${BACKEND_DST_DIR}/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${APP_PORT}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now "${SERVICE_NAME}"
}

post_install_summary() {
  cat <<EOF

Installation complete.

Service status:
  sudo systemctl status ${SERVICE_NAME}

Bootstrap first admin (run on server):
  curl -X POST http://127.0.0.1:${APP_PORT}/api/v1/auth/bootstrap \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"CHANGE_ME_STRONG_PASSWORD"}'

Security reminder:
  Keep the API bound to localhost and expose it only via Nginx with authentication enabled.
EOF
}

main() {
  ensure_linux
  require_root_or_sudo

  log "Updating apt package index"
  $SUDO apt-get update -y

  ensure_python
  ensure_node
  ensure_core_tools
  ensure_pm2

  sync_backend_files
  setup_python_env
  write_env_file
  run_migrations
  write_systemd_service
  post_install_summary
}

main "$@"
