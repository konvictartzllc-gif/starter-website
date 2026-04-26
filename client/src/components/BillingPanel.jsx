import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../utils/api";
import { useAuth } from "../hooks/useAuth.jsx";

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getStatusTone(accessType) {
  switch (accessType) {
    case "paid":
      return "bg-green-900/40 text-green-300 border-green-700/60";
    case "trial":
      return "bg-blue-900/40 text-blue-300 border-blue-700/60";
    case "expired":
      return "bg-red-900/40 text-red-300 border-red-700/60";
    case "unlimited":
      return "bg-purple-900/40 text-purple-300 border-purple-700/60";
    default:
      return "bg-gray-800 text-gray-200 border-gray-700";
  }
}

function getStatusLabel(accessType) {
  switch (accessType) {
    case "paid":
      return "Paid";
    case "trial":
      return "Trial";
    case "expired":
      return "Expired";
    case "unlimited":
      return "Unlimited";
    default:
      return "Inactive";
  }
}

export default function BillingPanel() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const billingNotice = useMemo(() => {
    const flag = searchParams.get("billing");
    if (flag === "success") return "Your billing update went through.";
    if (flag === "cancelled") return "Checkout was cancelled. Your account has not been changed.";
    if (flag === "recovery") return "Dex brought you here to recover access and get billing back on track.";
    return "";
  }, [searchParams]);

  const recoveryReason = searchParams.get("reason");
  const recoveryDetail = useMemo(() => {
    if (recoveryReason === "trial_expired") return "Your free trial ended, so the next step is starting your subscription.";
    if (recoveryReason === "subscription_expired") return "Your subscription needs to be restarted so Dex can open back up.";
    if (recoveryReason === "no_access") return "Dex needs an account with trial or paid access before chat can continue.";
    return "";
  }, [recoveryReason]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let active = true;
    api.getPaymentStatus()
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch((err) => {
        if (active) setError(err?.message || "Failed to load billing status.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  async function handleCheckout() {
    setBusy("checkout");
    setError("");
    try {
      const data = await api.createCheckoutSession();
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      throw new Error("Stripe checkout URL was missing.");
    } catch (err) {
      const message =
        err?.error === "payment_provider_unreachable"
          ? "Dex could not reach Stripe right now. Give it a moment and try again."
          : (err?.message || "Could not start Stripe checkout.");
      setError(message);
      setBusy("");
    }
  }

  async function handlePortal() {
    setBusy("portal");
    setError("");
    try {
      const data = await api.openBillingPortal();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error("Stripe portal URL was missing.");
    } catch (err) {
      setError(err?.message || "Could not open billing portal.");
      setBusy("");
    }
  }

  if (!user) {
    return (
      <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Billing</h2>
          <p className="text-sm text-gray-400">Sign in to start your 3-day Dex trial or manage your subscription.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/register" className="bg-brand hover:bg-brand-light text-white font-semibold px-4 py-2 rounded-md transition-colors">
            Start Free Trial
          </Link>
          <Link to="/login" className="border border-gray-700 hover:border-gray-500 text-gray-200 font-semibold px-4 py-2 rounded-md transition-colors">
            Log In
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Billing</h2>
          <p className="text-sm text-gray-400">Trial, subscription, and payment management for Dex.</p>
        </div>
        <span className={`inline-flex items-center border rounded-md px-3 py-1 text-sm font-medium ${getStatusTone(status?.access_type)}`}>
          {getStatusLabel(status?.access_type)}
        </span>
      </div>

      {billingNotice && (
        <div className="rounded-md border border-green-700/60 bg-green-900/30 px-3 py-2 text-sm text-green-200">
          {billingNotice}
        </div>
      )}

      {recoveryDetail && (
        <div className="rounded-md border border-blue-700/60 bg-blue-900/30 px-3 py-2 text-sm text-blue-200">
          {recoveryDetail}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-700/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading billing status...</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-gray-800 bg-gray-950 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Plan</div>
              <div className="mt-1 text-white font-medium">$9.99 / month</div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Trial Days Left</div>
              <div className="mt-1 text-white font-medium">
                {status?.trialDaysLeft ?? 0}
              </div>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Renews / Ends</div>
              <div className="mt-1 text-white font-medium">
                {status?.sub_expires ? formatDate(status.sub_expires) : "Not scheduled"}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-gray-300">
            {status?.access_type === "paid" && "Your Dex subscription is active. You can manage payment method or cancel in the billing portal."}
            {status?.access_type === "trial" && "Your 3-day trial is active. Start Stripe checkout now to roll straight into paid access without interruption."}
            {status?.access_type === "expired" && "Your Dex access has expired. Restart it with a Stripe subscription."}
            {!status?.access_type && "Billing status is available after your account is loaded."}
          </div>

          <div className="flex flex-wrap gap-3">
            {status?.access_type !== "paid" && status?.access_type !== "unlimited" && (
              <button
                type="button"
                onClick={handleCheckout}
                disabled={busy === "checkout"}
                className="bg-brand hover:bg-brand-light text-white font-semibold px-4 py-2 rounded-md transition-colors disabled:opacity-60"
              >
                {busy === "checkout" ? "Opening Stripe..." : "Start Subscription"}
              </button>
            )}

            {(status?.stripe_customer_id || status?.access_type === "paid") && (
              <button
                type="button"
                onClick={handlePortal}
                disabled={busy === "portal"}
                className="border border-gray-700 hover:border-gray-500 text-gray-100 font-semibold px-4 py-2 rounded-md transition-colors disabled:opacity-60"
              >
                {busy === "portal" ? "Opening Portal..." : "Manage Billing"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
