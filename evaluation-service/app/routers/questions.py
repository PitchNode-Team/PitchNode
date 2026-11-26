import uuid as uuid_lib

from fastapi import APIRouter, HTTPException, Depends
from app.models.question import QuestionResponse
from app.db.supabase_client import get_supabase
from app.db.auth import get_current_user
from app.services.question_gen import generate_questions

router = APIRouter(prefix="/questions", tags=["questions"])

@router.post("/generate", response_model=list[dict])
def generate_tailored_questions(
    interview_type: str,
    difficulty: str ="medium",
    cv_id: str | None = None,
    jd_id: str | None = None,
    count: int = 5,
    current_user: dict = Depends(get_current_user)
):

    supabase = get_supabase()
    user_id = current_user["sub"]

    cv_text = None
    jd_text = None

    if cv_id:
        cv_result = supabase.table("cvs").select("cv_text").eq("id", cv_id).eq("user_id", user_id).execute()
        if cv_result.data:
            cv_text = cv_result.data[0].get("cv_text")

    if jd_id:
        jd_result = supabase.table("job_descriptions").select("text, user_id").eq("id", jd_id).execute()
        if jd_result.data:
            jd_row = jd_result.data[0]
            if jd_row.get("user_id") in (None, user_id):
                jd_text = jd_result.data[0].get("text")

    try:
        questions = generate_questions(
            interview_type=interview_type,
            difficulty=difficulty,
            cv_text=cv_text,
            jd_text=jd_text,
            count=count,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Question generation failed: {str(e)}")

    return questions

@router.post("/{session_id}/start", response_model=dict)
def start_session_questions(session_id: str, current_user: dict = Depends(get_current_user)):
    """Queues questions for the session in order. Call once when interview begins.

    If the session has a CV or JD attached, tailored questions are generated and
    persisted as real rows in `questions`, then the session is seeded with those
    IDs — so each answer and its evaluation link to the exact question asked, and
    the generated questions accumulate into a reusable bank. With no documents,
    or if generation fails, the session is seeded from the static question bank.
    """
    supabase = get_supabase()
    user_id = current_user["sub"]

    session_result = supabase.table("sessions").select("*").eq("id", session_id).execute()
    if not session_result.data:
        raise HTTPException(status_code=404, detail="Session not found")
    session = session_result.data[0]
    if session["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Session not found")

    interview_type = session["interview_type"]
    duration = session["duration"]
    difficulty = session.get("difficulty", "medium")
    cv_id = session.get("cv_id")
    jd_id = session.get("jd_id")

    # Approx. 6 minutes per question
    question_count = max(3, round(duration / 6))

    # Idempotent: if already seeded, don't seed again.
    existing = supabase.table("session_questions").select("id").eq("session_id", session_id).execute()
    if existing.data:
        return {"message": "Session already started", "session_id": session_id}

    seeded_questions = None

    # --- Tailored path: generate from CV/JD and persist as real question rows ---
    if cv_id or jd_id:
        cv_text = None
        jd_text = None
        if cv_id:
            cv_result = supabase.table("cvs").select("cv_text").eq("id", cv_id).eq("user_id", user_id).execute()
            if cv_result.data:
                cv_text = cv_result.data[0].get("cv_text")
        if jd_id:
            jd_result = supabase.table("job_descriptions").select("text, user_id").eq("id", jd_id).execute()
            if jd_result.data and jd_result.data[0].get("user_id") in (None, user_id):
                jd_text = jd_result.data[0].get("text")

        if cv_text or jd_text:
            try:
                generated = generate_questions(
                    interview_type=interview_type,
                    difficulty=difficulty,
                    cv_text=cv_text,
                    jd_text=jd_text,
                    count=question_count,
                )
                rows_to_insert = [
                    {
                        "interview_type": interview_type,
                        "prompt": q["prompt"],
                        "order": q.get("order", idx + 1),
                    }
                    for idx, q in enumerate(generated)
                    if q.get("prompt")
                ]
                if rows_to_insert:
                    inserted = supabase.table("questions").insert(rows_to_insert).execute()
                    # Keep them in generation order for seeding.
                    seeded_questions = sorted(
                        inserted.data, key=lambda r: r.get("order", 0)
                    )
            except Exception as e:
                # Generation/persist failed — fall back to the static bank below.
                print(f"Tailored generation failed, using static bank: {e}")
                seeded_questions = None

    # --- Static fallback: seed from the pre-written question bank ---
    if not seeded_questions:
        questions_result = (
            supabase.table("questions")
            .select("id, order")
            .eq("interview_type", interview_type)
            .order("order")
            .limit(question_count)
            .execute()
        )
        if not questions_result.data:
            raise HTTPException(status_code=404, detail=f"No questions found for: {interview_type}")
        seeded_questions = questions_result.data

    rows = [
        {"session_id": session_id, "question_id": q["id"], "question_order": idx + 1, "answered": False}
        for idx, q in enumerate(seeded_questions)
    ]
    supabase.table("session_questions").insert(rows).execute()
    supabase.table("sessions").update({"status": "in_progress"}).eq("id", session_id).execute()

    return {"message": "Session started", "session_id": session_id, "total_questions": len(rows)}

@router.get("/{session_id}/next", response_model=QuestionResponse)
def get_next_question(session_id: str, current_user: dict = Depends(get_current_user)):
    """Returns the next unanswered question for the session"""
    supabase = get_supabase()
    user_id = current_user["sub"]

    session_result = supabase.table("sessions").select("user_id").eq("id", session_id).execute()
    if not session_result.data or session_result.data[0]["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Session not found")

    sq_result = (
        supabase.table("session_questions")
        .select("*, questions(id, interview_type, prompt, order)")
        .eq("session_id", session_id)
        .eq("answered", False)
        .order("question_order")
        .limit(1)
        .execute()
    )

    if not sq_result.data:
        raise HTTPException(status_code=404, detail="All questions answered. Call POST /session/{id}/complete.")

    sq = sq_result.data[0]
    question = sq["questions"]
    question_number = sq["question_order"]

    total_result = (
        supabase.table("session_questions")
        .select("id", count="exact")
        .eq("session_id", session_id)
        .execute()
    )
    total = total_result.count 

    return {
        "id": question["id"],
        "interview_type": question["interview_type"],
        "prompt": question["prompt"],
        "order": question["order"],
        "question_number": question_number,
        "total_questions": total,
        "is_last": question_number == total,
    }

@router.get("/{session_id}/all", response_model=list[dict])
def get_all_session_questions(session_id: str, current_user: dict = Depends(get_current_user)):
    """
    Returns every question queued for this session, in order, each with its
    real question_id (UUID). Room 1 fetches one at a time via /next because
    it only ever moves forward, marking-answered to advance. Room 2/3
    supports going backward (Previous) and manages its own local index
    client-side, so it needs the whole sequence — with real ids — up front
    instead of one at a time.
    """
    supabase = get_supabase()
    user_id = current_user["sub"]

    session_result = supabase.table("sessions").select("user_id").eq("id", session_id).execute()
    if not session_result.data or session_result.data[0]["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Session not found")

    sq_result = (
        supabase.table("session_questions")
        .select("question_order, questions(id, prompt)")
        .eq("session_id", session_id)
        .order("question_order")
        .execute()
    )

    return [
        {
            "id": row["questions"]["id"],
            "prompt": row["questions"]["prompt"],
            "question_number": row["question_order"],
        }
        for row in sq_result.data
        if row.get("questions")
    ]


@router.post("/{session_id}/answered/{question_id}", response_model=dict)
def mark_answered(session_id: str, question_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase()

    try:
        uuid_lib.UUID(question_id)
    except (ValueError, AttributeError, TypeError):
        return {"message": "No matching question row (non-UUID id) — skipped", "question_id": question_id}
                
    result = (
        supabase.table("session_questions")
        .update({"answered": True})
        .eq("session_id", session_id)
        .eq("question_id", question_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Session/question combination not found")
    return {"message": "Question marked as answered", "question_id": question_id}
