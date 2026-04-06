import React, { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

import {
  analyzeProjectImport,
  applyNginxRoute,
  createProject,
  createProjectEnvironment,
  deleteProjectEnvironment,
  deployProject,
  getMe,
  getDomainPlan,
  getNextPort,
  getProject,
  getProjectLogs,
  listDomainRecords,
  listImportPaths,
  listProjectDeployments,
  listProjectEnvironment,
  listProjects,
  login,
  removeNginxRoute,
  restartProject,
  runSelfUpdate,
  saveDomainRecords,
  startProject,
  stopProject,
  updateMeCredentials,
  updateProject,
  updateProjectEnvironment,
  validateDomainRecords,
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

function formatDuration(startedAt, completedAt) {
  if (!startedAt) {
    return "n/a";
  }
  const start = new Date(startedAt).valueOf();
  const end = completedAt ? new Date(completedAt).valueOf() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "n/a";
  }

  const totalSeconds = Math.round((end - start) / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function isLikelyDomain(value) {
  if (!value) {
    return false;
  }
  return /^(?!-)[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(value);
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
  onAnalyze,
  analyzeBusy,
  analyzedInfo,
  wizardStep,
  setWizardStep,
  importPaths,
  loadingImportPaths,
  importFilter,
  setImportFilter,
  onLoadImportPaths,
  onStackPreset,
  onApplySuggestedName,
}) {
  const navigate = useNavigate();
  const [stepError, setStepError] = useState("");

  const isPython = (newProject.tech_stack || "").toLowerCase() === "python";
  const existingProjectPaths = new Set(projects.map((project) => project.local_path));
  const analyzedConflicts = new Set(analyzedInfo?.conflicting_paths || []);
  const selectedPathConflict = existingProjectPaths.has(newProject.local_path) || analyzedConflicts.has(newProject.local_path);

  const importErrors = [];
  if (newProject.name.trim().length <= 1) {
    importErrors.push("project name is required");
  }
  if (newProject.git_url.trim().length <= 3) {
    importErrors.push("git url is required");
  }
  if (newProject.local_path.trim().length <= 1) {
    importErrors.push("local path is required");
  }
  if (selectedPathConflict) {
    importErrors.push("selected local path is already used");
  }

  const runtimeErrors = [];
  if (newProject.tech_stack.trim().length <= 1) {
    runtimeErrors.push("tech stack is required");
  }

  function canContinueFromImport() {
    return importErrors.length === 0;
  }

  function canContinueFromRuntime() {
    return runtimeErrors.length === 0;
  }

  function goNext() {
    if (wizardStep === 1 && !canContinueFromImport()) {
      setStepError(importErrors[0] || "Import step has validation errors.");
      return;
    }
    if (wizardStep === 2 && !canContinueFromRuntime()) {
      setStepError(runtimeErrors[0] || "Runtime step has validation errors.");
      return;
    }
    setStepError("");
    setWizardStep((prev) => Math.min(prev + 1, 3));
  }

  function goPrev() {
    setStepError("");
    setWizardStep((prev) => Math.max(prev - 1, 1));
  }

  return (
    <section className="project-section">
      <h2>CREATE PROJECT (WIZARD)</h2>
      <div className="wizard-steps" role="tablist" aria-label="create project steps">
        <button type="button" className={`wizard-step ${wizardStep === 1 ? "active" : ""}`} onClick={() => setWizardStep(1)}>
          1. Import
        </button>
        <button type="button" className={`wizard-step ${wizardStep === 2 ? "active" : ""}`} onClick={() => setWizardStep(2)}>
          2. Runtime
        </button>
        <button type="button" className={`wizard-step ${wizardStep === 3 ? "active" : ""}`} onClick={() => setWizardStep(3)}>
          3. Review
        </button>
      </div>

      <form className="project-form" onSubmit={onCreate}>
        {wizardStep === 1 ? (
          <>
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
            {analyzedInfo?.suggested_project_name ? (
              <div className="wizard-inline-help">
                <span>suggested name: {analyzedInfo.suggested_project_name}</span>
                <button type="button" className="ghost-btn" onClick={onApplySuggestedName}>
                  use suggestion
                </button>
              </div>
            ) : null}
            <button type="button" className="ghost-btn" onClick={onAnalyze} disabled={analyzeBusy}>
              {analyzeBusy ? "analyzing..." : "analyze import"}
            </button>
            <button type="button" className="ghost-btn" onClick={onLoadImportPaths} disabled={loadingImportPaths}>
              {loadingImportPaths ? "loading paths..." : "scan local paths"}
            </button>
            {importPaths.length ? (
              <input
                placeholder="filter discovered paths"
                value={importFilter}
                onChange={(event) => setImportFilter(event.target.value)}
              />
            ) : null}
            {importPaths.length ? (
              <select
                value={newProject.local_path}
                onChange={(event) => setNewProject((prev) => ({ ...prev, local_path: event.target.value }))}
              >
                {importPaths
                  .filter((path) => path.toLowerCase().includes(importFilter.trim().toLowerCase()))
                  .slice(0, 120)
                  .map((path) => (
                    <option key={path} value={path} disabled={existingProjectPaths.has(path) || analyzedConflicts.has(path)}>
                      {path}{existingProjectPaths.has(path) || analyzedConflicts.has(path) ? " (in use)" : ""}
                    </option>
                  ))}
              </select>
            ) : null}
            {analyzedInfo?.suggested_local_paths?.length ? (
              <select
                value={newProject.local_path}
                onChange={(event) => setNewProject((prev) => ({ ...prev, local_path: event.target.value }))}
              >
                {analyzedInfo.suggested_local_paths.map((path) => (
                  <option key={path} value={path} disabled={existingProjectPaths.has(path) || analyzedConflicts.has(path)}>
                    {path}{existingProjectPaths.has(path) || analyzedConflicts.has(path) ? " (in use)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                placeholder="local path (example: /srv/apps/myapp)"
                value={newProject.local_path}
                onChange={(event) => setNewProject((prev) => ({ ...prev, local_path: event.target.value }))}
                required
              />
            )}
            {analyzedInfo ? (
              <input
                value={`stack=${analyzedInfo.detected_stack || "unknown"} framework=${analyzedInfo.detected_python_framework || "n/a"} next_port=${analyzedInfo.suggested_port}`}
                readOnly
              />
            ) : null}
            {analyzedInfo?.suggested_project_name ? (
              <input value={`suggested project name=${analyzedInfo.suggested_project_name}`} readOnly />
            ) : null}
            {selectedPathConflict ? (
              <div className="error-banner">Selected local path already belongs to an existing project.</div>
            ) : null}
            {analyzedInfo?.conflicting_paths?.length ? (
              <div className="error-banner">Analyzer detected conflicting paths: {analyzedInfo.conflicting_paths.join(", ")}</div>
            ) : null}
            {importErrors.length ? (
              <div className="wizard-field-errors">
                {importErrors.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {wizardStep === 2 ? (
          <>
            <select
              value={newProject.tech_stack}
              onChange={(event) => onStackPreset(event.target.value)}
              required
            >
              <option value="node">node</option>
              <option value="python">python</option>
              <option value="other">other</option>
            </select>
            <input
              placeholder="build command (optional)"
              value={newProject.build_command}
              onChange={(event) => setNewProject((prev) => ({ ...prev, build_command: event.target.value }))}
            />
            {isPython ? (
              <input value={newProject.start_command || "auto-generated for detected python framework"} readOnly />
            ) : (
              <input
                placeholder="start command (optional, can be auto)"
                value={newProject.start_command}
                onChange={(event) => setNewProject((prev) => ({ ...prev, start_command: event.target.value }))}
              />
            )}
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
            {runtimeErrors.length ? (
              <div className="wizard-field-errors">
                {runtimeErrors.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {wizardStep === 3 ? (
          <>
            <input value={`name=${newProject.name}`} readOnly />
            <input value={`service=${newProject.service_type}`} readOnly />
            <input value={`repo=${newProject.git_url}`} readOnly />
            <input value={`path=${newProject.local_path}`} readOnly />
            <input value={`stack=${newProject.tech_stack}`} readOnly />
            <input value={`build=${newProject.build_command || "(none)"}`} readOnly />
            <input value={`start=${newProject.start_command || "(auto)"}`} readOnly />
            <input value={`port=${newProject.internal_port || "auto"}`} readOnly />
            <input value={`domain=${newProject.domain || "(none)"}`} readOnly />
          </>
        ) : null}

        <div className="wizard-nav">
          {stepError ? <div className="wizard-error">{stepError}</div> : null}
          <button type="button" className="ghost-btn" onClick={goPrev} disabled={wizardStep === 1}>
            back
          </button>
          {wizardStep < 3 ? (
            <button type="button" className="ghost-btn" onClick={goNext}>
              next
            </button>
          ) : (
            <button type="submit" className="auth-btn" disabled={creatingProject || importErrors.length > 0 || runtimeErrors.length > 0}>
              {creatingProject ? "creating..." : "create project"}
            </button>
          )}
        </div>
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
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [editingEnvId, setEditingEnvId] = useState(null);
  const [editingEnvValue, setEditingEnvValue] = useState("");
  const [envForm, setEnvForm] = useState({ key: "", value: "", is_secret: false });
  const [domainForm, setDomainForm] = useState({ site_name: "", domain: "" });
  const [domainMode, setDomainMode] = useState("auto");
  const [dnsRecords, setDnsRecords] = useState([]);
  const [domainValidation, setDomainValidation] = useState(null);
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    tech_stack: "",
    build_command: "",
    start_command: "",
    local_path: "",
    internal_port: "",
  });
  const [nextPort, setNextPort] = useState(null);
  const [initialSettingsSnapshot, setInitialSettingsSnapshot] = useState("");

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
        setInitialSettingsSnapshot(JSON.stringify({
          name: data.name || "",
          tech_stack: data.tech_stack || "",
          build_command: data.build_command || "",
          start_command: data.start_command || "",
          local_path: data.local_path || "",
          internal_port: data.internal_port || "",
        }));
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
          setEnvRows(await listProjectEnvironment(token, projectId, revealSecrets));
        } else if (tab === "domain") {
          const recordsPayload = await listDomainRecords(token, projectId);
          setDnsRecords(recordsPayload?.records || []);
        } else if (tab === "settings") {
          const next = await getNextPort(token, 8000);
          setNextPort(next?.next_port || null);
        }
      } catch (err) {
        setGlobalError(err.message || "Tab data load failed");
      }
    }

    loadTabData();
  }, [project, tab, token, projectId, setGlobalError, revealSecrets]);

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
      setEnvRows(await listProjectEnvironment(token, projectId, revealSecrets));
      setEnvForm({ key: "", value: "", is_secret: false });
    } catch (err) {
      setGlobalError(err.message || "Env create failed");
    }
  }

  async function handleToggleSecret(row) {
    try {
      await updateProjectEnvironment(token, projectId, row.id, { is_secret: !row.is_secret });
      setEnvRows(await listProjectEnvironment(token, projectId, revealSecrets));
    } catch (err) {
      setGlobalError(err.message || "Env update failed");
    }
  }

  async function handleDeleteEnv(row) {
    try {
      await deleteProjectEnvironment(token, projectId, row.id);
      setEnvRows(await listProjectEnvironment(token, projectId, revealSecrets));
    } catch (err) {
      setGlobalError(err.message || "Env delete failed");
    }
  }

  async function handleSaveEnvValue(row) {
    try {
      await updateProjectEnvironment(token, projectId, row.id, { value: editingEnvValue });
      setEditingEnvId(null);
      setEditingEnvValue("");
      setEnvRows(await listProjectEnvironment(token, projectId, revealSecrets));
    } catch (err) {
      setGlobalError(err.message || "Env value save failed");
    }
  }

  function handleDnsRecordChange(index, key, value) {
    setDnsRecords((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  }

  function addDnsRecord() {
    setDnsRecords((prev) => [...prev, { record_type: "A", host: "@", value: "", ttl: 300 }]);
  }

  function removeDnsRecord(index) {
    setDnsRecords((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }

  async function handleGenerateDomainPlan() {
    try {
      const plan = await getDomainPlan(token, projectId, domainMode, domainForm.domain.trim() || undefined);
      setDomainForm((prev) => ({ ...prev, domain: plan.domain }));
      setDnsRecords(plan.records || []);
      setDomainValidation(null);
    } catch (err) {
      setGlobalError(err.message || "Domain plan generation failed");
    }
  }

  async function handleSaveDomainRecords() {
    try {
      const payload = await saveDomainRecords(token, projectId, {
        domain: domainForm.domain.trim(),
        records: dnsRecords.map((row) => ({
          record_type: row.record_type,
          host: (row.host || "").trim(),
          value: (row.value || "").trim(),
          ttl: Number(row.ttl || 300),
        })),
      });
      setDnsRecords(payload?.records || []);
      setDomainValidation(null);
      await reloadProjectAndList();
    } catch (err) {
      setGlobalError(err.message || "Saving domain records failed");
    }
  }

  async function handleValidateDomainRecords() {
    try {
      const result = await validateDomainRecords(token, projectId);
      setDomainValidation(result);
      const refreshed = await listDomainRecords(token, projectId);
      setDnsRecords(refreshed?.records || []);
    } catch (err) {
      setGlobalError(err.message || "Domain validation failed");
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
      setInitialSettingsSnapshot(JSON.stringify(settingsForm));
    } catch (err) {
      setGlobalError(err.message || "Settings save failed");
    }
  }

  const isSettingsDirty = initialSettingsSnapshot && JSON.stringify(settingsForm) !== initialSettingsSnapshot;
  const domainValid = isLikelyDomain(domainForm.domain);

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
                <p>
                  branch: {item.branch} • started: {formatWhen(item.started_at)} • finished: {formatWhen(item.completed_at)} • duration: {formatDuration(item.started_at, item.completed_at)}
                </p>
                {item.error_message ? <p className="error-text">{item.error_message}</p> : null}
              </div>
              <div className="project-actions">
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => handleHeaderAction("deploy")}
                  disabled={busyAction === `deploy:${project.id}`}
                >
                  retry deploy
                </button>
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
          <div className="project-actions" style={{ marginBottom: 10 }}>
            <button className="ghost-btn" type="button" onClick={() => setRevealSecrets((prev) => !prev)}>
              {revealSecrets ? "hide secrets" : "reveal secrets"}
            </button>
          </div>
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
                  {editingEnvId === row.id ? (
                    <input
                      value={editingEnvValue}
                      onChange={(event) => setEditingEnvValue(event.target.value)}
                    />
                  ) : (
                    <p>{row.value}</p>
                  )}
                </div>
                <div className="project-actions">
                  {editingEnvId === row.id ? (
                    <>
                      <button className="ghost-btn" type="button" onClick={() => handleSaveEnvValue(row)}>
                        save
                      </button>
                      <button className="ghost-btn" type="button" onClick={() => { setEditingEnvId(null); setEditingEnvValue(""); }}>
                        cancel
                      </button>
                    </>
                  ) : (
                    <button className="ghost-btn" type="button" onClick={() => { setEditingEnvId(row.id); setEditingEnvValue(row.value); }}>
                      edit
                    </button>
                  )}
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
        <>
          <div className="wizard-inline-help" style={{ marginBottom: 10 }}>
            <span>current domain: {project.domain || "not configured"} • service type: {project.service_type}</span>
          </div>
          {project.service_type !== "web" ? (
            <div className="error-banner">Domain mapping is only available for web services.</div>
          ) : null}
          {!domainValid && domainForm.domain ? (
            <div className="error-banner">Domain format looks invalid. Example: api.example.com</div>
          ) : null}
          <form className="project-form" onSubmit={(event) => event.preventDefault()}>
            <select value={domainMode} onChange={(event) => setDomainMode(event.target.value)}>
              <option value="auto">auto domain</option>
              <option value="custom">custom domain</option>
            </select>
            <input
              placeholder="domain"
              value={domainForm.domain}
              onChange={(event) => setDomainForm((prev) => ({ ...prev, domain: event.target.value }))}
              required={domainMode === "custom"}
            />
            <button type="button" className="ghost-btn" onClick={handleGenerateDomainPlan} disabled={project.service_type !== "web"}>
              generate dns plan
            </button>
            <button type="button" className="ghost-btn" onClick={addDnsRecord} disabled={project.service_type !== "web"}>
              add dns record
            </button>
          </form>

          {dnsRecords.length ? (
            <div className="project-list" style={{ marginBottom: 12 }}>
              {dnsRecords.map((row, index) => (
                <article key={`${row.id || "new"}-${index}`} className="project-row">
                  <div className="project-main">
                    <div className="project-title-wrap">
                      <h3>dns record #{index + 1}</h3>
                      <StatusBadge status={row.is_verified ? "running" : "unknown"} />
                    </div>
                    <div className="project-form" style={{ marginTop: 8, marginBottom: 0, padding: 0, border: "none", background: "transparent" }}>
                      <select value={row.record_type} onChange={(event) => handleDnsRecordChange(index, "record_type", event.target.value)}>
                        <option value="A">A</option>
                        <option value="CNAME">CNAME</option>
                      </select>
                      <input
                        placeholder="name/host (example: @, www)"
                        value={row.host || ""}
                        onChange={(event) => handleDnsRecordChange(index, "host", event.target.value)}
                      />
                      <input
                        placeholder="value/target"
                        value={row.value || ""}
                        onChange={(event) => handleDnsRecordChange(index, "value", event.target.value)}
                      />
                      <input
                        placeholder="ttl"
                        type="number"
                        min="60"
                        max="86400"
                        value={row.ttl || 300}
                        onChange={(event) => handleDnsRecordChange(index, "ttl", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="project-actions">
                    <button className="ghost-btn" type="button" onClick={() => removeDnsRecord(index)}>
                      remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          <div className="project-actions" style={{ marginBottom: 12 }}>
            <button type="button" className="ghost-btn" onClick={handleSaveDomainRecords} disabled={project.service_type !== "web" || !domainValid}>
              save dns records
            </button>
            <button type="button" className="ghost-btn" onClick={handleValidateDomainRecords} disabled={project.service_type !== "web" || !domainValid}>
              validate dns
            </button>
          </div>

          {domainValidation ? (
            <div className="terminal" style={{ marginBottom: 12 }}>
              <p>[domain validation] {domainValidation.all_matched ? "all records matched" : "some records mismatched"}</p>
              {(domainValidation.records || []).map((row) => (
                <p key={`${row.record_type}-${row.fqdn}-${row.expected}`}>
                  {row.record_type} {row.fqdn} expected={row.expected} actual=[{(row.actual_values || []).join(", ") || "none"}] matched={String(row.matched)}
                </p>
              ))}
            </div>
          ) : null}

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
              disabled={project.service_type !== "web"}
            />
            <button type="submit" className="auth-btn" disabled={project.service_type !== "web" || !domainValid}>
              apply route
            </button>
            <button type="button" className="ghost-btn" onClick={handleRemoveDomain} disabled={project.service_type !== "web"}>
              remove route
            </button>
          </form>
        </>
      ) : null}

      {tab === "settings" ? (
        <>
          {isSettingsDirty ? (
            <div className="wizard-field-errors">
              <p>You have unsaved settings changes.</p>
            </div>
          ) : null}
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
            <button type="submit" className="auth-btn" disabled={!isSettingsDirty}>save settings</button>
          </form>
        </>
      ) : null}
    </section>
  );
}

function AccountPage({ token, me, setMe, setGlobalError }) {
  const [form, setForm] = useState({
    current_password: "",
    new_username: me?.username || "",
    new_password: "",
    confirm_password: "",
  });
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    setForm((prev) => ({ ...prev, new_username: me?.username || prev.new_username }));
  }, [me]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSuccessMessage("");

    const currentPassword = form.current_password.trim();
    const newUsername = form.new_username.trim();
    const newPassword = form.new_password;
    const confirmPassword = form.confirm_password;

    if (!currentPassword) {
      setGlobalError("Current password is required");
      return;
    }

    if (newPassword && newPassword !== confirmPassword) {
      setGlobalError("New password and confirmation do not match");
      return;
    }

    const payload = { current_password: currentPassword };
    if (newUsername && newUsername !== me?.username) {
      payload.new_username = newUsername;
    }
    if (newPassword) {
      payload.new_password = newPassword;
    }

    if (!payload.new_username && !payload.new_password) {
      setGlobalError("No credential change requested");
      return;
    }

    try {
      setSaving(true);
      setGlobalError("");
      const updated = await updateMeCredentials(token, payload);
      setMe(updated);
      setSuccessMessage("Credentials updated successfully");
      setForm((prev) => ({
        ...prev,
        current_password: "",
        new_password: "",
        confirm_password: "",
        new_username: updated.username,
      }));
    } catch (err) {
      setGlobalError(err.message || "Credential update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="project-section">
      <h2>ACCOUNT SETTINGS</h2>
      <p className="detail-meta">Panel kullanici adi ve sifresini buradan degistirebilirsin.</p>
      <form className="project-form" onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="current password"
          value={form.current_password}
          onChange={(event) => setForm((prev) => ({ ...prev, current_password: event.target.value }))}
          required
        />
        <input
          placeholder="new username"
          value={form.new_username}
          onChange={(event) => setForm((prev) => ({ ...prev, new_username: event.target.value }))}
        />
        <input
          type="password"
          placeholder="new password"
          value={form.new_password}
          onChange={(event) => setForm((prev) => ({ ...prev, new_password: event.target.value }))}
        />
        <input
          type="password"
          placeholder="confirm new password"
          value={form.confirm_password}
          onChange={(event) => setForm((prev) => ({ ...prev, confirm_password: event.target.value }))}
        />
        {successMessage ? <div className="wizard-inline-help"><span>{successMessage}</span></div> : null}
        <button type="submit" className="auth-btn" disabled={saving}>
          {saving ? "saving..." : "save credentials"}
        </button>
      </form>
    </section>
  );
}

function GeneralSettingsPage({ token, setGlobalError }) {
  const [updateForm, setUpdateForm] = useState({
    branch: "main",
    install_backend_dependencies: true,
    run_migrations: true,
    rebuild_frontend: true,
  });
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);

  async function handleSelfUpdate(event) {
    event.preventDefault();
    try {
      setGlobalError("");
      setUpdating(true);
      const result = await runSelfUpdate(token, {
        branch: updateForm.branch.trim() || null,
        install_backend_dependencies: updateForm.install_backend_dependencies,
        run_migrations: updateForm.run_migrations,
        rebuild_frontend: updateForm.rebuild_frontend,
      });
      setUpdateResult(result);
    } catch (err) {
      setGlobalError(err.message || "Self update failed");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <section className="project-section">
      <h2>GENERAL SETTINGS</h2>
      <p className="detail-meta">Panel repository'sini panelden guncelle (git pull + optional build steps).</p>
      <form className="project-form" onSubmit={handleSelfUpdate}>
        <input
          placeholder="git branch"
          value={updateForm.branch}
          onChange={(event) => setUpdateForm((prev) => ({ ...prev, branch: event.target.value }))}
        />
        <select
          value={updateForm.install_backend_dependencies ? "yes" : "no"}
          onChange={(event) => setUpdateForm((prev) => ({ ...prev, install_backend_dependencies: event.target.value === "yes" }))}
        >
          <option value="yes">install backend dependencies: yes</option>
          <option value="no">install backend dependencies: no</option>
        </select>
        <select
          value={updateForm.run_migrations ? "yes" : "no"}
          onChange={(event) => setUpdateForm((prev) => ({ ...prev, run_migrations: event.target.value === "yes" }))}
        >
          <option value="yes">run migrations: yes</option>
          <option value="no">run migrations: no</option>
        </select>
        <select
          value={updateForm.rebuild_frontend ? "yes" : "no"}
          onChange={(event) => setUpdateForm((prev) => ({ ...prev, rebuild_frontend: event.target.value === "yes" }))}
        >
          <option value="yes">rebuild frontend: yes</option>
          <option value="no">rebuild frontend: no</option>
        </select>
        <button type="submit" className="auth-btn" disabled={updating}>
          {updating ? "updating..." : "run self update"}
        </button>
      </form>

      {updateResult ? (
        <>
          <div className="wizard-inline-help" style={{ marginBottom: 10 }}>
            <span>{updateResult.message}</span>
          </div>
          <div className="terminal">
            {updateResult.steps?.map((step, index) => (
              <p key={`${index}-${step.command.join(" ")}`}>
                $ {step.command.join(" ")} [{step.returncode}]
              </p>
            ))}
          </div>
        </>
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
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analyzedInfo, setAnalyzedInfo] = useState(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [importPaths, setImportPaths] = useState([]);
  const [loadingImportPaths, setLoadingImportPaths] = useState(false);
  const [importFilter, setImportFilter] = useState("");
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
      setAnalyzedInfo(null);
      setWizardStep(1);
    } catch (err) {
      setError(err.message || "Project creation failed");
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

  async function handleLoadImportPaths() {
    try {
      setError("");
      setLoadingImportPaths(true);
      const result = await listImportPaths(token);
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
            <NavLink to="/account" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              Account
            </NavLink>
            <NavLink to="/settings/general" className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
              General Settings
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
                  onAnalyze={handleAnalyzeImport}
                  analyzeBusy={analyzeBusy}
                  analyzedInfo={analyzedInfo}
                  wizardStep={wizardStep}
                  setWizardStep={setWizardStep}
                  importPaths={importPaths}
                  loadingImportPaths={loadingImportPaths}
                  importFilter={importFilter}
                  setImportFilter={setImportFilter}
                  onLoadImportPaths={handleLoadImportPaths}
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
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
