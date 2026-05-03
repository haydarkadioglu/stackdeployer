# Installer can leave incorrect Git remote (`YOUR_USERNAME`) causing self-update failures and stale backend (API 404s)

## Summary
After installation, the server repository remote can remain as a placeholder (`https://github.com/YOUR_USERNAME/stackdeployer.git`) instead of the actual repository URL.  
This causes update flow failures (`git pull` prompts/auth issues or pull abort), and the running backend stays outdated, which leads to endpoint 404s in the UI.

## Environment
- OS: Ubuntu (server)
- Install path: `/opt/stackdeployer`
- Install command uses `DEPLOYER_REPO_URL`
- Repo can be public, but issue still appears if remote is wrong

## Steps to Reproduce
1. Install with:
   `sudo PANEL_SERVER_NAME=... CERTBOT_EMAIL=... DEPLOYER_REPO_URL=https://github.com/haydarkadioglu/stackdeployer.git bash install.sh`
2. On server, check:
   `git -C /opt/stackdeployer remote -v`
3. Try update:
   `git -C /opt/stackdeployer pull origin main`
4. Open panel and trigger actions requiring newer backend endpoints.

## Actual Result
- `origin` may point to placeholder URL (`YOUR_USERNAME`).
- `git pull` may fail or ask for credentials unexpectedly.
- Backend does not get latest code.
- UI receives 404 for newer endpoints (examples seen):
  - `/api/v1/projects/import/analyze`
  - `/api/v1/projects/import/paths`
  - `/api/v1/system/info`
  - `/api/v1/system/self-update`

## Expected Result
- Installer always sets `origin` to the real repository URL from `DEPLOYER_REPO_URL`.
- Update flow works non-interactively for public repos.
- Backend updates correctly and endpoints are available (no 404 due to stale code).

## Impact
- New users think features are broken.
- Self-update appears unreliable.
- Troubleshooting is confusing because service restart can succeed while code stays old.

## Proposed Fix
1. In installer, always enforce:
   `git remote set-url origin "$DEPLOYER_REPO_URL"` after repo init/sync.
2. Validate remote immediately after install and print it in summary.
3. Add a startup/update sanity check:
   - Verify `/opt/stackdeployer/.git` exists.
   - Verify `origin` is not placeholder.
4. Improve docs with a troubleshooting section:
   - `git remote -v`
   - `git pull --ff-only origin main`
   - how to correct remote URL.

## Acceptance Criteria
- Fresh install sets correct `origin` every time.
- Self-update works without manual remote correction.
- No endpoint 404s caused by stale backend right after update flow.