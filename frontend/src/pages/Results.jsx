import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import {getResultsApi} from "../api/interviewApi";

const METRIC_LABELS = {
  communication: "Communication",
  technicalAccuracy: "Technical accuracy",
  confidence: "Confidence",
  problemSolving: "Problem solving",
};

const RECOMMENDATIONS = {
  communication:
    "Practice answering aloud with the STAR structure — situation, task, action, result — and record yourself once a week.",
  technicalAccuracy:
    "Review the core concepts behind the questions you missed and practice explaining each with a concrete example.",
  confidence:
    "Slow your pace and pause instead of using filler words. Confidence scores rise fast with deliberate delivery.",
  problemSolving:
    "Narrate your reasoning before giving the answer — interviewers score the path, not just the destination.",
};

function metricAverages(answers) {
  const keys = Object.keys(METRIC_LABELS);
  const sums = Object.fromEntries(keys.map((k) => [k, 0]));
  answers.forEach((a) => keys.forEach((k) => (sums[k] += a.scores[k])));
  return Object.fromEntries(
    keys.map((k) => [k, Math.round(sums[k] / answers.length)])
  );
}

function buildViewFromState(state){
  const { answers, settings, totalSeconds = 0 } = state;
  const averages = metricAverages(answers);
  const ranked = Object.entries(averages).sort((a, b) => b[1] - a[1]);
  const overall = Math.round(
    ranked.reduce((sum, [, v]) => sum + v, 0) / ranked.length
  );
  const strengths = ranked.slice(0, 2).map(([k]) => METRIC_LABELS[k]);
  const weakestKey = ranked[ranked.length - 1][0];
  const minutes = Math.max(1, Math.round(totalSeconds / 60));

  return {
    typeLine: `${settings.type} · ${settings.difficulty}`,
    subtitle: `${answers.length} question${answers.length === 1 ? "" : "s"} answered in ${minutes} min`,
    overall,
    strengths,
    weaknesses: [METRIC_LABELS[weakestKey]],
    recommendation: RECOMMENDATIONS[weakestKey],
    labels: METRIC_LABELS,
    perQuestion: answers.map((a) => ({
      key: a.index,
      number: a.index + 1,
      question: a.question,
      scores: a.scores,
      feedback: a.feedback,
    })),
  };
}

function buildViewFromApi (data){
  const perQuestion = data.per_question || [];
  const labels = data.labels || {};
  const labelFor = (k) => labels[k] || METRIC_LABELS[k] || k;

  return {
    typeLine: [data.interview_type, data.difficulty].filter(Boolean).join(" · "),
    subtitle: `${perQuestion.length} question${perQuestion.length === 1 ? "" : "s"} answered`,
    overall: Math.round(data.overall_score ?? 0),
    strengths: (data.strengths || []).map(labelFor),
    weaknesses: (data.weaknesses || []).map(labelFor),
    recommendation: data.recommendation || "Keep practicing across all dimensions.",
    labels,
    perQuestion: perQuestion.map((q, i) => ({
      key: q.question_id || i,
      number: i + 1,
      question: q.question_text || "Question",
      scores: q.scores || {},
      feedback: q.feedback || "",
    })),
  };
}

function Results() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  useEffect(() => {
    document.title = "Interview results — PitchNode";
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (state?.answers?.length) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const sessionId = state?.sessionId;
    if (!sessionId || sessionId === "OFFLINE") {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const res = await getResultsApi(state.sessionId);
        if (!cancelled) {
          setData(res.data);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to fetch results", err);
        if (!cancelled) {
          setFetchError("Couldn't load your results. Try again in a moment.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state]);

  const view = state?.answers?.length
    ? buildViewFromState(state)
    : data
    ? buildViewFromApi(data)
    : null;
    

  if (loading) {
    return (
      <>
        <nav className="pn-nav">
          <Logo />
        </nav>
        <main className="dash-main">
          <p className="dash-label">Loading your results…</p>
        </main>
      </>
    );
  }

  if (!view) {
    return (
      <>
        <nav className="pn-nav">
          <Logo />
        </nav>
        <main className="dash-main">
          <p className="dash-label">
            {fetchError || "No results to show yet."}
          </p>
          <button className="pn-btn pn-btn--ghost" onClick={() => navigate("/history")}>
            View all sessions
          </button>
        </main>
      </>
    );
  }

  const { typeLine, subtitle, overall, strengths, weaknesses, recommendation, perQuestion, labels } = view; 

  return (
    <>
      <nav className="pn-nav">
        <Logo />
        <span className="pn-pill">
          <span className="pn-node" aria-hidden="true" />
          Interview completed
        </span>
      </nav>

      <main className="dash-main">
        <header className="dash-head">
          <h1>Your results</h1>
          <p>
            {typeLine}
            {typeLine && subtitle ? " · " : ""}
            {subtitle}
          </p>
        </header>

        <section className="dash-grid">
          <div className="pn-card dash-card dash-card--score">
            <p className="dash-label">Overall score</p>
            <p className="dash-score">{overall}%</p>
            <div className="dash-metricbar">
              <div
                className="dash-metricbar__fill"
                style={{ width: `${overall}%` }}
              />
            </div>
          </div>

          <div className="pn-card dash-card">
            <p className="dash-label">Strengths</p>
            <div className="dash-chips">
              {strengths.map((s) => (
                <span key={s} className="dash-chip dash-chip--good">
                  {s}
                </span>
              ))}
            </div>
            <p className="dash-label" style={{ marginTop: 16 }}>
              Focus area
            </p>
            <div className="dash-chips">
              {weaknesses.map((w) => (
                <span key={w} className="dash-chip dash-chip--warn">
                  {w}
                </span>
              ))}
            </div>
          </div>

          <div className="pn-card dash-card">
            <p className="dash-label">Recommendation</p>
            <p className="dash-reco">{recommendation}</p>
          </div>
        </section>

        <section className="dash-questions">
          <h2>Question breakdown</h2>
          {perQuestion.map((a) => (
            <div key={a.key} className="pn-card dash-card dash-q">
              <p className="dash-q__text">
                <span className="dash-q__num">Q{a.number}</span>
                {a.question}
              </p>
              <div className="dash-q__metrics">
                {Object.entries(a.scores).map(([k, v]) => (
                  <div key={k} className="dash-q__metric">
                    <span>{labels[k] || METRIC_LABELS[k] || k}</span>
                    <span className="dash-q__value">{v}%</span>
                    <div className="dash-metricbar">
                      <div
                        className="dash-metricbar__fill"
                        style={{ width: `${v}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="dash-q__feedback">{a.feedback}</p>
            </div>
          ))}
        </section>

        <footer className="dash-actions">
          <button
            className="pn-btn pn-btn--primary"
            onClick={() => navigate("/setup")}
          >
            Practice again
          </button>

          <button className="pn-btn pn-btn--ghost" onClick={() => navigate("/history")}>
            View all sessions
          </button>

          <button className="pn-btn pn-btn--ghost" onClick={() => navigate("/")}>
            Back to home
          </button>
        </footer>
      </main>
    </>
  );
}

export default Results;
