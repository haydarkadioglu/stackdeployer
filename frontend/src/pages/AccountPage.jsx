import React, { useEffect, useState } from "react";

import { updateMeCredentials } from "../services/api";

export default function AccountPage({ token, me, setMe, setGlobalError }) {
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
        {successMessage ? <div className="wizard-inline-help" style={{ gridColumn: "1 / -1" }}><span>{successMessage}</span></div> : null}
        <div className="project-actions" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="auth-btn" disabled={saving}>
            {saving ? "saving..." : "save credentials"}
          </button>
        </div>
      </form>
    </section>
  );
}
