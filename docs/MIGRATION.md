# Migration Guide

## 🔄 Migration from Old Installation

If you have an existing installation using the legacy method, follow these steps to migrate to the universal installer:

### 1. Backup Your Data

First, backup your existing StackDeployer installation:

```bash
sudo cp -r /opt/stackdeployer /opt/stackdeployer.backup
```

This preserves:
- Database files (`stackdeployer.db`)
- Project configurations
- Environment variables
- Log files

### 2. Stop Old Service

Stop and disable the legacy StackDeployer service:

```bash
sudo systemctl stop stackdeployer
sudo systemctl disable stackdeployer
```

This prevents conflicts during the new installation.

### 3. Run Universal Installer

Install the new version using the universal installer:

```bash
curl -sSL https://raw.githubusercontent.com/haydarkadioglu/stackdeployer/main/install-universal.sh | bash
```

The universal installer will:
- Detect your platform and choose the best installation method
- Install all required dependencies automatically
- Set up the new configuration
- Start the service

### 4. Restore Data if Needed

If you want to preserve your existing projects and settings:

```bash
# Stop the new service temporarily
sudo systemctl stop stackdeployer

# Copy the old database
sudo cp /opt/stackdeployer.backup/backend/stackdeployer.db /opt/stackdeployer/backend/

# Restart the service
sudo systemctl start stackdeployer
```

### 5. Verify Migration

Check that everything is working:

```bash
# Check service status
sudo systemctl status stackdeployer

# Test API health
curl http://localhost:8001/api/v1/health

# Access dashboard
# Open http://localhost:8001 in your browser
```

## 🚨 Important Notes

### Data Compatibility

- **Database:** SQLite databases are compatible between versions
- **Projects:** Existing project configurations should work
- **Environment:** You may need to update environment variables

### Configuration Changes

The universal installer uses a slightly different configuration structure:

- **Old:** `/opt/stackdeployer/backend/.env`
- **New:** Same location, but with additional options

### Service Management

The new installation uses improved service management:

- **Old:** Basic systemd service
- **New:** Enhanced service with health checks and auto-restart

## 🛠️ Troubleshooting

### Port Conflicts

If you get port conflicts:

```bash
# Check what's using port 8001
sudo netstat -tulpn | grep :8001

# Use different port for new installation
APP_PORT=8002 bash install-universal.sh
```

### Permission Issues

If you encounter permission errors:

```bash
# Fix ownership
sudo chown -R $USER:$USER /opt/stackdeployer

# Or run with sudo
sudo bash install-universal.sh
```

### Database Issues

If the database doesn't work after migration:

```bash
# Check database integrity
sqlite3 /opt/stackdeployer/backend/stackdeployer.db "PRAGMA integrity_check;"

# Rebuild if needed
sudo rm /opt/stackdeployer/backend/stackdeployer.db
# Let the installer create a fresh database
```

## 📋 Migration Checklist

- [ ] Backup existing installation
- [ ] Stop old service
- [ ] Run universal installer
- [ ] Restore database (if needed)
- [ ] Verify service status
- [ ] Test API endpoints
- [ ] Access dashboard
- [ ] Check project deployments
- [ ] Update firewall rules (if needed)

## 🆘 Getting Help

If you encounter issues during migration:

1. **Check logs:** `sudo journalctl -u stackdeployer -f`
2. **Verify installation:** `curl http://localhost:8001/api/v1/health`
3. **Review configuration:** `cat /opt/stackdeployer/backend/.env`
4. **Open an issue:** https://github.com/haydarkadioglu/stackdeployer/issues

## 🔄 Rollback

If you need to rollback to the old installation:

```bash
# Stop new service
sudo systemctl stop stackdeployer
sudo systemctl disable stackdeployer

# Restore old installation
sudo rm -rf /opt/stackdeployer
sudo mv /opt/stackdeployer.backup /opt/stackdeployer

# Restart old service
sudo systemctl start stackdeployer
sudo systemctl enable stackdeployer
```

---

**Note:** The universal installer is backward compatible and should work with existing data without issues. This migration guide is provided for completeness and peace of mind.
