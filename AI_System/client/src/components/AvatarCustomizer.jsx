import React, { useState, useEffect } from "react";

const DEFAULT_AVATAR = {
  avatar_shape: "orb",
  avatar_color: "neon_blue",
  avatar_glow: "soft",
  avatar_expression: "neutral",
  avatar_animation: "floating",
  avatar_voice_indicator: "pulse",
};

const AvatarPreview = ({ settings }) => {
  const { avatar_shape, avatar_color, avatar_glow, avatar_expression, avatar_animation } = settings;

  const colorMap = {
    neon_blue: "#3b82f6",
    neon_purple: "#a855f7",
    neon_red: "#ef4444",
    neon_green: "#22c55e",
    white: "#ffffff",
    black: "#0f172a",
  };

  const glowMap = {
    none: "0 0 0px rgba(0,0,0,0)",
    soft: `0 0 12px ${colorMap[avatar_color] || "#3b82f6"}`,
    medium: `0 0 24px ${colorMap[avatar_color] || "#3b82f6"}`,
    heavy: `0 0 40px ${colorMap[avatar_color] || "#3b82f6"}`,
  };

  const shapeStyle =
    avatar_shape === "orb"
      ? { borderRadius: "999px" }
      : avatar_shape === "hexagon"
      ? { clipPath: "polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)" }
      : { borderRadius: "24px" }; // cube

  const expressionText =
    avatar_expression === "friendly"
      ? "Dex 😊"
      : avatar_expression === "energetic"
      ? "Dex ⚡"
      : avatar_expression === "calm"
      ? "Dex 😌"
      : avatar_expression === "guardian"
      ? "Dex 🛡️"
      : "Dex";

  const animationStyle =
    avatar_animation === "floating"
      ? { animation: "dex-float 3s ease-in-out infinite" }
      : avatar_animation === "breathing"
      ? { animation: "dex-breathe 2.5s ease-in-out infinite" }
      : avatar_animation === "pulsing"
      ? { animation: "dex-pulse 1.8s ease-in-out infinite" }
      : {};

  return (
    <div
      style={{
        width: "260px",
        height: "260px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#020617",
        borderRadius: "24px",
        border: "1px solid #1f2937",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "140px",
          height: "140px",
          background: colorMap[avatar_color] || "#3b82f6",
          boxShadow: glowMap[avatar_glow] || glowMap.soft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#0b1120",
          fontWeight: "600",
          fontSize: "18px",
          ...shapeStyle,
          ...animationStyle,
        }}
      >
        {expressionText}
      </div>

      <style>
        {`
          @keyframes dex-float {
            0% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
            100% { transform: translateY(0px); }
          }
          @keyframes dex-breathe {
            0% { transform: scale(1); }
            50% { transform: scale(1.06); }
            100% { transform: scale(1); }
          }
          @keyframes dex-pulse {
            0% { transform: scale(1); box-shadow: ${glowMap.medium}; }
            50% { transform: scale(1.08); box-shadow: ${glowMap.heavy}; }
            100% { transform: scale(1); box-shadow: ${glowMap.medium}; }
          }
        `}
      </style>
    </div>
  );
};

const AvatarCustomizer = () => {
  const [settings, setSettings] = useState(DEFAULT_AVATAR);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    // Optional: load existing avatar from backend
    // fetch("/api/avatar")
    //   .then(res => res.json())
    //   .then(data => setSettings(prev => ({ ...prev, ...data }))
    //   .catch(() => {});
  }, []);

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveAvatar = async () => {
    setSaving(true);
    setSavedMessage("");

    try {
      const res = await fetch("/api/avatar/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!res.ok) throw new Error("Failed to save avatar");

      setSavedMessage("Dex avatar saved!");
    } catch (err) {
      setSavedMessage("Error saving avatar. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: "24px",
        padding: "24px",
        background: "#020617",
        color: "#e5e7eb",
        borderRadius: "24px",
        border: "1px solid #1f2937",
        maxWidth: "900px",
        margin: "24px auto",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Left: Controls */}
      <div style={{ flex: 1 }}>
        <h2 style={{ fontSize: "22px", marginBottom: "8px" }}>Customize your Dex</h2>
        <p style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "16px" }}>
          Everyone starts with a basic Dex. Make it yours.
        </p>

        {/* Shape */}
        <div style={{ marginBottom: "14px" }}>
          <label style={{ display: "block", fontSize: "14px", marginBottom: "4px" }}>
            Shape
          </label>
          <select
            value={settings.avatar_shape}
            onChange={e => updateSetting("avatar_shape", e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #374151",
              background: "#020617",
              color: "#e5e7eb",
            }}
          >
            <option value="orb">Orb</option>
            <option value="hexagon">Hexagon</option>
            <option value="cube">Soft Cube</option>
          </select>
        </div>

        {/* Color */}
        <div style={{ marginBottom: "14px" }}>
          <label style={{ display: "block", fontSize: "14px", marginBottom: "4px" }}>
            Color
          </label>
          <select
            value={settings.avatar_color}
            onChange={e => updateSetting("avatar_color", e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #374151",
              background: "#020617",
              color: "#e5e7eb",
            }}
          >
            <option value="neon_blue">Neon Blue</option>
            <option value="neon_purple">Neon Purple</option>
            <option value="neon_red">Neon Red</option>
            <option value="neon_green">Neon Green</option>
            <option value="white">White</option>
            <option value="black">Stealth Black</option>
          </select>
        </div>

        {/* Glow */}
        <div style={{ marginBottom: "14px" }}>
          <label style={{ display: "block", fontSize: "14px", marginBottom: "4px" }}>
            Glow
          </label>
          <select
            value={settings.avatar_glow}
            onChange={e => updateSetting("avatar_glow", e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #374151",
              background: "#020617",
              color: "#e5e7eb",
            }}
          >
            <option value="none">None</option>
            <option value="soft">Soft</option>
            <option value="medium">Medium</option>
            <option value="heavy">Heavy Neon</option>
          </select>
        </div>

        {/* Expression */}
        <div style={{ marginBottom: "14px" }}>
          <label style={{ display: "block", fontSize: "14px", marginBottom: "4px" }}>
            Expression
          </label>
          <select
            value={settings.avatar_expression}
            onChange={e => updateSetting("avatar_expression", e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #374151",
              background: "#020617",
              color: "#e5e7eb",
            }}
          >
            <option value="neutral">Neutral</option>
            <option value="friendly">Friendly</option>
            <option value="energetic">Energetic</option>
            <option value="calm">Calm</option>
            <option value="guardian">Guardian</option>
          </select>
        </div>

        {/* Animation */}
        <div style={{ marginBottom: "14px" }}>
          <label style={{ display: "block", fontSize: "14px", marginBottom: "4px" }}>
            Animation
          </label>
          <select
            value={settings.avatar_animation}
            onChange={e => updateSetting("avatar_animation", e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #374151",
              background: "#020617",
              color: "#e5e7eb",
            }}
          >
            <option value="floating">Floating</option>
            <option value="breathing">Breathing</option>
            <option value="pulsing">Pulsing</option>
          </select>
        </div>

        {/* Voice indicator */}
        <div style={{ marginBottom: "18px" }}>
          <label style={{ display: "block", fontSize: "14px", marginBottom: "4px" }}>
            Voice indicator style
          </label>
          <select
            value={settings.avatar_voice_indicator}
            onChange={e => updateSetting("avatar_voice_indicator", e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #374151",
              background: "#020617",
              color: "#e5e7eb",
            }}
          >
            <option value="pulse">Pulse</option>
            <option value="waveform">Waveform</option>
            <option value="ring">Ring</option>
          </select>
        </div>

        {/* Save button */}
        <button
          onClick={saveAvatar}
          disabled={saving}
          style={{
            marginTop: "4px",
            padding: "10px 16px",
            borderRadius: "999px",
            border: "none",
            background: "#a855f7",
            color: "#0b1120",
            fontWeight: "600",
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving..." : "Save Avatar"}
        </button>

        {savedMessage && (
          <p style={{ marginTop: "10px", fontSize: "13px", color: "#a5b4fc" }}>
            {savedMessage}
          </p>
        )}
      </div>

      {/* Right: Preview */}
      <div style={{ flexBasis: "280px" }}>
        <h3 style={{ fontSize: "16px", marginBottom: "8px" }}>Live Preview</h3>
        <p style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "12px" }}>
          This is how your floating Dex avatar will look.
        </p>
        <AvatarPreview settings={settings} />
      </div>
    </div>
  );
};

export default AvatarCustomizer;
