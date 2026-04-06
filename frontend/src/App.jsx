import { useEffect, useMemo, useState } from "react";

import {
  deployProject,
  getMe,
  getProjectLogs,
  listProjects,
  login,
  restartProject,
} from "./services/api";
import { createProjectLogsSocket } from "./services/ws";

const TOKEN_KEY = "deployer_token";

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
          {project.tech_stack} • port {project.internal_port} • {project.domain || "domain yok"} •
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

  if (!token) {
    return (
      <div className="auth-shell">
        <form className="auth-card" onSubmit={handleLogin}>
          <h1>Deployer</h1>
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
