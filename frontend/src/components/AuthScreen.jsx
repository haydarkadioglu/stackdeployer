import React from "react";

export default function AuthScreen({ error, username, setUsername, password, setPassword, onLogin }) {
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
