import { useState, useEffect } from "react";
import { api } from "../utils/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import AssistantHub from "../components/AssistantHub.jsx";
import CommunicationsCenter from "../components/CommunicationsCenter.jsx";
import LearningHub from "../components/LearningHub.jsx";
import Permissions from "../components/Permissions.jsx";
import Preferences from "../components/Preferences.jsx";

export default function AffiliateDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [cashoutForm, setCashoutForm] = useState({
    amount: "",
    payoutMethod: "cash_app",
    payoutDetails: "",
  });
  const [cashoutStatus, setCashoutStatus] = useState("");
  const [cashoutSubmitting, setCashoutSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadDashboard();
  }, [user]);

  async function loadDashboard() {
    setLoading(true);
    try {
      const dashboard = await api.getAffiliateDashboard();
      setData(dashboard);
      setCashoutForm((current) => ({
        ...current,
        amount: current.amount || Number(dashboard.availableToCashOut || 0).toFixed(2),
      }));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(data.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function downloadDexAssistant() {
    setDownloading(true);
    setDownloadStatus("");
    try {
      await api.downloadAffiliateAndroid();
      setDownloadStatus("Download started. Open the APK on your phone and allow install if Android asks.");
    } catch (err) {
      setDownloadStatus(err.detail || err.error || "Dex download is not ready yet.");
    } finally {
      setDownloading(false);
    }
  }

  async function requestCashout(e) {
    e.preventDefault();
    setCashoutSubmitting(true);
    setCashoutStatus("");
    try {
      await api.requestAffiliateCashout({
        amount: Number(cashoutForm.amount),
        payoutMethod: cashoutForm.payoutMethod,
        payoutDetails: cashoutForm.payoutDetails,
      });
      setCashoutStatus("Cash-out request sent. Konvict Artz will review it and send your payout.");
      setCashoutForm((current) => ({ ...current, payoutDetails: "" }));
      await loadDashboard();
    } catch (err) {
      setCashoutStatus(err.error || "Could not submit that cash-out request.");
    } finally {
      setCashoutSubmitting(false);
    }
  }

  const availableToCashOut = Number(data?.availableToCashOut || 0);
  const pendingPayouts = Number(data?.pendingPayouts || 0);
  const cashoutDisabled = cashoutSubmitting || availableToCashOut <= 0;

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Please <a href="/login" className="text-brand underline">log in</a> to view your affiliate dashboard.</p>
      </div>
    );
  }

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Loading...</div>;

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-2">You're not set up as an affiliate yet.</p>
          <p className="text-sm text-gray-500">Contact Konvict Artz to become an affiliate and start earning $2 per subscriber.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">Affiliate Dashboard</h1>
        <p className="text-gray-400 text-sm mb-6">Welcome back, {user.name || user.email}! Your affiliate account includes Dex access and learning tools.</p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-800 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-white">{data.signups}</p>
            <p className="text-xs text-gray-400 mt-1">Total Signups</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-white">{data.paidSubs}</p>
            <p className="text-xs text-gray-400 mt-1">Paid Subscribers</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-green-400">${data.earnings.toFixed(2)}</p>
            <p className="text-xs text-gray-400 mt-1">Total Earned</p>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-4 mb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-xl">
              <p className="text-xs uppercase tracking-wide text-brand mb-1">Cash Out</p>
              <h2 className="text-xl font-bold">Request Affiliate Payout</h2>
              <p className="text-sm text-gray-400 mt-1">
                Available now: <strong className="text-green-400">${availableToCashOut.toFixed(2)}</strong>
                {pendingPayouts > 0 && (
                  <span className="text-gray-500"> (${pendingPayouts.toFixed(2)} already pending)</span>
                )}
              </p>
            </div>

            <form onSubmit={requestCashout} className="w-full lg:max-w-md space-y-3">
              <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={availableToCashOut || undefined}
                  required
                  value={cashoutForm.amount}
                  onChange={(e) => setCashoutForm((p) => ({ ...p, amount: e.target.value }))}
                  disabled={cashoutDisabled}
                  className="bg-gray-700 text-sm text-white rounded-lg px-3 py-2 outline-none disabled:opacity-60"
                  aria-label="Cash-out amount"
                />
                <select
                  value={cashoutForm.payoutMethod}
                  onChange={(e) => setCashoutForm((p) => ({ ...p, payoutMethod: e.target.value }))}
                  disabled={cashoutDisabled}
                  className="bg-gray-700 text-sm text-white rounded-lg px-3 py-2 outline-none disabled:opacity-60"
                  aria-label="Payout method"
                >
                  <option value="cash_app">Cash App</option>
                  <option value="paypal">PayPal</option>
                  <option value="venmo">Venmo</option>
                  <option value="zelle">Zelle</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <input
                value={cashoutForm.payoutDetails}
                onChange={(e) => setCashoutForm((p) => ({ ...p, payoutDetails: e.target.value }))}
                disabled={cashoutDisabled}
                required
                placeholder="Username, email, phone, or payment instructions"
                className="w-full bg-gray-700 text-sm text-white rounded-lg px-3 py-2 outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={cashoutDisabled}
                className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 font-semibold text-sm transition-all"
              >
                {cashoutSubmitting ? "Sending Request..." : availableToCashOut > 0 ? "Request Cash Out" : "No Earnings Available"}
              </button>
              {cashoutStatus && (
                <p className={`text-sm ${cashoutStatus.includes("sent") ? "text-green-300" : "text-amber-300"}`}>
                  {cashoutStatus}
                </p>
              )}
            </form>
          </div>

          {data.payoutRequests?.length > 0 && (
            <div className="mt-5 border-t border-gray-700 pt-4">
              <h3 className="font-semibold mb-3">Recent Cash-Out Requests</h3>
              <div className="space-y-2">
                {data.payoutRequests.map((request) => (
                  <div key={request.id} className="flex flex-col gap-1 rounded-lg bg-gray-900/70 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <span className="font-semibold text-white">${Number(request.amount || 0).toFixed(2)}</span>
                      <span className="ml-2 text-gray-400">{request.payout_method.replace("_", " ")}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="rounded bg-brand/20 px-2 py-1 font-bold text-brand">{request.status}</span>
                      <span className="text-gray-500">{new Date(request.requested_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Promo Code */}
        <div className="bg-gray-800 rounded-xl p-4 mb-4">
          <p className="text-xs text-gray-400 mb-1">Your Promo Code</p>
          <p className="text-2xl font-bold tracking-widest text-brand">{data.promoCode}</p>
        </div>

        {/* Referral Link */}
        <div className="bg-gray-800 rounded-xl p-4 mb-6">
          <p className="text-xs text-gray-400 mb-2">Your Referral Link</p>
          <div className="flex gap-2">
            <input readOnly value={data.referralLink}
              className="flex-1 bg-gray-700 text-sm text-gray-300 rounded-lg px-3 py-2 outline-none" />
            <button onClick={copyLink}
              className="bg-brand hover:bg-brand-light text-white text-sm rounded-lg px-4 py-2 font-semibold transition-all">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-4 mb-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-brand mb-1">Affiliate Only</p>
              <h2 className="text-xl font-bold">Download Dex Assistant</h2>
              <p className="text-sm text-gray-400 mt-1">
                Install Dex on your Android phone so your affiliate account has the same assistant tools from the site.
              </p>
            </div>
            <button
              onClick={downloadDexAssistant}
              disabled={downloading}
              className="bg-brand hover:bg-brand-light disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg px-5 py-3 font-semibold transition-all"
            >
              {downloading ? "Preparing..." : "Download APK"}
            </button>
          </div>
          {downloadStatus && (
            <p className={`mt-3 text-sm ${downloadStatus.includes("not ready") || downloadStatus.includes("configured") ? "text-amber-300" : "text-green-300"}`}>
              {downloadStatus}
            </p>
          )}
          {!data.androidDownloadAvailable && (
            <p className="mt-3 text-xs text-gray-500">
              The affiliate download button is protected and ready. Add the APK URL on the backend to turn on live downloads.
            </p>
          )}
        </div>

        {/* How it works */}
        <div className="bg-gray-800 rounded-xl p-4 mb-6">
          <h3 className="font-bold mb-2">How It Works</h3>
          <ol className="text-sm text-gray-400 space-y-1 list-decimal list-inside">
            <li>Share your referral link or promo code</li>
            <li>People sign up for Dex AI using your code</li>
            <li>When they subscribe ($9.99/month), you earn <strong className="text-green-400">$2.00</strong></li>
            <li>Track all your earnings here in real time</li>
          </ol>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
            <Permissions />
          </section>
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-5">
            <Preferences />
          </section>
        </div>

        {data.recentSignups?.length > 0 && (
          <div className="mt-6">
            <h3 className="font-bold mb-3">Recent Signups</h3>
            <div className="space-y-2">
              {data.recentSignups.map((s, i) => (
                <div key={i} className="bg-gray-800 rounded-xl px-4 py-3 flex justify-between items-center">
                  <p className="text-sm">{s.name || s.email}</p>
                  <p className="text-xs text-gray-400">{new Date(s.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
