import uuid as uuid_lib

from fastapi import APIRouter, HTTPException, Depends
from app.models.evaluation import EvaluationRequest, EvaluationResponse
from app.db.supabase_client import get_supabase
from app.services.scoring import score_answer
from app.db.auth import get_current_user

router = APIRouter(prefix="/evaluations", tags=["evaluations"])

def _as_uuid_or_none(value: str | None) -> str | None:
    if not value:
        return None
    try:
        uuid_lib.UUID(value)
        return value
    except (ValueError, AttributeError, TypeError):
        return None


@router.post("", response_model=EvaluationResponse)
def evaluate_answer(payload: EvaluationRequest, current_user: dict = Depends(get_current_user)):
    """
    Scores one spoken answer using Groq + rubric methodology.
    Steps:
      1. Retrieve the interview type and difficulty from the session.
      2. Fetch rubric dimensions for this session's interview_type
      3. Persist the transcript first (unscored) so a Groq failure can't lose it
      4. Score with Groq; on success update the row, on failure keep it unscored
      5. Mark the question answered only after a successful score
    """
    supabase = get_supabase()
    user_id = current_user["sub"]

    # 1. Get the session and verify ownership — an answer may only be written
    #    into a session the authenticated user owns.
    session_result = (
        supabase.table("sessions")
        .select("user_id, interview_type, difficulty")
        .eq("id", payload.session_id)
        .execute()
    )
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session = session_result.data[0]
    if session["user_id"] != user_id:
        # 404, not 403, so we don't reveal that the session exists.
        raise HTTPException(status_code=404, detail="Session not found")

    interview_type = session["interview_type"]
    difficulty = session.get("difficulty", "medium")

    # 2. Fetch rubric dimensions for this interview type
    rubric_result = (
        supabase.table("rubrics")
        .select("dimension_key, dimension_label, description")
        .eq("interview_type", interview_type)
        .order("order")
        .execute()
    )
    if not rubric_result.data:
        raise HTTPException(status_code=500, detail=f"No rubric found for type: {interview_type}")

    safe_question_id = _as_uuid_or_none(payload.question_id)

    # 3. Persist the transcript FIRST, unscored. If Groq fails afterwards we
    #    still keep the candidate's words (overall_score stays NULL) instead of
    #    losing the answer to a 500.
    insert_result = supabase.table("evaluations").insert({
        "session_id": payload.session_id,
        "question_id": safe_question_id,
        "transcript": payload.transcript,
        "dimension_scores": None,
        "overall_score": None,
        "feedback": None,
    }).execute()
    evaluation_id = insert_result.data[0]["id"]

    # 4. Score using Groq. On failure, leave the saved row unscored and tell the
    #    frontend scoring is unavailable rather than discarding the answer.
    try:
        result = score_answer(
            question_text=payload.question_text,
            transcript=payload.transcript,
            interview_type=interview_type,
            difficulty=difficulty,
            rubric_dimensions=rubric_result.data,
        )
    except Exception as e:
        print(f"Scoring unavailable for evaluation {evaluation_id}: {e}")
        return {
            "scores": None,
            "feedback": "Scoring is temporarily unavailable. Your answer was saved and can be re-evaluated.",
            "scoring_unavailable": True,
        }

    scores = result["scores"]
    # Overall is the mean of the REAL rubric dimensions actually scored, so it
    # matches the per-criterion numbers the results page shows. Fall back to the
    # legacy 4-bucket mean only if no dimension scores came back.
    dimension_scores = result.get("dimension_scores") or {}
    dim_values = [float(v) for v in dimension_scores.values() if isinstance(v, (int, float))]
    if dim_values:
        overall = round(sum(dim_values) / len(dim_values), 1)
    else:
        overall = round(sum(scores.values()) / len(scores), 1)

    # 5. Scoring succeeded — fill in the row we already inserted.
    supabase.table("evaluations").update({
        "dimension_scores": result["dimension_scores"],
        "overall_score": overall,
        "feedback": result["feedback"],
    }).eq("id", evaluation_id).execute()

    # 6. Mark the question answered only once it has actually been scored.
    if safe_question_id:
        try:
            supabase.table("session_questions").update({"answered": True}).eq(
                "session_id", payload.session_id
            ).eq("question_id", payload.question_id).execute()
        except Exception as e:
            print(f"Warning: failed to mark question answered: {e}")

    return {
        "scores": scores,
        "feedback": result["feedback"],
        "scoring_unavailable": False,
    }