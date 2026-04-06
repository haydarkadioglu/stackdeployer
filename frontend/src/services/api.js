const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

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

export async function listProjects(token) {
  return request("/api/v1/projects", { token });
}

export async function getProjectLogs(token, projectId, limit = 200) {
  return request(`/api/v1/projects/${projectId}/logs?limit=${limit}`, { token });
}

export async function deployProject(token, projectId) {
  return request(`/api/v1/projects/${projectId}/deploy`, {
    method: "POST",
    token,
  });
}

export async function restartProject(token, projectId) {
  return request(`/api/v1/projects/${projectId}/restart`, {
    method: "POST",
    token,
  });
}

export { API_BASE_URL };
