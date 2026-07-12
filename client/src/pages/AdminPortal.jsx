import { useEffect, useState } from "react";
import { api } from "../utils/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import AssistantHub from "../components/AssistantHub.jsx";
import CommunicationsCenter from "../components/CommunicationsCenter.jsx";
import LearningHub from "../components/LearningHub.jsx";
import Permissions from "../components/Permissions.jsx";
import Preferences from "../components/Preferences.jsx";

const ADMIN_TABS = ["launch", "stats", "bookings", "dex tools", "flags", "inventory", "affiliates", "promo", "users"];

function normalizeAdminTab(value) {
  const tab = String(value || "")
    .replace(/-/g, " ")
    .trim()
    .toLowerCase();
  return ADMIN_TABS.includes(tab) ? tab : "dex tools";
}

function isReadyStatus(item) {
  if (!item) return false;
  if (typeof item.ready === "boolean") return item.ready;
  if (typeof item.configured === "boolean") return item.configured;
  return false;
}

function statusReason(item) {
  if (!item) return "not checked";
  return item.reason || item.detail || item.nextStep || (isReadyStatus(item) ? "ok" : "needs setup");
}

function buildLaunchChecks(diagnostics) {
  const providers = diagnostics?.providers || {};
  const launch = diagnostics?.launch || {};
  const summary = diagnostics?.summary || {};
  return [
    {
      label: "AI replies",
      ready: isReadyStatus(providers.ai),
      detail: statusReason(providers.ai),
      next: "Set OPENAI_API_KEY and confirm AI diagnostics are ok.",
    },
    {
      label: "Email delivery",
      ready: isReadyStatus(providers.email),
      detail: statusReason(providers.email),
      next: "Send a test email from Promo and verify inbox delivery.",
    },
    {
      label: "Stripe billing",
      ready: isReadyStatus(providers.stripe),
      detail: statusReason(providers.stripe),
      next: "Confirm live secret key, price ID, success/cancel URLs, and webhook secret.",
    },
    {
      label: "Public site URL",
      ready: Boolean(summary.publicSiteUrlSet || launch.site?.publicSiteUrlStatus?.configured),
      detail: launch.site?.publicSiteUrl || "missing",
      next: "Set PUBLIC_SITE_URL to https://www.konvict-artz.com.",
    },
    {
      label: "Client origin",
      ready: Boolean(summary.clientOriginSet || launch.site?.clientOriginStatus?.configured),
      detail: launch.site?.clientOrigin || "missing",
      next: "Set CLIENT_ORIGIN to the production website origin.",
    },
    {
      label: "Auth secrets",
      ready: Boolean(launch.auth?.jwtSecret?.configured && launch.auth?.adminEmail?.configured && launch.auth?.adminPassword?.configured),
      detail: launch.auth?.jwtSecret?.configured ? "configured" : "missing jwt/admin config",
      next: "Confirm JWT_SECRET, ADMIN_EMAIL, and ADMIN_PASSWORD are set in Railway.",
    },
  ];
}

export default function AdminPortal() {
  const { user, login, logout } = useAuth();
  const [tab, setTab] = useState(() => {
    const urlTab = new URLSearchParams(window.location.search).get("tab");
    return normalizeAdminTab(urlTab || localStorage.getItem("dex_admin_tab"));
  });
  const [previousTab, setPreviousTab] = useState(null);
  const [stats, setStats] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [affiliates, setAffiliates] = useState([]);
  const [affiliateInvites, setAffiliateInvites] = useState([]);
  const [users, setUsers] = useState([]);
  const [featureFlags, setFeatureFlags] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [serviceArea, setServiceArea] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [invForm, setInvForm] = useState({
    name: "",
    description: "",
    category: "",
    price_cents: "",
    quantity: "",
    low_threshold: "5",
    image_url: "",
  });

  const [affEmail, setAffEmail] = useState("");
  const [affName, setAffName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");

  const [promoEmail, setPromoEmail] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoName, setPromoName] = useState("");
  const [testEmail, setTestEmail] = useState("");

  const isAdmin = user?.role === "admin";
  const launchChecks = buildLaunchChecks(diagnostics);
  const readyLaunchChecks = launchChecks.filter((check) => check.ready).length;
  const launchReady = launchChecks.length > 0 && readyLaunchChecks === launchChecks.length;

  function updateAdminTab(nextTab, options = {}) {
    const normalized = normalizeAdminTab(nextTab);
    if (normalized === tab && !options.replace) return;

    if (options.trackPrevious !== false) {
      setPreviousTab(tab);
    }
    setTab(normalized);
    localStorage.setItem("dex_admin_tab", normalized);

    const url = new URL(window.location.href);
    url.searchParams.set("tab", normalized.replace(/\s+/g, "-"));
    const method = options.replace ? "replaceState" : "pushState";
    window.history[method]({ adminTab: normalized }, "", url);
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api.login({ email, password });
      if (data.user.role !== "admin") {
        setMsg("Access denied: not an admin.");
        return;
      }
      login(data.token, data.user);
    } catch (err) {
      setMsg(err.error || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try { setStats(await api.getAdminStats()); } catch {}
  }

  async function loadInventory() {
    try { setInventory(await api.getInventory()); } catch {}
  }

  async function loadAffiliates() {
    try { setAffiliates(await api.getAffiliates()); } catch {}
  }

  async function loadAffiliateInvites() {
    try { setAffiliateInvites(await api.getAffiliateInvites()); } catch {}
  }

  async function loadUsers() {
    try { setUsers(await api.getUsers()); } catch {}
  }

  async function loadFeatureFlags() {
    try { setFeatureFlags(await api.getFeatureFlags()); } catch {}
  }

  async function loadBookings() {
    try {
      const data = await api.getBookings();
      setBookings(data.bookings || []);
      setServiceArea(data.serviceArea || []);
    } catch {}
  }

  async function loadDiagnostics() {
    setDiagnosticsLoading(true);
    try {
      setDiagnostics(await api.getDiagnostics());
    } catch (err) {
      setMsg("Error: " + (err.error || err.message || "Failed to load launch diagnostics"));
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    loadStats();
    loadInventory();
    loadAffiliates();
    loadAffiliateInvites();
    loadUsers();
    loadFeatureFlags();
    loadBookings();
    loadDiagnostics();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;

    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab.replace(/\s+/g, "-"));
    window.history.replaceState({ adminTab: tab }, "", url);
    localStorage.setItem("dex_admin_tab", tab);

    function handlePopState() {
      const nextTab = normalizeAdminTab(new URLSearchParams(window.location.search).get("tab"));
      setPreviousTab(tab);
      setTab(nextTab);
      localStorage.setItem("dex_admin_tab", nextTab);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isAdmin, tab]);

  async function handleAddInventory(e) {
    e.preventDefault();
    try {
      await api.addInventory({
        ...invForm,
        price_cents: parseInt(invForm.price_cents, 10),
        quantity: parseInt(invForm.quantity, 10),
        low_threshold: parseInt(invForm.low_threshold, 10),
      });
      setMsg("Item added.");
      setInvForm({
        name: "",
        description: "",
        category: "",
        price_cents: "",
        quantity: "",
        low_threshold: "5",
        image_url: "",
      });
      loadInventory();
      loadStats();
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed"));
    }
  }

  async function handleDeleteInventory(id) {
    if (!window.confirm("Delete this item?")) return;
    try {
      await api.deleteInventory(id);
      loadInventory();
      loadStats();
      setMsg("Item deleted.");
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed"));
    }
  }

  async function handleCreateAffiliate(e) {
    e.preventDefault();
    try {
      const data = await api.createAffiliate({ email: affEmail, name: affName });
      const deliveryMessage = data.emailed
        ? `The setup code was emailed to ${affEmail}.`
        : data.emailError
          ? `${data.emailError} Copy the setup code/link and send it manually.`
          : "The setup email was not confirmed. Copy the setup code/link and send it manually.";
      const setupCode = data.invite?.code || data.promoCode;
      const setupLink = data.invite?.registerLink ? ` Signup link: ${data.invite.registerLink}.` : "";
      setMsg(`Affiliate ready. Setup code: ${setupCode}.${setupLink} ${deliveryMessage}`);
      setAffEmail("");
      setAffName("");
      loadAffiliates();
      loadAffiliateInvites();
      loadUsers();
      loadStats();
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed"));
    }
  }

  async function handleCreateAffiliateInvite(e) {
    e.preventDefault();
    try {
      const data = await api.createAffiliateInvite({ email: inviteEmail, name: inviteName });
      const deliveryMessage = data.emailed
        ? `The invite email was sent to ${inviteEmail || "the affiliate"}.`
        : data.emailError
          ? `${data.emailError} Copy the code or signup link below and send it manually.`
          : "The invite was created, but no email delivery was confirmed. Copy the code or signup link below and send it manually.";
      setMsg(`Affiliate invite ready. Code: ${data.invite.code}. Signup link: ${data.invite.registerLink}. ${deliveryMessage}`);
      setInviteEmail("");
      setInviteName("");
      loadAffiliateInvites();
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed"));
    }
  }

  async function handleResendAffiliateInvite(invite) {
    try {
      const data = await api.resendAffiliateInvite(invite.id);
      if (data.emailed) {
        setMsg(`Invite email sent to ${invite.email}. Code: ${data.invite.code}.`);
      } else {
        setMsg(`Email was not confirmed. ${data.emailError || "Copy the signup link and send it manually."}`);
      }
      loadAffiliateInvites();
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed to resend invite"));
    }
  }

  async function handleSendPromo(e) {
    e.preventDefault();
    try {
      const data = await api.sendPromo({ email: promoEmail, name: promoName, code: promoCode });
      if (data.emailed) {
        setMsg("Promo code sent.");
      } else {
        setMsg(`Promo email was not confirmed. ${data.emailError || "Check SMTP settings."}`);
      }
      setPromoEmail("");
      setPromoCode("");
      setPromoName("");
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed"));
    }
  }

  async function handleSendTestEmail(e) {
    e.preventDefault();
    try {
      const data = await api.sendTestEmail({ email: testEmail });
      if (data.emailed) {
        setMsg(`Test email sent to ${testEmail}.`);
      } else {
        setMsg(`Test email was not confirmed. ${data.emailError || "Check SMTP settings."}`);
      }
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed to send test email"));
    }
  }

  async function handleUpdateUserAccess(id, body, successMessage) {
    try {
      await api.updateUserAccess(id, body);
      setMsg(successMessage);
      loadUsers();
      loadAffiliates();
      loadStats();
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed"));
    }
  }

  async function handleToggleFeatureFlag(flag) {
    try {
      await api.updateFeatureFlag(flag.key, { enabled: !flag.enabled });
      setMsg(`${flag.key} ${flag.enabled ? "disabled" : "enabled"}.`);
      loadFeatureFlags();
      loadStats();
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed"));
    }
  }

  async function handleUpdateBooking(id, status) {
    try {
      await api.updateBooking(id, { status });
      setMsg(`Booking marked ${status}.`);
      loadBookings();
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed to update booking"));
    }
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-md border border-gray-700">
          <h1 className="text-2xl font-bold text-white mb-2">Admin Portal</h1>
          <p className="text-gray-400 text-sm mb-6">Konvict Artz admin access only.</p>
          {msg && <p className="text-red-400 text-sm mb-4">{msg}</p>}
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              placeholder="Admin Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none border border-gray-600 focus:border-brand"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 outline-none border border-gray-600 focus:border-brand"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand hover:bg-brand-light text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50"
            >
              {loading ? "Logging in..." : "Log In"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="bg-gray-900 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Konvict Artz Admin</h1>
          <p className="text-gray-400 text-xs">Logged in as {user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateAdminTab("dex tools", { replace: tab === "dex tools" })}
            className="text-sm font-semibold text-brand hover:text-brand-light"
          >
            Dex Tools
          </button>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-white">Log Out</button>
        </div>
      </div>

      <div className="flex gap-1 px-6 pt-4 overflow-x-auto">
        {ADMIN_TABS.map((t) => (
          <button
            key={t}
            onClick={() => updateAdminTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              tab === t ? "bg-brand text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {msg && (
        <div className="mx-6 mt-4 break-words rounded-xl border border-gray-600 bg-gray-800 px-4 py-3 text-sm text-green-400">
          {msg} <button onClick={() => setMsg("")} className="ml-2 text-gray-500 hover:text-gray-200">Dismiss</button>
        </div>
      )}

      <div className="p-6">
        {tab !== "dex tools" && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => updateAdminTab(previousTab || "dex tools")}
              className="bg-gray-800 hover:bg-gray-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => updateAdminTab("dex tools")}
              className="bg-brand hover:bg-brand-light text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all"
            >
              Dex Tools
            </button>
          </div>
        )}

        {tab === "stats" && stats && (
          <div>
            <h2 className="text-lg font-bold mb-4">Dashboard Overview</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {[
                { label: "Total Users", value: stats.totalUsers },
                { label: "Paid Subscribers", value: stats.paidUsers },
                { label: "Trial Users", value: stats.trialUsers },
                { label: "Revenue", value: `$${((stats.totalRevenueCents || 0) / 100).toFixed(2)}` },
                { label: "Affiliates", value: stats.affiliateCount },
                { label: "Active Today", value: stats.activeToday },
                { label: "Open Tasks", value: stats.openTasks },
                { label: "Saved Aliases", value: stats.savedAliases },
                { label: "Lessons Built", value: stats.learningLessons },
              ].map((s) => (
                <div key={s.label} className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">{s.label}</p>
                  <p className="text-2xl font-bold text-white">{s.value}</p>
                </div>
              ))}
            </div>

            {stats.lowInventory?.length > 0 && (
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4">
                <h3 className="font-bold text-yellow-400 mb-2">Low Inventory Alert</h3>
                {stats.lowInventory.map((item) => (
                  <p key={item.id} className="text-sm text-yellow-300">
                    {item.name} - {item.quantity} left (threshold: {item.low_threshold})
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "launch" && (
          <div>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-bold">Launch Readiness</h2>
                <p className="text-sm text-gray-400 mt-1">
                  One place to see what is ready, what is blocked, and what needs your next move.
                </p>
              </div>
              <button
                type="button"
                onClick={loadDiagnostics}
                disabled={diagnosticsLoading}
                className="bg-brand hover:bg-brand-light disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all"
              >
                {diagnosticsLoading ? "Checking..." : "Refresh Checks"}
              </button>
            </div>

            <div className={`mb-5 rounded-xl border px-4 py-4 ${
              launchReady ? "border-green-700 bg-green-900/20" : "border-yellow-700 bg-yellow-900/20"
            }`}>
              <p className={`text-sm font-bold ${launchReady ? "text-green-300" : "text-yellow-300"}`}>
                {launchReady ? "Launch ready" : `${readyLaunchChecks}/${launchChecks.length} launch checks ready`}
              </p>
              <p className="mt-1 text-sm text-gray-300">
                {launchReady
                  ? "Core provider diagnostics are green. Run one final live payment, affiliate invite, emergency alert, and phone-answering test."
                  : "Finish the blocked checks below before calling Dex launch-ready."}
              </p>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {launchChecks.map((check) => (
                <div key={check.label} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-white">{check.label}</h3>
                      <p className="mt-1 break-words text-sm text-gray-400">{check.detail}</p>
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${
                      check.ready ? "bg-green-900/50 text-green-300" : "bg-red-900/50 text-red-300"
                    }`}>
                      {check.ready ? "Ready" : "Fix"}
                    </span>
                  </div>
                  {!check.ready && (
                    <p className="mt-3 rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300">
                      Next: {check.next}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-4">
              <h3 className="font-semibold text-white">Final Manual Tests</h3>
              <div className="mt-3 grid gap-2 text-sm text-gray-300 sm:grid-cols-2">
                {[
                  "Create a user account and confirm trial access.",
                  "Run live Stripe subscription and confirm user becomes paid.",
                  "Buy a Dex coin pack and confirm coins update.",
                  "Generate affiliate invite and confirm the email/link works.",
                  "Install latest APK and test Hey Dex on Android.",
                  "Run one communications call-routing test end to end.",
                  "Trigger emergency contact alert with a safe test phrase.",
                  "Ask Dex to search web and YouTube from web and app.",
                ].map((item) => (
                  <div key={item} className="rounded-md bg-gray-950 px-3 py-2">{item}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "flags" && (
          <div>
            <h2 className="text-lg font-bold mb-4">Feature Flags</h2>
            <p className="text-sm text-gray-400 mb-4">
              These toggles give you launch control over the new Dex upgrade pack without needing another deploy.
            </p>
            <div className="space-y-3">
              {featureFlags.map((flag) => (
                <div key={flag.key} className="bg-gray-800 rounded-xl p-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-white">{flag.key}</p>
                    <p className="text-sm text-gray-400 mt-1">{flag.description || "No description saved."}</p>
                    <p className="text-xs text-gray-500 mt-2">Updated {new Date(flag.updated_at).toLocaleString()}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleFeatureFlag(flag)}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                      flag.enabled ? "bg-green-700 text-white hover:bg-green-600" : "bg-gray-700 text-gray-100 hover:bg-gray-600"
                    }`}
                  >
                    {flag.enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "bookings" && (
          <div>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-bold">Service Bookings</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Customers can book all services inside ZIP codes {(serviceArea.length ? serviceArea : ["35580", "35501", "35579", "35148", "35549"]).join(", ")}.
                </p>
              </div>
              <button
                type="button"
                onClick={loadBookings}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
              >
                Refresh
              </button>
            </div>

            {bookings.length === 0 ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-sm text-gray-400">
                No booking requests yet.
              </div>
            ) : (
              <div className="space-y-3">
                {bookings.map((booking) => (
                  <div key={booking.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-white">{booking.service}</h3>
                          <span className={`rounded px-2 py-1 text-xs font-bold ${
                            booking.status === "new" ? "bg-blue-900/50 text-blue-300" :
                            booking.status === "confirmed" ? "bg-green-900/50 text-green-300" :
                            booking.status === "completed" ? "bg-purple-900/50 text-purple-300" :
                            booking.status === "cancelled" ? "bg-red-900/50 text-red-300" :
                            "bg-gray-800 text-gray-300"
                          }`}>
                            {booking.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-300">{booking.name} - ZIP {booking.zip_code}</p>
                        <p className="mt-1 text-sm text-gray-400">
                          {[booking.phone, booking.email].filter(Boolean).join(" - ") || "No contact details saved"}
                        </p>
                        {booking.address && <p className="mt-1 text-sm text-gray-400">{booking.address}</p>}
                        <p className="mt-1 text-sm text-gray-400">
                          Preferred: {booking.preferred_date || "date not set"} {booking.preferred_time || ""}
                        </p>
                        {booking.notes && <p className="mt-3 whitespace-pre-wrap rounded-md bg-gray-950 px-3 py-2 text-sm text-gray-300">{booking.notes}</p>}
                        <p className="mt-2 text-xs text-gray-500">Requested {new Date(booking.created_at).toLocaleString()}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {["confirmed", "rescheduled", "completed", "cancelled"].map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => handleUpdateBooking(booking.id, status)}
                            className="rounded-md bg-gray-800 px-3 py-2 text-xs font-bold capitalize text-gray-100 hover:bg-gray-700"
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "dex tools" && (
          <div>
            <h2 className="text-lg font-bold mb-2">Dex Tools</h2>
            <p className="text-sm text-gray-400 mb-6">
              Admin accounts have full Dex access here, including learning, preferences, permissions, tasks, and communication tools.
            </p>
            <div className="grid gap-6 xl:grid-cols-2">
              <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
                <AssistantHub />
              </section>
              <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
                <CommunicationsCenter />
              </section>
            </div>
            <section className="mt-6 bg-gray-900 border border-gray-800 rounded-lg p-5">
              <LearningHub />
            </section>
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
                <Permissions />
              </section>
              <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
                <Preferences />
              </section>
            </div>
          </div>
        )}

        {tab === "inventory" && (
          <div>
            <h2 className="text-lg font-bold mb-4">Inventory Management</h2>
            <form onSubmit={handleAddInventory} className="bg-gray-800 rounded-xl p-4 mb-6 grid grid-cols-2 gap-3">
              <input
                placeholder="Product Name *"
                value={invForm.name}
                onChange={(e) => setInvForm((p) => ({ ...p, name: e.target.value }))}
                className="col-span-2 bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
                required
              />
              <input
                placeholder="Category"
                value={invForm.category}
                onChange={(e) => setInvForm((p) => ({ ...p, category: e.target.value }))}
                className="bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <input
                placeholder="Price (cents)"
                type="number"
                value={invForm.price_cents}
                onChange={(e) => setInvForm((p) => ({ ...p, price_cents: e.target.value }))}
                className="bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
                required
              />
              <input
                placeholder="Quantity *"
                type="number"
                value={invForm.quantity}
                onChange={(e) => setInvForm((p) => ({ ...p, quantity: e.target.value }))}
                className="bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
                required
              />
              <input
                placeholder="Low Stock Threshold"
                type="number"
                value={invForm.low_threshold}
                onChange={(e) => setInvForm((p) => ({ ...p, low_threshold: e.target.value }))}
                className="bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <input
                placeholder="Image URL"
                value={invForm.image_url || ""}
                onChange={(e) => setInvForm((p) => ({ ...p, image_url: e.target.value }))}
                className="col-span-2 bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <textarea
                placeholder="Description"
                value={invForm.description}
                onChange={(e) => setInvForm((p) => ({ ...p, description: e.target.value }))}
                className="col-span-2 bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
                rows={2}
              />
              <button type="submit" className="col-span-2 bg-brand text-white rounded-lg py-2 font-semibold text-sm">
                Add Item
              </button>
            </form>

            <div className="space-y-2">
              {inventory.map((item) => (
                <div key={item.id} className="bg-gray-800 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-gray-400">
                      {item.category || "uncategorized"} - ${(item.price_cents / 100).toFixed(2)} - Stock: {item.quantity}
                    </p>
                  </div>
                  <button onClick={() => handleDeleteInventory(item.id)} className="text-red-400 hover:text-red-300 text-sm">
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "affiliates" && (
          <div>
            <h2 className="text-lg font-bold mb-4">Affiliate Management</h2>
            <p className="text-sm text-gray-400 mb-4">
              Invite an affiliate here. If you enter an email, Dex will try to send the one-time code and signup link there. If email is not configured, you can still copy the generated code below and send it manually.
            </p>
            <form onSubmit={handleCreateAffiliateInvite} className="bg-gray-800 rounded-xl p-4 mb-6 flex gap-3 flex-wrap">
              <input
                placeholder="Invite Email (optional)"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <input
                placeholder="Invite Name (optional)"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="flex-1 bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <button type="submit" className="bg-green-600 text-white rounded-lg px-4 py-2 font-semibold text-sm">
                Generate One-Time Code
              </button>
            </form>
            <form onSubmit={handleCreateAffiliate} className="bg-gray-800 rounded-xl p-4 mb-6 flex gap-3 flex-wrap">
              <input
                placeholder="Affiliate Email *"
                type="email"
                value={affEmail}
                onChange={(e) => setAffEmail(e.target.value)}
                className="flex-1 bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
                required
              />
              <input
                placeholder="Name (optional)"
                value={affName}
                onChange={(e) => setAffName(e.target.value)}
                className="flex-1 bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <button type="submit" className="bg-brand text-white rounded-lg px-4 py-2 font-semibold text-sm">
                Create Affiliate
              </button>
            </form>

            <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 mb-6">
              <h3 className="font-semibold mb-3">Recent One-Time Affiliate Invites</h3>
              <div className="space-y-2">
                {affiliateInvites.length === 0 && (
                  <p className="text-sm text-gray-500">No invite codes generated yet.</p>
                )}
                {affiliateInvites.map((invite) => (
                  <div key={invite.id} className="bg-gray-800 rounded-xl p-3 text-sm">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <p className="font-semibold text-white">{invite.name || invite.email || "Open affiliate invite"}</p>
                        <p className="text-xs text-gray-400">{invite.email || "Any email can claim this code."}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!invite.used && invite.email && (
                          <button
                            type="button"
                            onClick={() => handleResendAffiliateInvite(invite)}
                            className="bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold px-3 py-1 rounded"
                          >
                            Resend Email
                          </button>
                        )}
                        <span className={`text-xs font-bold px-2 py-1 rounded ${invite.used ? "bg-gray-700 text-gray-300" : "bg-green-900/40 text-green-300"}`}>
                          {invite.used ? "used" : "open"}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-brand font-mono">{invite.code}</p>
                    <p className="text-xs text-gray-400 break-all">{invite.registerLink}</p>
                    {invite.claimed_by_email && (
                      <p className="mt-1 text-xs text-gray-500">Claimed by {invite.claimed_by_email}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {affiliates.map((a) => (
                <div key={a.id} className="bg-gray-800 rounded-xl p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{a.name || a.email}</p>
                      <p className="text-xs text-gray-400">{a.email}</p>
                    </div>
                    <span className="bg-brand/20 text-brand text-xs font-bold px-2 py-1 rounded">{a.promo_code}</span>
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    <span>Signups: <strong className="text-white">{a.signups}</strong></span>
                    <span>Paid Subs: <strong className="text-white">{a.paid_subs}</strong></span>
                    <span>Earnings: <strong className="text-green-400">${Number(a.earnings || 0).toFixed(2)}</strong></span>
                    <span>Pending Cash Out: <strong className="text-amber-300">${Number(a.pending_payouts || 0).toFixed(2)}</strong></span>
                  </div>
                  {a.latest_payout_status && (
                    <div className="mt-3 rounded-lg bg-gray-900/70 p-3 text-xs text-gray-300">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold text-white">Latest cash-out request</span>
                        <span className="rounded bg-brand/20 px-2 py-1 font-bold text-brand">{a.latest_payout_status}</span>
                        <span>${Number(a.latest_payout_amount || 0).toFixed(2)}</span>
                        <span>{String(a.latest_payout_method || "").replace("_", " ")}</span>
                      </div>
                      <p className="mt-2 break-all text-gray-400">{a.latest_payout_details}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "promo" && (
          <div>
            <h2 className="text-lg font-bold mb-4">Send Promo Code</h2>
            <form onSubmit={handleSendTestEmail} className="bg-gray-800 rounded-xl p-4 mb-6 flex gap-3 flex-wrap">
              <input
                placeholder="Test Email Address *"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="flex-1 min-w-[220px] bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
                required
              />
              <button type="submit" className="bg-green-600 text-white rounded-lg px-4 py-2 font-semibold text-sm">
                Send Test Email
              </button>
            </form>
            <form onSubmit={handleSendPromo} className="bg-gray-800 rounded-xl p-4 space-y-3 max-w-md">
              <input
                placeholder="Recipient Email *"
                type="email"
                value={promoEmail}
                onChange={(e) => setPromoEmail(e.target.value)}
                className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
                required
              />
              <input
                placeholder="Recipient Name (optional)"
                value={promoName}
                onChange={(e) => setPromoName(e.target.value)}
                className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <input
                placeholder="Promo Code *"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                className="w-full bg-gray-700 rounded-lg px-3 py-2 text-sm outline-none"
                required
              />
              <button type="submit" className="w-full bg-brand text-white rounded-lg py-2 font-semibold text-sm">
                Send Promo Code
              </button>
            </form>
          </div>
        )}

        {tab === "users" && (
          <div>
            <h2 className="text-lg font-bold mb-4">All Users ({users.length})</h2>
            <p className="text-sm text-gray-400 mb-4">
              Use these controls to keep your admin account unlimited forever, or promote people into affiliate access directly from the portal.
            </p>
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.id} className="bg-gray-800 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{u.name || u.email}</p>
                    <p className="text-xs text-gray-400">
                      {u.email} - {u.role} - Joined {new Date(u.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      u.access_type === "paid" ? "bg-green-900/50 text-green-400" :
                      u.access_type === "trial" ? "bg-blue-900/50 text-blue-400" :
                      u.access_type === "unlimited" ? "bg-purple-900/50 text-purple-400" :
                      "bg-gray-700 text-gray-400"
                    }`}>
                      {u.access_type}
                    </span>
                    <button
                      onClick={() => handleUpdateUserAccess(u.id, { role: "admin", access_type: "unlimited" }, `${u.email} now has permanent admin Dex access.`)}
                      className="text-xs bg-purple-700/80 hover:bg-purple-700 text-white px-2 py-1 rounded"
                    >
                      Make Admin
                    </button>
                    <button
                      onClick={() => handleUpdateUserAccess(u.id, { access_type: "unlimited" }, `${u.email} now has unlimited Dex access.`)}
                      className="text-xs bg-green-700/80 hover:bg-green-700 text-white px-2 py-1 rounded"
                    >
                      Unlimited
                    </button>
                    <button
                      onClick={() => handleUpdateUserAccess(u.id, { role: "affiliate", access_type: "unlimited" }, `${u.email} is now an affiliate with Dex access.`)}
                      className="text-xs bg-brand hover:bg-brand-light text-white px-2 py-1 rounded"
                    >
                      Make Affiliate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
