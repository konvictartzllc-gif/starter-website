import React from "react";
import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-brand hover:text-brand-light mb-8 inline-block">← Back to Home</Link>
        <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
        <p className="text-gray-400 mb-4">Last Updated: April 14, 2026</p>
        
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
          <p className="text-gray-400">
            By accessing or using the Konvict Artz website and services, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">2. Services Provided</h2>
          <p className="text-gray-400">
            Konvict Artz provides a platform for booking lawn care, cleaning, handyman repair, and electronics services. We also provide the Dex AI voice assistant to help manage your bookings and preferences.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">3. Subscriptions and Free Trials</h2>
          <p className="text-gray-400 mb-2">
            We offer a free 3-day trial for our Dex AI subscription. After the trial period, you will be charged $9.99 per month unless you cancel.
          </p>
          <ul className="list-disc list-inside text-gray-400 space-y-2 ml-4">
            <li>Subscriptions are billed monthly in advance.</li>
            <li>You may cancel your subscription at any time through your account settings.</li>
            <li>No refunds are provided for partial months of service.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">4. User Responsibilities</h2>
          <p className="text-gray-400 mb-2">As a user, you agree to:</p>
          <ul className="list-disc list-inside text-gray-400 space-y-2 ml-4">
            <li>Provide accurate and complete information when registering.</li>
            <li>Maintain the security of your account credentials.</li>
            <li>Use our services only for lawful purposes.</li>
            <li>Not attempt to hack, disrupt, or misuse our services or Dex AI.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">5. Dex AI Usage</h2>
          <p className="text-gray-400">
            Dex AI is designed to assist with bookings and information. While we strive for accuracy, we are not responsible for any errors or omissions in the information provided by Dex AI. You are responsible for verifying all booking details.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">6. Limitation of Liability</h2>
          <p className="text-gray-400">
            To the maximum extent permitted by law, Konvict Artz shall not be liable for any indirect, incidental, special, or consequential damages arising out of or in connection with your use of our services.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">7. Changes to Terms</h2>
          <p className="text-gray-400">
            We reserve the right to modify these Terms of Service at any time. We will notify you of any changes by posting the new terms on this page. Your continued use of our services after such changes constitutes your acceptance of the new terms.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">8. Contact Us</h2>
          <p className="text-gray-400">
            If you have any questions about these Terms of Service, please contact us at:
            <br />
            <strong>Email:</strong> Konvictartzllc@gmail.com
          </p>
        </section>
      </div>
    </div>
  );
}