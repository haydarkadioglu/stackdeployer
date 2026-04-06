import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import {
  applyNginxRoute,
  createProject,
  deployProject,
  getMe,
  getProjectLogs,
  listProjects,
  login,
  removeNginxRoute,
  restartProject,
  startProject,
  stopProject,
} from "./services/api";
import { createProjectLogsSocket } from "./services/ws";

const TOKEN_KEY = "stackdeployer_token";

function formatWhen(value) {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function formatLogLine(log) {
  const stamp = formatWhen(log.created_at);
  const source = log.source || "system";
  const message = log.message || "";
  return `[ ${stamp} ] [${source}] ${message}`;
}

function StatusBadge({ status }) {
  return <span className={`status status-${status || "unknown"}`}>{status || "unknown"}</span>;
}

function ActionButton({ label, onClick, busy, disabled }) {
  return (
    <button type="button" className="ghost-btn" onClick={onClick} disabled={disabled || busy}>
      {busy ? `${label}...` : label}
    </button>
  );
}

function ProjectCard({ project, busyAction, onAction }) {
  return (
    <article className={`project-row ${project.status === "building" ? "project-building" : ""}`}>
      <div className="project-main">
        <div className="project-title-wrap">
          <h3>{project.name}</h3>
          <StatusBadge status={project.status} />
        </div>
        <p>
          {project.tech_stack} • {project.service_type} • {project.internal_port ? `port ${project.internal_port}` : "no port"} • {project.domain || "domain yok"} • {" "}
          {formatWhen(project.updated_at)}
        </p>
      </div>

      <div className="project-actions">
        <ActionButton
          label="start"
          busy={busyAction === `start:${project.id}`}
          disabled={project.status === "running"}
          onClick={() => onAction("start", project)}
        />
        <ActionButton
          label="stop"
          busy={busyAction === `stop:${project.id}`}
          disabled={project.status === "stopped"}
          onClick={() => onAction("stop", project)}
        />
        <ActionButton
          label="restart"
          busy={busyAction === `restart:${project.id}`}
          onClick={() => onAction("restart", project)}
        />
        <ActionButton
          label="deploy"
          busy={busyAction === `deploy:${project.id}`}
          onClick={() => onAction("deploy", project)}
        />
      </div>
    </article>
  );
}

function ProjectsPage({
  projects,
  newProject,
  creatingProject,
  busyAction,
  onField,
  onCreate,
  onAction,
}) {
  return (
    <>
      <section className="project-section">
        <h2>CREATE PROJECT</h2>
        <form className="project-form" onSubmit={onCreate}>
          <select
            value={newProject.service_type}
            onChange={(event) => onField("service_type", event.target.value)}
          >
            <option value="web">web service</option>
            <option value="worker">worker service</option>
          </select>
          <input
            placeholder="name"
            value={newProject.name}
            onChange={(event) => onField("name", event.target.value)}
            required
          />
          <input
            placeholder="git url"
            value={newProject.git_url}
            onChange={(event) => onField("git_url", event.target.value)}
            required
          />
          <input
            placeholder="local path (example: /srv/apps/myapp)"
            value={newProject.local_path}
            onChange={(event) => onField("local_path", event.target.value)}
            required
          />
          <input
            placeholder="tech stack (node/python/other)"
            value={newProject.tech_stack}
            onChange={(event) => onField("tech_stack", event.target.value)}
            required
          />
          <input
            placeholder="start command (example: npm start)"
            value={newProject.start_command}
            onChange={(event) => onField("start_command", event.target.value)}
          />
          <input
            placeholder="build command (optional)"
            value={newProject.build_command}
            onChange={(event) => onField("build_command", event.target.value)}
          />
          <input
            placeholder={newProject.service_type === "web" ? "internal port (required)" : "internal port (optional)"}
            type="number"
            min="1"
            max="65535"
            value={newProject.internal_port}
            onChange={(event) => onField("internal_port", event.target.value)}
            required={newProject.service_type === "web"}
          />
          <input
            placeholder="domain (web only)"
            value={newProject.domain}
            onChange={(event) => onField("domain", event.target.value)}
            disabled={newProject.service_type === "worker"}
          />
          <button type="submit" className="auth-btn" disabled={creatingProject}>
            {creatingProject ? "creating..." : "create project"}
          </button>
        </form>

        <h2>PROJECTS ({projects.length})</h2>
        <div className="project-list">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} busyAction={busyAction} onAction={onAction} />
          ))}
        </div>
      </section>
    </>
  );
}

function LogsPage({
  projects,
  activeProjectId,
  setActiveProjectId,
  logLines,
  wsConnected,
}) {
  return (
    <section className="log-section">
      <h2>LIVE DEPLOYMENT LOGS</h2>
      <div className="project-form" style={{ marginBottom: 10 }}>
        <select
          value={activeProjectId || ""}
          onChange={(event) => setActiveProjectId(Number(event.target.value))}
        >
          <option value="" disabled>
            select project
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <input value={wsConnected ? "socket connected" : "socket disconnected"} readOnly />
      </div>
      <div className="terminal">
        {logLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {!logLines.length ? <p>[ waiting for log stream ]</p> : null}
      </div>
    </section>
  );
}

function MonitorPage({ projects, busyAction, onAction }) {
  const summary = useMemo(() => {
    const total = projects.length || 1;
    const running = projects.filter((p) => p.status === "running").length;
    const building = projects.filter((p) => p.status === "building").length;
    const stopped = projects.filter((p) => p.status === "stopped").length;
    return {
      running,
      building,
      stopped,
      runningPct: Math.round((running / total) * 100),
      buildingPct: Math.round((building / total) * 100),
      stoppedPct: Math.round((stopped / total) * 100),
    };
  }, [projects]);

  return (
    <>
      <section className="stats-grid">
        <div className="metric-card">
          <span>RUNNING</span>
          <strong>{summary.running}</strong>
          <small>projects • %{summary.runningPct}</small>
        </div>
        <div className="metric-card">
          <span>BUILDING</span>
          <strong>{summary.building}</strong>
          <small>projects • %{summary.buildingPct}</small>
        </div>
        <div className="metric-card">
          <span>STOPPED</span>
          <strong>{summary.stopped}</strong>
          <small>projects • %{summary.stoppedPct}</small>
        </div>
      </section>

      <section className="project-section">
        <h2>PROJECT STATUS</h2>
        <div className="project-list">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} busyAction={busyAction} onAction={onAction} />
          ))}
        </div>
      </section>
    </>
  );
}

function NginxPage({ token, projects, onRefresh, setError }) {
  const webProjects = projects.filter((project) => project.service_type === "web");
  const [projectId, setProjectId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId && webProjects.length) {
      setProjectId(String(webProjects[0].id));
    }
  }, [projectId, webProjects]);

  async function handleApply(event) {
    event.preventDefault();
    try {
      setBusy(true);
      setError("");
      await applyNginxRoute(token, Number(projectId), {
        site_name: siteName.trim(),
        domain: domain.trim(),
      });
      await onRefresh();
    } catch (err) {
      setError(err.message || "Nginx apply failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    try {
      setBusy(true);
      setError("");
      await removeNginxRoute(token, Number(projectId), siteName.trim());
      await onRefresh();
    } catch (err) {
      setError(err.message || "Nginx remove failed");
    } finally {
      setBusy(false);
    }
  }

  if (!webProjects.length) {
    return (
      <section className="project-section">
        <h2>NGINX ROUTES</h2>
        <div className="error-banner">No web service project found. Create a web project first.</div>
      </section>
    );
  }

  return (
    <section className="project-section">
      <h2>NGINX ROUTES</h2>
      <form className="project-form" onSubmit={handleApply}>
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
          {webProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <input
          placeholder="site name (example: api-backend)"
          value={siteName}
          onChange={(event) => setSiteName(event.target.value)}
          required
        />
        <input
          placeholder="domain (example: api.example.com)"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          required
        />
        <button type="submit" className="auth-btn" disabled={busy}>
          {busy ? "applying..." : "apply route"}
        </button>
        <button type="button" className="ghost-btn" disabled={busy || !siteName.trim()} onClick={handleRemove}>
          remove route
        </button>
      </form>
      <div className="project-list">
        {webProjects.map((project) => (
          <article key={project.id} className="project-row">
            <div className="project-main">
              <div className="project-title-wrap">
                <h3>{project.name}</h3>
                <StatusBadge status={project.status} />
              </div>
              <p>{project.domain || "no domain assigned"}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [me, setMe] = useState(null);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [newProject, setNewProject] = useState({
    service_type: "web",
    name: "",
    git_url: "",
    local_path: "",
    internal_port: "",
    tech_stack: "node",
    start_command: "",
    build_command: "",
    domain: "",
  });

  useEffect(() => {
    if (!token) {
      setMe(null);
      setProjects([]);
      setActiveProjectId(null);
      return;
    }

    let cancelled = false;

    async function loadInitial() {
      try {
        setError("");
        const [meData, projectData] = await Promise.all([getMe(token), listProjects(token)]);
        if (!cancelled) {
          setMe(meData);
          setProjects(projectData || []);
          if (projectData?.length) {
            setActiveProjectId((current) => current || projectData[0].id);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Authentication failed");
          setToken("");
          localStorage.removeItem(TOKEN_KEY);
        }
      }
    }

    loadInitial();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !activeProjectId) {
      setLogLines([]);
      setWsConnected(false);
      return undefined;
    }

    let socket;
    let mounted = true;

    async function loadLogsAndConnect() {
      try {
        const initialLogs = await getProjectLogs(token, activeProjectId, 120);
        if (mounted) {
          const ordered = [...(initialLogs || [])].reverse();
          setLogLines(ordered.map((log) => formatLogLine(log)));
        }
      } catch (err) {
        if (mounted) {
          setError(err.message || "Log fetch failed");
        }
      }

      if (!mounted) {
        return;
      }

      socket = createProjectLogsSocket({
        projectId: activeProjectId,
        token,
        onOpen: () => setWsConnected(true),
        onClose: () => setWsConnected(false),
        onError: () => setWsConnected(false),
        onMessage: (payload) => {
          setLogLines((prev) => [...prev, formatLogLine(payload)].slice(-500));
        },
      });
    }

    loadLogsAndConnect();

    return () => {
      mounted = false;
      setWsConnected(false);
      if (socket && socket.readyState < 2) {
        socket.close();
      }
    };
  }, [token, activeProjectId]);

  async function refreshProjects() {
    const data = await listProjects(token);
    setProjects(data || []);
    if (activeProjectId && !(data || []).some((item) => item.id === activeProjectId)) {
      setActiveProjectId(data?.[0]?.id || null);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    try {
      setError("");
      const result = await login(username, password);
      localStorage.setItem(TOKEN_KEY, result.access_token);
      setToken(result.access_token);
      setPassword("");
    } catch (err) {
      setError(err.message || "Login failed");
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setLogLines([]);
    setWsConnected(false);
  }

  function updateNewProjectField(key, value) {
    setNewProject((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreateProject(event) {
    event.preventDefault();

    try {
      setError("");
      setCreatingProject(true);

      const payload = {
        service_type: newProject.service_type,
        name: newProject.name.trim(),
        git_url: newProject.git_url.trim(),
        local_path: newProject.local_path.trim(),
        tech_stack: newProject.tech_stack.trim(),
        build_command: newProject.build_command.trim() || null,
        start_command: newProject.start_command.trim() || null,
        domain: newProject.domain.trim() || null,
        internal_port:
          newProject.service_type === "web" && newProject.internal_port
            ? Number(newProject.internal_port)
            : null,
      };

      if (newProject.service_type === "worker") {
        payload.domain = null;
      }

      const created = await createProject(token, payload);
      await refreshProjects();
      if (created) {
        setActiveProjectId(created.id);
      }

      setNewProject((prev) => ({
        ...prev,
        name: "",
        git_url: "",
        local_path: "",
        internal_port: "",
        start_command: "",
        build_command: "",
        domain: "",
      }));
    } catch (err) {
      setError(err.message || "Project creation failed");
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleProjectAction(action, project) {
    try {
      setError("");
      setBusyAction(`${action}:${project.id}`);

      if (action === "deploy") {
        await deployProject(token, project.id);
      } else if (action === "restart") {
        await restartProject(token, project.id);
      } else if (action === "start") {
        await startProject(token, project.id);
      } else if (action === "stop") {
        await stopProject(token, project.id);
      }

      await refreshProjects();
    } catch (err) {
      setError(err.message || `${action} failed`);
    } finally {
      setBusyAction("");
    }
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <form className="auth-card" onSubmit={handleLogin}>
          <h1>StackDeployer</h1>
          <p>Control plane girisi</p>
          <label htmlFor="username">username</label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
          <label htmlFor="password">password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          {error ? <p className="error-text">{error}</p> : null}
          <button type="submit" className="auth-btn">
            sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="window-dots" aria-hidden="true">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
        </div>
        <div className="host-text">{window.location.host} • {me?.username || "admin"}</div>
        <div className={`connection-pill ${wsConnected ? "is-up" : "is-down"}`}>
          {wsConnected ? "connected" : "disconnected"}
        </div>
      </header>

      <div className="layout-grid">
        <aside className="sidebar">
          <div className="menu-group">
            <p>PANEL</p>
            <NavLink to="/projects" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              Projects
            </NavLink>
            <NavLink to="/logs" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              Logs
            </NavLink>
          </div>

          <div className="menu-group">
            <p>SYSTEM</p>
            <NavLink to="/monitor" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              Monitor
            </NavLink>
            <NavLink to="/nginx" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              Nginx
            </NavLink>
            <button type="button" className="menu-item danger-item" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        </aside>

        <main className="content">
          {error ? <div className="error-banner">{error}</div> : null}

          <Routes>
            <Route
              path="/projects"
              element={
                <ProjectsPage
                  projects={projects}
                  newProject={newProject}
                  creatingProject={creatingProject}
                  busyAction={busyAction}
                  onField={updateNewProjectField}
                  onCreate={handleCreateProject}
                  onAction={handleProjectAction}
                />
              }
            />
            <Route
              path="/logs"
              element={
                <LogsPage
                  projects={projects}
                  activeProjectId={activeProjectId}
                  setActiveProjectId={setActiveProjectId}
                  logLines={logLines}
                  wsConnected={wsConnected}
                />
              }
            />
            <Route
              path="/monitor"
              element={<MonitorPage projects={projects} busyAction={busyAction} onAction={handleProjectAction} />}
            />
            <Route
              path="/nginx"
              element={
                <NginxPage token={token} projects={projects} onRefresh={refreshProjects} setError={setError} />
              }
            />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
