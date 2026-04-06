const LOCAL_DEV_API_BASE_URL = "http://127.0.0.1:8001";

function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) {
    return configured;
  }

  if (typeof window === "undefined") {
    return LOCAL_DEV_API_BASE_URL;
  }

  const origin = window.location.origin;
  if (origin.includes(":5173")) {
    return LOCAL_DEV_API_BASE_URL;
  }

  return origin;
}

const API_BASE_URL = resolveApiBaseUrl().replace(/\/$/, "");

async function request(path, { method = "GET", token, body } = {}) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = payload.detail || payload.message || message;
    } catch (_error) {
      // Keep generic message if response body is not JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function login(username, password) {
  return request("/api/v1/auth/login", {
    method: "POST",
    body: { username, password },
  });
}

export async function getMe(token) {
  return request("/api/v1/auth/me", { token });
}

export async function updateMeCredentials(token, payload) {
  return request("/api/v1/auth/me", {
    method: "PATCH",
    token,
    body: payload,
  });
}

export async function listProjects(token) {
  return request("/api/v1/projects", { token });
}

export async function getProject(token, projectId) {
  return request(`/api/v1/projects/${projectId}`, { token });
}

export async function createProject(token, payload) {
  return request("/api/v1/projects", {
    method: "POST",
    token,
    body: payload,
  });
}

export async function getProjectLogs(token, projectId, limit = 200) {
  return request(`/api/v1/projects/${projectId}/logs?limit=${limit}`, { token });
}

export async function listProjectDeployments(token, projectId, limit = 50, deploymentType = "all") {
  const query = new URLSearchParams({ limit: String(limit) });
  if (deploymentType && deploymentType !== "all") {
    query.set("deployment_type", deploymentType);
  }
  return request(`/api/v1/projects/${projectId}/deployments?${query.toString()}`, { token });
}

export async function listProjectEnvironment(token, projectId, revealSecrets = false) {
  return request(`/api/v1/projects/${projectId}/env?reveal_secrets=${revealSecrets}`, { token });
}

export async function createProjectEnvironment(token, projectId, payload) {
  return request(`/api/v1/projects/${projectId}/env`, {
    method: "POST",
    token,
    body: payload,
  });
}

export async function updateProjectEnvironment(token, projectId, envId, payload) {
  return request(`/api/v1/projects/${projectId}/env/${envId}`, {
    method: "PATCH",
    token,
    body: payload,
  });
}

export async function deleteProjectEnvironment(token, projectId, envId) {
  return request(`/api/v1/projects/${projectId}/env/${envId}`, {
    method: "DELETE",
    token,
  });
}

export async function updateProject(token, projectId, payload) {
  return request(`/api/v1/projects/${projectId}`, {
    method: "PATCH",
    token,
    body: payload,
  });
}

export async function getNextPort(token, startPort = 8000) {
  return request(`/api/v1/projects/ports/next?start_port=${startPort}`, { token });
}

export async function analyzeProjectImport(token, payload) {
  return request("/api/v1/projects/import/analyze", {
    method: "POST",
    token,
    body: payload,
  });
}

export async function listImportPaths(token) {
  return request("/api/v1/projects/import/paths", { token });
}

export async function deployProject(token, projectId, payload) {
  return request(`/api/v1/projects/${projectId}/deploy`, {
    method: "POST",
    token,
    body: payload,
  });
}

export async function restartProject(token, projectId) {
  return request(`/api/v1/projects/${projectId}/restart`, {
    method: "POST",
    token,
  });
}

export async function startProject(token, projectId) {
  return request(`/api/v1/projects/${projectId}/start`, {
    method: "POST",
    token,
  });
}

export async function stopProject(token, projectId) {
  return request(`/api/v1/projects/${projectId}/stop`, {
    method: "POST",
    token,
  });
}

export async function applyNginxRoute(token, projectId, payload) {
  return request(`/api/v1/projects/${projectId}/nginx/apply`, {
    method: "POST",
    token,
    body: payload,
  });
}

export async function removeNginxRoute(token, projectId, siteName) {
  return request(`/api/v1/projects/${projectId}/nginx/${encodeURIComponent(siteName)}`, {
    method: "DELETE",
    token,
  });
}

export async function getProjectSSLStatus(token, projectId) {
  return request(`/api/v1/projects/${projectId}/ssl/status`, { token });
}

export async function getDomainPlan(token, projectId, mode, domain) {
  const query = new URLSearchParams({ mode });
  if (domain) {
    query.set("domain", domain);
  }
  return request(`/api/v1/projects/${projectId}/domain/plan?${query.toString()}`, { token });
}

export async function listDomainRecords(token, projectId) {
  return request(`/api/v1/projects/${projectId}/domain/records`, { token });
}

export async function saveDomainRecords(token, projectId, payload) {
  return request(`/api/v1/projects/${projectId}/domain/records`, {
    method: "PUT",
    token,
    body: payload,
  });
}

export async function validateDomainRecords(token, projectId) {
  return request(`/api/v1/projects/${projectId}/domain/validate`, {
    method: "POST",
    token,
  });
}

export async function runSelfUpdate(token, payload) {
  return request("/api/v1/system/self-update", {
    method: "POST",
    token,
    body: payload,
  });
}

export async function getSystemInfo(token) {
  return request("/api/v1/system/info", { token });
}

export { API_BASE_URL };
