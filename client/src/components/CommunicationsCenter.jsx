import { useEffect, useState } from "react";
import { api } from "../utils/api";

export default function CommunicationsCenter() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [voicemailSummary, setVoicemailSummary] = useState(null);

  async function loadCommunications() {
    try {
      setError("");
      const data = await api.getCommunications();
      setDrafts(data.drafts || []);
      setVoicemailSummary(data.voicemailSummary || null);
    } catch (err) {
      setError(err?.message || "Dex could not load the communications center right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCommunications();
  }, []);

  async function handleDraftStatus(draft, status) {
    setBusy(`draft-${draft.id}`);
    setError("");
    setMessage("");
    try {
      await api.updateCommunicationDraft(draft.id, { status });
      setMessage(status === "approved" ? "Draft sent." : "Draft updated.");
      await loadCommunications();
    } catch (err) {
      setError(err?.message || "Dex could not update that draft.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Communications Center</h2>
        <p className="text-sm text-gray-400">
          Review Dex message drafts, approve sends, and keep an eye on missed-call pressure in one spot.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-700/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {message && (
        <div className="rounded-md border border-green-700/50 bg-green-900/20 px-3 py-2 text-sm text-green-200">
          {message}
        </div>
      )}

      <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Missed-call view</div>
            <h3 className="mt-1 text-lg font-semibold text-white">Voicemail-style summary</h3>
          </div>
          <button
            type="button"
            onClick={loadCommunications}
            className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-gray-500"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-gray-400">Dex is checking recent activity...</p>
        ) : (
          <div className="mt-4 rounded-md border border-blue-800/50 bg-blue-900/20 p-4">
            <div className="text-sm font-medium text-white">{voicemailSummary?.headline || "No recent call summary yet."}</div>
            <div className="mt-2 text-sm text-blue-100">
              {voicemailSummary?.summary || "Once Dex sees a few calls come through, this summary will sharpen up."}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
        <div className="text-xs uppercase tracking-wide text-gray-500">Approval inbox</div>
        <h3 className="mt-1 text-lg font-semibold text-white">Dex communication drafts</h3>

        <div className="mt-4 space-y-3">
          {drafts.length ? (
            drafts.map((draft) => (
              <div key={draft.id} className="rounded-md border border-gray-800 bg-gray-900 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">
                      {draft.channel === "sms" ? "Text draft" : "Email draft"} to {draft.target_name || draft.target_value}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {draft.target_value} • {draft.status} • {new Date(draft.created_at).toLocaleString()}
                    </div>
                    {draft.subject ? <div className="mt-2 text-sm text-gray-300">Subject: {draft.subject}</div> : null}
                    <div className="mt-2 whitespace-pre-wrap text-sm text-gray-200">{draft.body}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {draft.status === "pending" && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDraftStatus(draft, "approved")}
                          disabled={busy === `draft-${draft.id}`}
                          className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-light disabled:opacity-60"
                        >
                          Send Now
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDraftStatus(draft, "canceled")}
                          disabled={busy === `draft-${draft.id}`}
                          className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-gray-500 disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {draft.status !== "pending" && (
                      <span className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300">
                        {draft.status}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
              No communication drafts yet. When Dex drafts texts or emails for approval, they will show up here.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
