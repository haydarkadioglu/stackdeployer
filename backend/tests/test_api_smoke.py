from __future__ import annotations


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
