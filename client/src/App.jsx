import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth.js";
import Home from "./pages/Home.jsx";
import { RegisterPage, LoginPage } from "./pages/Auth.jsx";
import AdminPortal from "./pages/AdminPortal.jsx";
import AffiliateDashboard from "./pages/AffiliateDashboard.jsx";
import DexChat from "./components/DexChat.jsx";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminPortal />} />
        <Route path="/affiliate" element={<AffiliateDashboard />} />
      </Routes>
      {/* Dex AI is always present on every page */}
      <DexChat />
    </AuthProvider>
  );
}
