import { useState, useEffect, createContext, useContext } from "react";
import { api } from "../utils/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("dex_user");
    const token = localStorage.getItem("dex_token");
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch {}
    }

    if (!token) {
      setLoading(false);
      return;
    }

    let active = true;
    api.me()
      .then(({ user: freshUser }) => {
        if (!active || !freshUser) return;
        localStorage.setItem("dex_user", JSON.stringify(freshUser));
        setUser(freshUser);
      })
      .catch(() => {
        if (!active) return;
        localStorage.removeItem("dex_token");
        localStorage.removeItem("dex_user");
        setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function login(token, userData) {
    localStorage.setItem("dex_token", token);
    localStorage.setItem("dex_user", JSON.stringify(userData));
    setUser(userData);
  }

  function logout() {
    localStorage.removeItem("dex_token");
    localStorage.removeItem("dex_user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
