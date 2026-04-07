import React from "react";

import StatusBadge from "../components/StatusBadge";
import { APP_VERSION } from "../constants";

export default function SystemDashboardPage({ systemInfo }) {
  if (!systemInfo) {
    return <section className="project-section"><h2>loading system info...</h2></section>;
  }

  return (
    <section className="project-section">
      <h2>SYSTEM DASHBOARD</h2>
      <div className="project-list" style={{ marginBottom: 12 }}>
        <article className="project-row">
          <div className="project-main">
            <h3>{systemInfo.app_name}</h3>
            <p>{systemInfo.platform} • python {systemInfo.python_version} • host {systemInfo.host} • {APP_VERSION}</p>
          </div>
        </article>
      </div>
      <div className="stats-grid" style={{ marginBottom: 12 }}>
        <article className="metric-card"><span>PROJECTS</span><strong>{systemInfo.project_total}</strong><small>{systemInfo.project_running} running / {systemInfo.project_error} error</small></article>
        <article className="metric-card"><span>DEPLOYMENTS</span><strong>{systemInfo.deployment_total}</strong><small>{systemInfo.deployment_last_24h} in last 24h</small></article>
        <article className="metric-card"><span>DISK USED</span><strong>{Math.max(0, Math.round((systemInfo.disk_used_bytes || 0) / (1024 * 1024 * 1024)))}G</strong><small>free {Math.max(0, Math.round((systemInfo.disk_free_bytes || 0) / (1024 * 1024 * 1024)))}G</small></article>
      </div>
      <div className="project-list">
        {(systemInfo.services || []).map((service) => (
          <article key={service.name} className="project-row">
            <div className="project-main">
              <div className="project-title-wrap">
                <h3>{service.name}</h3>
                <StatusBadge status={service.ok ? "running" : "error"} />
              </div>
              <p>{service.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
