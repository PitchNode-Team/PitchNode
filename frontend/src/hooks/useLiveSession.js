import { useCallback, useEffect, useRef, useState } from "react";
import { 
    generateQuestionsApi, 
    startQuestionsApi, 
    startSessionApi,
    evaluateAnswerApi,
    completeSessionApi,
    getAllQuestionsApi
} from "../api/interviewApi";

export default function useLiveSession({settings, isHost, enabled = true, sessionIdOverride = null}) {
    const [sessionId, setSessionId] = useState("");
    const [serverQuestions, setServerQuestions] = useState(null);
    const [scores, setScores] = useState(null);
    const [feedback, setFeedback] = useState("");
    const [scoring, setScoring] = useState(false);
    const [answers, setAnswers] = useState([]);

    const startedRef = useRef(false);

    const apiMode = sessionId != "" && sessionId !== "OFFLINE";

    useEffect(() => {
        if (isHost || !sessionIdOverride || startedRef.current) return;
        startedRef.current = true;
        setSessionId(sessionIdOverride);
    }, [isHost, sessionIdOverride]);

    useEffect(() => {
        if(!enabled || !isHost || startedRef.current)
            return;

        startedRef.current = true;

        (async () => {
            try{
                const res = await startSessionApi(settings.type, {
                    difficulty: settings.difficulty,
                    duration: settings.duration,
                    mode: settings.mode,
                    cvId: settings.cvId || null,
                    jdId: settings.jobDescriptionId || null,
                });
                const id = res?.data?.id;
                if (!id) throw new Error("Session response missing id");

                let tailoredTexts = null;

                //tailored question when cv/jd is present
                if(settings.cvId || settings.jobDescriptionId){
                    try{
                        const gen = await generateQuestionsApi({
                            interviewType: settings.type,
                            difficulty: settings.difficulty || "medium",
                            cvId: settings.cvId || null,
                            jdId: settings.jobDescriptionId || null,
                            duration: settings.duration || 15,
                        })

                        if(Array.isArray(gen?.data) && gen.data.length) {
                            tailoredTexts = gen.data.map((q) => q.prompt ?? q.text ?? "");
                        }
                    } catch (err) {
                        console.warn("Tailored generation unavailable for live room.", err);
                    }
                }

                try{
                    await startQuestionsApi(id);
                    const allRes = await getAllQuestionsApi(id);
                    const seeded = Array.isArray(allRes?.data) ? allRes.data : [];

                    if(seeded.length){
                        if (tailoredTexts && tailoredTexts.length !== seeded.length) {
                            console.warn(
                                `Generated question count (${tailoredTexts.length}) differs from seeded question count (${seeded.length}) — some questions may show mismatched or fallback text.`
                            );
                        }
                        
                        setServerQuestions(
                            seeded.map((sq, i) => ({
                                id: sq.id,
                                prompt: (tailoredTexts && tailoredTexts[i]) || sq.prompt,
                            }))
                        )
                    }
                } catch (err) {
                    console.warn("Question seeding failed for live room.", err);
                }
                
                setSessionId(id);
            } catch(err){
                console.warn("Live session unavailable — running locally.", err);
                setSessionId("OFFLINE");
            }
        })();
    }, [enabled, isHost, settings])

    const evaluateAnswer = useCallback(
        async({questionIndex, questionId, questionText, transcript, mockEvaluate}) => {
           setScoring(true);
           let result;

            // Only ever send a real question UUID. No synthetic "q{n}" fallback:
            // a fake id can't link to a question row, and the backend nulls it
            // out anyway. null = unlinked answer (still saved and scored).
            const idForBackend = questionId || null;

            try{
            if(apiMode && transcript?.trim()) {
                const res = await evaluateAnswerApi({
                    sessionId,
                    questionId: idForBackend,
                    questionText,
                    transcript,
                });
                result = res?.data ? { ...res.data, isMock: false } : null;
                if(!result) throw new Error("empty-response")
            } else {
                throw new Error(
                    !apiMode ? "no-live-session" : "empty-transcript"
                )
            }
            } catch (err){    
                console.warn(
                    `Real evaluation unavailable (${err.message}) — using mock scoring.`
                );
                result = mockEvaluate
                ? {
                    ...mockEvaluate({
                        questionIndex,
                        answerSeconds: 10,
                        transcriptLength: (transcript || "").length,
                    }),
                    isMock: true,
                  }
                : null;
            } finally {
                setScoring(false);
            }

            if(result){
                setScores(result?.scores);
                setFeedback(result.feedback);
                setAnswers((prev) => [
                    ...prev.filter((a) => a.index !== questionIndex),
                    {
                        index: questionIndex,
                        question: questionIndex,
                        questionId: idForBackend,
                        transcript,
                        ...result,
                    },
                ]);
                
                // No separate markAnswered: POST /evaluations marks the question
                // answered itself after a successful score (see change #4).
            }
            return result;
        }, [apiMode, sessionId]
    );

    const clearScores = useCallback(() => {
        setScores(null);
        setFeedback("");
    }, [])

    const completeSession = useCallback(async () => {
        if(!apiMode)
            return null;

        try{
            const res = await completeSessionApi(sessionId);
            return res?.data ?? null;
        } catch (err){
            console.error(
                "completeSession failed:",
                err?.response?.data ?? err
            );
            return null;        }
    }, [apiMode, sessionId])

    return{
        sessionId,
        apiMode,
        serverQuestions,
        scores,
        feedback,
        scoring,
        answers,
        evaluateAnswer,
        clearScores,
        completeSession,
    };
}