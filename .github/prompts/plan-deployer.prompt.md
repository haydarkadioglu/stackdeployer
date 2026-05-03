## Plan: StackDeployer MVP foundation

Build a monorepo Deployment Management System with a FastAPI control plane, React dashboard, and Linux-first setup script. The approach prioritizes secure bootstrap, deterministic process/nginx automation, and observable deployment workflows (status + log streaming) for mixed stacks via PM2.

**Steps**
1. Phase A — Repository bootstrap and baseline guardrails
   1.1 Create monorepo skeleton: backend/, frontend/, install.sh, docs, and env templates.
   1.2 Add baseline project controls: .gitignore, dependency pinning strategy, and Linux-only runtime assumptions in setup docs.
   1.3 Define shared configuration contract (API base URL, JWT expiry, default deployment base path, PM2 app naming scheme).

2. Phase B — Backend foundation and data model (*blocks Phases C-F*)
   2.1 Initialize FastAPI service structure with app startup, settings loader, and health endpoint.
   2.2 Implement models.py for SQLite entities: Projects, Logs, Settings, Users (admin), DeploymentEvents.
   2.3 Configure SQLAlchemy + Alembic migration workflow; add initial migration for schema.
   2.4 Add CRUD service/repository boundaries for Projects and Settings to avoid route-level DB coupling.

3. Phase C — Security and authentication (*depends on B*)
   3.1 Implement auth.py: password hashing, JWT issue/verify, login endpoint, auth dependency.
   3.2 Implement first-run admin bootstrap flow: CLI prompt in install.sh or setup command writes hashed admin credentials and marks initialization complete.
   3.3 Enforce secure defaults: backend non-debug mode, CORS allowlist from env, rate-limited login (or lockout thresholds), secure JWT secret validation at startup.
   3.4 Align access model with user decision: panel served under domain/subdomain after install; all deployment operations require authenticated session.

4. Phase D — Executor and deployment lifecycle (*depends on B,C; parallel with E core implementation*)
   4.1 Implement executor.py subprocess wrapper with structured command runner (timeouts, streamed stdout/stderr, exit code capture, redaction hooks).
   4.2 Add deployment pipeline steps: clone/pull repo, dependency install by detected stack, build command support, PM2 start/restart/stop/delete.
   4.3 Persist lifecycle events and logs into DB + file-backed rotating logs for recovery.
   4.4 Expose backend endpoints for deploy/start/stop/restart/status and log tail subscription metadata.

5. Phase E — Nginx and SSL automation (*depends on B,C; parallel with D*)
   5.1 Implement nginx_config.py templating for upstream + server blocks in sites-available and symlink management to sites-enabled.
   5.2 Add safe-apply flow: render -> write temp -> nginx -t validation -> atomic replace -> reload.
   5.3 Implement ssl_service.py Certbot integration for issue/renew/reconfigure operations with explicit domain ownership assumptions.
   5.4 Add rollback behavior on nginx/ssl failure to avoid breaking existing routes.

6. Phase F — Realtime logs and websocket transport (*depends on D base*)
   6.1 Implement websocket endpoint for authenticated log streaming by project id.
   6.2 Add bounded buffering/backpressure handling and disconnect-safe tail resume strategy.
   6.3 Ensure executor and websocket streamer share normalized log event format.

7. Phase G — Frontend dashboard and deployment UX (*depends on C,D,F; can begin shell in parallel earlier*)
   7.1 Scaffold React (Vite) app with vanilla CSS architecture and dark glassmorphism design tokens in index.css.
   7.2 Build App.jsx layout shell: top navigation, project dashboard, deployment wizard container, log terminal panel.
   7.3 Implement project dashboard cards with status badges and last deployment metadata.
   7.4 Implement multi-step wizard: Git -> Config -> Review -> Deploy with validation and API integration.
   7.5 Implement real-time terminal log viewer via websocket and deploy status transitions.
   7.6 Add JWT login flow, token persistence, logout, and unauthorized-route handling.

8. Phase H — Installer and operationalization (*depends on C,D,E,G*)
   8.1 Implement install.sh for Ubuntu/Debian dependency checks/install: Python 3.10+, Node 18+, Nginx, Certbot, PM2.
   8.2 Automate backend/frontend build + service wiring (systemd for control plane) and environment file generation.
   8.3 Add first-time setup sequence: admin credential bootstrap, domain/subdomain input, initial Nginx site generation, optional SSL issuance.
   8.4 Add maintenance commands documentation: upgrade, backup/restore SQLite, cert renewal verification.

9. Phase I — Verification and acceptance (*depends on all prior phases*)
   9.1 Automated tests: auth endpoints, project CRUD, executor command orchestration, nginx template rendering/validation (mocked), websocket auth.
   9.2 Manual acceptance: deploy Hello World FastAPI + Node apps, verify domain routing, SSL issuance path, and live logs in UI.
   9.3 Security validation: failed login behavior, unauthorized endpoint checks, command injection guardrails in executor inputs.

**Relevant files**
- /backend/app/models.py — SQLAlchemy models for Projects, Logs, Settings, Users, DeploymentEvents
- /backend/app/auth.py — JWT and password hashing, auth dependencies, login route hooks
- /backend/app/executor.py — subprocess orchestration and PM2 control adapter
- /backend/app/nginx_config.py — Nginx template renderer, test/apply/reload logic
- /backend/app/ssl_service.py — Certbot issue/renew orchestration
- /backend/app/main.py — FastAPI app wiring, routers, websocket registration
- /backend/alembic/* — migration environment and initial schema migration
- /frontend/src/App.jsx — dashboard composition and deployment flow containers
- /frontend/src/index.css — design tokens, dark theme, glassmorphism primitives
- /frontend/src/services/api.js — REST client + auth token handling
- /frontend/src/services/ws.js — websocket client for log streaming
- /install.sh — Linux installation/bootstrap automation
- /README.md — setup, security posture, and operational runbook

**Verification**
1. Run backend unit/API tests for auth/project/executor/nginx modules with mocked system calls.
2. Run frontend build + lint and validate wizard and websocket flow against local backend.
3. Execute installer in a clean Ubuntu VM and confirm idempotent dependency checks.
4. Validate nginx apply safety by introducing an invalid template fixture and confirming rollback.
5. Perform end-to-end manual scenario: create project -> deploy -> observe logs -> assign domain -> issue SSL.

**Decisions**
- Monorepo structure is selected (backend + frontend + install.sh in one repository).
- DB schema changes will use Alembic migrations (not startup auto-mutate only).
- Process manager is PM2 for mixed-stack runtimes.
- SSL issuance is automatic via Certbot integration.
- Initial admin credential is set during first-time setup via CLI/bootstrap flow.
- Access expectation: user installs on their own server and exposes panel via domain/subdomain; all deployment actions require authenticated login.

**Further Considerations**
1. Security hardening baseline for first release: recommend optional IP allowlist mode and login throttling even when panel is domain-exposed.
2. Persistence strategy: decide whether log records in SQLite are retained with TTL or archived/rotated only on filesystem.
3. Multi-user scope: current plan assumes single-admin MVP; role-based access is explicitly out of scope for this iteration.
