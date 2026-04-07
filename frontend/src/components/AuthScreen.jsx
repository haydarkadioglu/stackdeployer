import React, { useState } from "react";

import { APP_REPOSITORY_URL } from "../constants";

export default function AuthScreen({ error, username, setUsername, password, setPassword, onLogin }) {
  const [showHelp, setShowHelp] = useState(false);

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
        <button
          type="button"
          className="auth-help-toggle"
          onClick={() => setShowHelp((prev) => !prev)}
        >
          {showHelp ? "Hide help" : "Need help?"}
        </button>

        {showHelp ? (
          <section className="auth-help-panel" aria-live="polite">
            <h2>Quick Help</h2>
            <ol>
              <li>Open panel with HTTPS: <strong>https://your-panel-domain</strong>.</li>
              <li>If login fails, verify API health: <strong>/api/v1/health</strong> should return 200.</li>
              <li>If API is 502, check <strong>stackdeployer</strong> service and restart it.</li>
              <li>If first install, bootstrap admin from API and then sign in.</li>
            </ol>
            <div className="auth-help-links">
              <a href={APP_REPOSITORY_URL} target="_blank" rel="noreferrer">Open GitHub repository</a>
              <a href={`${APP_REPOSITORY_URL}/issues/new`} target="_blank" rel="noreferrer">Create issue</a>
              <a href={`${APP_REPOSITORY_URL}/blob/main/docs/DETAILED_SETUP.md`} target="_blank" rel="noreferrer">Read setup guide</a>
            </div>
          </section>
        ) : null}
      </form>
    </div>
  );
}
