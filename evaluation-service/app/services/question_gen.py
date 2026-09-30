import json
from groq import Groq
import os
from dotenv import load_dotenv

load_dotenv()

_client = None


def get_groq() -> Groq:
    global _client
    if _client is None:
        key = os.environ.get("GROQ_API_KEY")
        if not key:
            raise RuntimeError("GROQ_API_KEY not set")
        _client = Groq(api_key=key)
    return _client


def generate_questions(
    interview_type: str,
    difficulty: str = "medium",
    cv_text: str | None = None,
    jd_text: str | None = None,
    count: int = 5,
) -> list[dict]:
    """
    Generate tailored interview questions using Groq
    Uses CV alone, JD alone, or both whatever is provided.
    Falls back to generic questions if neither is provided.
    """
    groq = get_groq()

    context_parts = []
    if cv_text:
        context_parts.append(f"Candidate CV:\n{cv_text[:3000]}")
    if jd_text:
        context_parts.append(f"Job Description:\n{jd_text[:2000]}")

    context = "\n\n".join(context_parts) if context_parts else "No CV or JD provided — generate generic questions."

    type_guidance = {
        "technical": "Focus on technical concepts, problem-solving, and system design relevant to the candidate's background and the role.",
        "behavioral": "Use the STAR method. Focus on situations the candidate likely encountered based on their experience.",
        "hr": "Focus on career goals, motivation, culture fit, and professionalism relevant to the role and company.",
    }

    difficulty_guidance = {
    "easy": (
        "Questions should test fundamental concepts, basic knowledge, "
        "and simple real-world scenarios suitable for beginners."
    ),
    "medium": (
        "Questions should require practical experience, analytical thinking, "
        "and moderate problem-solving."
    ),
    "hard": (
        "Questions should challenge experienced candidates with advanced concepts, "
        "edge cases, system design, and complex problem-solving."
    ),
}

    prompt = f"""You are an expert interviewer preparing {count} {difficulty.upper()} {interview_type.upper()} interview questions.

{context}

Interview type guidance: {type_guidance.get(interview_type, '')}

Difficulty guidance: {difficulty_guidance.get(difficulty, difficulty_guidance["medium"])}

Generate exactly {count} questions that are:
- Specific to the candidate's background and/or the job role (when context is provided)
- Appropriate for a spoken verbal answer (no code writing required)
- Match the requested difficulty level
- Varied in topic and wording
- Avoid duplicate or very similar questions

Respond ONLY with valid JSON array, no preamble, no markdown:
[
  {{"order": 1, "prompt": "Question text here"}},
  {{"order": 2, "prompt": "Question text here"}},
  ...
]"""

    response = groq.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=1000,
    )

    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    questions = json.loads(raw)
    return questions
