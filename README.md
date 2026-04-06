# StackDeployer

StackDeployer is a self-hosted control plane for deploying multiple projects (FastAPI, Node.js, mixed stacks) on a single VPS.

## Start Here: Import, Run, and Publish

### 1. Import the repository
1. Create an empty repository in your Git provider.
2. Push this project to that repository, or clone directly if already hosted.
3. On your VPS (or local machine for development), clone it:

```bash
git clone https://github.com/haydarkadioglu/stackdeployer
cd stackdeployer
```

### 2. Bring up StackDeployer on a VPS (recommended)
1. Use Ubuntu or Debian with a sudo-enabled user.
2. Run installer from project root (`PANEL_SERVER_NAME` can be your domain or subdomain):

```bash
sudo PANEL_SERVER_NAME=panel.example.com CERTBOT_EMAIL=admin@example.com bash install.sh
```

3. Check service health:

```bash
sudo systemctl status stackdeployer
curl http://127.0.0.1:8001/api/v1/health
```

### 3. Bootstrap first admin
Run once after first install:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"CHANGE_ME_STRONG_PASSWORD"}'
```

### 4. Login and get API token
Use this token for project operations (deploy, restart, domain mapping):

```bash
curl -X POST http://127.0.0.1:8001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"CHANGE_ME_STRONG_PASSWORD"}'
```

### 5. Configure custom domain or subdomain
1. In DNS, create an `A` record that points to your VPS IP.
   - Example root domain: `example.com -> <VPS_IP>`
   - Example subdomain: `app.example.com -> <VPS_IP>`
2. Create your project in StackDeployer (API or UI).
3. Apply Nginx route for that project:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects/<PROJECT_ID>/nginx/apply \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"site_name":"myapp","domain":"app.example.com"}'
```

4. Verify route is active:

```bash
curl -I http://app.example.com
```

### 6. Enable SSL for domain/subdomain (Certbot)
After DNS propagation and successful HTTP routing:

```bash
sudo certbot --nginx -d app.example.com
```

For root + www:

```bash
sudo certbot --nginx -d example.com -d www.example.com
```

You can also trigger SSL from StackDeployer API:

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects/<PROJECT_ID>/ssl/issue \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","extra_domains":["www.example.com"]}'
```

Renew all certificates (optional dry-run):

```bash
curl -X POST http://127.0.0.1:8001/api/v1/projects/ssl/renew \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true}'
```

### 7. Optional local development flow
Run backend and frontend manually if you are not using the VPS installer.

## Ready-to-Run Checklist
1. Run migrations: `alembic upgrade head` inside `backend/`.
2. Bootstrap first admin with `/api/v1/auth/bootstrap`.
3. Login and verify `/api/v1/auth/me` works with your token.
4. Create a `web` or `worker` project from dashboard form or API.
5. For `web` projects, set `internal_port` and apply Nginx mapping.

## Service Types
- `web`: requires `internal_port`, supports domain and Nginx mapping.
- `worker`: port/domain optional, managed via PM2 as background/console service.

## Current Backend Capabilities
- Project CRUD API
- Service types: `web` and `worker` (console/background processes)
- JWT auth (`bootstrap`, `login`, `me`)
- Deployment executor (git, install, build, PM2 lifecycle)
- Nginx site automation (apply/remove with validation)
- Realtime log stream via WebSocket
- Alembic migration baseline

## Quick Start (Development)
1. Create a Python virtual environment in `backend/`.
2. Install dependencies from `backend/requirements.txt`.
3. Copy `backend/.env.example` to `backend/.env` and set `jwt_secret`.
4. Run migrations from `backend/`: `alembic upgrade head`.
5. Start API from `backend/`: `uvicorn app.main:app --reload`.

## Testing
Run backend smoke tests with pytest:

```bash
cd backend
python -m pytest -q
```

## Frontend (Dashboard)
1. Change directory to `frontend/`.
2. Install dependencies: `npm install`.
3. Run development server: `npm run dev`.
4. Open the local Vite URL shown in terminal.

Notes:
- By default, frontend calls `http://127.0.0.1:8001` in local dev (`:5173`).
- In deployed mode, frontend uses same-origin API path (`/api/...`) via Nginx.
- You can override with `VITE_API_BASE_URL`.

## VPS Installation (Ubuntu/Debian)
Run:

```bash
sudo bash install.sh
```

The installer will:
- Check/install Python 3.10+, Node.js 18+, Nginx, Certbot, PM2
- Copy backend files to `/opt/stackdeployer/backend`
- Copy frontend files to `/opt/stackdeployer/frontend`
- Create venv and install dependencies
- Create backend `.env` with generated JWT secret
- Run `alembic upgrade head`
- Build frontend (`npm install && npm run build`)
- Create and start `stackdeployer.service` (systemd)
- Configure Nginx panel site and reload Nginx

## Security Notes
- Keep backend bound to `127.0.0.1` and expose only via Nginx.
- Complete admin bootstrap immediately after installation.
- Replace any weak/default secrets before production traffic.
- Login endpoint includes temporary lockout after repeated failed attempts.

## Initial Admin Bootstrap Example
```bash
curl -X POST http://127.0.0.1:8001/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"CHANGE_ME_STRONG_PASSWORD"}'
```
