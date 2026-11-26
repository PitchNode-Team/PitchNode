from pydantic import BaseModel
from typing import Optional


class EvaluationRequest(BaseModel):
    session_id: str
    question_id: str
    question_text: str
    transcript: str


class ScoresShape(BaseModel):
    communication: float
    technicalAccuracy: float
    confidence: float
    problemSolving: float
    

class EvaluationResponse(BaseModel):
    scores: Optional[ScoresShape] = None
    feedback: str
    scoring_unavailable: bool = False
