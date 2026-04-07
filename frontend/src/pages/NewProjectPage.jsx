import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function NewProjectPage({
  projects,
  newProject,
  setNewProject,
  creatingProject,
  onCreate,
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

  const repoStepErrors = [];
  if (newProject.git_url.trim().length <= 3) {
    repoStepErrors.push("git url is required");
  }

  const configErrors = [];
  if (newProject.name.trim().length <= 1) {
    configErrors.push("project name is required");
  }
  if (newProject.local_path.trim().length <= 1) {
    configErrors.push("local path is required");
  }
  if (selectedPathConflict) {
    configErrors.push("selected local path is already used");
  }
  if (newProject.tech_stack.trim().length <= 1) {
    configErrors.push("tech stack is required");
  }

  async function goNext() {
    if (wizardStep === 1) {
      if (repoStepErrors.length > 0) {
        setStepError(repoStepErrors[0]);
        return;
      }
      setStepError("");
      await onAnalyze();
      setWizardStep(2);
      return;
    }

    if (wizardStep === 2 && configErrors.length > 0) {
      setStepError(configErrors[0] || "Configuration step has validation errors.");
      return;
    }

    setStepError("");
    setWizardStep((prev) => Math.min(prev + 1, 3));
  }

  function goPrev() {
    setStepError("");
    setWizardStep((prev) => Math.max(prev - 1, 1));
  }

  async function handleCreateSubmit(event) {
    const created = await onCreate(event);
    if (created) {
      navigate("/projects");
    }
  }

  return (
    <section className="project-section project-index-compact">
      <div className="project-actions" style={{ marginBottom: 12 }}>
        <button className="ghost-btn" type="button" onClick={() => navigate("/projects")}>
          all projects
        </button>
      </div>

      <h2>CREATE PROJECT</h2>
      <div className="wizard-steps" role="tablist" aria-label="create project steps">
        <button type="button" className={`wizard-step ${wizardStep === 1 ? "active" : ""}`} onClick={() => setWizardStep(1)}>
          1. Repository
        </button>
        <button type="button" className={`wizard-step ${wizardStep === 2 ? "active" : ""}`} onClick={() => setWizardStep(2)}>
          2. Configure
        </button>
        <button type="button" className={`wizard-step ${wizardStep === 3 ? "active" : ""}`} onClick={() => setWizardStep(3)}>
          3. Review
        </button>
      </div>

      <form className={`project-form ${wizardStep === 1 ? "project-form-compact" : ""}`} onSubmit={handleCreateSubmit}>
        {wizardStep === 1 ? (
          <>
            <div className="wizard-inline-help">
              <span>Paste repository URL. On next step, we auto-detect name, path and runtime suggestions.</span>
            </div>
            <input
              placeholder="https://github.com/owner/repo"
              value={newProject.git_url}
              onChange={(event) => setNewProject((prev) => ({ ...prev, git_url: event.target.value }))}
              required
            />
            <select
              value={newProject.service_type}
              onChange={(event) => setNewProject((prev) => ({ ...prev, service_type: event.target.value }))}
            >
              <option value="web">web service</option>
              <option value="worker">worker service</option>
            </select>
          </>
        ) : null}

        {wizardStep === 2 ? (
          <>
            <input
              placeholder="name"
              value={newProject.name}
              onChange={(event) => setNewProject((prev) => ({ ...prev, name: event.target.value }))}
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
            <div className="project-actions" style={{ gridColumn: "1 / -1" }}>
              <button type="button" className="ghost-btn" onClick={onAnalyze} disabled={analyzeBusy}>
                {analyzeBusy ? "detecting..." : "re-run detection"}
              </button>
              <button type="button" className="ghost-btn" onClick={onLoadImportPaths} disabled={loadingImportPaths}>
                {loadingImportPaths ? "loading paths..." : "scan local paths"}
              </button>
            </div>
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
            {analyzedInfo ? (
              <input
                value={`detected stack=${analyzedInfo.detected_stack || "unknown"} framework=${analyzedInfo.detected_python_framework || "n/a"} next_port=${analyzedInfo.suggested_port}`}
                readOnly
              />
            ) : null}
            {selectedPathConflict ? (
              <div className="error-banner">Selected local path already belongs to an existing project.</div>
            ) : null}
            {analyzedInfo?.conflicting_paths?.length ? (
              <div className="error-banner">Analyzer detected conflicting paths: {analyzedInfo.conflicting_paths.join(", ")}</div>
            ) : null}
            {configErrors.length ? (
              <div className="wizard-field-errors">
                {configErrors.map((message) => (
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
          <button type="button" className="ghost-btn" onClick={goPrev} disabled={wizardStep === 1 || analyzeBusy}>
            back
          </button>
          {wizardStep < 3 ? (
            <button type="button" className="ghost-btn" onClick={goNext} disabled={analyzeBusy}>
              {wizardStep === 1 && analyzeBusy ? "detecting..." : "next"}
            </button>
          ) : (
            <button type="submit" className="auth-btn" disabled={creatingProject || configErrors.length > 0}>
              {creatingProject ? "creating..." : "create project"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
