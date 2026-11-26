import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

import {
  startSessionApi,
  evaluateAnswerApi,
  startQuestionsApi,
  nextQuestionApi,
  completeSessionApi,
  // generateQuestionsApi,
} from "../api/interviewApi";

import VideoPanel from "../components/VideoPanel";
import QuestionPanel from "../components/QuestionPanel";
import TranscriptPanel from "../components/TranscriptPanel";
import FeedbackPanel from "../components/FeedbackPanel";
import SessionInfo from "../components/SessionInfo";
import {
  MicIcon,
  MicOffIcon,
  CamIcon,
  CamOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
} from "../components/RoomIcons";
import { mockEvaluate } from "../utils/mockEvaluation";
import useLocalMedia from "../hooks/useLocalMedia";
import useSpeechRecognition from "../hooks/useSpeechRecognition";
import "../styles/room.css";

function formatElapsed(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function AiInterviewRoom({ settings, questions }) {
  const navigate = useNavigate();
  const localStream = useLocalMedia();

  const [sessionId, setSessionId] = useState("");
  const [apiQuestion, setApiQuestion] = useState(null);
  // const [tailoredQuestions, setTailoredQuestions] = useState(null);
  const [allAnswered, setAllAnswered] = useState(false);

  const [qIndex, setQIndex] = useState(0);
  const [scores, setScores] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [isMockResult, setIsMockResult] = useState(false);

  const [answers, setAnswers] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [ttsOn, setTtsOn] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [qSeconds, setQSeconds] = useState(0);
  const MIN_SECONDS = 10;

  const questionStartRef = useRef(null);
  const sessionRequestedRef = useRef(false);

  const speech = useSpeechRecognition({ enabled: micOn });

  const { supported, lines, interim, transcript, error: speechError } = speech;
  const resetTranscript = () => 
    typeof speech.reset === "function" ? speech.reset() : undefined;

  const apiMode = sessionId !== "" && sessionId !== "OFFLINE";

  /* Server-driven values when the backend is up; local bank otherwise */
  // const tailoredPrompt = 
  //   tailoredQuestions && apiQuestion 
  //   ? (tailoredQuestions[apiQuestion.question_number - 1]?.prompt ??
  //     tailoredQuestions[apiQuestion.question_number - 1]?.text ??
  //     null)
  //   : null;

    /* Server-driven values when the backend is up; local bank otherwise */
  const currentQuestion =
    apiMode && apiQuestion ? apiQuestion.prompt : questions[qIndex];

  const questionNumber =
    apiMode && apiQuestion ? apiQuestion.question_number : qIndex + 1;

  const totalQuestions =
    apiMode && apiQuestion ? apiQuestion.total_questions : questions.length;

  const isLast =
    apiMode && apiQuestion
      ? apiQuestion.is_last
      : qIndex === questions.length - 1;

  /*
   * Create a session record so results have an ID to attach to.
   * AI mode has no peer, so this is bookkeeping only — if the backend
   * is unreachable we continue in offline demo mode instead of blocking.
   */

  useEffect(() => {
    if (sessionRequestedRef.current) return;
    sessionRequestedRef.current = true;
    
    (async () => {
      try {
        const res = await startSessionApi(settings.type, {
          difficulty: settings.difficulty,
          duration: settings.duration,
          mode: settings.mode,
          cvId: settings.cvId || null,
          jdId: settings.jobDescriptionId || null,
        });
        const id = res?.data?.id;

        if(!id) {
          throw new Error("Session response missing id");
        }

        // const hasDocs = Boolean(settings.cvId || settings.jobDescriptionId);
        // let tailored = null;
        // if (hasDocs) {
        //   try {
        //     const gen = await generateQuestionsApi({
        //         interviewType: settings.type,
        //         difficulty: settings.difficulty || "medium",
        //         cvId: settings.cvId || null,
        //         jdId: settings.jobDescriptionId || null,
        //         duration: settings.duration || 15,
        //     })
            
        //     if (Array.isArray(gen?.data) && gen.data.length) tailored = gen.data;
        //   } catch (genErr) {
        //     console.warn("Tailored generation unavailable — using standard flow.", genErr);
        //   }
        // }

        await startQuestionsApi(id);

        const q = await nextQuestionApi(id);
        setApiQuestion(q?.data);
        // if (tailored) setTailoredQuestions(tailored);
        setSessionId(id);
      } catch (err) {
        console.warn(
          "Evaluation service unavailable — using local question bank.",
          err
        );
        setSessionId("OFFLINE");
      }
    })();
  }, [settings.type]);

  /* Session timer */
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  /* Speak the question aloud when it changes (browser TTS, toggleable) */
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!ttsOn || !synth || !currentQuestion) 
      return;

    const utterance = new SpeechSynthesisUtterance(currentQuestion);
    utterance.rate = 1;
    utterance.lang = "en-US";

    const t = setTimeout(() => synth.speak(utterance), 120);
    return () => {
      clearTimeout(t);
      synth.cancel();
    };
  }, [ttsOn, currentQuestion]);

  /* Track when the current question started, for answer timing */
  useEffect(() => {
    questionStartRef.current = Date.now();
  }, [currentQuestion]);

  //per-question timer
  useEffect(() => {
    const id = setInterval(() => {
      const startedAt = questionStartRef.current ?? Date.now();
      setQSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [currentQuestion]);

  const toggleMic = () => {
    if (!localStream) return;
    const next = !micOn;
    localStream.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  };

  const toggleCam = () => {
    if (!localStream) return;
    const next = !camOn;
    localStream.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  };

  const submitAnswer = async () => {
    const startedAt = questionStartRef.current ?? Date.now();
    const answerSeconds = Math.round((Date.now() - startedAt) / 1000);
    const index = questionNumber - 1;
    const questionId = apiMode && apiQuestion ? apiQuestion.id : null;

    setScoring(true);
    let result;

    try{
      if(apiMode && questionId) {
        const res = await evaluateAnswerApi({
          sessionId,
          questionId,
          questionText: currentQuestion,
          transcript,
        });
        result = res?.data ? { ...res.data, isMock: false } : null;
        if (!result) throw new Error("empty-response");
      } else {
        throw new Error("Offline mode or missing question ID — using mock evaluation");
      } 
    } catch(err) {
        console.warn("Live scoring unavailable — using local estimate.", err);
        result = {
          ...mockEvaluate({
            questionIndex: index,
            answerSeconds,
            transcriptLength: transcript.length,
          }),
          isMock: true,
        };
    } finally {
      setScoring(false);  
    }

    setScores(result?.scores);
    setFeedback(result?.feedback);
    setIsMockResult(Boolean(result?.isMock));
    setAnswers((prev) => [
      ...prev.filter((a) => a.index !== index),
      { 
        index, 
        question: currentQuestion, 
        questionId,
        transcript, 
        ...result 
      },
    ]);
  };

  const nextQuestion = async () => {
    setScores(null);
    setFeedback("");
    setIsMockResult(false);
    resetTranscript();

    if (apiMode && apiQuestion) {
      try {
        // await markAnsweredApi(sessionId, apiQuestion.id);
        const q = await nextQuestionApi(sessionId);
        setApiQuestion(q.data);
      } catch (err) {
        if (err?.response?.status === 404) {
          setAllAnswered(true);
        } else {
          console.error("Failed to fetch next question:", err);
        }
      }
      return;
    }

    setQIndex((i) => Math.min(i + 1, questions.length - 1));
  };

  const finishInterview = () => {
    window.speechSynthesis?.cancel();

    // if (apiMode && apiQuestion) {
    //   markAnsweredApi(sessionId, apiQuestion.id).catch(() => {});
    // }

    if (apiMode) {
      completeSessionApi(sessionId).catch(() => {}); 
    }

    navigate("/results", {
      state: {
        settings,
        answers: [...answers].sort((a, b) => a.index - b.index),
        totalSeconds: elapsed,
        sessionId,
      },
    });
  };

  const answeredCurrent = scores != null;
  const minTimeMet = qSeconds >= MIN_SECONDS;
  const canSubmit = minTimeMet && !scoring;
  const canGoNext = answeredCurrent && minTimeMet;

  /* finish only allowed once every question is answered */
  const answeredCount = answers.length;
  const allAnsweredForFinish =
    (apiMode && apiQuestion
      ? answeredCount >= (apiQuestion.total_questions || 0)
      : answeredCount >= questions.length) || allAnswered;

  
  const badgeId =
    sessionId === "OFFLINE"
      ? "OFFLINE"
      : sessionId
      ? sessionId.slice(0, 8).toUpperCase()
      : "";

  return (
    <div className="room-page">
      <header className="room-header">
        <div className="room-header__group">
          <h1>AI Interview</h1>
          {badgeId && <span className="rm-badge rm-badge--id">{badgeId}</span>}
          <span className="rm-badge rm-badge--live">
            <span className="rm-dot rm-dot--pulse" />
            Solo session
          </span>
        </div>

        <div className="room-header__group">
          <span className="rm-badge">
            {answers.length} of {totalQuestions} answered
          </span>
          <span className="rm-timer">{formatElapsed(elapsed)}</span>
          <button
            className="rm-btn rm-btn--primary"
            onClick={finishInterview}
            disabled={answers.length === 0}
            title={
              answers.length === 0
                ? "Answer at least one question first"
                : "Finish and see your results"
            }
          >
            Finish interview
          </button>
        </div>
      </header>

      <main className="room-main">
        <section className="room-stage rm-anim">
          <div className="rm-video">
            <VideoPanel stream={localStream} muted mirrored />
            <span className="rm-video__label">You</span>
          </div>

          <div className="room-controlbar">
            <button
              className={`rm-ctl${micOn ? "" : " rm-ctl--off"}`}
              onClick={toggleMic}
              aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
              title={micOn ? "Mute microphone" : "Unmute microphone"}
            >
              {micOn ? <MicIcon /> : <MicOffIcon />}
            </button>

            <button
              className={`rm-ctl${camOn ? "" : " rm-ctl--off"}`}
              onClick={toggleCam}
              aria-label={camOn ? "Turn camera off" : "Turn camera on"}
              title={camOn ? "Turn camera off" : "Turn camera on"}
            >
              {camOn ? <CamIcon /> : <CamOffIcon />}
            </button>

            <button
              className={`rm-ctl${ttsOn ? " rm-ctl--active" : ""}`}
              onClick={() => {
                if (ttsOn) window.speechSynthesis?.cancel();
                setTtsOn((v) => !v);
              }}
              aria-label={ttsOn ? "Mute AI voice" : "Unmute AI voice"}
              title={ttsOn ? "AI voice on — click to mute" : "AI voice off"}
            >
              {ttsOn ? <SpeakerIcon /> : <SpeakerOffIcon />}
            </button>

            <button
              className="rm-btn rm-btn--primary"
              onClick={submitAnswer}
              disabled={!canSubmit }
              title={
                !minTimeMet
                  ? `Take at least ${MIN_SECONDS}s on this question`
                  : "Submit your answer"
              }
            >
              {scoring
                ? "Scoring…"
                : !minTimeMet
                ? `Submit in ${MIN_SECONDS - qSeconds}s`
                : answeredCurrent
                ? "Re-evaluate answer"
                : "Submit answer"
              }
            </button>

            {!isLast && !allAnswered && (
              <button 
                className="rm-btn rm-btn--outline" 
                onClick={nextQuestion}
                disabled={!canGoNext}
                title={
                  !canGoNext
                    ? "Submit your answer before moving on"
                    : "Next question"
                }
              >
                {canGoNext ? "Next question" : "Submit to continue"}
              </button>
            )}

            {allAnswered && (
              <span className="rm-card__note">
                All questions answered — finish to see your results.
              </span>
            )}
          </div>
        </section>

        <aside className="room-side">
          <QuestionPanel
            number={questionNumber}
            total={totalQuestions}
            type={settings.type}
            question={currentQuestion}
          />
          <TranscriptPanel 
            lines={lines} 
            interim={interim} 
            supported={supported} 
            error={speechError}
          />

          <FeedbackPanel 
            scores={scores} 
            feedback={feedback} 
            isMock={isMockResult}
            />

          <SessionInfo
            participantCount={1}
            roomId={badgeId}
            mode={settings.mode}
            type={settings.type}
            duration={`${settings.duration} min`}
            connected={apiMode}
          />
        </aside>
      </main>
    </div>
  );
}

export default AiInterviewRoom;
