import { useCallback, useState, useEffect } from "react";
import { getHistoryApi, getResultsApi } from "../api/interviewApi";
import { useNavigate, useSearchParams } from "react-router-dom";
import Logo from "../components/Logo";

const STATUS = {
    created: { 
        label: "Not started", 
        cls: "req-status--pending" 
    },
    in_progress: { 
        label: "In progress", 
        cls: "req-status--accepted" 
    },
    completed: { 
        label: "Completed", 
        cls: "req-status--done" 
    },
};

const MODE_LABEL = {
  ai: "AI Interviewer",
  human: "With a Human",
  friend: "With a Friend",
};

const fmtDate = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
};

const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function SessionHistory() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [sessions, setSessions] = useState([]);
    // Per-session answer data, lazy-loaded when a card is expanded.
    const [expandedId, setExpandedId] = useState(null);
    const [answersById, setAnswersById] = useState({});
    const [answersLoading, setAnswersLoading] = useState({});

    const toggleAnswers = useCallback(async (sessionId) => {
        // Collapse if already open.
        if (expandedId === sessionId) {
            setExpandedId(null);
            return;
        }
        setExpandedId(sessionId);
        // Fetch once, then reuse.
        if (answersById[sessionId]) return;
        setAnswersLoading((m) => ({ ...m, [sessionId]: true }));
        try {
            const res = await getResultsApi(sessionId);
            setAnswersById((m) => ({ ...m, [sessionId]: res.data?.per_question || [] }));
        } catch (err) {
            console.error("Failed to load answers for session", sessionId, err);
            setAnswersById((m) => ({ ...m, [sessionId]: [] }));
        } finally {
            setAnswersLoading((m) => ({ ...m, [sessionId]: false }));
        }
    }, [expandedId, answersById]);



    const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getHistoryApi();
      setSessions(res.data?.sessions || []);
    } catch (err) {
      console.error("Failed to load session history", err);
      setError("Couldn't load your sessions. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

    useEffect(() => {
        document.title = "My sessions — PitchNode";
        load();
    }, [load]);


    return(<>
        <nav className="pn-nav">
            <Logo/>
            <button 
                className="pn-btn pn-btn--primary" 
                onClick={() => navigate("/setup")}
            >
                New Interview
            </button>
        </nav>

        <main className="admin-main">
            <header className="admin-head">
                <h1>MY SESSIONS</h1>
                <p>Every Interview you've run, here</p>
            </header>

            {loading ? (
                <div className="pn-card admin-table">
                    <p className="admin-empty">Loading your sessions...</p>
                </div>
            ): error ? (
                <div className="pn-card admin-table">
                    <p className="admin-empty">
                    {error}
                    <br />
                    <button 
                        className="pn-btn pn-btn--outline req-empty-cta" 
                        onClick={load}
                    >
                        Retry
                    </button>
                    </p>
                </div>
            ) : sessions.length === 0 ? (
               <div className="pn-card admin-table">
                    <p className="admin-empty">
                        No interviews yet — start one.
                        <br />
                        <button
                            className="pn-btn pn-btn--primary req-empty-cta"
                            onClick={() => navigate("/setup")}
                        >
                            Start your first interview
                        </button>
                    </p>
                </div> 
            ) : (
                <section className="req-list">
                    {sessions.map((s) => {
                        const status = STATUS[s.status] || STATUS.created;
                        const canView = s.status === "completed";

                        return (
                            <article
                                className={`pn-card req-item${canView ? " session-item--clickable" : ""}`}
                                key={s.id}
                                onClick={canView ? () => navigate("/results", { state: { sessionId: s.id } }) : undefined}
                            >
                            <div className="req-item__main">
                                <div className="req-item__head">
                                    <h3>{titleCase(s.interview_type)} interview</h3>
                                    <span className={`req-status ${status.cls}`}>{status.label}</span>
                                </div>
                                <p className="req-item__jd">
                                    {MODE_LABEL[s.mode] || "AI Interviewer"}
                                    {s.difficulty ? ` · ${titleCase(s.difficulty)} difficulty` : ""}
                                </p>
                                <div className="req-item__meta">
                                <span>{fmtDate(s.created_at)}</span>
                                {s.overall_score != null && (
                                    <span>· Score {s.overall_score}</span>
                                )}
                                </div>
                            </div>

                            <div className="req-item__actions">
                                {canView && (
                                <>
                                <button
                                    className="pn-btn pn-btn--ghost"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleAnswers(s.id);
                                    }}
                                >
                                    {expandedId === s.id ? "Hide answers" : "Show answers"}
                                </button>
                                <button
                                    className="pn-btn pn-btn--outline"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate("/results", { state: { sessionId: s.id } });
                                    }}
                                >
                                    View results
                                </button>
                                </>
                                )}
                            </div>

                            {expandedId === s.id && (
                                <div
                                    className="session-answers"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {answersLoading[s.id] ? (
                                        <p className="admin-empty">Loading answers…</p>
                                    ) : (answersById[s.id] || []).length === 0 ? (
                                        <p className="admin-empty">No answers recorded for this session.</p>
                                    ) : (
                                        (answersById[s.id] || []).map((q, i) => (
                                            <div className="session-answer" key={q.question_id || i}>
                                                <p className="session-answer__q">
                                                    <span className="dash-q__num">Q{i + 1}</span>
                                                    {q.question_text || "Question"}
                                                </p>
                                                <p className="session-answer__a">
                                                    {q.transcript
                                                        ? q.transcript
                                                        : <em>No answer was recorded.</em>}
                                                </p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                            </article>
                        );
                        })}
                </section>
            )}
        </main>
    </>)
}

export default SessionHistory;