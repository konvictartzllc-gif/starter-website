import { useState, useEffect } from "react";
import { api } from "../utils/api.js";
import { useAuth } from "../hooks/useAuth.jsxx";

export default function AffiliateDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.getAffiliateDashboard()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [user]);

  function copyLink() {
    navigator.clipboard.writeText(data.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">Affiliate Dashboard</h1>
        <p className="text-gray-400 text-sm mb-6">Welcome back, {user.name || user.email}!</p>

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

        {/* Recent Signups */}
        {data.recentSignups?.length > 0 && (
          <div>
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
