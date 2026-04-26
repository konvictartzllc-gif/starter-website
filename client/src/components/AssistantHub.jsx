import { useEffect, useState } from "react";
import { api } from "../utils/api";

const EMPTY_TASK = { title: "", details: "", due_at: "" };
const EMPTY_ALIAS = { alias: "", contact_name: "" };

export default function AssistantHub() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [briefing, setBriefing] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [aliases, setAliases] = useState([]);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [aliasForm, setAliasForm] = useState(EMPTY_ALIAS);

  async function loadAll() {
    try {
      setError("");
      const [briefingData, tasksData, followUpsData, aliasesData] = await Promise.all([
        api.getBriefing(),
        api.getTasks(),
        api.getFollowUps(),
        api.getRelationshipAliases(),
      ]);
      setBriefing(briefingData.briefing || null);
      setTasks(tasksData.tasks || []);
      setSuggestions(followUpsData.suggestions || []);
      setAliases(aliasesData.aliases || []);
    } catch (err) {
      setError(err?.message || "Dex could not load the assistant hub right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleAddTask(e) {
    e.preventDefault();
    setBusy("task");
    setError("");
    setMessage("");
    try {
      await api.createTask({
        title: taskForm.title,
        details: taskForm.details,
        due_at: taskForm.due_at ? new Date(taskForm.due_at).toISOString() : null,
        kind: "task",
        source: "assistant_hub",
      });
      setTaskForm(EMPTY_TASK);
      setMessage("Task saved.");
      await loadAll();
    } catch (err) {
      setError(err?.message || "Dex could not save that task.");
    } finally {
      setBusy("");
    }
  }

  async function handleTaskStatus(task, status) {
    setBusy(`task-${task.id}`);
    setError("");
    setMessage("");
    try {
      await api.updateTask(task.id, { status });
      await loadAll();
    } catch (err) {
      setError(err?.message || "Dex could not update that task.");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteTask(taskId) {
    setBusy(`task-${taskId}`);
    setError("");
    setMessage("");
    try {
      await api.deleteTask(taskId);
      await loadAll();
    } catch (err) {
      setError(err?.message || "Dex could not delete that task.");
    } finally {
      setBusy("");
    }
  }

  async function handleSaveAlias(e) {
    e.preventDefault();
    setBusy("alias");
    setError("");
    setMessage("");
    try {
      await api.saveRelationshipAlias(aliasForm);
      setAliasForm(EMPTY_ALIAS);
      setMessage("Relationship alias saved.");
      await loadAll();
    } catch (err) {
      setError(err?.message || "Dex could not save that relationship alias.");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteAlias(aliasId) {
    setBusy(`alias-${aliasId}`);
    setError("");
    setMessage("");
    try {
      await api.deleteRelationshipAlias(aliasId);
      await loadAll();
    } catch (err) {
      setError(err?.message || "Dex could not delete that alias.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Assistant Hub</h2>
        <p className="text-sm text-gray-400">
          Dex now pulls your daily briefing, open tasks, follow-up suggestions, and relationship aliases into one place.
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

      <div className="grid gap-4 lg:grid-cols-[1.25fr,0.95fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Morning Briefing</div>
                <h3 className="mt-1 text-lg font-semibold text-white">Your day with Dex</h3>
              </div>
              <button
                type="button"
                onClick={loadAll}
                className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-gray-500"
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <p className="mt-4 text-sm text-gray-400">Dex is building your briefing...</p>
            ) : briefing ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <StatCard label="Today’s agenda" value={briefing.agenda?.length ?? 0} />
                  <StatCard label="Open priorities" value={briefing.priorities?.length ?? 0} />
                  <StatCard label="Recent missed calls" value={briefing.calls?.missed ?? 0} />
                </div>

                <div className="rounded-md border border-blue-800/50 bg-blue-900/20 p-4">
                  <div className="text-xs uppercase tracking-wide text-blue-300">Highlights</div>
                  <ul className="mt-2 space-y-2 text-sm text-blue-100">
                    {(briefing.highlights || []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-md border border-gray-800 bg-gray-900 p-4">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Agenda</div>
                    <div className="mt-3 space-y-3">
                      {(briefing.agenda || []).length ? (
                        briefing.agenda.map((item) => (
                          <div key={item.id} className="text-sm text-gray-200">
                            <div className="font-medium text-white">{item.title}</div>
                            <div className="text-xs text-gray-400">{formatDateTime(item.time)}</div>
                            {item.description ? <div className="mt-1 text-gray-400">{item.description}</div> : null}
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-gray-400">No calendar items yet for today.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-gray-800 bg-gray-900 p-4">
                    <div className="text-xs uppercase tracking-wide text-gray-500">Dex Recommends</div>
                    <div className="mt-3 text-sm text-gray-200">
                      {briefing.nextLesson ? (
                        <>
                          <div className="font-medium text-white">{briefing.nextLesson.topic}</div>
                          <div className="mt-1 text-gray-400">{briefing.nextLesson.reason}</div>
                        </>
                      ) : (
                        <div className="text-gray-400">No recommendation yet. A quick check-in with Dex will sharpen this.</div>
                      )}
                    </div>
                    {briefing.latestLesson && (
                      <div className="mt-4 rounded-md border border-gray-800 bg-gray-950 p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500">Latest lesson</div>
                        <div className="mt-1 font-medium text-white">{briefing.latestLesson.title}</div>
                        <div className="mt-1 text-xs text-gray-400">{briefing.latestLesson.language || "General"} • {briefing.latestLesson.level || "mixed"}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">Action Center</div>
            <h3 className="mt-1 text-lg font-semibold text-white">Open tasks and follow-ups</h3>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <form onSubmit={handleAddTask} className="rounded-md border border-gray-800 bg-gray-900 p-4 space-y-3">
                <div className="text-sm font-medium text-white">Add a task</div>
                <input
                  type="text"
                  placeholder="Call back the accountant"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none"
                  required
                />
                <textarea
                  placeholder="Any detail Dex should keep with it"
                  value={taskForm.details}
                  onChange={(e) => setTaskForm((prev) => ({ ...prev, details: e.target.value }))}
                  className="min-h-[92px] w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none"
                />
                <input
                  type="datetime-local"
                  value={taskForm.due_at}
                  onChange={(e) => setTaskForm((prev) => ({ ...prev, due_at: e.target.value }))}
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none"
                />
                <button
                  type="submit"
                  disabled={busy === "task"}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
                >
                  {busy === "task" ? "Saving..." : "Save Task"}
                </button>
              </form>

              <div className="space-y-3 rounded-md border border-gray-800 bg-gray-900 p-4">
                <div className="text-sm font-medium text-white">Dex follow-up suggestions</div>
                {(suggestions || []).length ? (
                  suggestions.map((item, index) => (
                    <div key={`${item.type}-${item.title}-${index}`} className="rounded-md border border-gray-800 bg-gray-950 p-3">
                      <div className="text-sm font-medium text-white">{item.title}</div>
                      <div className="mt-1 text-sm text-gray-400">{item.detail}</div>
                      <div className="mt-2 text-xs text-blue-300">{item.suggestedAction}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-gray-400">Dex does not see anything urgent to follow up right now.</div>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(tasks || []).length ? tasks.map((task) => (
                <div key={task.id} className="flex flex-col gap-3 rounded-md border border-gray-800 bg-gray-900 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">{task.title}</div>
                    <div className="mt-1 text-sm text-gray-400">{task.details || "No extra detail saved."}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {task.due_at ? `Due ${formatDateTime(task.due_at)}` : "No due time set"} • {task.status.replace("_", " ")}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleTaskStatus(task, "in_progress")}
                      disabled={busy === `task-${task.id}` || task.status === "in_progress"}
                      className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-gray-500 disabled:opacity-60"
                    >
                      Start
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTaskStatus(task, "done")}
                      disabled={busy === `task-${task.id}` || task.status === "done"}
                      className="rounded-md bg-green-700 px-3 py-2 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-60"
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task.id)}
                      disabled={busy === `task-${task.id}`}
                      className="rounded-md border border-red-800 px-3 py-2 text-xs font-semibold text-red-200 hover:border-red-600 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )) : (
                <div className="rounded-md border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
                  No open tasks yet. Add one and Dex will keep it in your action center.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Relationship aliases</div>
          <h3 className="mt-1 text-lg font-semibold text-white">Teach Dex who your people are</h3>
          <p className="mt-2 text-sm text-gray-400">
            This is what lets “call my wife” or “text my boss” resolve cleanly to a saved contact name.
          </p>

          <form onSubmit={handleSaveAlias} className="mt-4 space-y-3 rounded-md border border-gray-800 bg-gray-900 p-4">
            <input
              type="text"
              placeholder="Alias, like wife or boss"
              value={aliasForm.alias}
              onChange={(e) => setAliasForm((prev) => ({ ...prev, alias: e.target.value }))}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none"
              required
            />
            <input
              type="text"
              placeholder="Exact saved contact name, like Jessica Smith"
              value={aliasForm.contact_name}
              onChange={(e) => setAliasForm((prev) => ({ ...prev, contact_name: e.target.value }))}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none"
              required
            />
            <button
              type="submit"
              disabled={busy === "alias"}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
            >
              {busy === "alias" ? "Saving..." : "Save Alias"}
            </button>
          </form>

          <div className="mt-4 space-y-3">
            {(aliases || []).length ? aliases.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-800 bg-gray-900 p-3">
                <div>
                  <div className="text-sm font-medium text-white">{item.alias}</div>
                  <div className="text-sm text-gray-400">{item.contact_name}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteAlias(item.id)}
                  disabled={busy === `alias-${item.id}`}
                  className="rounded-md border border-red-800 px-3 py-2 text-xs font-semibold text-red-200 hover:border-red-600 disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            )) : (
              <div className="rounded-md border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
                No aliases yet. Add a few and Dex will feel much more natural on calls and messages.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return "No time set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
