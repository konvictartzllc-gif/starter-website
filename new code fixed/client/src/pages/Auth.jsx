import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../utils/api.js";
import { useAuth } from "../hooks/useAuth.js";

export function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref") || "";

  const [form, setForm] = useState({ name: "", email: "", password: "", promoCode: refCode });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api.register(form);
      login(data.token, data.user);
      navigate("/");
    } catch (err) {
      setError(err.error || err.errors?.[0]?.msg || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-md border border-gray-700">
        <h1 className="text-2xl font-bold text-white mb-1">Create Your Account</h1>
        <p className="text-gray-400 text-sm mb-6">Start your free 3-day trial — no credit card needed</p>
        {error && <p className="text-red-400 text-sm mb-4 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input placeholder="Your Name" value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none border border-gray-600 focus:border-brand text-sm" />
          <input type="email" placeholder="Email Address *" value={form.email} onChange={e => setForm(p => ({...p, email: e.target.value}))}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none border border-gray-600 focus:border-brand text-sm" required />
          <input type="password" placeholder="Password (min 6 chars) *" value={form.password} onChange={e => setForm(p => ({...p, password: e.target.value}))}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none border border-gray-600 focus:border-brand text-sm" required />
          <input placeholder="Promo / Referral Code (optional)" value={form.promoCode} onChange={e => setForm(p => ({...p, promoCode: e.target.value}))}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none border border-gray-600 focus:border-brand text-sm" />
          <button type="submit" disabled={loading}
            className="w-full bg-brand hover:bg-brand-light text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50">
            {loading ? "Creating account..." : "Start Free Trial"}
          </button>
        </form>
        <p className="text-center text-gray-500 text-sm mt-4">
          Already have an account? <Link to="/login" className="text-brand hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api.login(form);
      login(data.token, data.user);
      if (data.user.role === "admin") navigate("/admin");
      else if (data.user.role === "affiliate") navigate("/affiliate");
      else navigate("/");
    } catch (err) {
      setError(err.error || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-md border border-gray-700">
        <h1 className="text-2xl font-bold text-white mb-1">Welcome Back</h1>
        <p className="text-gray-400 text-sm mb-6">Log in to your Konvict Artz account</p>
        {error && <p className="text-red-400 text-sm mb-4 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" placeholder="Email Address" value={form.email} onChange={e => setForm(p => ({...p, email: e.target.value}))}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none border border-gray-600 focus:border-brand text-sm" required />
          <input type="password" placeholder="Password" value={form.password} onChange={e => setForm(p => ({...p, password: e.target.value}))}
            className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none border border-gray-600 focus:border-brand text-sm" required />
          <button type="submit" disabled={loading}
            className="w-full bg-brand hover:bg-brand-light text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50">
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>
        <p className="text-center text-gray-500 text-sm mt-4">
          No account? <Link to="/register" className="text-brand hover:underline">Start free trial</Link>
        </p>
      </div>
    </div>
  );
}
