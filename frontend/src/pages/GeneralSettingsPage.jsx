import React, { useState } from "react";

import { runSelfUpdate } from "../services/api";

export default function GeneralSettingsPage({ token, setGlobalError }) {
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
        <div className="project-actions" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="auth-btn" disabled={updating}>
            {updating ? "updating..." : "run self update"}
          </button>
        </div>
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
