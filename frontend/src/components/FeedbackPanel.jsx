const METRICS = [
  { key: "communication", label: "Communication" },
  { key: "technicalAccuracy", label: "Technical accuracy" },
  { key: "confidence", label: "Confidence" },
  { key: "problemSolving", label: "Problem solving" },
];

function FeedbackPanel({ scores = null, feedback = "", isMock = false, scoringUnavailable = false }) {
  return (
    <div className="rm-card rm-anim rm-anim--3">
      <div className="rm-card__head">
        <h3 className="rm-card__title">AI feedback</h3>
        {scores && isMock && (
          <span className="rm-chip rm-chip--mock" title="Real scoring was unavailable — this is a local estimate, not a Groq evaluation.">
            Estimated (offline)
          </span>
        )}
        {scoringUnavailable && (
          <span className="rm-chip rm-chip--mock" title="Your answer was saved, but automatic scoring was unavailable. It can be re-evaluated later.">
            Scoring unavailable
          </span>
        )}
      </div>

      {METRICS.map(({ key, label }) => {
        const value = scores?.[key];
        return (
          <div className="rm-metric" key={key}>
            <span className="rm-metric__label">{label}</span>
            <span className="rm-metric__value">
              {value != null ? `${value}%` : "—"}
            </span>
            <div className="rm-metric__bar">
              <div
                className="rm-metric__fill"
                style={{ width: value != null ? `${value}%` : "0%" }}
              />
            </div>
          </div>
        );
      })}

      {feedback ? (
        <p className="rm-card__note">{feedback}</p>
      ) : (
        !scores && (
          <p className="rm-card__note">
            Scores appear here after each answer is evaluated.
          </p>
        )
      )}
    </div>
  );
}

export default FeedbackPanel;