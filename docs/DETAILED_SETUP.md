# StackDeployer Detailed Setup Guide

This guide expands the short README flow and gives full setup details for production and development environments.

For a dedicated DNS/domain mapping walkthrough, see:
- [DOMAIN_TO_VPS.md](DOMAIN_TO_VPS.md)

## 1. Architecture Summary

StackDeployer consists of:
- FastAPI backend (control plane)
- React frontend (dashboard)
- Nginx reverse proxy (panel + project routing)
- PM2 process manager (web and worker services)
- SQLite database (metadata, logs, settings)

Default runtime ports:
- Backend API bind: `127.0.0.1:8001`
- Frontend dev server (local only): `5173`

## 2. VPS Prerequisites

Recommended OS:
- Ubuntu 22.04+ or Debian 12+

Minimum suggested resources:
- 1 vCPU
- 4 GB RAM
- 40+ GB disk

Required system conditions:
- Sudo-capable user
- DNS A record access for your domain/subdomain
- Inbound ports 80/443 open

Optional but recommended:
- UFW firewall enabled
- Fail2ban enabled
- Separate non-root deployment user for app-level operations

## 3. DNS and Domain Planning

Before running SSL steps, prepare DNS:
- Root domain example: `example.com -> VPS_IP`
- Subdomain example: `panel.example.com -> VPS_IP`

Check propagation:

```bash
nslookup panel.example.com
```

Only continue SSL issue after DNS resolves to your server IP.

## 4. Import Repository

```bash
git clone https://github.com/haydarkadioglu/stackdeployer
cd stackdeployer
```

If you use your own fork, replace URL with your repository URL.

## 5. One-Step VPS Installation

Use panel domain and SSL email at install time:

```bash
sudo PANEL_SERVER_NAME=panel.example.com CERTBOT_EMAIL=admin@example.com bash install.sh
```

If you cloned earlier and hit installer errors, pull latest changes before re-running:

```bash
git pull
sudo PANEL_SERVER_NAME=panel.example.com CERTBOT_EMAIL=admin@example.com bash install.sh
```

Installer actions:
- Installs/checks Python, Node, Nginx, Certbot, PM2
- Copies backend to `/opt/stackdeployer/backend`
- Copies frontend to `/opt/stackdeployer/frontend`
- Creates backend `.env`
- Runs Alembic migrations
- Builds frontend
- Creates and starts `stackdeployer.service`
- Creates Nginx panel site and reloads Nginx

## 6. Verify Installation

Service and health checks:

```bash
sudo systemctl status stackdeployer
curl http://127.0.0.1:8001/api/v1/health
sudo nginx -t
```

Nginx panel route check (from browser):
- `http://panel.example.com`

## 7. Bootstrap and Login

Create first admin once:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"CHANGE_ME_STRONG_PASSWORD"}'
```

Login and copy token:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"CHANGE_ME_STRONG_PASSWORD"}'
```

Use token in next API calls as:
- `Authorization: Bearer <ACCESS_TOKEN>`

## 8. Create Projects

### 8.1 Web Service Project

Rules:
- `service_type` must be `web`
- `internal_port` required
- domain optional at creation, can be added later

Example:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "service_type": "web",
    "name": "api-backend",
    "git_url": "https://github.com/org/repo.git",
    "local_path": "/srv/apps/api-backend",
    "tech_stack": "python",
    "internal_port": 8080,
    "start_command": "uvicorn app.main:app --host 0.0.0.0 --port 8080"
  }'
```

### 8.2 Worker/Console Project

Rules:
- `service_type` must be `worker`
- port/domain not required
- cannot use nginx/apply route

Example:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "service_type": "worker",
    "name": "queue-worker",
    "git_url": "https://github.com/org/worker.git",
    "local_path": "/srv/apps/queue-worker",
    "tech_stack": "python",
    "start_command": "python worker.py"
  }'
```

## 9. Deploy and Process Control

Deploy project:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects/<PROJECT_ID>/deploy \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Restart project:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects/<PROJECT_ID>/restart \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Stop project:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects/<PROJECT_ID>/stop \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

## 10. Domain/Subdomain Mapping (Web Only)

Apply Nginx route for a web project:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects/<PROJECT_ID>/nginx/apply \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"site_name":"api-backend","domain":"api.example.com"}'
```

Validate:

```bash
curl -I http://api.example.com
```

Remove route:

```bash
curl -X DELETE http://127.0.0.1:8001/api/v1/projects/<PROJECT_ID>/nginx/api-backend \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

## 11. SSL Setup and Renewal

Manual certbot:

```bash
sudo certbot --nginx -d api.example.com
```

API-based issue:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects/<PROJECT_ID>/ssl/issue \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","extra_domains":["www.example.com"]}'
```

Renew all certificates (dry run):

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects/ssl/renew \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true}'
```

## 12. Local Development Flow

Backend:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## 13. Testing

Run backend smoke suite:

```bash
cd backend
python -m pytest -q
```

## 14. Upgrade Procedure

1. Pull new code:

```bash
git pull
```

2. Re-run installer (safe for updates):

```bash
sudo PANEL_SERVER_NAME=panel.example.com CERTBOT_EMAIL=admin@example.com bash install.sh
```

3. Verify service + health + tests.

## 15. Backup and Restore

### Backup

```bash
sudo cp /opt/stackdeployer/backend/stackdeployer.db /opt/stackdeployer/backend/stackdeployer.db.bak
```

### Restore

```bash
sudo systemctl stop stackdeployer
sudo cp /opt/stackdeployer/backend/stackdeployer.db.bak /opt/stackdeployer/backend/stackdeployer.db
sudo systemctl start stackdeployer
```

## 16. Troubleshooting

### API does not respond
- Check service: `sudo systemctl status stackdeployer`
- Check logs: `sudo journalctl -u stackdeployer -n 200 --no-pager`

### Nginx mapping fails
- Validate config: `sudo nginx -t`
- Check active sites:

```bash
ls -la /etc/nginx/sites-available
ls -la /etc/nginx/sites-enabled
```

### SSL issuance fails
- Verify DNS points to VPS
- Ensure port 80 is reachable from internet
- Inspect certbot output:

```bash
sudo certbot certificates
```

### Login lockout
- Repeated failed attempts trigger temporary lockout.
- Wait for lockout timeout and retry with correct credentials.

## 17. Security Checklist (Production)

- Use a strong admin password
- Keep backend bound to localhost
- Use HTTPS only for public access
- Rotate JWT secret when needed
- Restrict SSH access and disable password login if possible
- Keep OS packages up to date
