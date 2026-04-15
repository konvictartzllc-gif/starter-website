import React from "react";
import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-brand hover:text-brand-light mb-8 inline-block">← Back to Home</Link>
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
        <p className="text-gray-400 mb-4">Last Updated: April 14, 2026</p>
        
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">1. Introduction</h2>
          <p className="text-gray-400">
            Welcome to Konvict Artz ("we," "our," or "us"). We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you visit our website and use our services, including our Dex AI system.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">2. Information We Collect</h2>
          <p className="text-gray-400 mb-2">We collect personal information that you voluntarily provide to us when you:</p>
          <ul className="list-disc list-inside text-gray-400 space-y-2 ml-4">
            <li>Register for an account or a free trial.</li>
            <li>Interact with our Dex AI voice assistant.</li>
            <li>Book services (lawn care, cleaning, handyman, etc.).</li>
            <li>Make payments for subscriptions or services.</li>
            <li>Contact our support team.</li>
          </ul>
          <p className="text-gray-400 mt-2">
            This information may include your name, email address, phone number, billing address, payment information, and voice recordings or transcripts from your interactions with Dex AI.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">3. How We Use Your Information</h2>
          <p className="text-gray-400 mb-2">We use your information to:</p>
          <ul className="list-disc list-inside text-gray-400 space-y-2 ml-4">
            <li>Provide and maintain our services.</li>
            <li>Process your bookings and payments.</li>
            <li>Improve Dex AI's ability to remember your preferences and history.</li>
            <li>Communicate with you about your account and services.</li>
            <li>Send promotional materials (with your consent).</li>
            <li>Comply with legal obligations.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">4. Data Sharing and Third Parties</h2>
          <p className="text-gray-400">
            We do not sell your personal information. We may share data with trusted third-party service providers to perform functions on our behalf, such as payment processing (Stripe/Square), email delivery, and AI processing (OpenAI). These providers are obligated to protect your data.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">5. Data Security</h2>
          <p className="text-gray-400">
            We implement industry-standard security measures, including encryption and secure servers, to protect your data. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">6. Your Rights</h2>
          <p className="text-gray-400">
            Depending on your location, you may have rights regarding your personal data, including the right to access, correct, or delete your information. To exercise these rights, please contact us at the email provided below.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">7. Contact Us</h2>
          <p className="text-gray-400">
            If you have any questions about this Privacy Policy, please contact us at:
            <br />
            <strong>Email:</strong> Konvictartzllc@gmail.com
          </p>
        </section>
      </div>
    </div>
  );
}