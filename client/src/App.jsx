import Settings from "./pages/Settings.jsx";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth.jsx";
import Home from "./pages/Home.jsx";
import { RegisterPage, LoginPage, ForgotPasswordPage, ResetPasswordPage } from "./pages/Auth.jsx";
import AdminPortal from "./pages/AdminPortal.jsx";
import AffiliateDashboard from "./pages/AffiliateDashboard.jsx";
import Shop from "./pages/Shop.jsx";
import DexChat from "./components/DexChat.jsx";
import GamesHub from "./components/GamesHub.jsx";
import Onboarding from "./components/Onboarding.jsx";
import BannerAds from "./components/BannerAds.jsx";
import PrivacyBanner from "./components/PrivacyBanner.jsx";
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";
import Booking from "./pages/Booking.jsx";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/admin" element={<AdminPortal />} />
        <Route path="/affiliate" element={<AffiliateDashboard />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/book" element={<Booking />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/games" element={<GamesHub />} />
      </Routes>
      <PrivacyBanner />
      <BannerAds location="USA" />
      <Onboarding />
      <DexChat />
    </AuthProvider>
  );
}
