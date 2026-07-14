import { useEffect, useState } from "react";
import { api } from "../utils/api";

const EMPTY_APPT = { title: "", description: "", start_time: "", end_time: "" };
const EMPTY_SPECIAL = { title: "", date: "", kind: "reminder", recur_yearly: false, notes: "" };
const KIND_LABELS = { birthday: "🎂 Birthday", anniversary: "💍 Anniversary", holiday: "🎉 Holiday", reminder: "📌 Reminder" };

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

export default function CalendarView() {
  const [appointments, setAppointments] = useState([]);
  const [specialDays, setSpecialDays] = useState([]);
  const [apptForm, setApptForm] = useState(EMPTY_APPT);
  const [specialForm, setSpecialForm] = useState(EMPTY_SPECIAL);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState("appointments");

  async function loadAll() {
    try {
      setError("");
      const [appts, specials] = await Promise.all([
        api.getAppointments(),
        api.getSpecialDays().catch(() => ({ specialDays: [] })),
      ]);
      setAppointments(Array.isArray(appts) ? appts : (appts.appointments || []));
      setSpecialDays(specials.specialDays || []);
    } catch (err) {
      setError(err?.message || "Dex could not load your calendar right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleAddAppointment(e) {
    e.preventDefault();
    setBusy("appt");
    setError(""); setMessage("");
    try {
      await api.saveAppointment({
        title: apptForm.title,
        description: apptForm.description || undefined,
        start_time: new Date(apptForm.start_time).toISOString(),
        end_time: apptForm.end_time ? new Date(apptForm.end_time).toISOString() : undefined,
      });
      setApptForm(EMPTY_APPT);
      setMessage("Appointment saved. Dex will remind you before it starts.");
      await loadAll();
    } catch (err) {
      setError(err?.message || "Dex could not save that appointment.");
    } finally { setBusy(""); }
  }

  async function handleDeleteAppointment(id) {
    setBusy(`del-appt-${id}`);
    setError(""); setMessage("");
    try {
      await api.deleteAppointment(id);
      await loadAll();
    } catch (err) {
      setError(err?.message || "Dex could not delete that appointment.");
    } finally { setBusy(""); }
  }

  async function handleAddSpecialDay(e) {
    e.preventDefault();
    setBusy("special");
    setError(""); setMessage("");
    try {
      await api.createSpecialDay({
        title: specialForm.title,
        date: specialForm.date,
        kind: specialForm.kind,
        recur_yearly: specialForm.recur_yearly ? 1 : 0,
        notes: specialForm.notes || undefined,
      });
      setSpecialForm(EMPTY_SPECIAL);
      setMessage("Special day saved. Dex will notify you on the day.");
      await loadAll();
    } catch (err) {
      setError(err?.message || "Dex could not save that special day.");
    } finally { setBusy(""); }
  }

  async function handleDeleteSpecialDay(id) {
    setBusy(`del-special-${id}`);
    setError(""); setMessage("");
    try {
      await api.deleteSpecialDay(id);
      await loadAll();
    } catch (err) {
      setError(err?.message || "Dex could not delete that special day.");
    } finally { setBusy(""); }
  }

  const upcoming = appointments
    .filter((a) => new Date(a.start_time) >= new Date())
    .slice(0, 20);
  const past = appointments
    .filter((a) => new Date(a.start_time) < new Date())
    .slice(0, 10);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Calendar & Reminders</h2>
        <p className="text-sm text-gray-400">
          Dex tracks your appointments and special days, and sends you SMS/email reminders automatically.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-700/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">{error}</div>
      )}
      {message && (
        <div className="rounded-md border border-green-700/50 bg-green-900/20 px-3 py-2 text-sm text-green-200">{message}</div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-2 border-b border-gray-800 pb-1">
        {["appointments", "special-days"].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${
              tab === t
                ? "bg-gray-900 text-white border border-b-0 border-gray-700"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t === "appointments" ? "Appointments" : "Special Days"}
          </button>
        ))}
      </div>

      {tab === "appointments" && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr,1fr]">
          {/* Upcoming appointments */}
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">Upcoming</div>
                <button
                  type="button"
                  onClick={loadAll}
                  className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-gray-500"
                >
                  Refresh
                </button>
              </div>

              {loading ? (
                <p className="text-sm text-gray-400">Loading your calendar…</p>
              ) : upcoming.length ? (
                <div className="space-y-3">
                  {upcoming.map((a) => (
                    <div key={a.id} className="flex items-start justify-between gap-3 rounded-md border border-gray-800 bg-gray-900 p-3">
                      <div>
                        <div className="text-sm font-medium text-white">{a.title}</div>
                        {a.description && <div className="mt-0.5 text-xs text-gray-400">{a.description}</div>}
                        <div className="mt-1 text-xs text-blue-300">{formatDateTime(a.start_time)}</div>
                        {a.end_time && (
                          <div className="text-xs text-gray-500">Ends {formatDateTime(a.end_time)}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteAppointment(a.id)}
                        disabled={busy === `del-appt-${a.id}`}
                        className="shrink-0 rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:border-red-600 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No upcoming appointments. Add one and Dex will remind you.</p>
              )}

              {past.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs uppercase tracking-wide text-gray-600 hover:text-gray-400">
                    Past appointments ({past.length})
                  </summary>
                  <div className="mt-3 space-y-2">
                    {past.map((a) => (
                      <div key={a.id} className="flex items-start justify-between gap-3 rounded-md border border-gray-800 bg-gray-900/50 p-3 opacity-70">
                        <div>
                          <div className="text-sm font-medium text-gray-300">{a.title}</div>
                          <div className="mt-1 text-xs text-gray-500">{formatDateTime(a.start_time)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteAppointment(a.id)}
                          disabled={busy === `del-appt-${a.id}`}
                          className="shrink-0 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-red-800 hover:text-red-300 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>

          {/* Add appointment form */}
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">Add Appointment</div>
            <form onSubmit={handleAddAppointment} className="space-y-3">
              <input
                type="text"
                placeholder="Title (e.g. Doctor visit)"
                value={apptForm.title}
                onChange={(e) => setApptForm((p) => ({ ...p, title: e.target.value }))}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-600"
                required
              />
              <textarea
                placeholder="Details (optional)"
                value={apptForm.description}
                onChange={(e) => setApptForm((p) => ({ ...p, description: e.target.value }))}
                className="w-full min-h-[64px] rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-600"
              />
              <div>
                <label className="block text-xs text-gray-400 mb-1">Start time</label>
                <input
                  type="datetime-local"
                  value={apptForm.start_time}
                  onChange={(e) => setApptForm((p) => ({ ...p, start_time: e.target.value }))}
                  className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-600"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">End time (optional)</label>
                <input
                  type="datetime-local"
                  value={apptForm.end_time}
                  onChange={(e) => setApptForm((p) => ({ ...p, end_time: e.target.value }))}
                  className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-600"
                />
              </div>
              <p className="text-xs text-gray-500">
                Dex will automatically send you SMS/email reminders 15 minutes, 1 hour, and 1 day before.
              </p>
              <button
                type="submit"
                disabled={busy === "appt"}
                className="w-full rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
              >
                {busy === "appt" ? "Saving…" : "Save Appointment"}
              </button>
            </form>
          </div>
        </div>
      )}

      {tab === "special-days" && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr,1fr]">
          {/* Special days list */}
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Marked Days</div>
              <button
                type="button"
                onClick={loadAll}
                className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-gray-500"
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : specialDays.length ? (
              <div className="space-y-3">
                {specialDays.map((sd) => (
                  <div key={sd.id} className="flex items-start justify-between gap-3 rounded-md border border-gray-800 bg-gray-900 p-3">
                    <div>
                      <div className="text-sm font-medium text-white">
                        {KIND_LABELS[sd.kind] || "📌"} {sd.title}
                      </div>
                      <div className="mt-0.5 text-xs text-blue-300">
                        {formatDate(sd.date)}{sd.recur_yearly ? " · repeats yearly" : ""}
                      </div>
                      {sd.notes && <div className="mt-1 text-xs text-gray-400">{sd.notes}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteSpecialDay(sd.id)}
                      disabled={busy === `del-special-${sd.id}`}
                      className="shrink-0 rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:border-red-600 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                No special days yet. Add birthdays, anniversaries, or holidays and Dex will notify you on the day.
              </p>
            )}
          </div>

          {/* Add special day form */}
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">Mark a Special Day</div>
            <form onSubmit={handleAddSpecialDay} className="space-y-3">
              <input
                type="text"
                placeholder="Name (e.g. Mom's Birthday)"
                value={specialForm.title}
                onChange={(e) => setSpecialForm((p) => ({ ...p, title: e.target.value }))}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-600"
                required
              />
              <div>
                <label className="block text-xs text-gray-400 mb-1">Date</label>
                <input
                  type="date"
                  value={specialForm.date}
                  onChange={(e) => setSpecialForm((p) => ({ ...p, date: e.target.value }))}
                  className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-600"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Type</label>
                <select
                  value={specialForm.kind}
                  onChange={(e) => setSpecialForm((p) => ({ ...p, kind: e.target.value }))}
                  className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-600"
                >
                  <option value="birthday">🎂 Birthday</option>
                  <option value="anniversary">💍 Anniversary</option>
                  <option value="holiday">🎉 Holiday</option>
                  <option value="reminder">📌 Reminder</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={specialForm.recur_yearly}
                  onChange={(e) => setSpecialForm((p) => ({ ...p, recur_yearly: e.target.checked }))}
                  className="accent-blue-500"
                />
                Repeat every year
              </label>
              <textarea
                placeholder="Notes (optional)"
                value={specialForm.notes}
                onChange={(e) => setSpecialForm((p) => ({ ...p, notes: e.target.value }))}
                className="w-full min-h-[56px] rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-600"
              />
              <p className="text-xs text-gray-500">
                Dex will send you a notification on the day via SMS/email.
              </p>
              <button
                type="submit"
                disabled={busy === "special"}
                className="w-full rounded-md bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-600 disabled:opacity-60"
              >
                {busy === "special" ? "Saving…" : "Mark This Day"}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
