import React from "react";
import { useNavigate } from "react-router-dom";

import StatusBadge from "../components/StatusBadge";

export default function ProjectsIndexPage({
  projects,
  systemInfo,
  busyAction,
  onAction,
}) {
  const navigate = useNavigate();

  return (
    <section className="project-section project-index-compact">
      {systemInfo ? (
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          <article className="metric-card">
            <span>RUNNING PROJECTS</span>
            <strong>{systemInfo.project_running}</strong>
            <small>/ {systemInfo.project_total} total</small>
          </article>
          <article className="metric-card">
            <span>DEPLOYS (24H)</span>
            <strong>{systemInfo.deployment_last_24h}</strong>
            <small>{systemInfo.deployment_total} all-time</small>
          </article>
          <article className="metric-card">
            <span>DISK FREE</span>
            <strong>{Math.max(0, Math.round((systemInfo.disk_free_bytes || 0) / (1024 * 1024 * 1024)))}G</strong>
            <small>{systemInfo.environment}</small>
          </article>
        </div>
      ) : null}
      <div className="project-actions" style={{ marginBottom: 12 }}>
        <button className="auth-btn" type="button" onClick={() => navigate("/projects/new")}>
          yeni proje olustur
        </button>
      </div>

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
                {project.tech_stack} | {project.service_type} | {project.internal_port ? `port ${project.internal_port}` : "no port"} | {project.domain || "no domain"}
              </p>
            </div>
            <div className="project-actions">
              <button className="ghost-btn" type="button" onClick={() => navigate(`/projects/${project.id}`)}>
                open
              </button>
              <button className="ghost-btn" type="button" onClick={() => onAction("deploy", project)} disabled={busyAction === `deploy:${project.id}`}>
                deploy
              </button>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete project ${project.name}? This action cannot be undone.`)) {
                    onAction("delete", project);
                  }
                }}
                disabled={busyAction === `delete:${project.id}`}
              >
                delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
