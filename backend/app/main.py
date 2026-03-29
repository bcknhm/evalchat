import os
from fastapi import FastAPI, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .auth import create_token, verify_token
from .config import settings
from .database import init_db, get_db, get_settings_from_db, Setting, Document, Chunk  # noqa: F401
from .models import LoginRequest, TokenResponse, SettingsResponse, SettingsUpdateRequest
from .documents import router as documents_router
from .chat import router as chat_router
from .rag import clear_all_vectors, chunk_text, embed_and_store, extract_text_from_file
from sqlalchemy.orm import Session

app = FastAPI(title="RAGAS Evaluator", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    init_db()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.post("/api/auth", response_model=TokenResponse)
def login(body: LoginRequest):
    if body.password != settings.app_password:
        raise HTTPException(status_code=401, detail="Falsches Passwort")
    return TokenResponse(token=create_token())


@app.get("/api/auth/verify")
def verify(token: str = Depends(verify_token)):
    return {"valid": True}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@app.get("/api/settings", response_model=SettingsResponse)
def get_settings(db: Session = Depends(get_db), token: str = Depends(verify_token)):
    cfg = get_settings_from_db(db)
    return SettingsResponse(**cfg)


@app.put("/api/settings", response_model=SettingsResponse)
def update_settings(
    body: SettingsUpdateRequest,
    db: Session = Depends(get_db),
    token: str = Depends(verify_token),
):
    updates = {}
    if body.chunk_size is not None:
        if not (100 <= body.chunk_size <= 4000):
            raise HTTPException(status_code=400, detail="chunk_size muss zwischen 100 und 4000 liegen")
        updates["chunk_size"] = str(body.chunk_size)
    if body.chunk_overlap is not None:
        if body.chunk_overlap < 0:
            raise HTTPException(status_code=400, detail="chunk_overlap muss >= 0 sein")
        updates["chunk_overlap"] = str(body.chunk_overlap)
    if body.splitter is not None:
        if body.splitter not in ("recursive", "character", "markdown"):
            raise HTTPException(status_code=400, detail="Ungültiger splitter")
        updates["splitter"] = body.splitter

    for key, value in updates.items():
        row = db.query(Setting).filter(Setting.key == key).first()
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))
    db.commit()

    cfg = get_settings_from_db(db)
    return SettingsResponse(**cfg)


# ---------------------------------------------------------------------------
# Reindex all / Clear vectors
# ---------------------------------------------------------------------------

@app.post("/api/reindex")
def reindex_all(db: Session = Depends(get_db), token: str = Depends(verify_token)):
    from .documents import _process_document
    cfg = get_settings_from_db(db)
    docs = db.query(Document).all()
    total_chunks = 0
    for doc in docs:
        try:
            text = extract_text_from_file(doc.file_path, doc.file_type)
            _process_document(doc, text, db, cfg["chunk_size"], cfg["chunk_overlap"], cfg["splitter"])
            total_chunks += doc.chunk_count
        except Exception:
            pass
    return {"documents_processed": len(docs), "total_chunks": total_chunks}


@app.delete("/api/vectors")
def clear_vectors(db: Session = Depends(get_db), token: str = Depends(verify_token)):
    clear_all_vectors()
    db.query(Chunk).delete()
    docs = db.query(Document).all()
    for doc in docs:
        doc.chunk_count = 0
    db.commit()
    return {"cleared": True}


# ---------------------------------------------------------------------------
# Chunks browser endpoint (across all documents)
# ---------------------------------------------------------------------------

@app.get("/api/chunks")
def get_all_chunks(
    document_id: str = None,
    db: Session = Depends(get_db),
    token: str = Depends(verify_token),
):
    from .models import ChunkInfo
    query = db.query(Chunk, Document).join(Document, Chunk.document_id == Document.id)
    if document_id:
        query = query.filter(Chunk.document_id == document_id)
    rows = query.order_by(Chunk.document_id, Chunk.chunk_index).all()
    return [
        ChunkInfo(
            id=c.id,
            document_id=c.document_id,
            document_name=doc.filename,
            chunk_index=c.chunk_index,
            content=c.content,
            char_count=c.char_count,
            has_overlap=c.has_overlap,
            overlap_chars=c.overlap_chars,
        )
        for c, doc in rows
    ]


# ---------------------------------------------------------------------------
# Document routes
# ---------------------------------------------------------------------------

app.include_router(documents_router, prefix="/api/documents", tags=["documents"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])

# ---------------------------------------------------------------------------
# Serve React build
# ---------------------------------------------------------------------------

static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "static"))
if os.path.exists(static_dir):
    assets_dir = os.path.join(static_dir, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't catch API routes (shouldn't happen, but safety net)
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        index = os.path.join(static_dir, "index.html")
        if os.path.exists(index):
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Frontend not built")
