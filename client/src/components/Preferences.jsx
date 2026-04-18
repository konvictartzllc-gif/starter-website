import { useState, useEffect } from "react";
import { api } from "../utils/api";

export default function Preferences() {
  const [preferences, setPreferences] = useState({});
  const [input, setInput] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [automationSaving, setAutomationSaving] = useState(false);

  useEffect(() => {
    api.getPreferences()
      .then(({ preferences }) => setPreferences(preferences || {}))
      .catch(() => setError("Failed to load preferences."))
      .finally(() => setLoading(false));
  }, []);

  // Enable/disable automation
  async function handleAutomationToggle(key, enabled) {
    setAutomationSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.setPreference(`automation_enabled_${key}`, enabled ? "1" : "0");
      setPreferences((prev) => ({ ...prev, [`automation_enabled_${key}`]: enabled ? "1" : "0" }));
      setSuccess(`Automation ${enabled ? "enabled" : "disabled"}!`);
    } catch {
      setError("Failed to update automation.");
    }
    setAutomationSaving(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.setPreference(input, value);
      setPreferences((prev) => ({ ...prev, [input]: value }));
      setSuccess("Preference saved!");
      setInput("");
      setValue("");
    } catch {
      setError("Failed to save preference.");
    }
    setSaving(false);
  }

  if (loading) return <div>Loading preferences...</div>;

  return (
    <div className="preferences-form">
      <h2>Dex Learned Preferences</h2>
      <ul>
        {Object.entries(preferences).map(([k, v]) => (
          <li key={k}><b>{k}:</b> {v}</li>
        ))}
      </ul>

      {/* Emergency Contact Section */}
      <div className="emergency-contact-section">
        <h3>Emergency Contact</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            setSuccess("");
            try {
              await api.setPreference("emergency_contact", value);
              setPreferences((prev) => ({ ...prev, emergency_contact: value }));
              setSuccess("Emergency contact saved!");
              setValue("");
            } catch {
              setError("Failed to save emergency contact.");
            }
            setSaving(false);
          }}
        >
          <input
            type="text"
            placeholder="Phone or email (trusted contact)"
            value={value}
            onChange={e => setValue(e.target.value)}
            required
          />
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Contact"}
          </button>
        </form>
        <label style={{ marginTop: 8, display: "block" }}>
          <input
            type="checkbox"
            checked={preferences.emergency_contact_permission === "1"}
            onChange={async e => {
              setSaving(true);
              setError("");
              setSuccess("");
              try {
                await api.setPreference("emergency_contact_permission", e.target.checked ? "1" : "0");
                setPreferences((prev) => ({ ...prev, emergency_contact_permission: e.target.checked ? "1" : "0" }));
                setSuccess("Permission updated!");
              } catch {
                setError("Failed to update permission.");
              }
              setSaving(false);
            }}
            disabled={saving}
          />
          Allow Dex to notify my trusted contact in an emergency
        </label>
      </div>

      {/* Suggested Automations Section */}
      {preferences.suggested_automation && (
        <div className="automations-section">
          <h3>Suggested Automation</h3>
          <div>
            <b>{preferences.suggested_automation}</b>
            <label style={{ marginLeft: 12 }}>
              <input
                type="checkbox"
                checked={preferences[`automation_enabled_${preferences.suggested_automation}`] === "1"}
                onChange={e => handleAutomationToggle(preferences.suggested_automation, e.target.checked)}
                disabled={automationSaving}
              />
              Enable
            </label>
          </div>
        </div>
      )}

      <form onSubmit={handleSave}>
        <input
          type="text"
          placeholder="Preference key (e.g. favorite_contact)"
          value={input}
          onChange={e => setInput(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Value (e.g. +12345551234)"
          value={value}
          onChange={e => setValue(e.target.value)}
          required
        />
        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Preference"}
        </button>
      </form>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
    </div>
  );
}
