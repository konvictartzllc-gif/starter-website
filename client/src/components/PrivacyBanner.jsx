import { useEffect, useState } from "react";

export default function PrivacyBanner() {
  const [show, setShow] = useState(true);
  const [policy, setPolicy] = useState("");

  const summaryLine =
    policy
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) || "";

  useEffect(() => {
    fetch("/privacy-policy.txt")
      .then((response) => response.text())
      .then(setPolicy);
  }, []);

  if (!show || !policy) return null;

  return (
    <div
      style={{
        background: "#222",
        color: "#fff",
        padding: "12px 20px",
        fontSize: 14,
        borderBottom: "2px solid #0af",
        zIndex: 1000,
      }}
    >
      <strong>Privacy Notice:</strong> {summaryLine}
      <button
        onClick={() => setShow(false)}
        style={{
          float: "right",
          background: "none",
          color: "#0af",
          border: "none",
          fontWeight: "bold",
          fontSize: 16,
          cursor: "pointer",
        }}
      >
        x
      </button>
      <a href="/privacy" style={{ marginLeft: 16, color: "#0af", textDecoration: "underline" }}>
        Full Policy
      </a>
    </div>
  );
}
