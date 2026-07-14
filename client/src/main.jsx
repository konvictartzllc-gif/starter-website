import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Dex Providers
import { DexProvider } from "./providers/DexProvider";
import { AvatarProvider } from "./providers/AvatarProvider";
import { SafetyProvider } from "./providers/SafetyProvider";
import { VoiceProvider } from "./providers/VoiceProvider";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DexProvider>
      <SafetyProvider>
        <VoiceProvider>
          <AvatarProvider>
            <App />
          </AvatarProvider>
        </VoiceProvider>
      </SafetyProvider>
    </DexProvider>
  </React.StrictMode>
);
