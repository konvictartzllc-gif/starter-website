import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.jsx";

const services = [
  {
    marker: "LC",
    title: "Lawn Care",
    desc: "Mowing, trimming, edging, and full yard maintenance.",
    details: "Keep the outside of the property sharp with routine cuts, clean edges, trimming around fences and walkways, leaf cleanup, and full yard maintenance plans.",
    includes: ["Mowing and edging", "Trimming and cleanup", "Seasonal yard refresh", "One-time or recurring service"],
    photos: [
      { label: "Clean cuts", src: "https://images.unsplash.com/photo-1589923188900-85dae523342b?auto=format&fit=crop&w=900&q=80" },
      { label: "Fresh edges", src: "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=900&q=80" },
    ],
  },
  {
    marker: "CL",
    title: "Cleaning",
    desc: "Residential and commercial cleaning for regular or one-time jobs.",
    details: "Book dependable cleaning for homes, offices, move-outs, deep cleans, and recurring upkeep so the space looks ready when people walk in.",
    includes: ["Deep cleaning", "Regular home cleaning", "Office and commercial spaces", "Move-in and move-out cleanup"],
    photos: [
      { label: "Residential", src: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=900&q=80" },
      { label: "Detail work", src: "https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&w=900&q=80" },
    ],
  },
  {
    marker: "HD",
    title: "Handyman",
    desc: "Repairs, installs, and practical home improvements.",
    details: "Get help with small repairs, installs, furniture assembly, fixture swaps, punch-list items, and practical improvements around the home or business.",
    includes: ["Small repairs", "Installations", "Assembly work", "Home improvement punch lists"],
    photos: [
      { label: "Repairs", src: "https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=900&q=80" },
      { label: "Install work", src: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=900&q=80" },
    ],
  },
  {
    marker: "EL",
    title: "Electronics",
    desc: "Refurbished and new electronics with straightforward checkout.",
    details: "Shop available electronics, accessories, refurbished devices, and tech items added through the Konvict Artz inventory system.",
    includes: ["New and refurbished items", "Accessories and add-ons", "Inventory shown in real time", "Secure checkout when available"],
    photos: [
      { label: "Devices", src: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80" },
      { label: "Accessories", src: "https://images.unsplash.com/photo-1468495244123-6c6c332eeece?auto=format&fit=crop&w=900&q=80" },
    ],
  },
];

const dexFeatures = [
  { marker: "VO", title: "Voice Ready", desc: 'Say "Hey Dex" when wake mode is enabled.' },
  { marker: "ME", title: "Memory", desc: "Dex can remember preferences, lessons, and saved workflows." },
  { marker: "PL", title: "Planning", desc: "Use Dex for lessons, reminders, calls, and daily planning." },
];

function Home() {
  const { user, logout } = useAuth();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref");
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [installStatus, setInstallStatus] = useState("");
  const [selectedService, setSelectedService] = useState(null);

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) {
      setInstallStatus("Install prompt is not available yet. Try refreshing the page.");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowInstall(false);
      setInstallStatus("App installed. You can launch it from your home screen or apps menu.");
    } else {
      setInstallStatus("Install dismissed. You can try again later.");
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {showInstall && (
        <div className="border-b border-green-500/30 bg-green-500/10 px-6 py-3">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-green-100">Install Dex for faster access from this device.</p>
            <button
              type="button"
              onClick={handleInstall}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700"
            >
              Install App
            </button>
          </div>
          {installStatus && <p className="mx-auto mt-2 max-w-6xl text-sm text-green-100">{installStatus}</p>}
        </div>
      )}

      <section className="relative overflow-hidden border-b border-gray-800 px-6 py-16">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.28em] text-brand">Konvict Artz</p>
            <h1 className="max-w-3xl text-4xl font-black leading-tight md:text-6xl">
              Services, products, and Dex in one clean place.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-gray-300">
              Book services, shop inventory, learn with Dex, and manage your assistant from the same account.
            </p>
            <p className="mt-3 text-sm font-semibold text-brand">Powered by Dex AI. Say "Hey Dex" when wake mode is enabled.</p>

            {refCode && (
              <div className="mt-5 rounded-md border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-100">
                Referral code <strong>{refCode}</strong> is applied.
              </div>
            )}

            {user ? (
              <div className="mt-8">
                <p className="mb-3 text-sm text-gray-300">Signed in as {user.name || user.email}</p>
                <div className="flex flex-wrap gap-3">
                  <Link to="/settings" className="rounded-md bg-brand px-5 py-3 font-bold text-white hover:bg-brand-light">
                    Open Dex Dashboard
                  </Link>
                  <Link to="/shop" className="rounded-md border border-gray-700 px-5 py-3 font-bold text-gray-200 hover:border-brand">
                    Shop Products
                  </Link>
                  {user.role === "affiliate" && (
                    <Link to="/affiliate" className="rounded-md border border-gray-700 px-5 py-3 font-bold text-gray-200 hover:border-brand">
                      Affiliate Dashboard
                    </Link>
                  )}
                  {user.role === "admin" && (
                    <Link to="/admin" className="rounded-md border border-gray-700 px-5 py-3 font-bold text-gray-200 hover:border-brand">
                      Admin Portal
                    </Link>
                  )}
                  <button type="button" onClick={logout} className="rounded-md border border-gray-700 px-5 py-3 font-bold text-gray-200 hover:border-brand">
                    Log Out
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to={`/register${refCode ? `?ref=${refCode}` : ""}`}
                  className="rounded-md bg-brand px-5 py-3 font-bold text-white hover:bg-brand-light"
                >
                  Start Free Trial
                </Link>
                <Link to="/login" className="rounded-md border border-gray-700 px-5 py-3 font-bold text-gray-200 hover:border-brand">
                  Log In
                </Link>
                <Link to="/shop" className="rounded-md border border-gray-700 px-5 py-3 font-bold text-gray-200 hover:border-brand">
                  Shop Products
                </Link>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
            <div className="flex items-center gap-4 border-b border-gray-800 pb-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-brand/60 bg-brand/20 text-2xl font-black text-white">
                D
              </div>
              <div>
                <h2 className="text-xl font-bold">Dex Assistant</h2>
                <p className="text-sm text-gray-400">Chat, voice, lessons, games, shop, and account tools.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              {dexFeatures.map((feature) => (
                <div key={feature.title} className="flex gap-3 rounded-md bg-gray-950/70 p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/20 text-xs font-black text-brand">
                    {feature.marker}
                  </span>
                  <div>
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="text-sm text-gray-400">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand">What You Can Do</p>
            <h2 className="mt-2 text-2xl font-bold">Services and shopping</h2>
          </div>
          <Link to="/shop" className="text-sm font-bold text-brand hover:text-brand-light">View shop</Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service) => (
            <button
              key={service.title}
              type="button"
              onClick={() => setSelectedService(service)}
              className="group rounded-lg border border-gray-800 bg-gray-900 p-5 text-left transition hover:-translate-y-1 hover:border-brand/70 hover:bg-gray-900/80 focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-gray-800 text-xs font-black text-brand">
                {service.marker}
              </span>
              <h3 className="mt-4 text-lg font-bold">{service.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">{service.desc}</p>
              <span className="mt-4 inline-flex text-sm font-bold text-brand group-hover:text-brand-light">View details</span>
            </button>
          ))}
        </div>
      </section>

      {selectedService && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-black/70 px-4 py-4 sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="service-details-title"
          onClick={() => setSelectedService(null)}
        >
          <div
            className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-800 p-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand">{selectedService.marker}</p>
                <h2 id="service-details-title" className="mt-1 text-2xl font-black">{selectedService.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedService(null)}
                className="rounded-md border border-gray-700 px-3 py-2 text-sm font-bold text-gray-200 hover:border-brand"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 p-5 lg:grid-cols-[1fr_0.9fr]">
              <div>
                <p className="text-base leading-7 text-gray-300">{selectedService.details}</p>
                <div className="mt-5 rounded-lg border border-gray-800 bg-gray-900 p-4">
                  <h3 className="font-bold">What we offer</h3>
                  <ul className="mt-3 grid gap-2 text-sm text-gray-300 sm:grid-cols-2">
                    {selectedService.includes.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-green-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    to={`/book?service=${encodeURIComponent(selectedService.title)}`}
                    className="rounded-md bg-brand px-5 py-3 text-sm font-bold text-white hover:bg-brand-light"
                    onClick={() => setSelectedService(null)}
                  >
                    Book Appointment
                  </Link>
                  <Link
                    to="/shop"
                    className="rounded-md border border-gray-700 px-5 py-3 text-sm font-bold text-gray-200 hover:border-brand"
                    onClick={() => setSelectedService(null)}
                  >
                    View Shop
                  </Link>
                  <Link
                    to={user ? "/settings" : "/register"}
                    className="rounded-md border border-gray-700 px-5 py-3 text-sm font-bold text-gray-200 hover:border-brand"
                    onClick={() => setSelectedService(null)}
                  >
                    {user ? "Ask Dex About This" : "Create Account"}
                  </Link>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {selectedService.photos.map((photo) => (
                  <figure key={photo.src} className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
                    <img src={photo.src} alt={`${selectedService.title} ${photo.label}`} className="aspect-[4/3] w-full object-cover" />
                    <figcaption className="px-3 py-2 text-sm font-semibold text-gray-200">{photo.label}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="border-y border-gray-800 bg-gray-900 px-6 py-12">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand">Dex Access</p>
          <h2 className="mt-2 text-3xl font-black">Simple pricing</h2>
          <p className="mt-3 text-gray-400">Start with a free 3-day trial. Continue with Dex for $9.99/month when you are ready.</p>
          <div className="mt-8 rounded-lg border border-brand/60 bg-gray-950 p-6 text-left">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-brand">Dex AI Subscription</p>
                <p className="mt-2 text-4xl font-black">$9.99 <span className="text-base font-semibold text-gray-400">/ month</span></p>
              </div>
              <Link to={user ? "/settings" : "/register"} className="rounded-md bg-brand px-5 py-3 text-center font-bold text-white hover:bg-brand-light">
                {user ? "Manage Account" : "Start Free Trial"}
              </Link>
            </div>
            <ul className="mt-6 grid gap-2 text-sm text-gray-300 sm:grid-cols-2">
              {["Voice and text assistant", "Learning and quizzes", "Saved preferences", "Games and Dex shop", "Permissions center", "Cancel anytime"].map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-green-400" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="px-6 py-6 text-center text-sm text-gray-500">
        <p>Copyright 2026 Konvict Artz. All rights reserved.</p>
        <div className="mt-3 flex flex-wrap justify-center gap-4">
          <Link to="/shop" className="hover:text-gray-300">Shop</Link>
          <Link to="/settings" className="hover:text-gray-300">Dex Dashboard</Link>
          <Link to="/affiliate" className="hover:text-gray-300">Affiliate Dashboard</Link>
          <Link to="/privacy" className="hover:text-gray-300">Privacy</Link>
          <Link to="/terms" className="hover:text-gray-300">Terms</Link>
        </div>
      </footer>
    </div>
  );
}

export default Home;
