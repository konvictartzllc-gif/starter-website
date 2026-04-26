import { useState, useEffect } from "react";
import { api } from "../utils/api";

const VOICE_STORAGE_KEY = "dex_voice_name";

export default function Preferences() {
  const [preferences, setPreferences] = useState({});
  const [input, setInput] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [automationSaving, setAutomationSaving] = useState(false);
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState(localStorage.getItem(VOICE_STORAGE_KEY) || "");

  useEffect(() => {
    api.getPreferences()
      .then(({ preferences }) => setPreferences(preferences || {}))
      .catch(() => setError("Failed to load preferences."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices().filter((voice) => voice.lang?.startsWith("en"));
      setVoices(availableVoices);
      if (!voiceName && preferences.voice_name) {
        setVoiceName(preferences.voice_name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [preferences.voice_name, voiceName]);

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

  async function savePreference(key, nextValue, successMessage) {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.setPreference(key, nextValue);
      setPreferences((prev) => ({ ...prev, [key]: nextValue }));
      setSuccess(successMessage || "Preference saved!");
    } catch (err) {
      setError(err?.message || "Failed to save preference.");
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

      <div className="learning-section">
        <h3>Learning With Dex</h3>
        <p>Tell Dex what you want to learn so lessons feel more personal. Language learning works especially well here.</p>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 12 }}>
          <label>
            <div>Target Language</div>
            <input
              type="text"
              placeholder="Spanish"
              value={preferences.learning_target_language || ""}
              onChange={(e) => setPreferences((prev) => ({ ...prev, learning_target_language: e.target.value }))}
            />
          </label>
          <label>
            <div>Level</div>
            <select
              value={preferences.learning_level || ""}
              onChange={(e) => setPreferences((prev) => ({ ...prev, learning_level: e.target.value }))}
            >
              <option value="">Choose level</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label>
            <div>Focus</div>
            <select
              value={preferences.learning_focus || ""}
              onChange={(e) => setPreferences((prev) => ({ ...prev, learning_focus: e.target.value }))}
            >
              <option value="">Choose focus</option>
              <option value="conversation">Conversation</option>
              <option value="grammar">Grammar</option>
              <option value="vocabulary">Vocabulary</option>
              <option value="pronunciation">Pronunciation</option>
              <option value="travel">Travel phrases</option>
            </select>
          </label>
          <label>
            <div>Teaching Style</div>
            <select
              value={preferences.learning_style || ""}
              onChange={(e) => setPreferences((prev) => ({ ...prev, learning_style: e.target.value }))}
            >
              <option value="">Choose style</option>
              <option value="gentle">Gentle and encouraging</option>
              <option value="structured">Structured lessons</option>
              <option value="quiz">Quiz me often</option>
              <option value="fast">Move fast</option>
            </select>
          </label>
          <label>
            <div>Main Subject</div>
            <input
              type="text"
              placeholder="Travel Spanish"
              value={preferences.learning_subject || ""}
              onChange={(e) => setPreferences((prev) => ({ ...prev, learning_subject: e.target.value }))}
            />
          </label>
          <label>
            <div>Reminder Time</div>
            <input
              type="time"
              value={preferences.learning_reminder_time || ""}
              onChange={(e) => setPreferences((prev) => ({ ...prev, learning_reminder_time: e.target.value }))}
            />
          </label>
        </div>
        <label style={{ display: "block", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={preferences.learning_reminder_enabled === "1"}
            onChange={(e) => setPreferences((prev) => ({ ...prev, learning_reminder_enabled: e.target.checked ? "1" : "0" }))}
          />
          {" "}Remind me to learn each day
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            await savePreference("learning_target_language", preferences.learning_target_language || "", "Learning profile updated!");
            await savePreference("learning_level", preferences.learning_level || "", "Learning profile updated!");
            await savePreference("learning_focus", preferences.learning_focus || "", "Learning profile updated!");
            await savePreference("learning_style", preferences.learning_style || "", "Learning profile updated!");
            await savePreference("learning_subject", preferences.learning_subject || "", "Learning profile updated!");
            await savePreference("learning_reminder_enabled", preferences.learning_reminder_enabled || "0", "Learning profile updated!");
            await savePreference("learning_reminder_time", preferences.learning_reminder_time || "", "Learning profile updated!");
          }}
        >
          {saving ? "Saving..." : "Save Learning Profile"}
        </button>
      </div>

      <div className="learning-section">
        <h3>Daily Briefing</h3>
        <p>Let Dex shape the tone of your check-ins and remember when you want your morning plan ready.</p>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginBottom: 12 }}>
          <label>
            <div>Conversation Tone</div>
            <select
              value={preferences.conversation_tone || ""}
              onChange={(e) => setPreferences((prev) => ({ ...prev, conversation_tone: e.target.value }))}
            >
              <option value="">Balanced</option>
              <option value="gentle">Gentle</option>
              <option value="direct">Direct</option>
              <option value="motivating">Motivating</option>
              <option value="playful">Playful</option>
            </select>
          </label>
          <label>
            <div>Briefing Time</div>
            <input
              type="time"
              value={preferences.daily_briefing_time || ""}
              onChange={(e) => setPreferences((prev) => ({ ...prev, daily_briefing_time: e.target.value }))}
            />
          </label>
        </div>
        <label style={{ display: "block", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={preferences.daily_briefing_enabled === "1"}
            onChange={(e) => setPreferences((prev) => ({ ...prev, daily_briefing_enabled: e.target.checked ? "1" : "0" }))}
          />
          {" "}Prepare a daily Dex briefing for me
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            await savePreference("conversation_tone", preferences.conversation_tone || "", "Briefing preferences updated!");
            await savePreference("daily_briefing_enabled", preferences.daily_briefing_enabled || "0", "Briefing preferences updated!");
            await savePreference("daily_briefing_time", preferences.daily_briefing_time || "", "Briefing preferences updated!");
          }}
        >
          {saving ? "Saving..." : "Save Briefing Preferences"}
        </button>
      </div>

      <div className="voice-section">
        <h3>Dex Voice</h3>
        <p>Pick the voice Dex uses on this device. Voice names depend on your browser and phone.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={voiceName}
            onChange={async (e) => {
              const nextVoice = e.target.value;
              setVoiceName(nextVoice);
              localStorage.setItem(VOICE_STORAGE_KEY, nextVoice);
              setSaving(true);
              setError("");
              setSuccess("");
              try {
                await api.setPreference("voice_name", nextVoice);
                setPreferences((prev) => ({ ...prev, voice_name: nextVoice }));
                setSuccess("Dex voice updated!");
              } catch (err) {
                setError(err?.message || "Failed to update Dex voice.");
              }
              setSaving(false);
            }}
            disabled={saving || voices.length === 0}
          >
            <option value="">Choose a voice</option>
            {voices.map((voice) => (
              <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              if (!voiceName) return;
              const utterance = new SpeechSynthesisUtterance("Hey, I'm Dex. This is how I sound right now.");
              const selectedVoice = window.speechSynthesis.getVoices().find((voice) => voice.name === voiceName);
              if (selectedVoice) utterance.voice = selectedVoice;
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(utterance);
            }}
            disabled={!voiceName}
          >
            Preview Voice
          </button>
        </div>
      </div>

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
