import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  applyNginxRoute,
  createProjectEnvironment,
  deleteProjectDeployment,
  deleteProjectEnvironment,
  getDomainPlan,
  getNextPort,
  getProject,
  getProjectLogs,
  getProjectSSLStatus,
  issueProjectSSL,
  listDomainRecords,
  listProjectDeployments,
  listProjectEnvironment,
  promoteProjectDeployment,
  removeNginxRoute,
  saveDomainRecords,
  updateProject,
  updateProjectEnvironment,
  validateDomainRecords,
} from "../services/api";
import { createProjectLogsSocket } from "../services/ws";
import ProjectTabs from "../components/ProjectTabs";
import StatusBadge from "../components/StatusBadge";
import { TABS } from "../constants";
import { formatDuration, formatLogLine, formatTimestamp, formatWhen, isLikelyDomain } from "../utils/formatters";

export default function ProjectDetailPage({ token, refreshProjects, onAction, busyAction, setGlobalError }) {
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
  const [sslStatus, setSslStatus] = useState(null);
  const [sslIssueEmail, setSslIssueEmail] = useState("");
  const [sslExtraDomains, setSslExtraDomains] = useState("");
  const [sslMessage, setSslMessage] = useState("");
  const [deploymentsFilter, setDeploymentsFilter] = useState("all");
  const [previewBranch, setPreviewBranch] = useState("feature-preview");
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
          setDeployments(await listProjectDeployments(token, projectId, 50, deploymentsFilter));
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
  }, [project, tab, token, projectId, setGlobalError, revealSecrets, deploymentsFilter]);

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
      setDeployments(await listProjectDeployments(token, projectId, 50, deploymentsFilter));
    }
  }

  async function handlePreviewDeploy() {
    if (!project) {
      return;
    }
    await onAction("deploy", project, { deployment_type: "preview", branch: previewBranch.trim() || "main" });
    await reloadProjectAndList();
    setDeployments(await listProjectDeployments(token, projectId, 50, deploymentsFilter));
  }

  async function handleRemovePreviewDeployment(item) {
    try {
      await deleteProjectDeployment(token, projectId, item.id);
      setDeployments(await listProjectDeployments(token, projectId, 50, deploymentsFilter));
      await refreshProjects();
    } catch (err) {
      setGlobalError(err.message || "Preview remove failed");
    }
  }

  async function handlePromotePreviewDeployment(item) {
    try {
      await promoteProjectDeployment(token, projectId, item.id);
      await reloadProjectAndList();
      setDeployments(await listProjectDeployments(token, projectId, 50, deploymentsFilter));
    } catch (err) {
      setGlobalError(err.message || "Preview promote failed");
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

  async function handleCopyEnvValue(row) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(row.value);
        return;
      }
      setGlobalError("Clipboard access is not available in this browser");
    } catch (err) {
      setGlobalError(err.message || "Copy failed");
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

  async function handleCheckSSLStatus() {
    try {
      const statusPayload = await getProjectSSLStatus(token, projectId);
      setSslStatus(statusPayload);
      setSslMessage("");
    } catch (err) {
      setGlobalError(err.message || "SSL status check failed");
    }
  }

  async function handleIssueSSL() {
    try {
      const extraDomains = sslExtraDomains
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const payload = {
        email: sslIssueEmail.trim() || null,
        extra_domains: extraDomains,
      };

      const result = await issueProjectSSL(token, projectId, payload);
      setSslMessage(result?.message || "SSL certificate issued successfully");
      const statusPayload = await getProjectSSLStatus(token, projectId);
      setSslStatus(statusPayload);
    } catch (err) {
      setGlobalError(err.message || "SSL issue failed");
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

  async function handleDeleteProject() {
    if (!project) {
      return;
    }

    const ok = window.confirm(`Delete project ${project.name}? This action cannot be undone.`);
    if (!ok) {
      return;
    }

    await onAction("delete", project);
    navigate("/projects");
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
        <>
          <form className="project-form" onSubmit={(event) => event.preventDefault()}>
            <select value={deploymentsFilter} onChange={(event) => setDeploymentsFilter(event.target.value)}>
              <option value="all">all deployments</option>
              <option value="production">production only</option>
              <option value="preview">preview only</option>
            </select>
            <input
              placeholder="preview branch"
              value={previewBranch}
              onChange={(event) => setPreviewBranch(event.target.value)}
            />
            <button className="ghost-btn" type="button" onClick={handlePreviewDeploy} disabled={busyAction === `deploy:${project.id}`}>
              deploy preview
            </button>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => handleHeaderAction("deploy")}
              disabled={busyAction === `deploy:${project.id}`}
            >
              deploy production
            </button>
          </form>

          <div className="project-list">
            {deployments.map((item) => (
              <article key={item.id} className="project-row">
                <div className="project-main">
                  <div className="project-title-wrap">
                    <h3>deployment #{item.id}</h3>
                    <StatusBadge status={item.status} />
                  </div>
                  <p>
                    type: {item.deployment_type || "production"} • branch: {item.branch} • preview port: {item.preview_port || "n/a"}
                  </p>
                  <p>
                    started: {formatWhen(item.started_at)} • finished: {formatWhen(item.completed_at)} • duration: {formatDuration(item.started_at, item.completed_at)}
                  </p>
                  {item.error_message ? <p className="error-text">{item.error_message}</p> : null}
                </div>
                <div className="project-actions">
                  {item.deployment_type === "preview" ? (
                    <>
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={() => handlePromotePreviewDeployment(item)}
                        disabled={busyAction === `deploy:${project.id}`}
                      >
                        promote
                      </button>
                      <button
                        className="ghost-btn"
                        type="button"
                        onClick={() => handleRemovePreviewDeployment(item)}
                        disabled={busyAction === `deploy:${project.id}`}
                      >
                        remove
                      </button>
                    </>
                  ) : (
                    <button
                      className="ghost-btn"
                      type="button"
                      onClick={() => handleHeaderAction("deploy")}
                      disabled={busyAction === `deploy:${project.id}`}
                    >
                      retry deploy
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!deployments.length ? <div className="error-banner">No deployments yet.</div> : null}
          </div>
        </>
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
            <div className="project-actions" style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="auth-btn">add env</button>
            </div>
          </form>

          <div className="project-list">
            {envRows.map((row) => (
              <article key={row.id} className="project-row">
                <div className="project-main">
                  <div className="project-title-wrap">
                    <h3>{row.key}</h3>
                    <StatusBadge status={row.is_secret ? "secret" : "plain"} />
                  </div>
                  <div className="detail-meta">updated {formatTimestamp(row.updated_at)}</div>
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
                  <button className="ghost-btn" type="button" onClick={() => handleCopyEnvValue(row)} disabled={row.is_secret && !revealSecrets}>
                    copy
                  </button>
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
            <button type="button" className="ghost-btn" onClick={handleIssueSSL} disabled={project.service_type !== "web" || !domainValid}>
              issue ssl certificate
            </button>
            <button type="button" className="ghost-btn" onClick={handleCheckSSLStatus} disabled={project.service_type !== "web" || !domainValid}>
              check ssl status
            </button>
          </div>

          <form className="project-form" onSubmit={(event) => event.preventDefault()}>
            <input
              placeholder="certbot email (optional, fallback to backend certbot_email)"
              value={sslIssueEmail}
              onChange={(event) => setSslIssueEmail(event.target.value)}
            />
            <input
              placeholder="extra domains (comma separated, optional)"
              value={sslExtraDomains}
              onChange={(event) => setSslExtraDomains(event.target.value)}
            />
          </form>

          {sslMessage ? (
            <div className="wizard-inline-help" style={{ marginBottom: 12 }}>
              <span>{sslMessage}</span>
            </div>
          ) : null}

          {sslStatus ? (
            <div className="wizard-inline-help" style={{ marginBottom: 12 }}>
              <span>
                ssl: {sslStatus.certificate_present ? "issued" : "not issued"} • expires: {sslStatus.expires_at || "n/a"} • days left: {sslStatus.days_remaining ?? "n/a"}
              </span>
            </div>
          ) : null}

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
            <div className="project-actions" style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="auth-btn" disabled={project.service_type !== "web" || !domainValid}>
                apply route
              </button>
              <button type="button" className="ghost-btn" onClick={handleRemoveDomain} disabled={project.service_type !== "web"}>
                remove route
              </button>
            </div>
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
            <div className="project-actions" style={{ gridColumn: "1 / -1", marginTop: "10px" }}>
              <button type="submit" className="auth-btn" disabled={!isSettingsDirty}>save settings</button>
              <button
                type="button"
                className="ghost-btn"
                onClick={handleDeleteProject}
                disabled={busyAction === `delete:${project.id}`}
              >
                delete project
              </button>
            </div>
          </form>
        </>
      ) : null}
    </section>
  );
}
