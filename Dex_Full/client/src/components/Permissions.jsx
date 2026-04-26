import { useState, useEffect } from "react";
import { api } from "../utils/api";

export default function Permissions() {
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    api.getPermissions()
      .then(({ permissions }) => setPermissions(permissions || {}))
      .catch(() => setError("Failed to load permissions."))
      .finally(() => setLoading(false));
  }, []);

  function handleChange(e) {
    const { name, checked } = e.target;
    setPermissions((prev) => ({ ...prev, [name]: checked }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.setPermissions(permissions);
      setSuccess("Permissions updated!");
    } catch {
      setError("Failed to save permissions.");
    }
    setSaving(false);
  }

  if (loading) return <div>Loading permissions...</div>;

  return (
    <form onSubmit={handleSave} className="permissions-form">
      <h2>Dex Permissions & Consent</h2>
      <label>
        <input
          type="checkbox"
          name="phone"
          checked={!!permissions.phone}
          onChange={handleChange}
        />
        Allow Dex to announce callers (Android)
      </label>
      <label>
        <input
          type="checkbox"
          name="calendar"
          checked={!!permissions.calendar}
          onChange={handleChange}
        />
        Allow Dex to manage calendar events
      </label>
      <label>
        <input
          type="checkbox"
          name="notifications"
          checked={!!permissions.notifications}
          onChange={handleChange}
        />
        Allow Dex to send notifications
      </label>
      <button type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Permissions"}
      </button>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
    </form>
  );
}