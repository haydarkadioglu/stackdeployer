from __future__ import annotations

from app.database import SessionLocal
from app.models import ProjectEnvironment


def bootstrap_admin(client) -> None:
    response = client.post(
        "/api/v1/auth/bootstrap",
        json={"username": "admin", "password": "StrongPass123!"},
    )
    assert response.status_code == 201, response.text


def login_and_get_headers(client) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "StrongPass123!"},
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_health_and_auth_flow(client) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200, response.text

    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    me_response = client.get("/api/v1/auth/me", headers=headers)
    assert me_response.status_code == 200, me_response.text
    assert me_response.json()["username"] == "admin"


def test_worker_and_web_constraints(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    worker_payload = {
        "service_type": "worker",
        "name": "worker-one",
        "git_url": "https://example.com/worker.git",
        "local_path": "/srv/apps/worker-one",
        "tech_stack": "python",
        "start_command": "python worker.py",
    }
    worker_response = client.post("/api/v1/projects", json=worker_payload, headers=headers)
    assert worker_response.status_code == 201, worker_response.text
    worker_id = worker_response.json()["id"]

    nginx_response = client.post(
        f"/api/v1/projects/{worker_id}/nginx/apply",
        json={"site_name": "worker-one", "domain": "worker.example.com"},
        headers=headers,
    )
    assert nginx_response.status_code == 400, nginx_response.text

    web_payload = {
        "service_type": "web",
        "name": "web-one",
        "git_url": "https://example.com/web.git",
        "local_path": "/srv/apps/web-one",
        "tech_stack": "node",
        "internal_port": 8080,
        "domain": "app.example.com",
        "start_command": "npm start",
    }
    web_response = client.post("/api/v1/projects", json=web_payload, headers=headers)
    assert web_response.status_code == 201, web_response.text
    web_id = web_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/projects/{web_id}",
        json={"domain": None},
        headers=headers,
    )
    assert patch_response.status_code == 200, patch_response.text
    assert patch_response.json()["domain"] is None


def test_login_lockout(client) -> None:
    bootstrap_admin(client)

    for _ in range(5):
        client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "wrong-pass"},
        )

    lockout_response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "wrong-pass"},
    )
    assert lockout_response.status_code == 429, lockout_response.text


def test_ssl_issue_and_renew_with_mock(client, monkeypatch) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    web_payload = {
        "service_type": "web",
        "name": "ssl-web",
        "git_url": "https://example.com/ssl-web.git",
        "local_path": "/srv/apps/ssl-web",
        "tech_stack": "node",
        "internal_port": 8081,
        "domain": "ssl.example.com",
        "start_command": "npm start",
    }
    web_response = client.post("/api/v1/projects", json=web_payload, headers=headers)
    assert web_response.status_code == 201, web_response.text
    project_id = web_response.json()["id"]

    from app.routers import projects as projects_router

    monkeypatch.setattr(
        projects_router.ssl_service,
        "issue_certificate",
        lambda primary_domain, email, extra_domains=None: f"issued:{primary_domain}:{email}",
    )
    monkeypatch.setattr(
        projects_router.ssl_service,
        "renew_certificates",
        lambda dry_run=False: "renew-ok" if not dry_run else "renew-dry-run-ok",
    )

    issue_response = client.post(
        f"/api/v1/projects/{project_id}/ssl/issue",
        headers=headers,
        json={"email": "admin@example.com", "extra_domains": ["www.ssl.example.com"]},
    )
    assert issue_response.status_code == 200, issue_response.text
    assert issue_response.json()["status"] == "ok"

    renew_response = client.post(
        "/api/v1/projects/ssl/renew",
        headers=headers,
        json={"dry_run": True},
    )
    assert renew_response.status_code == 200, renew_response.text
    assert renew_response.json()["status"] == "ok"


def test_create_project_rejects_disallowed_local_path(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "bad-path",
            "git_url": "https://example.com/bad-path.git",
            "local_path": "/etc/bad-path",
            "tech_stack": "python",
            "internal_port": 8082,
            "start_command": "uvicorn app.main:app --host 0.0.0.0 --port 8082",
        },
    )
    assert response.status_code == 400, response.text
    assert "allowed roots" in response.json()["detail"]


def test_create_project_rejects_forbidden_command_chars(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "bad-command",
            "git_url": "https://example.com/bad-command.git",
            "local_path": "/srv/apps/bad-command",
            "tech_stack": "node",
            "internal_port": 8083,
            "start_command": "npm start; rm -rf /",
        },
    )
    assert response.status_code == 400, response.text
    assert "forbidden shell characters" in response.json()["detail"]


def test_create_project_rejects_parent_path_segments(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "bad-traversal",
            "git_url": "https://example.com/bad-traversal.git",
            "local_path": "/srv/apps/../etc/bad-traversal",
            "tech_stack": "python",
            "internal_port": 8084,
            "start_command": "uvicorn app.main:app --host 0.0.0.0 --port 8084",
        },
    )
    assert response.status_code == 400, response.text
    assert "parent directory segments" in response.json()["detail"]


def test_create_project_normalizes_local_path(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "normalized-path",
            "git_url": "https://example.com/normalized-path.git",
            "local_path": "/srv/apps//team///normalized-path",
            "tech_stack": "node",
            "internal_port": 8085,
            "start_command": "npm start",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["local_path"] == "/srv/apps/team/normalized-path"


def test_update_project_rejects_parent_path_segments(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    create_response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "patch-path-check",
            "git_url": "https://example.com/patch-path-check.git",
            "local_path": "/srv/apps/patch-path-check",
            "tech_stack": "python",
            "internal_port": 8086,
            "start_command": "uvicorn app.main:app --host 0.0.0.0 --port 8086",
        },
    )
    assert create_response.status_code == 201, create_response.text
    project_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/projects/{project_id}",
        headers=headers,
        json={"local_path": "/srv/apps/../etc/patch-path-check"},
    )
    assert patch_response.status_code == 400, patch_response.text
    assert "parent directory segments" in patch_response.json()["detail"]


def test_env_reveal_secrets_creates_audit_log(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    create_project_response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "env-audit-check",
            "git_url": "https://example.com/env-audit-check.git",
            "local_path": "/srv/apps/env-audit-check",
            "tech_stack": "python",
            "internal_port": 8087,
            "start_command": "uvicorn app.main:app --host 0.0.0.0 --port 8087",
        },
    )
    assert create_project_response.status_code == 201, create_project_response.text
    project_id = create_project_response.json()["id"]

    create_env_response = client.post(
        f"/api/v1/projects/{project_id}/env",
        headers=headers,
        json={"key": "API_KEY", "value": "super-secret", "is_secret": True},
    )
    assert create_env_response.status_code == 201, create_env_response.text

    reveal_response = client.get(
        f"/api/v1/projects/{project_id}/env?reveal_secrets=true",
        headers=headers,
    )
    assert reveal_response.status_code == 200, reveal_response.text
    rows = reveal_response.json()
    assert len(rows) == 1
    assert rows[0]["value"] == "super-secret"

    logs_response = client.get(f"/api/v1/projects/{project_id}/logs", headers=headers)
    assert logs_response.status_code == 200, logs_response.text
    messages = [item["message"] for item in logs_response.json()]
    assert any(message.startswith("Environment secrets viewed via API") for message in messages)


def test_secret_env_values_are_encrypted_at_rest(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    create_project_response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "env-encryption-check",
            "git_url": "https://example.com/env-encryption-check.git",
            "local_path": "/srv/apps/env-encryption-check",
            "tech_stack": "python",
            "internal_port": 8088,
            "start_command": "uvicorn app.main:app --host 0.0.0.0 --port 8088",
        },
    )
    assert create_project_response.status_code == 201, create_project_response.text
    project_id = create_project_response.json()["id"]

    create_env_response = client.post(
        f"/api/v1/projects/{project_id}/env",
        headers=headers,
        json={"key": "SECRET_TOKEN", "value": "super-secret", "is_secret": True},
    )
    assert create_env_response.status_code == 201, create_env_response.text

    with SessionLocal() as db:
        item = db.query(ProjectEnvironment).filter(ProjectEnvironment.project_id == project_id).one()
        assert item.value != "super-secret"
        assert item.value.startswith("enc:v1:")

    reveal_response = client.get(
        f"/api/v1/projects/{project_id}/env?reveal_secrets=true",
        headers=headers,
    )
    assert reveal_response.status_code == 200, reveal_response.text
    assert reveal_response.json()[0]["value"] == "super-secret"


def test_deploy_renders_env_file_content(client, monkeypatch) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    create_project_response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "env-deploy-check",
            "git_url": "https://example.com/env-deploy-check.git",
            "local_path": "/srv/apps/env-deploy-check",
            "tech_stack": "python",
            "internal_port": 8089,
            "start_command": "uvicorn app.main:app --host 0.0.0.0 --port 8089",
        },
    )
    assert create_project_response.status_code == 201, create_project_response.text
    project_id = create_project_response.json()["id"]

    client.post(
        f"/api/v1/projects/{project_id}/env",
        headers=headers,
        json={"key": "PLAIN_TOKEN", "value": "plain-value", "is_secret": False},
    )
    client.post(
        f"/api/v1/projects/{project_id}/env",
        headers=headers,
        json={"key": "SECRET_TOKEN", "value": "super-secret", "is_secret": True},
    )

    from app.routers import projects as projects_router

    captured = {}

    def fake_deploy(plan, stream=None):
        captured["env_content"] = plan.env_content
        captured["env_file_name"] = plan.env_file_name

    monkeypatch.setattr(projects_router.executor, "deploy", fake_deploy)

    deploy_response = client.post(
        f"/api/v1/projects/{project_id}/deploy",
        headers=headers,
        json={"branch": "main", "deployment_type": "production"},
    )
    assert deploy_response.status_code == 202, deploy_response.text
    assert captured["env_file_name"] == ".env"
    assert 'PLAIN_TOKEN="plain-value"' in captured["env_content"]
    assert 'SECRET_TOKEN="super-secret"' in captured["env_content"]


def test_user_can_change_username_and_password(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    update_response = client.patch(
        "/api/v1/auth/me",
        headers=headers,
        json={
            "current_password": "StrongPass123!",
            "new_username": "admin2",
            "new_password": "EvenStronger456!",
        },
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["username"] == "admin2"

    old_login_response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "StrongPass123!"},
    )
    assert old_login_response.status_code == 401, old_login_response.text

    new_login_response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin2", "password": "EvenStronger456!"},
    )
    assert new_login_response.status_code == 200, new_login_response.text


def test_create_project_rejects_when_resolved_path_escapes_allowed_roots(client, monkeypatch) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    from app.routers import projects as projects_router

    monkeypatch.setattr(projects_router, "_resolve_posix_path", lambda path: "/etc/escape")

    response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "resolved-escape",
            "git_url": "https://example.com/resolved-escape.git",
            "local_path": "/srv/apps/resolved-escape",
            "tech_stack": "python",
            "internal_port": 8088,
            "start_command": "uvicorn app.main:app --host 0.0.0.0 --port 8088",
        },
    )
    assert response.status_code == 400, response.text
    assert "resolves outside allowed roots" in response.json()["detail"]


def test_self_update_endpoint_runs_git_pull_flow(client, monkeypatch, tmp_path) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    from app import config as app_config
    from app.executor import CommandResult
    from app.routers import system as system_router

    repo_root = tmp_path / "stackdeployer"
    repo_root.mkdir(parents=True, exist_ok=True)
    (repo_root / ".git").mkdir(exist_ok=True)

    monkeypatch.setattr(app_config.settings, "self_update_enabled", True)
    monkeypatch.setattr(app_config.settings, "self_update_repo_root", str(repo_root))
    monkeypatch.setattr(app_config.settings, "self_update_default_branch", "main")

    calls = []

    def fake_run(args, cwd=None, timeout=None, stream=None):
        _ = timeout, stream
        calls.append((list(args), str(cwd) if cwd else None))
        return CommandResult(command=list(args), returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(system_router.executor, "run", fake_run)

    response = client.post(
        "/api/v1/system/self-update",
        headers=headers,
        json={
            "branch": "main",
            "install_backend_dependencies": False,
            "run_migrations": False,
            "rebuild_frontend": False,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["branch"] == "main"
    assert len(payload["steps"]) == 3
    assert calls[0][0] == ["git", "fetch", "origin"]
    assert calls[1][0] == ["git", "checkout", "main"]
    assert calls[2][0] == ["git", "pull", "--ff-only", "origin", "main"]


def test_create_project_assigns_auto_domain(client, monkeypatch) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    from app import config as app_config

    monkeypatch.setattr(app_config.settings, "domain_auto_enabled", True)
    monkeypatch.setattr(app_config.settings, "domain_base_domain", "apps.example.com")

    response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "auto-domain-project",
            "git_url": "https://example.com/auto-domain-project.git",
            "local_path": "/srv/apps/auto-domain-project",
            "tech_stack": "node",
            "internal_port": 8090,
            "start_command": "npm start",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["domain"] == "auto-domain-project.apps.example.com"


def test_custom_domain_records_and_validation_flow(client, monkeypatch) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    create_response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "domain-wizard",
            "git_url": "https://example.com/domain-wizard.git",
            "local_path": "/srv/apps/domain-wizard",
            "tech_stack": "node",
            "internal_port": 8091,
            "start_command": "npm start",
            "domain": "app.example.com",
        },
    )
    assert create_response.status_code == 201, create_response.text
    project_id = create_response.json()["id"]

    plan_response = client.get(
        f"/api/v1/projects/{project_id}/domain/plan?mode=custom&domain=app.example.com",
        headers=headers,
    )
    assert plan_response.status_code == 200, plan_response.text
    planned_records = plan_response.json()["records"]
    assert len(planned_records) >= 2

    save_response = client.put(
        f"/api/v1/projects/{project_id}/domain/records",
        headers=headers,
        json={
            "domain": "app.example.com",
            "records": [
                {"record_type": "A", "host": "@", "value": "203.0.113.10", "ttl": 300},
                {"record_type": "CNAME", "host": "www", "value": "app.example.com", "ttl": 300},
            ],
        },
    )
    assert save_response.status_code == 200, save_response.text
    assert save_response.json()["domain"] == "app.example.com"
    assert len(save_response.json()["records"]) == 2

    from app.routers import projects as projects_router

    def fake_resolver(record_type: str, fqdn: str) -> list[str]:
        if record_type == "A" and fqdn == "app.example.com":
            return ["203.0.113.10"]
        if record_type == "CNAME" and fqdn == "www.app.example.com":
            return ["app.example.com"]
        return []

    monkeypatch.setattr(projects_router, "_resolve_dns_values", fake_resolver)

    validate_response = client.post(f"/api/v1/projects/{project_id}/domain/validate", headers=headers)
    assert validate_response.status_code == 200, validate_response.text
    assert validate_response.json()["all_matched"] is True


def test_ssl_status_endpoint_with_mock(client, monkeypatch) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    create_response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "ssl-status-project",
            "git_url": "https://example.com/ssl-status-project.git",
            "local_path": "/srv/apps/ssl-status-project",
            "tech_stack": "node",
            "internal_port": 8092,
            "start_command": "npm start",
            "domain": "ssl-status.example.com",
        },
    )
    assert create_response.status_code == 201, create_response.text
    project_id = create_response.json()["id"]

    from app.routers import projects as projects_router

    monkeypatch.setattr(
        projects_router.ssl_service,
        "certificate_status",
        lambda domain: {
            "domain": domain,
            "certificate_present": True,
            "expires_at": "2030-01-01 00:00:00+00:00",
            "days_remaining": 1000,
            "issuer": "Fake CA",
            "raw_output": "ok",
        },
    )

    response = client.get(f"/api/v1/projects/{project_id}/ssl/status", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["certificate_present"] is True
    assert payload["issuer"] == "Fake CA"


def test_system_info_endpoint(client) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    response = client.get("/api/v1/system/info", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "app_name" in payload
    assert "services" in payload
    assert isinstance(payload["services"], list)


def test_preview_deployment_and_type_filter(client, monkeypatch) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    create_response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "preview-project",
            "git_url": "https://example.com/preview-project.git",
            "local_path": "/srv/apps/preview-project",
            "tech_stack": "node",
            "internal_port": 8093,
            "start_command": "npm start",
        },
    )
    assert create_response.status_code == 201, create_response.text
    project_id = create_response.json()["id"]

    from app.routers import projects as projects_router

    monkeypatch.setattr(projects_router.executor, "deploy", lambda plan, stream=None: None)

    deploy_response = client.post(
        f"/api/v1/projects/{project_id}/deploy",
        headers=headers,
        json={"branch": "feature/pr-123", "deployment_type": "preview"},
    )
    assert deploy_response.status_code == 202, deploy_response.text

    list_response = client.get(
        f"/api/v1/projects/{project_id}/deployments?deployment_type=preview",
        headers=headers,
    )
    assert list_response.status_code == 200, list_response.text
    rows = list_response.json()
    assert len(rows) >= 1
    assert rows[0]["deployment_type"] == "preview"
    assert rows[0]["branch"] == "feature/pr-123"


def test_preview_deployment_remove_endpoint(client, monkeypatch) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    create_response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "preview-remove-project",
            "git_url": "https://example.com/preview-remove-project.git",
            "local_path": "/srv/apps/preview-remove-project",
            "tech_stack": "node",
            "internal_port": 8094,
            "start_command": "npm start",
        },
    )
    assert create_response.status_code == 201, create_response.text
    project_id = create_response.json()["id"]

    from app.routers import projects as projects_router

    monkeypatch.setattr(projects_router.executor, "deploy", lambda plan, stream=None: None)
    monkeypatch.setattr(projects_router.executor, "pm2_delete", lambda app_name: None)

    deploy_response = client.post(
        f"/api/v1/projects/{project_id}/deploy",
        headers=headers,
        json={"branch": "feature/remove-me", "deployment_type": "preview"},
    )
    assert deploy_response.status_code == 202, deploy_response.text

    preview_rows = client.get(
        f"/api/v1/projects/{project_id}/deployments?deployment_type=preview",
        headers=headers,
    ).json()
    deployment_id = preview_rows[0]["id"]

    remove_response = client.delete(f"/api/v1/projects/{project_id}/deployments/{deployment_id}", headers=headers)
    assert remove_response.status_code == 204, remove_response.text

    preview_after = client.get(
        f"/api/v1/projects/{project_id}/deployments?deployment_type=preview",
        headers=headers,
    )
    assert preview_after.status_code == 200, preview_after.text
    assert preview_after.json() == []


def test_preview_deployment_promote_endpoint_creates_production_deploy(client, monkeypatch) -> None:
    bootstrap_admin(client)
    headers = login_and_get_headers(client)

    create_response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "service_type": "web",
            "name": "preview-promote-project",
            "git_url": "https://example.com/preview-promote-project.git",
            "local_path": "/srv/apps/preview-promote-project",
            "tech_stack": "node",
            "internal_port": 8095,
            "start_command": "npm start",
        },
    )
    assert create_response.status_code == 201, create_response.text
    project_id = create_response.json()["id"]

    from app.routers import projects as projects_router

    monkeypatch.setattr(projects_router.executor, "deploy", lambda plan, stream=None: None)

    deploy_response = client.post(
        f"/api/v1/projects/{project_id}/deploy",
        headers=headers,
        json={"branch": "feature/promote-me", "deployment_type": "preview"},
    )
    assert deploy_response.status_code == 202, deploy_response.text

    preview_rows = client.get(
        f"/api/v1/projects/{project_id}/deployments?deployment_type=preview",
        headers=headers,
    ).json()
    deployment_id = preview_rows[0]["id"]

    promote_response = client.post(f"/api/v1/projects/{project_id}/deployments/{deployment_id}/promote", headers=headers)
    assert promote_response.status_code == 202, promote_response.text

    production_rows = client.get(
        f"/api/v1/projects/{project_id}/deployments?deployment_type=production",
        headers=headers,
    )
    assert production_rows.status_code == 200, production_rows.text
    assert len(production_rows.json()) == 1
