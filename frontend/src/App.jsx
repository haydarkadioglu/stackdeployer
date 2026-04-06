const projects = [
  {
    id: 1,
    name: "api-backend",
    status: "running",
    stack: "pm2",
    detail: "port 3001",
    branch: "main",
    lastDeploy: "2sa once",
  },
  {
    id: 2,
    name: "frontend-app",
    status: "running",
    stack: "nginx static",
    detail: "port 80",
    branch: "main",
    lastDeploy: "1 gun once",
  },
  {
    id: 3,
    name: "dashboard",
    status: "building",
    stack: "docker",
    detail: "port 8080",
    branch: "develop",
    lastDeploy: "az once basladi",
  },
];

const logs = [
  "[ 14:32:01 ] git pull origin develop",
  "[ 14:32:03 ] Already up to date.",
  "[ 14:32:03 ] docker build -t dashboard .",
  "[ 14:32:18 ] step 4/8 : RUN npm install",
  "[ 14:33:02 ] step 7/8 : RUN npm run build",
  "[ 14:33:21 ] deployment status: building",
];

function StatusBadge({ status }) {
  return <span className={`status status-${status}`}>{status}</span>;
}

function ProjectRow({ project }) {
  const disabled = project.status === "building";

  return (
    <article className={`project-row ${disabled ? "project-building" : ""}`}>
      <div className="project-main">
        <div className="project-title-wrap">
          <h3>{project.name}</h3>
          <StatusBadge status={project.status} />
        </div>
        <p>
          {project.stack} • {project.detail} • {project.branch} • {project.lastDeploy}
        </p>
      </div>

      <div className="project-actions">
        <button type="button" className="ghost-btn">
          logs
        </button>
        <button type="button" className="ghost-btn" disabled={disabled}>
          restart
        </button>
        <button type="button" className="ghost-btn" disabled={disabled}>
          deploy
        </button>
      </div>
    </article>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="window-dots" aria-hidden="true">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
        </div>
        <div className="host-text">deploy.yourdomain.com</div>
        <div className="connection-pill">connected</div>
      </header>

      <div className="layout-grid">
        <aside className="sidebar">
          <div className="menu-group">
            <p>PANEL</p>
            <a className="menu-item active">Projeler</a>
            <a className="menu-item">Loglar</a>
            <a className="menu-item">Env Editor</a>
          </div>

          <div className="menu-group">
            <p>SISTEM</p>
            <a className="menu-item">Monitor</a>
            <a className="menu-item">Nginx</a>
          </div>
        </aside>

        <main className="content">
          <section className="stats-grid">
            <div className="metric-card">
              <span>CPU</span>
              <strong>23%</strong>
              <small>t3.medium • 2 vCPU</small>
            </div>
            <div className="metric-card">
              <span>RAM</span>
              <strong>1.8GB</strong>
              <small>/ 4 GB • %44</small>
            </div>
            <div className="metric-card">
              <span>DISK</span>
              <strong>18GB</strong>
              <small>/ 50 GB • %36</small>
            </div>
          </section>

          <section className="project-section">
            <h2>PROJELER ({projects.length})</h2>
            <div className="project-list">
              {projects.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </div>
          </section>

          <section className="log-section">
            <h2>SON DEPLOYMENT LOGU — DASHBOARD</h2>
            <div className="terminal">
              {logs.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
