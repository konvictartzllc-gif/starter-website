import { useEffect, useState } from "react";
import { api } from "../utils/api.js";
import { useAuth } from "../hooks/useAuth.jsx";

export default function AdminPortal() {
  const { user, login, logout } = useAuth();
  const [tab, setTab] = useState("stats");
  const [stats, setStats] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [affiliates, setAffiliates] = useState([]);
  const [affiliateInvites, setAffiliateInvites] = useState([]);
  const [users, setUsers] = useState([]);
  const [featureFlags, setFeatureFlags] = useState([]);
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
  });

  const [affEmail, setAffEmail] = useState("");
  const [affName, setAffName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");

  const [promoEmail, setPromoEmail] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoName, setPromoName] = useState("");

  const isAdmin = user?.role === "admin";

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

  useEffect(() => {
    if (!isAdmin) return;
    loadStats();
    loadInventory();
    loadAffiliates();
    loadAffiliateInvites();
    loadUsers();
    loadFeatureFlags();
  }, [isAdmin]);

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
      setMsg(`Affiliate ready. Code: ${data.promoCode}. They can finish setup by registering with ${affEmail}.`);
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
        ? `The invite was emailed to ${inviteEmail || "the affiliate"}`
        : data.emailQueued
          ? `The invite was created and the email is on its way to ${inviteEmail || "the affiliate"}.`
          : "The invite was created, but it was not emailed. Copy the code or signup link below and send it manually.";
      setMsg(`Affiliate invite ready. Code: ${data.invite.code}. Signup link: ${data.invite.registerLink}. ${deliveryMessage}`);
      setInviteEmail("");
      setInviteName("");
      loadAffiliateInvites();
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed"));
    }
  }

  async function handleSendPromo(e) {
    e.preventDefault();
    try {
      await api.sendPromo({ email: promoEmail, name: promoName, code: promoCode });
      setMsg("Promo code sent.");
      setPromoEmail("");
      setPromoCode("");
      setPromoName("");
    } catch (err) {
      setMsg("Error: " + (err.error || "Failed"));
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

  const tabs = ["stats", "flags", "inventory", "affiliates", "promo", "users"];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="bg-gray-900 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Konvict Artz Admin</h1>
          <p className="text-gray-400 text-xs">Logged in as {user.email}</p>
        </div>
        <button onClick={logout} className="text-sm text-gray-400 hover:text-white">Log Out</button>
      </div>

      <div className="flex gap-1 px-6 pt-4 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              tab === t ? "bg-brand text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {msg && (
        <div className="mx-6 mt-4 bg-gray-800 border border-gray-600 rounded-xl px-4 py-2 text-sm text-green-400">
          {msg} <button onClick={() => setMsg("")} className="ml-2 text-gray-500">x</button>
        </div>
      )}

      <div className="p-6">
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
                      <span className={`text-xs font-bold px-2 py-1 rounded ${invite.used ? "bg-gray-700 text-gray-300" : "bg-green-900/40 text-green-300"}`}>
                        {invite.used ? "used" : "open"}
                      </span>
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
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "promo" && (
          <div>
            <h2 className="text-lg font-bold mb-4">Send Promo Code</h2>
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
