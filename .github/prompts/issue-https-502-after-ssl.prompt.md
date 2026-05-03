## Issue: API returns 502 after moving panel to HTTPS

After enabling HTTPS for the panel domain, the frontend loads correctly but login and all API calls fail with `502 Bad Gateway`.

### Symptoms
- `http://<panel-domain>` redirects to HTTPS with `301` (expected).
- `https://<panel-domain>` returns frontend `index.html` (expected).
- `https://<panel-domain>/api/v1/health` returns `502 Bad Gateway` (unexpected).
- Browser console shows failed requests such as `/api/v1/auth/login` with status `502`.

### Root Cause (confirmed)
`stackdeployer` backend service was not running due to systemd startup failure:
- Service state: `activating (auto-restart)`
- Exec status: `status=203/EXEC`
- ExecStart path: `/opt/stackdeployer/backend/.venv/bin/uvicorn ...`

This indicates the executable path was invalid or missing (broken/missing venv), so Nginx could not reach upstream `127.0.0.1:8001` and returned 502.

### Fix Applied
1. Recreate backend virtual environment under `/opt/stackdeployer/backend/.venv`.
2. Reinstall Python dependencies from `requirements.txt`.
3. Restart `stackdeployer` service.
4. Verify:
   - `curl -i http://127.0.0.1:8001/api/v1/health` -> `200`
   - `curl -i https://<panel-domain>/api/v1/health` -> `200`

### Suggested Preventive Improvements
- Add install/update guard to verify `ExecStart` binary exists before restarting service.
- Add post-update health check that fails fast if `/api/v1/health` is not reachable locally.
- Surface service startup errors in system dashboard with actionable hints.
- Keep Nginx 80->443 redirect and 443 `/api/` proxy validation in setup scripts.
