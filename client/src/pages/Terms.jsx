import React from "react";
import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <Link to="/" className="text-brand hover:text-brand-light inline-block">
          &larr; Back to Home
        </Link>

        <div>
          <h1 className="text-3xl font-bold mb-3">Terms of Service</h1>
          <p className="text-gray-400">Last updated: April 25, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Acceptance</h2>
          <p className="text-gray-300">
            By creating an account, downloading the Dex AI Assistant app, or using Dex web or mobile
            features, you agree to these Terms of Service. If you do not agree, do not use the
            service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. What Dex Provides</h2>
          <p className="text-gray-300">
            Dex is an AI assistant that can respond to chat and voice prompts, help with tasks,
            reminders, learning flows, drafts, calls, calendar items, and related assistant features.
            Some features depend on device permissions, connected third-party services, or a paid
            subscription.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Accounts and Security</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-300">
            <li>You must provide accurate registration information.</li>
            <li>You are responsible for activity under your account and for keeping credentials secure.</li>
            <li>You must promptly notify us if you believe your account has been compromised.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Trials, Subscriptions, and Billing</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-300">
            <li>Dex currently offers a free 3-day trial for eligible new accounts.</li>
            <li>
              After the trial ends, Dex access may be limited until you start a paid subscription.
            </li>
            <li>
              The current advertised subscription price is $9.99 per month unless changed with
              notice.
            </li>
            <li>
              Paid subscriptions are processed through Stripe and renew according to the subscription
              terms shown at checkout unless canceled.
            </li>
            <li>
              You can manage or cancel your subscription through the available billing settings or
              Stripe billing portal when enabled.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Permissions, Calls, and Communications</h2>
          <p className="text-gray-300">
            By enabling phone, microphone, contacts, calendar, or notification features, you
            authorize Dex to use those permissions to provide the features you requested. You are
            responsible for using communication features lawfully and for making sure you have the
            right to contact people, place calls, and send messages.
          </p>
          <p className="text-gray-300">
            Where Dex drafts messages, emails, or calls for approval, you remain responsible for the
            final content and recipients. You should review important actions before approving them.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. AI Limitations</h2>
          <p className="text-gray-300">
            Dex uses AI-generated outputs that may be incomplete, inaccurate, delayed, or unsuitable
            for your situation. Dex is not a lawyer, doctor, therapist, accountant, broker, or
            emergency response service. Do not rely on Dex as a substitute for professional advice or
            emergency assistance.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Acceptable Use</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-300">
            <li>Do not use Dex for unlawful, abusive, deceptive, or harmful activity.</li>
            <li>Do not try to break, reverse engineer, or interfere with the service.</li>
            <li>Do not use Dex to harass people, impersonate others, or bypass consent requirements.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Suspension and Termination</h2>
          <p className="text-gray-300">
            We may suspend or terminate access if we reasonably believe the service is being misused,
            if payment obligations are not met, or if continued access creates security, legal, or
            operational risk.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">9. Disclaimer and Liability Limits</h2>
          <p className="text-gray-300">
            Dex is provided on an &quot;as is&quot; and &quot;as available&quot; basis to the fullest extent
            permitted by law. We do not guarantee uninterrupted service, perfect recognition,
            guaranteed delivery, or error-free AI outputs.
          </p>
          <p className="text-gray-300">
            To the fullest extent permitted by law, Konvict Artz will not be liable for indirect,
            incidental, special, consequential, or punitive damages arising from use of Dex.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">10. Changes</h2>
          <p className="text-gray-300">
            We may update these terms from time to time. Continued use after updated terms are posted
            means you accept the revised terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">11. Contact</h2>
          <p className="text-gray-300">
            Questions about these terms can be sent to:
            <br />
            <strong>Konvictartzllc@gmail.com</strong>
          </p>
        </section>
      </div>
    </div>
  );
}
