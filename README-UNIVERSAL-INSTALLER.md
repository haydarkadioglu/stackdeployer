# Universal Installer for StackDeployer

Cross-platform installation solution that works on Linux, macOS, and Windows.

## Quick Start

### Linux/macOS
```bash
curl -sSL https://raw.githubusercontent.com/haydarkadioglu/stackdeployer/main/install-universal.sh | bash
```

### Windows
```powershell
# Download and run PowerShell script
irm https://raw.githubusercontent.com/haydarkadioglu/stackdeployer/main/install.ps1 | iex

# Or download and run manually
curl -o install.ps1 https://raw.githubusercontent.com/haydarkadioglu/stackdeployer/main/install.ps1
.\install.ps1
```

## Installation Methods

### 1. Docker Installation (Recommended)
- **Pros:** Isolated environment, easy setup, cross-platform
- **Cons:** Requires Docker Desktop
- **Command:** `USE_DOCKER=true bash install-universal.sh`

### 2. WSL2 Installation (Windows)
- **Pros:** Native Linux performance, full compatibility
- **Cons:** Requires WSL2 setup
- **Command:** `install.ps1` (auto-detects WSL2)

### 3. Native Installation
- **Pros:** Best performance, direct system integration
- **Cons:** More dependencies, platform-specific setup
- **Command:** `USE_DOCKER=false bash install-universal.sh`

## Configuration Options

### Environment Variables
- `INSTALL_DIR`: Installation directory (default: `/opt/stackdeployer`)
- `APP_PORT`: Application port (default: `8001`)
- `USE_DOCKER`: Force Docker installation (`true`/`false`/`auto`)
- `CERTBOT_EMAIL`: Email for SSL certificates

### PowerShell Parameters
```powershell
.\install.ps1 -InstallDir "C:\StackDeployer" -Port 8001 -UseDocker
```

## Platform-Specific Requirements

### Linux
- Ubuntu 22.04+ or Debian 12+
- Python 3.10+
- Node.js 18+
- Git

### macOS
- macOS 10.15+
- Homebrew (auto-installed)
- Python 3.10+
- Node.js 18+
- Git

### Windows
- Windows 10/11 with WSL2
- OR Docker Desktop
- OR PowerShell Administrator access

## Post-Installation Steps

1. **Bootstrap Admin User**
```bash
curl -X POST http://localhost:8001/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_STRONG_PASSWORD"}'
```

2. **Access Dashboard**
- URL: `http://localhost:8001`
- Login with admin credentials

3. **Verify Health**
```bash
curl http://localhost:8001/api/v1/health
```

## Troubleshooting

### Docker Issues
```bash
# Check Docker status
docker info
docker-compose ps

# View logs
docker-compose logs stackdeployer

# Restart services
docker-compose restart
```

### Native Installation Issues
```bash
# Check service status (Linux)
sudo systemctl status stackdeployer

# Check service status (Windows)
Get-Service StackDeployer

# View logs
journalctl -u stackdeployer -f
```

### Port Conflicts
```bash
# Change port
APP_PORT=8002 bash install-universal.sh

# Or check what's using the port
netstat -tulpn | grep :8001
```

### Permission Issues
```bash
# Linux: Ensure proper permissions
sudo chown -R $USER:/opt/stackdeployer

# Windows: Run as Administrator
# Right-click PowerShell -> Run as Administrator
```

## Migration from Old Installer

If you have an existing installation using the old `install.sh`:

1. **Backup Data**
```bash
sudo cp -r /opt/stackdeployer /opt/stackdeployer.backup
```

2. **Stop Old Service**
```bash
sudo systemctl stop stackdeployer
sudo systemctl disable stackdeployer
```

3. **Run Universal Installer**
```bash
bash install-universal.sh
```

4. **Restore Data (if needed)**
```bash
sudo cp -r /opt/stackdeployer.backup/backend/stackdeployer.db /opt/stackdeployer/backend/
```

## Development Mode

For development using Docker Compose:

```bash
# Development environment
APP_ENV=development docker-compose up

# With hot reload
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Security Notes

- **Production:** Always change default passwords
- **SSL:** Configure SSL certificates for production
- **Firewall:** Restrict access to management ports
- **Updates:** Keep dependencies updated

## Support

- **Documentation:** [README.md](README.md)
- **Issues:** [GitHub Issues](https://github.com/haydarkadioglu/stackdeployer/issues)
- **Community:** [Discussions](https://github.com/haydarkadioglu/stackdeployer/discussions)

## Advanced Configuration

### Custom Docker Compose
Create `docker-compose.override.yml`:
```yaml
version: '3.8'
services:
  stackdeployer:
    environment:
      - APP_ENV=production
      - JWT_SECRET=your-custom-secret
    ports:
      - "8001:8001"
    volumes:
      - ./custom-config:/app/config
```

### Environment File
Create `.env`:
```bash
APP_ENV=production
DATABASE_URL=postgresql://user:pass@localhost:5432/stackdeployer
JWT_SECRET=your-very-secure-secret
CORS_ORIGINS=https://yourdomain.com
```

### Custom Installation Directory
```bash
INSTALL_DIR=/custom/path bash install-universal.sh
```

This universal installer provides a seamless experience across all major platforms while maintaining the flexibility of the original system.
