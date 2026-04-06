import React, { useEffect, useMemo, useState } from "react";

import {
  createProject,
  deployProject,
  getMe,
  getProjectLogs,
  listProjects,
  login,
  restartProject,
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

function ProjectRow({ project, onLogs, onRestart, onDeploy, busyAction }) {
  const disabled = project.status === "building";

  return (
    <article className={`project-row ${disabled ? "project-building" : ""}`}>
      <div className="project-main">
        <div className="project-title-wrap">
          <h3>{project.name}</h3>
          <StatusBadge status={project.status} />
        </div>
        <p>
          {project.tech_stack} • {project.service_type} • {project.internal_port ? `port ${project.internal_port}` : "no port"} • {project.domain || "domain yok"} •
          {" "}
          {formatWhen(project.updated_at)}
        </p>
      </div>

      <div className="project-actions">
        <button type="button" className="ghost-btn" onClick={() => onLogs(project)}>
          logs
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={disabled || busyAction === `restart:${project.id}`}
          onClick={() => onRestart(project)}
        >
          restart
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={disabled || busyAction === `deploy:${project.id}`}
          onClick={() => onDeploy(project)}
        >
          deploy
        </button>
      </div>
    </article>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [me, setMe] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
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

  useEffect(() => {
    if (!token) {
      setMe(null);
      setProjects([]);
      setActiveProject(null);
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
          if (!activeProject && projectData?.length) {
            setActiveProject(projectData[0]);
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
    if (!token || !activeProject) {
      setLogLines([]);
      return undefined;
    }

    let socket;
    let mounted = true;

    async function loadLogsAndConnect() {
      try {
        const initialLogs = await getProjectLogs(token, activeProject.id, 120);
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
        projectId: activeProject.id,
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
  }, [token, activeProject?.id]);

  async function refreshProjects() {
    const data = await listProjects(token);
    setProjects(data || []);
    if (activeProject) {
      const latest = (data || []).find((item) => item.id === activeProject.id);
      if (latest) {
        setActiveProject(latest);
      }
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
    setWsConnected(false);
    setLogLines([]);
  }

  async function handleRestart(project) {
    try {
      setBusyAction(`restart:${project.id}`);
      await restartProject(token, project.id);
      await refreshProjects();
    } catch (err) {
      setError(err.message || "Restart failed");
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeploy(project) {
    try {
      setBusyAction(`deploy:${project.id}`);
      await deployProject(token, project.id);
      await refreshProjects();
    } catch (err) {
      setError(err.message || "Deploy failed");
    } finally {
      setBusyAction("");
    }
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
        setActiveProject(created);
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
        <div className="host-text">deploy.yourdomain.com • {me?.username || "admin"}</div>
        <div className={`connection-pill ${wsConnected ? "is-up" : "is-down"}`}>
          {wsConnected ? "connected" : "disconnected"}
        </div>
      </header>

      <div className="layout-grid">
        <aside className="sidebar">
          <div className="menu-group">
            <p>PANEL</p>
            <a className="menu-item active">Projects</a>
            <a className="menu-item">Logs</a>
            <a className="menu-item">Env Editor</a>
          </div>

          <div className="menu-group">
            <p>SYSTEM</p>
            <a className="menu-item">Monitor</a>
            <a className="menu-item">Nginx</a>
            <button type="button" className="menu-item danger-item" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        </aside>

        <main className="content">
          {error ? <div className="error-banner">{error}</div> : null}

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
            <h2>CREATE PROJECT</h2>
            <form className="project-form" onSubmit={handleCreateProject}>
              <select
                value={newProject.service_type}
                onChange={(event) => updateNewProjectField("service_type", event.target.value)}
              >
                <option value="web">web service</option>
                <option value="worker">worker service</option>
              </select>
              <input
                placeholder="name"
                value={newProject.name}
                onChange={(event) => updateNewProjectField("name", event.target.value)}
                required
              />
              <input
                placeholder="git url"
                value={newProject.git_url}
                onChange={(event) => updateNewProjectField("git_url", event.target.value)}
                required
              />
              <input
                placeholder="local path (example: /srv/apps/myapp)"
                value={newProject.local_path}
                onChange={(event) => updateNewProjectField("local_path", event.target.value)}
                required
              />
              <input
                placeholder="tech stack (node/python/other)"
                value={newProject.tech_stack}
                onChange={(event) => updateNewProjectField("tech_stack", event.target.value)}
                required
              />
              <input
                placeholder="start command (example: npm start)"
                value={newProject.start_command}
                onChange={(event) => updateNewProjectField("start_command", event.target.value)}
              />
              <input
                placeholder="build command (optional)"
                value={newProject.build_command}
                onChange={(event) => updateNewProjectField("build_command", event.target.value)}
              />
              <input
                placeholder={newProject.service_type === "web" ? "internal port (required)" : "internal port (optional)"}
                type="number"
                min="1"
                max="65535"
                value={newProject.internal_port}
                onChange={(event) => updateNewProjectField("internal_port", event.target.value)}
                required={newProject.service_type === "web"}
              />
              <input
                placeholder="domain (web only)"
                value={newProject.domain}
                onChange={(event) => updateNewProjectField("domain", event.target.value)}
                disabled={newProject.service_type === "worker"}
              />
              <button type="submit" className="auth-btn" disabled={creatingProject}>
                {creatingProject ? "creating..." : "create project"}
              </button>
            </form>

            <h2>PROJECTS ({projects.length})</h2>
            <div className="project-list">
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  busyAction={busyAction}
                  onLogs={(p) => setActiveProject(p)}
                  onRestart={handleRestart}
                  onDeploy={handleDeploy}
                />
              ))}
            </div>
          </section>

          <section className="log-section">
            <h2>LIVE DEPLOYMENT LOG — {activeProject?.name || "NO PROJECT SELECTED"}</h2>
            <div className="terminal">
              {logLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {!logLines.length ? <p>[ waiting for log stream ]</p> : null}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
