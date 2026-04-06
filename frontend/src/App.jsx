import React, { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

import {
  applyNginxRoute,
  createProject,
  createProjectEnvironment,
  deleteProjectEnvironment,
  deployProject,
  getMe,
  getNextPort,
  getProject,
  getProjectLogs,
  listProjectDeployments,
  listProjectEnvironment,
  listProjects,
  login,
  removeNginxRoute,
  restartProject,
  startProject,
  stopProject,
  updateProject,
  updateProjectEnvironment,
} from "./services/api";
import { createProjectLogsSocket } from "./services/ws";

const TOKEN_KEY = "stackdeployer_token";
const TABS = ["deployments", "logs", "env", "domain", "settings"];

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

function AuthScreen({ error, username, setUsername, password, setPassword, onLogin }) {
  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={onLogin}>
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

function ProjectsIndexPage({
  projects,
  busyAction,
  newProject,
  setNewProject,
  creatingProject,
  onCreate,
  onAction,
}) {
  const navigate = useNavigate();

  return (
    <section className="project-section">
      <h2>CREATE PROJECT</h2>
      <form className="project-form" onSubmit={onCreate}>
        <select
          value={newProject.service_type}
          onChange={(event) => setNewProject((prev) => ({ ...prev, service_type: event.target.value }))}
        >
          <option value="web">web service</option>
          <option value="worker">worker service</option>
        </select>
        <input
          placeholder="name"
          value={newProject.name}
          onChange={(event) => setNewProject((prev) => ({ ...prev, name: event.target.value }))}
          required
        />
        <input
          placeholder="git url"
          value={newProject.git_url}
          onChange={(event) => setNewProject((prev) => ({ ...prev, git_url: event.target.value }))}
          required
        />
        <input
          placeholder="local path (example: /srv/apps/myapp)"
          value={newProject.local_path}
          onChange={(event) => setNewProject((prev) => ({ ...prev, local_path: event.target.value }))}
          required
        />
        <input
          placeholder="tech stack (node/python/other)"
          value={newProject.tech_stack}
          onChange={(event) => setNewProject((prev) => ({ ...prev, tech_stack: event.target.value }))}
          required
        />
        <input
          placeholder="start command (optional, can be auto)"
          value={newProject.start_command}
          onChange={(event) => setNewProject((prev) => ({ ...prev, start_command: event.target.value }))}
        />
        <input
          placeholder="build command (optional)"
          value={newProject.build_command}
          onChange={(event) => setNewProject((prev) => ({ ...prev, build_command: event.target.value }))}
        />
        <input
          placeholder="internal port (optional, auto if empty)"
          type="number"
          min="1"
          max="65535"
          value={newProject.internal_port}
          onChange={(event) => setNewProject((prev) => ({ ...prev, internal_port: event.target.value }))}
        />
        <input
          placeholder="domain (web only)"
          value={newProject.domain}
          onChange={(event) => setNewProject((prev) => ({ ...prev, domain: event.target.value }))}
          disabled={newProject.service_type === "worker"}
        />
        <button type="submit" className="auth-btn" disabled={creatingProject}>
          {creatingProject ? "creating..." : "create project"}
        </button>
      </form>

      <h2>PROJECTS ({projects.length})</h2>
      <div className="project-list">
        {projects.map((project) => (
          <article key={project.id} className={`project-row ${project.status === "building" ? "project-building" : ""}`}>
            <div className="project-main">
              <div className="project-title-wrap">
                <h3>{project.name}</h3>
                <StatusBadge status={project.status} />
              </div>
              <p>
                {project.tech_stack} • {project.service_type} • {project.internal_port ? `port ${project.internal_port}` : "no port"} • {project.domain || "no domain"}
              </p>
            </div>
            <div className="project-actions">
              <button className="ghost-btn" type="button" onClick={() => navigate(`/projects/${project.id}`)}>
                open
              </button>
              <button className="ghost-btn" type="button" onClick={() => onAction("deploy", project)} disabled={busyAction === `deploy:${project.id}`}>
                deploy
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProjectTabs({ projectId }) {
  return (
    <div className="tab-nav">
      {TABS.map((tab) => (
        <NavLink
          key={tab}
          to={`/projects/${projectId}/${tab}`}
          className={({ isActive }) => `tab-link ${isActive ? "active" : ""}`}
        >
          {tab}
        </NavLink>
      ))}
    </div>
  );
}

function ProjectDetailPage({ token, refreshProjects, onAction, busyAction, setGlobalError }) {
  const params = useParams();
  const navigate = useNavigate();
  const projectId = Number(params.projectId);
  const tab = params.tab || "deployments";

  const [project, setProject] = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [logLines, setLogLines] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [envRows, setEnvRows] = useState([]);
  const [envForm, setEnvForm] = useState({ key: "", value: "", is_secret: false });
  const [domainForm, setDomainForm] = useState({ site_name: "", domain: "" });
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    tech_stack: "",
    build_command: "",
    start_command: "",
    local_path: "",
    internal_port: "",
  });
  const [nextPort, setNextPort] = useState(null);

  useEffect(() => {
    if (!Number.isInteger(projectId) || projectId < 1) {
      navigate("/projects", { replace: true });
      return;
    }

    if (!TABS.includes(tab)) {
      navigate(`/projects/${projectId}/deployments`, { replace: true });
    }
  }, [projectId, tab, navigate]);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      try {
        const data = await getProject(token, projectId);
        if (cancelled) {
          return;
        }
        setProject(data);
        setDomainForm((prev) => ({
          ...prev,
          domain: data.domain || "",
          site_name: prev.site_name || data.name,
        }));
        setSettingsForm({
          name: data.name || "",
          tech_stack: data.tech_stack || "",
          build_command: data.build_command || "",
          start_command: data.start_command || "",
          local_path: data.local_path || "",
          internal_port: data.internal_port || "",
        });
      } catch (err) {
        setGlobalError(err.message || "Project load failed");
      }
    }

    loadProject();
    return () => {
      cancelled = true;
    };
  }, [token, projectId, setGlobalError]);

  useEffect(() => {
    if (!project) {
      return;
    }

    async function loadTabData() {
      try {
        if (tab === "deployments") {
          setDeployments(await listProjectDeployments(token, projectId, 50));
        } else if (tab === "env") {
          setEnvRows(await listProjectEnvironment(token, projectId));
        } else if (tab === "settings") {
          const next = await getNextPort(token, 8000);
          setNextPort(next?.next_port || null);
        }
      } catch (err) {
        setGlobalError(err.message || "Tab data load failed");
      }
    }

    loadTabData();
  }, [project, tab, token, projectId, setGlobalError]);

  useEffect(() => {
    if (tab !== "logs") {
      setWsConnected(false);
      return undefined;
    }

    let socket;
    let mounted = true;

    async function connectLogs() {
      try {
        const initialLogs = await getProjectLogs(token, projectId, 120);
        if (mounted) {
          const ordered = [...(initialLogs || [])].reverse();
          setLogLines(ordered.map((log) => formatLogLine(log)));
        }
      } catch (err) {
        if (mounted) {
          setGlobalError(err.message || "Log fetch failed");
        }
      }

      if (!mounted) {
        return;
      }

      socket = createProjectLogsSocket({
        projectId,
        token,
        onOpen: () => setWsConnected(true),
        onClose: () => setWsConnected(false),
        onError: () => setWsConnected(false),
        onMessage: (payload) => {
          setLogLines((prev) => [...prev, formatLogLine(payload)].slice(-500));
        },
      });
    }

    connectLogs();
    return () => {
      mounted = false;
      setWsConnected(false);
      if (socket && socket.readyState < 2) {
        socket.close();
      }
    };
  }, [tab, token, projectId, setGlobalError]);

  async function reloadProjectAndList() {
    await refreshProjects();
    const fresh = await getProject(token, projectId);
    setProject(fresh);
  }

  async function handleHeaderAction(action) {
    if (!project) {
      return;
    }
    await onAction(action, project);
    await reloadProjectAndList();
    if (tab === "deployments") {
      setDeployments(await listProjectDeployments(token, projectId, 50));
    }
  }

  async function handleCreateEnv(event) {
    event.preventDefault();
    try {
      await createProjectEnvironment(token, projectId, envForm);
      setEnvRows(await listProjectEnvironment(token, projectId));
      setEnvForm({ key: "", value: "", is_secret: false });
    } catch (err) {
      setGlobalError(err.message || "Env create failed");
    }
  }

  async function handleToggleSecret(row) {
    try {
      await updateProjectEnvironment(token, projectId, row.id, { is_secret: !row.is_secret });
      setEnvRows(await listProjectEnvironment(token, projectId));
    } catch (err) {
      setGlobalError(err.message || "Env update failed");
    }
  }

  async function handleDeleteEnv(row) {
    try {
      await deleteProjectEnvironment(token, projectId, row.id);
      setEnvRows(await listProjectEnvironment(token, projectId));
    } catch (err) {
      setGlobalError(err.message || "Env delete failed");
    }
  }

  async function handleApplyDomain(event) {
    event.preventDefault();
    try {
      await applyNginxRoute(token, projectId, domainForm);
      await reloadProjectAndList();
    } catch (err) {
      setGlobalError(err.message || "Domain apply failed");
    }
  }

  async function handleRemoveDomain() {
    try {
      await removeNginxRoute(token, projectId, domainForm.site_name || project.name);
      await updateProject(token, projectId, { domain: null });
      await reloadProjectAndList();
    } catch (err) {
      setGlobalError(err.message || "Domain remove failed");
    }
  }

  async function handleSaveSettings(event) {
    event.preventDefault();
    try {
      await updateProject(token, projectId, {
        name: settingsForm.name.trim(),
        tech_stack: settingsForm.tech_stack.trim(),
        build_command: settingsForm.build_command.trim() || null,
        start_command: settingsForm.start_command.trim() || null,
        local_path: settingsForm.local_path.trim(),
        internal_port: settingsForm.internal_port ? Number(settingsForm.internal_port) : null,
      });
      await reloadProjectAndList();
    } catch (err) {
      setGlobalError(err.message || "Settings save failed");
    }
  }

  if (!project) {
    return <section className="project-section"><h2>loading project...</h2></section>;
  }

  return (
    <section className="project-section">
      <div className="detail-header">
        <div>
          <h2>{project.name}</h2>
          <p className="detail-meta">
            {project.tech_stack} • {project.service_type} • port {project.internal_port || "auto"} • {project.domain || "no domain"}
          </p>
        </div>
        <div className="project-actions">
          <button className="ghost-btn" type="button" onClick={() => handleHeaderAction("start")} disabled={busyAction === `start:${project.id}`}>
            start
          </button>
          <button className="ghost-btn" type="button" onClick={() => handleHeaderAction("stop")} disabled={busyAction === `stop:${project.id}`}>
            stop
          </button>
          <button className="ghost-btn" type="button" onClick={() => handleHeaderAction("restart")} disabled={busyAction === `restart:${project.id}`}>
            restart
          </button>
          <button className="ghost-btn" type="button" onClick={() => handleHeaderAction("deploy")} disabled={busyAction === `deploy:${project.id}`}>
            deploy
          </button>
        </div>
      </div>

      <ProjectTabs projectId={projectId} />

      {tab === "deployments" ? (
        <div className="project-list">
          {deployments.map((item) => (
            <article key={item.id} className="project-row">
              <div className="project-main">
                <div className="project-title-wrap">
                  <h3>deployment #{item.id}</h3>
                  <StatusBadge status={item.status} />
                </div>
                <p>branch: {item.branch} • started: {formatWhen(item.started_at)} • finished: {formatWhen(item.completed_at)}</p>
                {item.error_message ? <p className="error-text">{item.error_message}</p> : null}
              </div>
            </article>
          ))}
          {!deployments.length ? <div className="error-banner">No deployments yet.</div> : null}
        </div>
      ) : null}

      {tab === "logs" ? (
        <>
          <div className="detail-meta">socket: {wsConnected ? "connected" : "disconnected"}</div>
          <div className="terminal">
            {logLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {!logLines.length ? <p>[ waiting for log stream ]</p> : null}
          </div>
        </>
      ) : null}

      {tab === "env" ? (
        <>
          <form className="project-form" onSubmit={handleCreateEnv}>
            <input
              placeholder="key"
              value={envForm.key}
              onChange={(event) => setEnvForm((prev) => ({ ...prev, key: event.target.value }))}
              required
            />
            <input
              placeholder="value"
              value={envForm.value}
              onChange={(event) => setEnvForm((prev) => ({ ...prev, value: event.target.value }))}
              required
            />
            <select
              value={envForm.is_secret ? "secret" : "plain"}
              onChange={(event) => setEnvForm((prev) => ({ ...prev, is_secret: event.target.value === "secret" }))}
            >
              <option value="plain">plain</option>
              <option value="secret">secret</option>
            </select>
            <button type="submit" className="auth-btn">add env</button>
          </form>

          <div className="project-list">
            {envRows.map((row) => (
              <article key={row.id} className="project-row">
                <div className="project-main">
                  <div className="project-title-wrap">
                    <h3>{row.key}</h3>
                    <StatusBadge status={row.is_secret ? "secret" : "plain"} />
                  </div>
                  <p>{row.value}</p>
                </div>
                <div className="project-actions">
                  <button className="ghost-btn" type="button" onClick={() => handleToggleSecret(row)}>
                    toggle secret
                  </button>
                  <button className="ghost-btn" type="button" onClick={() => handleDeleteEnv(row)}>
                    delete
                  </button>
                </div>
              </article>
            ))}
            {!envRows.length ? <div className="error-banner">No environment variables yet.</div> : null}
          </div>
        </>
      ) : null}

      {tab === "domain" ? (
        <form className="project-form" onSubmit={handleApplyDomain}>
          <input
            placeholder="site name"
            value={domainForm.site_name}
            onChange={(event) => setDomainForm((prev) => ({ ...prev, site_name: event.target.value }))}
            required
          />
          <input
            placeholder="domain"
            value={domainForm.domain}
            onChange={(event) => setDomainForm((prev) => ({ ...prev, domain: event.target.value }))}
            required
          />
          <button type="submit" className="auth-btn">apply route</button>
          <button type="button" className="ghost-btn" onClick={handleRemoveDomain}>remove route</button>
        </form>
      ) : null}

      {tab === "settings" ? (
        <form className="project-form" onSubmit={handleSaveSettings}>
          <input
            placeholder="name"
            value={settingsForm.name}
            onChange={(event) => setSettingsForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
          <input
            placeholder="tech stack"
            value={settingsForm.tech_stack}
            onChange={(event) => setSettingsForm((prev) => ({ ...prev, tech_stack: event.target.value }))}
            required
          />
          <input
            placeholder="local path"
            value={settingsForm.local_path}
            onChange={(event) => setSettingsForm((prev) => ({ ...prev, local_path: event.target.value }))}
            required
          />
          <input
            placeholder={`internal port (next auto: ${nextPort || "..."})`}
            value={settingsForm.internal_port}
            onChange={(event) => setSettingsForm((prev) => ({ ...prev, internal_port: event.target.value }))}
          />
          <input
            placeholder="build command"
            value={settingsForm.build_command}
            onChange={(event) => setSettingsForm((prev) => ({ ...prev, build_command: event.target.value }))}
          />
          <input
            placeholder="start command"
            value={settingsForm.start_command}
            onChange={(event) => setSettingsForm((prev) => ({ ...prev, start_command: event.target.value }))}
          />
          <button type="submit" className="auth-btn">save settings</button>
        </form>
      ) : null}
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

  async function refreshProjects() {
    const data = await listProjects(token);
    setProjects(data || []);
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
  }

  async function handleCreateProject(event) {
    event.preventDefault();
    try {
      setError("");
      setCreatingProject(true);
      await createProject(token, {
        service_type: newProject.service_type,
        name: newProject.name.trim(),
        git_url: newProject.git_url.trim(),
        local_path: newProject.local_path.trim(),
        tech_stack: newProject.tech_stack.trim(),
        build_command: newProject.build_command.trim() || null,
        start_command: newProject.start_command.trim() || null,
        domain: newProject.domain.trim() || null,
        internal_port: newProject.internal_port ? Number(newProject.internal_port) : null,
      });
      await refreshProjects();
      setNewProject({
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
      <AuthScreen
        error={error}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        onLogin={handleLogin}
      />
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
        <button type="button" className="connection-pill is-down" onClick={handleLogout}>sign out</button>
      </header>

      <div className="layout-grid">
        <aside className="sidebar">
          <div className="menu-group">
            <p>PROJECTS</p>
            <NavLink to="/projects" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              All Projects
            </NavLink>
          </div>
          <div className="menu-group">
            <p>QUICK LINKS</p>
            {projects.slice(0, 8).map((project) => (
              <Link key={project.id} to={`/projects/${project.id}`} className="menu-item">
                {project.name}
              </Link>
            ))}
          </div>
        </aside>

        <main className="content">
          {error ? <div className="error-banner">{error}</div> : null}
          <Routes>
            <Route
              path="/projects"
              element={
                <ProjectsIndexPage
                  projects={projects}
                  busyAction={busyAction}
                  newProject={newProject}
                  setNewProject={setNewProject}
                  creatingProject={creatingProject}
                  onCreate={handleCreateProject}
                  onAction={handleProjectAction}
                />
              }
            />
            <Route
              path="/projects/:projectId"
              element={<Navigate to="deployments" replace />}
            />
            <Route
              path="/projects/:projectId/:tab"
              element={
                <ProjectDetailPage
                  token={token}
                  refreshProjects={refreshProjects}
                  onAction={handleProjectAction}
                  busyAction={busyAction}
                  setGlobalError={setError}
                />
              }
            />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
