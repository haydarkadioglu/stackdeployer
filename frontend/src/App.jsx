import React, { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";

import {
  analyzeProjectImport,
  cloneImportRepository,
  createProject,
  deleteProject,
  deployProject,
  getMe,
  getSystemInfo,
  listImportPaths,
  listProjects,
  login,
  restartProject,
  startProject,
  stopProject,
} from "./services/api";
import AuthScreen from "./components/AuthScreen";
import { TOKEN_KEY } from "./constants";

const AccountPage = React.lazy(() => import("./pages/AccountPage"));
const GeneralSettingsPage = React.lazy(() => import("./pages/GeneralSettingsPage"));
const NewProjectPage = React.lazy(() => import("./pages/NewProjectPage"));
const ProjectDetailPage = React.lazy(() => import("./pages/ProjectDetailPage"));
const ProjectsIndexPage = React.lazy(() => import("./pages/ProjectsIndexPage"));
const SystemDashboardPage = React.lazy(() => import("./pages/SystemDashboardPage"));

const SuspenseFallback = () => (
  <div className="lazy-loader">
    <div className="spinner"></div>
  </div>
);

export default function App() {
  const location = useLocation();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [me, setMe] = useState(null);
  const [projects, setProjects] = useState([]);
  const [systemInfo, setSystemInfo] = useState(null);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analyzedInfo, setAnalyzedInfo] = useState(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [importPaths, setImportPaths] = useState([]);
  const [loadingImportPaths, setLoadingImportPaths] = useState(false);
  const [cloningImport, setCloningImport] = useState(false);
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
    setError("");
  }, [location.pathname]);

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
          getSystemInfo(token).then((payload) => {
            if (!cancelled) {
              setSystemInfo(payload);
            }
          }).catch(() => {
            if (!cancelled) {
              setSystemInfo(null);
            }
          });
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
      setAnalyzedInfo(null);
      setWizardStep(1);
      return true;
    } catch (err) {
      setError(err.message || "Project creation failed");
      return false;
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleAnalyzeImport() {
    try {
      setError("");
      setAnalyzeBusy(true);
      const analyzed = await analyzeProjectImport(token, {
        git_url: newProject.git_url.trim() || null,
        local_path: newProject.local_path.trim() || null,
        tech_stack: newProject.tech_stack.trim() || null,
        service_type: newProject.service_type,
      });
      setAnalyzedInfo(analyzed);

      setNewProject((prev) => ({
        ...prev,
        name: prev.name || analyzed.suggested_project_name || "",
        local_path: prev.local_path || analyzed.suggested_local_paths?.[0] || "",
        tech_stack: analyzed.detected_stack || prev.tech_stack,
        build_command: prev.build_command || analyzed.suggested_build_command || "",
        start_command: prev.start_command || analyzed.suggested_start_command || "",
        internal_port: prev.internal_port || String(analyzed.suggested_port || ""),
      }));
    } catch (err) {
      setError(err.message || "Analyze failed");
    } finally {
      setAnalyzeBusy(false);
    }
  }

  async function handleLoadImportPaths(basePath = "") {
    try {
      setError("");
      setLoadingImportPaths(true);
      const result = await listImportPaths(token, basePath, 1);
      setImportPaths(result?.discovered_paths || []);
      if (!newProject.local_path && result?.discovered_paths?.length) {
        setNewProject((prev) => ({ ...prev, local_path: result.discovered_paths[0] }));
      }
    } catch (err) {
      setError(err.message || "Path scan failed");
    } finally {
      setLoadingImportPaths(false);
    }
  }

  async function handleCloneImport(targetPath) {
    try {
      setError("");
      setCloningImport(true);
      const normalizedPath = (targetPath || "").trim();
      if (normalizedPath.length < 2) {
        throw new Error("local path is required for clone");
      }

      const result = await cloneImportRepository(token, {
        git_url: newProject.git_url.trim(),
        local_path: normalizedPath,
        branch: "main",
      });

      setImportPaths(result?.discovered_paths || []);
      setNewProject((prev) => ({
        ...prev,
        local_path: normalizedPath,
      }));
      return true;
    } catch (err) {
      setError(err.message || "Repository clone failed");
      return false;
    } finally {
      setCloningImport(false);
    }
  }

  function applyStackPreset(stackValue) {
    const normalized = (stackValue || "").toLowerCase();
    const suggestedPort = Number(newProject.internal_port || analyzedInfo?.suggested_port || 8000);

    setNewProject((prev) => {
      const next = { ...prev, tech_stack: normalized || prev.tech_stack };

      if (normalized === "python") {
        if (!next.start_command) {
          next.start_command = analyzedInfo?.suggested_start_command || `uvicorn app.main:app --host 0.0.0.0 --port ${suggestedPort}`;
        }
        if (!next.build_command) {
          next.build_command = analyzedInfo?.suggested_build_command || "";
        }
      } else if (normalized === "node") {
        if (!next.build_command) {
          next.build_command = "npm run build";
        }
        if (!next.start_command) {
          next.start_command = next.service_type === "worker" ? "node worker.js" : "npm start";
        }
      }

      return next;
    });
  }

  function applySuggestedName() {
    if (!analyzedInfo?.suggested_project_name) {
      return;
    }
    setNewProject((prev) => ({
      ...prev,
      name: analyzedInfo.suggested_project_name,
    }));
  }

  async function handleProjectAction(action, project, options = {}) {
    try {
      setError("");
      setBusyAction(`${action}:${project.id}`);
      if (action === "deploy") {
        await deployProject(token, project.id, {
          branch: options.branch || "main",
          deployment_type: options.deployment_type || "production",
        });
      } else if (action === "restart") {
        await restartProject(token, project.id);
      } else if (action === "start") {
        await startProject(token, project.id);
      } else if (action === "stop") {
        await stopProject(token, project.id);
      } else if (action === "delete") {
        await deleteProject(token, project.id);
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
        <div className="host-text">{window.location.host} | {me?.username || "admin"}</div>
        <button type="button" className="connection-pill is-down" onClick={handleLogout}>sign out</button>
      </header>

      <div className="layout-grid">
        <aside className="sidebar">
          <div className="menu-group">
            <p>PROJECTS</p>
            <NavLink to="/projects" end className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              All Projects
            </NavLink>
            <NavLink to="/account" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              Account
            </NavLink>
            <NavLink to="/settings/general" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              General Settings
            </NavLink>
            <NavLink to="/system/dashboard" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              System Dashboard
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
          <React.Suspense fallback={<SuspenseFallback />}>
            <Routes>
            <Route
              path="/projects"
              element={
                <ProjectsIndexPage
                  projects={projects}
                  systemInfo={systemInfo}
                  busyAction={busyAction}
                  onAction={handleProjectAction}
                />
              }
            />
            <Route
              path="/projects/new"
              element={
                <NewProjectPage
                  projects={projects}
                  newProject={newProject}
                  setNewProject={setNewProject}
                  creatingProject={creatingProject}
                  onCreate={handleCreateProject}
                  onAnalyze={handleAnalyzeImport}
                  analyzeBusy={analyzeBusy}
                  analyzedInfo={analyzedInfo}
                  wizardStep={wizardStep}
                  setWizardStep={setWizardStep}
                  importPaths={importPaths}
                  loadingImportPaths={loadingImportPaths}
                  cloningImport={cloningImport}
                  onLoadImportPaths={handleLoadImportPaths}
                  onCloneImport={handleCloneImport}
                  onStackPreset={applyStackPreset}
                  onApplySuggestedName={applySuggestedName}
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
            <Route
              path="/account"
              element={<AccountPage token={token} me={me} setMe={setMe} setGlobalError={setError} />}
            />
            <Route
              path="/settings/general"
              element={<GeneralSettingsPage token={token} setGlobalError={setError} />}
            />
            <Route
              path="/system/dashboard"
              element={<SystemDashboardPage systemInfo={systemInfo} />}
            />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </React.Suspense>
        </main>
      </div>
    </div>
  );
}
