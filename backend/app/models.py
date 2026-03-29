from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    token: str


class ChunkInfo(BaseModel):
    id: str
    document_id: str
    document_name: str
    chunk_index: int
    content: str
    char_count: int
    has_overlap: bool
    overlap_chars: int


class DocumentResponse(BaseModel):
    id: str
    filename: str
    file_type: str
    file_size: int
    chunk_count: int
    chunk_size: int
    chunk_overlap: int
    splitter: str
    created_at: datetime


class DocumentDetailResponse(DocumentResponse):
    chunks: List[ChunkInfo]


class ChatRequest(BaseModel):
    message: str
    model: str = "gpt-4o-mini"
    eval_model: str = "gpt-4o-mini"
    system_prompt: Optional[str] = None


class ChatHistoryItem(BaseModel):
    role: str
    content: str


class SettingsResponse(BaseModel):
    chunk_size: int
    chunk_overlap: int
    splitter: str


class SettingsUpdateRequest(BaseModel):
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    splitter: Optional[str] = None


class EvalScores(BaseModel):
    faithfulness: float
    answer_relevancy: float
    context_precision: float
    context_recall: float
