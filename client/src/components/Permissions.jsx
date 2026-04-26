import { useState, useEffect } from "react";
import { api } from "../utils/api";
import { Link } from "react-router-dom";

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
      <p>
        Turn features on only if you want Dex to use them. Some features also need a device-level
        permission prompt on Android or in your browser before they work.
      </p>
      <div className="space-y-3 text-sm text-gray-400 mb-4">
        <p>
          <strong className="text-white">Phone features:</strong> Lets Dex announce callers, look up
          saved contact names, place calls you ask for, and answer or decline calls when you approve it.
        </p>
        <p>
          <strong className="text-white">Calendar:</strong> Lets Dex create and manage Dex calendar
          items and any connected calendar integrations you choose to link.
        </p>
        <p>
          <strong className="text-white">Notifications:</strong> Lets Dex send reminders, learning
          nudges, and background status alerts to your device.
        </p>
        <p>
          You can revoke these permissions later in Dex settings or your device settings. Read the{" "}
          <Link to="/privacy" className="text-brand underline">
            Privacy Policy
          </Link>{" "}
          for details about data use, retention, and deletion.
        </p>
      </div>
      <label>
        <input
          type="checkbox"
          name="phone"
          checked={!!permissions.phone}
          onChange={handleChange}
        />
        Allow Dex to use phone features on this account
      </label>
      <label>
        <input
          type="checkbox"
          name="calendar"
          checked={!!permissions.calendar}
          onChange={handleChange}
        />
        Allow Dex to manage calendar features
      </label>
      <label>
        <input
          type="checkbox"
          name="notifications"
          checked={!!permissions.notifications}
          onChange={handleChange}
        />
        Allow Dex to send reminders and notifications
      </label>
      <button type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Permissions"}
      </button>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
    </form>
  );
}
