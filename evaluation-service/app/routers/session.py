from fastapi import APIRouter, HTTPException, Depends
from app.models.session import SessionCreateRequest, SessionResponse, SessionHistoryResponse
from app.db.supabase_client import get_supabase
from app.db.auth import get_current_user

router = APIRouter(tags=["session"])


@router.post("/session/start", response_model=SessionResponse, status_code=201)
def start_session(payload: SessionCreateRequest, current_user: dict = Depends(get_current_user)):
    """Create a new interview session"""
    supabase = get_supabase()
    user_id = current_user["sub"]
    result = (
        supabase.table("sessions")
        .insert({
            "interview_type": payload.interview_type,
            "user_id": user_id,
            "difficulty": payload.difficulty,
            "duration": payload.duration,
            "mode": payload.mode,
            "cv_id": payload.cv_id,
            "jd_id": payload.jd_id,
            "status": "created",
        })
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create session")
    return result.data[0]


@router.get("/sessions", response_model=SessionHistoryResponse)
def get_sessions(current_user: dict = Depends(get_current_user)):
    """Returns all sessions for the authenticated user"""
    supabase = get_supabase()
    user_id = current_user["sub"]
    result = (
        supabase.table("sessions")
        .select("id, interview_type, difficulty, mode, overall_score, status, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"sessions": result.data}


@router.get("/session/{session_id}", response_model=SessionResponse)
def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """only accessible by the session owner"""
    supabase = get_supabase()
    user_id = current_user["sub"]
    result = supabase.table("sessions").select("*").eq("id", session_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    session = result.data[0]
    if session["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/session/{session_id}/complete")
def complete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Marks session complete and computes overall score"""
    supabase = get_supabase()
    user_id = current_user["sub"]
    session_result = supabase.table("sessions").select("user_id").eq("id", session_id).execute()
    if not session_result.data or session_result.data[0]["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Session not found")
    evals = supabase.table("evaluations").select("overall_score").eq("session_id", session_id).execute()
    scores = [e["overall_score"] for e in evals.data if e.get("overall_score") is not None]
    overall = round(sum(scores) / len(scores), 1) if scores else None
    supabase.table("sessions").update({"status": "completed", "overall_score": overall}).eq("id", session_id).execute()
    return {"ok": True, "overall_score": overall}


@router.get("/session/{session_id}/results")
def get_session_results(session_id: str, current_user: dict = Depends(get_current_user)):
    """Full dashboard payload"""
    supabase = get_supabase()
    user_id = current_user["sub"]
    session_result = supabase.table("sessions").select("*").eq("id", session_id).execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    session = session_result.data[0]
    if session["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Session not found")
    
    evals = (
        supabase.table("evaluations")
        .select("*, questions(prompt)")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
    )

    # Labels for the real rubric dimensions of this interview type, so the
    # frontend can show "Problem Understanding" instead of a raw key.
    rubric_rows = (
        supabase.table("rubrics")
        .select("dimension_key, dimension_label, description")
        .eq("interview_type", session.get("interview_type"))
        .execute()
    )
    labels = {r["dimension_key"]: r["dimension_label"] for r in (rubric_rows.data or [])}
    descriptions = {r["dimension_key"]: r["description"] for r in (rubric_rows.data or [])}

    per_question = []
    # Average each real dimension across all answers, to rank strengths/weaknesses.
    dim_totals: dict[str, list[float]] = {}
    for e in evals.data:
        scores = e.get("dimension_scores") or {}
        per_question.append({
            "question_id": e["question_id"],
            "question_text": e["questions"]["prompt"] if e.get("questions") else "",
            "transcript": e.get("transcript") or "",
            "scores": scores,
            "feedback": e.get("feedback", ""),
        })
        for key, val in scores.items():
            if isinstance(val, (int, float)):
                dim_totals.setdefault(key, []).append(val)

    avg_scores = {k: round(sum(v) / len(v), 1) if v else 0 for k, v in dim_totals.items()}
    sorted_dims = sorted(avg_scores.items(), key=lambda x: x[1], reverse=True)
    strengths = [d[0] for d in sorted_dims[:2] if d[1] > 0]
    weaknesses = [d[0] for d in sorted_dims[-1:] if d[1] > 0]

    recommendation = ""
    scored = [e for e in evals.data if e.get("overall_score") is not None]
    if scored:
        weakest_eval = min(scored, key=lambda e: e["overall_score"])
        recommendation = (weakest_eval.get("feedback") or "").strip()
    if not recommendation:
        weakest_dim_key = sorted_dims[-1][0] if sorted_dims else None
        recommendation = (
            descriptions.get(weakest_dim_key)
            or "Keep practicing across all dimensions."
        )
        
    return {
        "session_id": session_id,
        "interview_type": session.get("interview_type"),
        "difficulty": session.get("difficulty"),
        "overall_score": session.get("overall_score"),
        "per_question": per_question,
        "labels": labels,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "recommendation": recommendation,
    }