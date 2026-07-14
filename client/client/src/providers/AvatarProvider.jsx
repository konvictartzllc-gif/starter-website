import { createContext, useContext, useState, useEffect } from "react";

const AvatarContext = createContext();

export const AvatarProvider = ({ children }) => {
  const [avatar, setAvatar] = useState(null);

  useEffect(() => {
    fetch("/api/avatar")
      .then(res => res.json())
      .then(data => setAvatar(data))
      .catch(() => setAvatar({}));
  }, []);

  const saveAvatar = (settings) => {
    setAvatar(settings);

    return fetch("/api/avatar/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  };

  return (
    <AvatarContext.Provider value={{ avatar, saveAvatar }}>
      {children}
    </AvatarContext.Provider>
  );
};

export const useAvatar = () => useContext(AvatarContext);
