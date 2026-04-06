# StackDeployer

StackDeployer is a self-hosted control plane for deploying multiple projects (FastAPI, Node.js, mixed stacks) on a single VPS.

## Current Backend Capabilities
- Project CRUD API
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

## Frontend (Dashboard)
1. Change directory to `frontend/`.
2. Install dependencies: `npm install`.
3. Run development server: `npm run dev`.
4. Open the local Vite URL shown in terminal.

## VPS Installation (Ubuntu/Debian)
Run:

```bash
sudo bash install.sh
```

The installer will:
- Check/install Python 3.10+, Node.js 18+, Nginx, Certbot, PM2
- Copy backend files to `/opt/stackdeployer/backend`
- Create venv and install dependencies
- Create backend `.env` with generated JWT secret
- Run `alembic upgrade head`
- Create and start `stackdeployer.service` (systemd)

## Security Notes
- Keep backend bound to `127.0.0.1` and expose only via Nginx.
- Complete admin bootstrap immediately after installation.
- Replace any weak/default secrets before production traffic.

## Initial Admin Bootstrap Example
```bash
curl -X POST http://127.0.0.1:8001/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"CHANGE_ME_STRONG_PASSWORD"}'
```
