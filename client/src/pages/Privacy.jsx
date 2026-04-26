import React from "react";
import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <Link to="/" className="text-brand hover:text-brand-light inline-block">
          &larr; Back to Home
        </Link>

        <div>
          <h1 className="text-3xl font-bold mb-3">Privacy Policy</h1>
          <p className="text-gray-400">Last updated: April 25, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Who This Policy Covers</h2>
          <p className="text-gray-300">
            This Privacy Policy applies to Dex AI Assistant, the Dex website, and related Android
            app features operated by Konvict Artz. It explains what data Dex accesses, collects,
            uses, stores, and shares when you create an account, use Dex voice and chat features,
            connect phone features, use reminders, manage tasks, or subscribe.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Information Dex Collects</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-300">
            <li>
              <strong>Account information:</strong> name, email address, password hash, access
              level, trial status, and account creation timestamps.
            </li>
            <li>
              <strong>Billing information:</strong> Stripe customer, checkout, and subscription
              identifiers, payment status, and limited transaction metadata. Dex does not store
              full card numbers.
            </li>
            <li>
              <strong>Chat and task content:</strong> messages you send to Dex, tasks, drafts,
              reminders, learning activity, and settings you choose to save.
            </li>
            <li>
              <strong>Phone-related data if enabled:</strong> caller labels, incoming/answered/
              declined call events, saved contact names used to identify callers or place calls, and
              call-control status. Dex uses phone state and contacts for these features. Dex does not
              require Call Log permission for the current Android feature set.
            </li>
            <li>
              <strong>Calendar data if enabled:</strong> Dex appointments and any connected calendar
              account information needed to create or sync events you approve.
            </li>
            <li>
              <strong>Voice data:</strong> microphone input processed by your device and Dex voice
              flows so Dex can hear commands and respond. Dex may store transcripts or resulting task
              content when needed to provide the feature you asked for.
            </li>
            <li>
              <strong>Device and app usage data:</strong> app settings, permission choices, reminder
              settings, backend connection settings, and basic operational logs.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. How Dex Uses Data</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-300">
            <li>Provide, secure, and maintain Dex accounts and subscriptions.</li>
            <li>Respond to chats, voice prompts, and assistant requests.</li>
            <li>Announce callers, answer or decline calls you approve, and place calls you request.</li>
            <li>Create tasks, reminders, communication drafts, and calendar items.</li>
            <li>Send account emails, billing notices, reminders, and service messages.</li>
            <li>Improve reliability, prevent abuse, and troubleshoot service issues.</li>
            <li>Comply with legal obligations and enforce our terms.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Sensitive Data and Memory Limits</h2>
          <p className="text-gray-300">
            Dex is designed to avoid storing highly sensitive personal information such as bank
            account details, payment card numbers, passwords, and Social Security numbers in Dex
            memory. If Dex detects that kind of information in a save-to-memory flow, Dex may refuse
            to store it and warn you.
          </p>
          <p className="text-gray-300">
            Paid memory features are limited by the settings and memory flows you choose to use.
            Admin users are not intended to see private user memory by default.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Sharing and Service Providers</h2>
          <p className="text-gray-300">Dex does not sell your personal data.</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300">
            <li>
              <strong>AI processing:</strong> Dex may send prompts and related context to AI
              providers such as OpenAI or another configured provider to generate responses.
            </li>
            <li>
              <strong>Payments:</strong> Stripe processes subscription checkout, billing portal
              actions, and payment events.
            </li>
            <li>
              <strong>Communications:</strong> RingCentral may be used for supported call or SMS
              flows, and SMTP/email providers may be used for email delivery.
            </li>
            <li>
              <strong>Calendar connections:</strong> Connected calendar providers such as Google
              Calendar may receive the event details needed to create or sync events you approve.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Retention and Deletion</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-300">
            <li>
              Dex chat history is currently trimmed to approximately 3 days for the short-term chat
              memory feature.
            </li>
            <li>
              Saved preferences, tasks, aliases, communications drafts, lesson history, and account
              records may remain until you delete them, close the account, or we need them for
              billing, security, or legal reasons.
            </li>
            <li>
              Billing records and subscription metadata may be retained as needed for accounting,
              fraud prevention, and legal compliance.
            </li>
            <li>
              You can request deletion of your account data by contacting us. Some records may be
              retained if required by law or needed to resolve disputes or enforce agreements.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Permissions and Device Access</h2>
          <p className="text-gray-300">
            Dex requests Android or browser permissions only for features you enable, such as phone
            state, contacts, microphone, calendar access, and notifications. Some Dex phone features
            can also continue in the background after sign-in, which is why Dex shows an in-app
            disclosure before requesting device permissions on Android.
          </p>
          <p className="text-gray-300">
            You can revoke device permissions at any time in your device settings or browser
            settings, although some Dex features may stop working until permission is restored.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Security</h2>
          <p className="text-gray-300">
            We use reasonable technical and organizational safeguards to protect account data and
            service infrastructure. No internet or device system is completely secure, so we cannot
            guarantee absolute security.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">9. Your Choices and Rights</h2>
          <p className="text-gray-300">
            Depending on where you live, you may have rights to access, correct, delete, or request
            a copy of certain personal data. You may also have the right to withdraw consent for
            optional features that rely on permissions or saved preferences.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">10. Contact</h2>
          <p className="text-gray-300">
            Questions, privacy requests, or deletion requests can be sent to:
            <br />
            <strong>Konvictartzllc@gmail.com</strong>
          </p>
        </section>
      </div>
    </div>
  );
}
