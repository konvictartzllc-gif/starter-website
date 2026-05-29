import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../utils/api.js";

const SERVICES = ["Lawn Care", "Cleaning", "Handyman", "Electronics"];

export default function Booking() {
  const [searchParams] = useSearchParams();
  const [serviceArea, setServiceArea] = useState(["35580", "35501", "35579", "35148", "35549"]);
  const [form, setForm] = useState({
    service: searchParams.get("service") || "Lawn Care",
    name: "",
    email: "",
    phone: "",
    zip_code: "",
    address: "",
    preferred_date: "",
    preferred_time: "",
    notes: "",
  });
  const [areaStatus, setAreaStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.getServiceArea()
      .then((data) => setServiceArea(data.zips || serviceArea))
      .catch(() => {});
  }, []);

  async function checkZip(zip) {
    const cleanZip = String(zip || "").replace(/\D/g, "").slice(0, 5);
    setForm((prev) => ({ ...prev, zip_code: cleanZip }));
    if (cleanZip.length !== 5) {
      setAreaStatus(null);
      return;
    }
    try {
      const data = await api.getServiceArea(cleanZip);
      setAreaStatus(data.inArea ? "in" : "out");
    } catch {
      setAreaStatus(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const data = await api.createBooking(form);
      setMessage(data.message || "Your appointment request was sent.");
      setAreaStatus("in");
      setForm((prev) => ({
        ...prev,
        name: "",
        email: "",
        phone: "",
        address: "",
        preferred_date: "",
        preferred_time: "",
        notes: "",
      }));
    } catch (err) {
      setMessage(err.message || err.error || "Could not send the booking request.");
      if (err.error === "outside_service_area") setAreaStatus("out");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Book Konvict Artz</h1>
            <p className="text-sm text-gray-400">Full services are available in ZIP codes {serviceArea.join(", ")}.</p>
          </div>
          <Link to="/" className="text-sm font-semibold text-brand hover:text-brand-light">Back Home</Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand">Service Area</p>
          <h2 className="mt-2 text-xl font-black">Where we offer all services</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {serviceArea.map((zip) => (
              <span key={zip} className="rounded-md bg-gray-800 px-3 py-2 text-sm font-bold text-gray-100">{zip}</span>
            ))}
          </div>
          <p className="mt-4 text-sm leading-6 text-gray-400">
            If the customer is inside one of these ZIP codes, they can submit an appointment request. If they are outside the area, Dex blocks the booking for now so you do not get jobs you cannot service yet.
          </p>
        </section>

        <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <h2 className="text-xl font-black">Appointment Request</h2>
          <p className="mt-1 text-sm text-gray-400">Send the request first, then Konvict Artz confirms the exact appointment time.</p>

          {message && (
            <div className={`mt-4 rounded-md border px-4 py-3 text-sm ${
              areaStatus === "out" ? "border-red-700 bg-red-900/30 text-red-100" : "border-brand/40 bg-brand/10 text-gray-100"
            }`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
            <label className="grid gap-2 text-sm font-semibold text-gray-200">
              Service
              <select
                value={form.service}
                onChange={(event) => setForm((prev) => ({ ...prev, service: event.target.value }))}
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-3 text-white outline-none focus:border-brand"
              >
                {SERVICES.map((service) => <option key={service}>{service}</option>)}
              </select>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold text-gray-200">
                Name
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-3 text-white outline-none focus:border-brand"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-gray-200">
                ZIP Code
                <input
                  inputMode="numeric"
                  value={form.zip_code}
                  onChange={(event) => checkZip(event.target.value)}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-3 text-white outline-none focus:border-brand"
                  required
                />
              </label>
            </div>

            {areaStatus && (
              <p className={`rounded-md px-3 py-2 text-sm font-semibold ${
                areaStatus === "in" ? "bg-green-900/40 text-green-300" : "bg-red-900/40 text-red-300"
              }`}>
                {areaStatus === "in"
                  ? "This ZIP code is inside the Konvict Artz service area."
                  : "This ZIP code is outside the current full-service area."}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold text-gray-200">
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-3 text-white outline-none focus:border-brand"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-gray-200">
                Phone
                <input
                  value={form.phone}
                  onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-3 text-white outline-none focus:border-brand"
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm font-semibold text-gray-200">
              Address
              <input
                value={form.address}
                onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-3 text-white outline-none focus:border-brand"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold text-gray-200">
                Preferred Date
                <input
                  type="date"
                  value={form.preferred_date}
                  onChange={(event) => setForm((prev) => ({ ...prev, preferred_date: event.target.value }))}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-3 text-white outline-none focus:border-brand"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-gray-200">
                Preferred Time
                <input
                  type="time"
                  value={form.preferred_time}
                  onChange={(event) => setForm((prev) => ({ ...prev, preferred_time: event.target.value }))}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-3 text-white outline-none focus:border-brand"
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm font-semibold text-gray-200">
              Job Details
              <textarea
                rows={4}
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                className="rounded-md border border-gray-700 bg-gray-800 px-3 py-3 text-white outline-none focus:border-brand"
                placeholder="Tell us what needs done, gate codes, yard size, rooms, repair details, or anything helpful."
              />
            </label>

            <button
              type="submit"
              disabled={loading || areaStatus === "out"}
              className="rounded-md bg-brand px-5 py-3 font-bold text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Sending..." : "Request Appointment"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
