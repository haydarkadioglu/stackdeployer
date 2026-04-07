import React, { useEffect, useState } from "react";

import { APP_REPOSITORY_URL, APP_VERSION } from "../constants";
import { runSelfUpdate } from "../services/api";

function normalizeVersion(value) {
  return (value || "").trim().replace(/^v/i, "");
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const l = left[index] || 0;
    const r = right[index] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }

  return 0;
}

function extractRepoPath(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) {
    return null;
  }

  const owner = match[1];
  const name = match[2].replace(/\.git$/i, "");
  return `${owner}/${name}`;
}

export default function GeneralSettingsPage({ token, setGlobalError }) {
  const [updateForm, setUpdateForm] = useState({
    branch: "main",
    install_backend_dependencies: true,
    run_migrations: true,
    rebuild_frontend: true,
  });
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const [updateCheck, setUpdateCheck] = useState({ status: "idle", latest: "", source: "" });

  useEffect(() => {
    let cancelled = false;

    async function checkLatestVersion() {
      const repoPath = extractRepoPath(APP_REPOSITORY_URL);
      if (!repoPath) {
        return;
      }

      try {
        setUpdateCheck({ status: "checking", latest: "", source: "" });

        const releaseResponse = await fetch(`https://api.github.com/repos/${repoPath}/releases/latest`);
        let latest = "";
        let source = "";

        if (releaseResponse.ok) {
          const releasePayload = await releaseResponse.json();
          latest = releasePayload?.tag_name || "";
          source = "release";
        }

        if (!latest) {
          const tagsResponse = await fetch(`https://api.github.com/repos/${repoPath}/tags?per_page=1`);
          if (tagsResponse.ok) {
            const tagsPayload = await tagsResponse.json();
            latest = tagsPayload?.[0]?.name || "";
            source = "tag";
          }
        }

        if (!cancelled) {
          if (latest) {
            const cmp = compareVersions(latest, APP_VERSION);
            setUpdateCheck({ status: cmp > 0 ? "available" : "up-to-date", latest, source });
          } else {
            setUpdateCheck({ status: "unknown", latest: "", source: "" });
          }
        }
      } catch (_error) {
        if (!cancelled) {
          setUpdateCheck({ status: "unknown", latest: "", source: "" });
        }
      }
    }

    checkLatestVersion();

    return () => {
      cancelled = true;
    };
  }, []);

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
      {updateCheck.status === "available" ? (
        <div className="wizard-inline-help" style={{ marginBottom: 10, borderColor: "hsl(39 83% 72% / 0.6)", color: "hsl(39 83% 78%)" }}>
          <span>
            New update available: {updateCheck.latest} (current: {APP_VERSION})
          </span>
        </div>
      ) : null}
      {updateCheck.status === "up-to-date" ? (
        <div className="detail-meta" style={{ marginBottom: 10 }}>
          Current version {APP_VERSION} is up to date.
        </div>
      ) : null}
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
