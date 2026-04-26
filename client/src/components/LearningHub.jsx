import { useEffect, useState } from "react";
import { api } from "../utils/api";

export default function LearningHub() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState({ lessons: [], quizAttempts: [], progress: null });
  const [lesson, setLesson] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [quizResult, setQuizResult] = useState(null);

  async function loadHistory() {
    try {
      const data = await api.getLearningHistory();
      setHistory(data);
    } catch (err) {
      setError(err?.message || "Failed to load learning history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleDailyLesson() {
    setBusy("lesson");
    setError("");
    try {
      const data = await api.getDailyLesson();
      setLesson(data.lesson);
      setQuiz(null);
      setQuizResult(null);
      await loadHistory();
    } catch (err) {
      setError(err?.message || "Dex could not create a lesson right now.");
    } finally {
      setBusy("");
    }
  }

  async function handleQuiz() {
    setBusy("quiz");
    setError("");
    try {
      const data = await api.createLearningQuiz();
      setQuiz(data.quiz);
      setAnswers(new Array(data.quiz?.questions?.length || 0).fill(""));
      setQuizResult(null);
    } catch (err) {
      setError(err?.message || "Dex could not create a quiz right now.");
    } finally {
      setBusy("");
    }
  }

  async function handleSubmitQuiz() {
    if (!quiz) return;
    setBusy("submit");
    setError("");
    try {
      const data = await api.submitLearningQuiz({ quiz, answers });
      setQuizResult(data);
      await loadHistory();
    } catch (err) {
      setError(err?.message || "Dex could not score your quiz right now.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Learning Hub</h2>
        <p className="text-sm text-gray-400">Daily lessons, quiz mode, lesson history, and progress tracking live here now.</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-700/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleDailyLesson}
          disabled={busy === "lesson"}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
        >
          {busy === "lesson" ? "Building lesson..." : "Get Daily Lesson"}
        </button>
        <button
          type="button"
          onClick={handleQuiz}
          disabled={busy === "quiz"}
          className="rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-100 hover:border-gray-500 disabled:opacity-60"
        >
          {busy === "quiz" ? "Building quiz..." : "Start Quiz Mode"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-gray-800 bg-gray-950 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Quiz Attempts</div>
          <div className="mt-1 text-white font-medium">{history.progress?.attempts ?? 0}</div>
        </div>
        <div className="rounded-md border border-gray-800 bg-gray-950 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Average Score</div>
          <div className="mt-1 text-white font-medium">
            {history.progress?.averageScore != null ? `${history.progress.averageScore}%` : "No quizzes yet"}
          </div>
        </div>
        <div className="rounded-md border border-gray-800 bg-gray-950 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Saved Lessons</div>
          <div className="mt-1 text-white font-medium">{history.lessons?.length ?? 0}</div>
        </div>
        <div className="rounded-md border border-gray-800 bg-gray-950 px-4 py-3 sm:col-span-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Learning Streak</div>
          <div className="mt-1 text-white font-medium">
            {history.progress?.streak ? `${history.progress.streak} day${history.progress.streak === 1 ? "" : "s"}` : "Start today"}
          </div>
          {history.reminders?.enabled && history.reminders?.time && (
            <div className="mt-1 text-xs text-gray-400">Reminder set for {history.reminders.time}</div>
          )}
        </div>
      </div>

      {history.nextLesson && (
        <div className="rounded-lg border border-blue-800/60 bg-blue-900/20 p-4">
          <div className="text-xs uppercase tracking-wide text-blue-300">Dex Recommends</div>
          <h3 className="text-lg font-semibold text-white mt-1">{history.nextLesson.topic}</h3>
          <p className="text-sm text-blue-100 mt-2">{history.nextLesson.reason}</p>
          <button
            type="button"
            onClick={handleDailyLesson}
            disabled={busy === "lesson"}
            className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
          >
            {busy === "lesson" ? "Building lesson..." : "Use This Next Lesson"}
          </button>
        </div>
      )}

      {lesson && (
        <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">{lesson.language} • {lesson.level}</div>
            <h3 className="text-lg font-semibold text-white mt-1">{lesson.title}</h3>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-gray-200 font-sans">{lesson.content}</pre>
        </div>
      )}

      {quiz && (
        <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">{quiz.language || "Language quiz"}</div>
            <h3 className="text-lg font-semibold text-white mt-1">{quiz.title || "Quiz"}</h3>
          </div>

          <div className="space-y-4">
            {(quiz.questions || []).map((question, index) => (
              <div key={`${question.question}-${index}`} className="rounded-md border border-gray-800 bg-gray-900 p-3">
                <p className="text-sm font-medium text-white">{index + 1}. {question.question}</p>
                <div className="mt-3 grid gap-2">
                  {(question.choices || []).map((choice) => (
                    <label key={choice} className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="radio"
                        name={`quiz-${index}`}
                        checked={answers[index] === choice}
                        onChange={() => setAnswers((prev) => {
                          const next = [...prev];
                          next[index] = choice;
                          return next;
                        })}
                      />
                      <span>{choice}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSubmitQuiz}
            disabled={busy === "submit"}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
          >
            {busy === "submit" ? "Scoring..." : "Submit Quiz"}
          </button>
        </div>
      )}

      {quizResult && (
        <div className="rounded-lg border border-green-700/50 bg-green-900/20 p-4 space-y-3">
          <h3 className="text-lg font-semibold text-white">Quiz Results</h3>
          <p className="text-sm text-green-200">
            You scored {quizResult.score} out of {quizResult.totalQuestions} ({quizResult.percentage}%).
          </p>
          <div className="space-y-2">
            {quizResult.results.map((result, index) => (
              <div key={`${result.question}-${index}`} className="rounded-md border border-gray-800 bg-gray-950 p-3 text-sm">
                <p className="text-white font-medium">{result.question}</p>
                <p className={result.correct ? "text-green-300 mt-1" : "text-red-300 mt-1"}>
                  Your answer: {result.userAnswer || "No answer"}
                </p>
                {!result.correct && (
                  <p className="text-gray-300 mt-1">Correct answer: {result.correctAnswer}</p>
                )}
                {result.explanation && (
                  <p className="text-gray-400 mt-1">{result.explanation}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && history.lessons?.length > 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
          <h3 className="text-lg font-semibold text-white mb-3">Saved Lesson History</h3>
          <div className="space-y-2">
            {history.lessons.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setLesson(item)}
                className="w-full text-left rounded-md border border-gray-800 bg-gray-900 px-3 py-3 hover:border-gray-700"
              >
                <div className="text-sm font-medium text-white">{item.title}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {item.language || "General"} • {item.level || "mixed"} • {new Date(item.created_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
