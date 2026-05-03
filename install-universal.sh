#!/usr/bin/env bash
set -euo pipefail

# StackDeployer Universal Installer
# Works on Linux, macOS, and Windows (WSL2)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="StackDeployer"
APP_VERSION="1.0.0"
INSTALL_DIR="${INSTALL_DIR:-/opt/stackdeployer}"
SERVICE_NAME="stackdeployer"
APP_PORT="${APP_PORT:-8001}"
USE_DOCKER="${USE_DOCKER:-auto}"

# Logging functions
log() {
    echo -e "${BLUE}[${APP_NAME}]${NC} $*"
}

success() {
    echo -e "${GREEN}[${APP_NAME}]${NC} ✓ $*"
}

warning() {
    echo -e "${YELLOW}[${APP_NAME}]${NC} ⚠ $*"
}

error() {
    echo -e "${RED}[${APP_NAME}]${NC} ✗ $*"
}

# System detection
detect_platform() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Docker availability
check_docker() {
    if command_exists docker && command_exists docker-compose; then
        if docker info >/dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Check native dependencies
check_native_deps() {
    local platform=$(detect_platform)
    
    case $platform in
        "linux")
            check_linux_deps
            ;;
        "macos")
            check_macos_deps
            ;;
        "windows")
            check_windows_deps
            ;;
        *)
            error "Unsupported platform: $platform"
            return 1
            ;;
    esac
}

install_nodejs_linux() {
    log "Installing Node.js..."
    
    # Check if we have sudo access
    local has_sudo=false
    if command_exists sudo && sudo -n true 2>/dev/null; then
        has_sudo=true
    fi
    
    if command_exists apt; then
        # Ubuntu/Debian - Use NodeSource for latest Node.js
        log "Setting up NodeSource repository..."
        
        if [[ "$has_sudo" == true ]]; then
            sudo apt-get update
            sudo apt-get install -y curl ca-certificates gnupg
            
            # Add NodeSource GPG key
            sudo mkdir -p /etc/apt/keyrings
            curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
            
            # Add NodeSource repository
            NODE_MAJOR=20
            echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
            
            # Install Node.js
            sudo apt-get update
            sudo apt-get install -y nodejs
        else
            error "Root privileges required to install Node.js"
            error "Please run: sudo apt-get update && sudo apt-get install -y nodejs npm"
            return 1
        fi
        
    elif command_exists yum; then
        # RHEL/CentOS
        if [[ "$has_sudo" == true ]]; then
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo yum install -y nodejs
        else
            error "Root privileges required to install Node.js"
            return 1
        fi
    elif command_exists dnf; then
        # Fedora/RHEL 8+
        if [[ "$has_sudo" == true ]]; then
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo dnf install -y nodejs
        else
            error "Root privileges required to install Node.js"
            return 1
        fi
    elif command_exists pacman; then
        # Arch Linux
        if [[ "$has_sudo" == true ]]; then
            sudo pacman -Sy --noconfirm nodejs npm
        else
            error "Root privileges required to install Node.js"
            return 1
        fi
    else
        error "Cannot install Node.js automatically"
        return 1
    fi
}

check_linux_deps() {
    local missing=()
    local need_node=false
    
    # Check if we have sudo access
    local has_sudo=false
    if command_exists sudo && sudo -n true 2>/dev/null; then
        has_sudo=true
    fi
    
    command_exists python3 || missing+=("python3")
    command_exists git || missing+=("git")
    
    # Check for node/npm separately (needs special handling)
    if ! command_exists node || ! command_exists npm; then
        need_node=true
    fi
    
    # Install basic dependencies first
    if [[ ${#missing[@]} -gt 0 ]]; then
        log "Installing missing dependencies: ${missing[*]}"
        
        if [[ "$has_sudo" == false ]]; then
            error "Root privileges required to install dependencies"
            error "Please run with sudo, or install manually:"
            error "  sudo apt-get update && sudo apt-get install -y ${missing[*]}"
            return 1
        fi
        
        if command_exists apt; then
            sudo apt-get update
            sudo apt-get install -y "${missing[@]}"
        elif command_exists yum; then
            sudo yum install -y "${missing[@]}"
        elif command_exists dnf; then
            sudo dnf install -y "${missing[@]}"
        elif command_exists pacman; then
            sudo pacman -Sy --noconfirm "${missing[@]}"
        else
            error "Cannot install dependencies automatically."
            error "Please install manually: ${missing[*]}"
            return 1
        fi
    fi
    
    # Install Node.js separately (special handling)
    if [[ "$need_node" == true ]]; then
        install_nodejs_linux || return 1
    fi
    
    # Final verification
    local still_missing=()
    command_exists python3 || still_missing+=("python3")
    command_exists node || still_missing+=("nodejs")
    command_exists npm || still_missing+=("npm")
    command_exists git || still_missing+=("git")
    
    if [[ ${#still_missing[@]} -gt 0 ]]; then
        error "Failed to install: ${still_missing[*]}"
        return 1
    fi
    
    success "All dependencies installed successfully"
    return 0
}

check_macos_deps() {
    if ! command_exists brew; then
        warning "Homebrew not found. Installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    
    local missing=()
    command_exists python3 || missing+=("python3")
    command_exists node || missing+=("node")
    command_exists npm || missing+=("npm")
    command_exists git || missing+=("git")
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log "Installing missing dependencies: ${missing[*]}"
        brew install "${missing[@]}"
    fi
}

check_windows_deps() {
    if ! command_exists wsl; then
        error "WSL2 not found. Please install WSL2 first."
        log "See: https://docs.microsoft.com/en-us/windows/wsl/install"
        return 1
    fi
    
    warning "Windows detected. Using WSL2 mode."
    return 0
}

# Install using Docker
install_docker() {
    log "Installing using Docker..."
    
    # Create docker-compose override for user
    cat > docker-compose.override.yml <<EOF
version: '3.8'
services:
  stackdeployer:
    environment:
      - APP_ENV=production
      - JWT_SECRET=$(generate_secret)
    ports:
      - "${APP_PORT}:8001"
EOF
    
    # Start services
    docker-compose up -d
    
    success "Docker installation complete!"
    return 0
}

# Install natively
install_native() {
    log "Installing natively..."
    
    local platform=$(detect_platform)
    
    case $platform in
        "linux")
            install_linux_native
            ;;
        "macos")
            install_macos_native
            ;;
        "windows")
            install_windows_wsl
            ;;
    esac
}

install_linux_native() {
    # Use existing install.sh but with improvements
    if [[ -f "install.sh" ]]; then
        log "Running native Linux installer..."
        sudo bash install.sh
    else
        error "install.sh not found"
        return 1
    fi
}

install_macos_native() {
    log "Setting up for macOS..."
    
    # Create installation directory
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$(whoami)" "$INSTALL_DIR"
    
    # Copy files
    cp -r backend "$INSTALL_DIR/"
    cp -r frontend "$INSTALL_DIR/"
    
    # Setup Python environment
    cd "$INSTALL_DIR/backend"
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    
    # Build frontend
    cd "$INSTALL_DIR/frontend"
    npm install
    npm run build
    
    # Create .env file
    create_env_file "$INSTALL_DIR/backend"
    
    # Run migrations
    cd "$INSTALL_DIR/backend"
    source .venv/bin/activate
    alembic upgrade head
    
    success "macOS installation complete!"
}

install_windows_wsl() {
    log "Setting up for Windows via WSL2..."
    
    # Inside WSL, use Linux installer
    wsl bash -c "cd $(pwd) && sudo bash install.sh"
}

# Generate secret
generate_secret() {
    if command_exists openssl; then
        openssl rand -hex 32
    else
        python3 -c 'import secrets; print(secrets.token_hex(32))'
    fi
}

# Create environment file
create_env_file() {
    local backend_dir="$1"
    local env_file="$backend_dir/.env"
    
    if [[ ! -f "$env_file" ]]; then
        log "Creating environment file..."
        cat > "$env_file" <<EOF
app_env=production
database_url=sqlite:///${backend_dir}/stackdeployer.db
jwt_secret=$(generate_secret)
jwt_algorithm=HS256
jwt_access_token_expire_minutes=60
cors_origins=http://localhost:3000,http://127.0.0.1:3000
allowed_project_roots=/srv/apps,/opt/apps,/home/ubuntu/apps
EOF
    fi
}

# Health check
health_check() {
    log "Performing health check..."
    
    if [[ "$USE_DOCKER" == "true" ]]; then
        # Check Docker containers
        if docker-compose ps | grep -q "Up"; then
            success "Docker services are running"
        else
            error "Docker services failed to start"
            return 1
        fi
    else
        # Check native installation
        if curl -f "http://localhost:${APP_PORT}/api/v1/health" >/dev/null 2>&1; then
            success "StackDeployer is running"
        else
            warning "StackDeployer may not be running properly"
        fi
    fi
}

# Show post-installation info
show_post_install() {
    cat <<EOF

${GREEN}Installation Complete!${NC}

${BLUE}Next Steps:${NC}
1. Bootstrap admin user:
   curl -X POST http://localhost:${APP_PORT}/api/v1/auth/bootstrap \\
     -H "Content-Type: application/json" \\
     -d '{"username":"admin","password":"YOUR_STRONG_PASSWORD"}'

2. Access the panel:
   http://localhost:${APP_PORT}

3. Check service status:
   ${USE_DOCKER:+docker-compose ps}
   ${USE_DOCKER:+docker-compose logs stackdeployer}

${BLUE}Documentation:${NC}
- https://github.com/haydarkadioglu/stackdeployer
- Check README.md for detailed usage

EOF
}

# Main installation flow
main() {
    log "Starting ${APP_NAME} v${APP_VERSION} installation..."
    log "Platform: $(detect_platform)"
    
    # Determine installation method
    if [[ "$USE_DOCKER" == "auto" ]]; then
        if check_docker; then
            USE_DOCKER="true"
            log "Docker detected, using Docker installation"
        else
            USE_DOCKER="false"
            log "Docker not available, using native installation"
        fi
    fi
    
    # Check dependencies
    if [[ "$USE_DOCKER" == "false" ]]; then
        if ! check_native_deps; then
            error "Please install missing dependencies and try again"
            exit 1
        fi
    fi
    
    # Perform installation
    if [[ "$USE_DOCKER" == "true" ]]; then
        install_docker
    else
        install_native
    fi
    
    # Health check
    sleep 3
    health_check
    
    # Show next steps
    show_post_install
}

# Script entry point
# Handle both direct execution and piping (curl | bash)
if [[ "${BASH_SOURCE[0]:-}" == "${0}" ]] || [[ -z "${BASH_SOURCE[0]:-}" ]]; then
    main "$@"
fi
