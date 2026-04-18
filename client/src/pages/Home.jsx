import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";

const services = [
  { icon: "🌿", title: "Lawn Care", desc: "Mowing, trimming, edging, and full yard maintenance." },
  { icon: "🧹", title: "Cleaning Services", desc: "Residential and commercial deep cleaning." },
  { icon: "🔧", title: "Handyman Repair", desc: "Repairs, installations, and home improvements." },
  { icon: "📱", title: "Electronics", desc: "Refurbished and new electronics at great prices." },
];

// Home component definition

  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref");
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [installStatus, setInstallStatus] = useState("");

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      setInstallStatus("Install prompt not available. Try refreshing the page.");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowInstall(false);
      setInstallStatus("App installed! You can now launch it from your home screen or apps menu.");
    } else {
      setInstallStatus("Install dismissed. You can try again later.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Hero */}
      {showInstall && (
        <div className="flex flex-col items-center mb-4">
          <button
            onClick={handleInstall}
            className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-2 rounded-xl shadow-lg transition-all mb-2"
          >
            Install App (Phone/Computer)
          </button>
          {installStatus && (
            <div className="text-sm text-yellow-300 mt-1">{installStatus}</div>
          )}
        </div>
      )}
      <section className="relative overflow-hidden px-6 py-20 text-center">
        <div className="absolute inset-0 bg-gradient-to-br from-brand/20 to-transparent pointer-events-none" />
        <h1 className="text-4xl md:text-6xl font-extrabold mb-4">
          Konvict <span className="text-brand">Artz</span>
        </h1>
        <p className="text-gray-400 text-lg md:text-xl mb-2 max-w-xl mx-auto">
          Lawn care, cleaning, handyman services, and electronics — all in one place.
        </p>
        <p className="text-brand font-semibold mb-8">Powered by Dex AI — just say "Hey Dex" to get started.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to={`/register${refCode ? `?ref=${refCode}` : ""}`}
            className="bg-brand hover:bg-brand-light text-white font-bold px-8 py-3 rounded-xl transition-all">
            Start Free 3-Day Trial
          </Link>
          <Link to="/login" className="border border-gray-600 hover:border-brand text-gray-300 font-bold px-8 py-3 rounded-xl transition-all">
            Log In
          </Link>
        </div>
        {refCode && (
          <p className="mt-4 text-sm text-green-400">🎁 Referral code <strong>{refCode}</strong> applied!</p>
        )}
      </section>

      {/* Services */}
      <section className="px-6 py-12 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-8">Our Services</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {services.map((s) => (
            <div key={s.title} className="bg-gray-800 rounded-2xl p-6 hover:border-brand border border-transparent transition-all">
              <span className="text-4xl">{s.icon}</span>
              <h3 className="text-lg font-bold mt-3 mb-1">{s.title}</h3>
              <p className="text-gray-400 text-sm">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Dex AI Feature */}
      <section className="px-6 py-12 bg-gray-900">
        <div className="max-w-3xl mx-auto text-center">
          <span className="text-5xl">🤖</span>
          <h2 className="text-2xl font-bold mt-4 mb-3">Meet Dex AI</h2>
          <p className="text-gray-400 mb-6">
            Just say <strong className="text-white">"Hey Dex"</strong> — no clicking, no typing required. Dex handles bookings, answers questions, manages your appointments, and remembers everything about you.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            {[
              { icon: "🎤", title: "Voice Activated", desc: 'Say "Hey Dex" to wake him up instantly' },
              { icon: "🧠", title: "Remembers You", desc: "Dex recalls your history and preferences" },
              { icon: "📅", title: "Books Appointments", desc: "Schedule services with just your voice" },
            ].map((f) => (
              <div key={f.title} className="bg-gray-800 rounded-xl p-4">
                <span className="text-2xl">{f.icon}</span>
                <h4 className="font-bold mt-2 mb-1">{f.title}</h4>
                <p className="text-gray-400 text-xs">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-12 max-w-xl mx-auto text-center">
        <h2 className="text-2xl font-bold mb-8">Simple Pricing</h2>
        <div className="bg-gray-800 border border-brand rounded-2xl p-8">
          <p className="text-brand font-bold text-sm uppercase tracking-wider mb-2">Dex AI Subscription</p>
          <p className="text-5xl font-extrabold mb-1">$9.99<span className="text-xl text-gray-400">/mo</span></p>
          <p className="text-gray-400 text-sm mb-6">Start with a free 3-day trial — no credit card required</p>
          <ul className="text-sm text-gray-300 space-y-2 text-left mb-6">
            {["Voice-activated AI assistant", "Appointment booking & reminders", "Service inquiries & support", "Chat history & memory", "Cancel anytime"].map(f => (
              <li key={f} className="flex items-center gap-2"><span className="text-green-400">✓</span>{f}</li>
            ))}
          </ul>
          <Link to="/register" className="block w-full bg-brand hover:bg-brand-light text-white font-bold py-3 rounded-xl transition-all">
            Start Free Trial
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-6 text-center text-gray-500 text-sm">
        <p>© 2026 Konvict Artz. All rights reserved.</p>
        <div className="flex justify-center gap-4 mt-2">
          <Link to="/admin" className="hover:text-gray-300">Admin</Link>
          <Link to="/affiliate" className="hover:text-gray-300">Affiliate Dashboard</Link>
        </div>
      </footer>
    </div>
  );
}
