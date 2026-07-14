import { createContext, useContext, useState, useEffect } from "react";

const SafetyContext = createContext();

export const SafetyProvider = ({ children }) => {
  const [distressMode, setDistressMode] = useState(false);
  const [autoCheckIn, setAutoCheckIn] = useState(true);

  useEffect(() => {
    fetch("/api/safety")
      .then(res => res.json())
      .then(data => {
        setDistressMode(data.distressMode || false);
        setAutoCheckIn(data.autoCheckIn ?? true);
      })
      .catch(() => {});
  }, []);

  const updateSafety = (key, value) => {
    if (key === "autoCheckIn") setAutoCheckIn(value);
    if (key === "distressMode") setDistressMode(value);

    fetch("/api/safety/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).catch(() => {});
  };

  return (
    <SafetyContext.Provider value={{ distressMode, autoCheckIn, updateSafety }}>
      {children}
    </SafetyContext.Provider>
  );
};

export const useSafety = () => useContext(SafetyContext);
