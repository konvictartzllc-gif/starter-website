import { createContext, useContext, useState, useEffect } from "react";

const DexContext = createContext();

export const DexProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [preferences, setPreferences] = useState({});

  useEffect(() => {
    fetch("/api/user")
      .then(res => res.json())
      .then(data => {
        setUser(data.user || null);
        setPreferences(data.preferences || {});
      })
      .catch(() => {});
  }, []);

  const updatePreference = (key, value) => {
    setPreferences(prev => ({ ...prev, [key]: value }));

    fetch("/api/preferences/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).catch(() => {});
  };

  return (
    <DexContext.Provider value={{ user, preferences, updatePreference }}>
      {children}
    </DexContext.Provider>
  );
};

export const useDex = () => useContext(DexContext);
