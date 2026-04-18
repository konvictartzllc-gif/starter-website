import Settings from "./pages/Settings.jsx";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth.jsx";
import Home from "./pages/Home.jsx";
import { RegisterPage, LoginPage } from "./pages/Auth.jsx";
import AdminPortal from "./pages/AdminPortal.jsx";
import AffiliateDashboard from "./pages/AffiliateDashboard.jsx";
import DexChat from "./components/DexChat.jsx";
import Onboarding from "./components/Onboarding.jsx";
import BannerAds from "./components/BannerAds.jsx";
import PrivacyBanner from "./components/PrivacyBanner.jsx";

// New imports added
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminPortal />} />
        <Route path="/affiliate" element={<AffiliateDashboard />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
      {/* Dex AI is always present on every page */}
      <PrivacyBanner />
      <BannerAds location="USA" />
      <Onboarding />
      <DexChat />
    </AuthProvider>
  );
}
