# Install StackDeployer on Ubuntu/Debian Server

## Fresh Install

Replace the values with your own configuration:

```bash
sudo PANEL_SERVER_NAME=server.haydarkadioglu.com \
     CERTBOT_EMAIL=admin@haydarkadioglu.com \
     DEPLOYER_REPO_URL=https://github.com/haydarkadioglu/stackdeployer.git \
     bash install.sh
```

### Configuration Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PANEL_SERVER_NAME` | Your domain/hostname for the panel | `server.haydarkadioglu.com` or `deployer.example.com` |
| `CERTBOT_EMAIL` | Email for Let's Encrypt SSL certificates | `admin@haydarkadioglu.com` |
| `DEPLOYER_REPO_URL` | Your GitHub repository URL | `https://github.com/haydarkadioglu/stackdeployer.git` |
| `APP_ROOT` | (Optional) Installation directory | `/opt/stackdeployer` (default) |
| `APP_PORT` | (Optional) Backend API port | `8001` (default) |

### Example for Your Setup

```bash
sudo PANEL_SERVER_NAME=server.haydarkadioglu.com \
     CERTBOT_EMAIL=admin@haydarkadioglu.com \
     DEPLOYER_REPO_URL=https://github.com/haydarkadioglu/stackdeployer.git \
     bash install.sh
```

## Update Existing Installation

After updating the repository, run on the server:

```bash
# SSH to server
ssh admin@server.haydarkadioglu.com

# Option 1: Use Web Panel
# 1. Login to http://server.haydarkadioglu.com
# 2. Click Account → System Dashboard
# 3. Click Self Update button
# 4. Click "update system" button

# Option 2: Manual update
sudo bash /opt/stackdeployer/update-server.sh
```

### What Self-Update Does

The update process:
1. `git fetch origin` - Fetch latest code
2. `git checkout main` - Switch to main branch
3. `git pull --ff-only origin main` - Pull latest changes
4. Updates Python dependencies (if changed)
5. Runs database migrations (if needed)
6. Rebuilds frontend (if changed)
7. Restarts the service
