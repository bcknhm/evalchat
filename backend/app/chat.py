import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI

from .auth import verify_token
from .config import settings
from .models import ChatRequest, ChatHistoryItem
from .rag import retrieve
from .evaluation import run_evaluation

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory chat history (single-user app)
_chat_history: List[dict] = []

SYSTEM_PROMPT_TEMPLATE = """Du bist ein hilfreicher Assistent. Beantworte Fragen ausschließlich auf Basis des bereitgestellten Kontexts.

Kontext:
{context}

Falls die Frage nicht aus dem Kontext beantwortet werden kann, antworte:
"Diese Information ist nicht in den Dokumenten enthalten."
"""

AVAILABLE_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"]


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("")
async def chat(request: ChatRequest, token: str = Depends(verify_token)):
    if request.model not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail="Ungültiges Modell")

    async def generate():
        client = AsyncOpenAI(api_key=settings.openai_api_key)

        # --- 1. Retrieve relevant chunks ---
        chunks = retrieve(request.message, k=4)
        if not chunks:
            context_str = "Keine Dokumente vorhanden."
            context_texts = []
        else:
            context_texts = [c["content"] for c in chunks]
            context_str = "\n\n---\n\n".join(context_texts)

        # Emit sources immediately so frontend can display them
        sources_payload = [
            {
                "chroma_id": c["chroma_id"],
                "document": c["metadata"].get("filename", ""),
                "chunk_index": c["metadata"].get("chunk_index", 0),
                "similarity": c["similarity"],
                "preview": c["content"][:200],
            }
            for c in chunks
        ]
        yield _sse({"type": "sources", "sources": sources_payload})

        # --- 2. Build messages ---
        template = request.system_prompt if request.system_prompt else SYSTEM_PROMPT_TEMPLATE
        system_prompt = template.format(context=context_str)
        messages = [{"role": "system", "content": system_prompt}]
        for h in _chat_history[-10:]:  # last 5 turns
            messages.append(h)
        messages.append({"role": "user", "content": request.message})

        # --- 3. Stream LLM response ---
        full_answer = ""
        try:
            stream = await client.chat.completions.create(
                model=request.model,
                messages=messages,
                stream=True,
                temperature=0.3,
            )
            async for event in stream:
                delta = event.choices[0].delta
                if delta.content:
                    full_answer += delta.content
                    yield _sse({"type": "token", "content": delta.content})
        except Exception as e:
            yield _sse({"type": "error", "message": str(e)})
            yield _sse({"type": "done"})
            return

        # Update history
        _chat_history.append({"role": "user", "content": request.message})
        _chat_history.append({"role": "assistant", "content": full_answer})

        # --- 4. Evaluation ---
        yield _sse({"type": "eval_start"})

        if context_texts:
            try:
                scores = await run_evaluation(
                    question=request.message,
                    answer=full_answer,
                    contexts=context_texts,
                    eval_model=request.eval_model,
                )
                yield _sse({"type": "eval_result", "scores": scores})
            except Exception as e:
                logger.error(f"Evaluation failed: {e}")
                yield _sse({"type": "eval_error", "message": str(e)})
        else:
            yield _sse({"type": "eval_result", "scores": {
                "faithfulness": 0.0,
                "answer_relevancy": 0.0,
                "context_precision": 0.0,
                "context_recall": 0.0,
            }})

        yield _sse({"type": "done"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/history", response_model=List[ChatHistoryItem])
def get_history(token: str = Depends(verify_token)):
    return [ChatHistoryItem(role=m["role"], content=m["content"]) for m in _chat_history]


@router.delete("/history")
def clear_history(token: str = Depends(verify_token)):
    _chat_history.clear()
    return {"cleared": True}
