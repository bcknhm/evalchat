import os
import shutil
from uuid import uuid4
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from .auth import verify_token
from .database import get_db, Document, Chunk, get_settings_from_db
from .models import DocumentResponse, DocumentDetailResponse, ChunkInfo
from .rag import extract_text_from_file, chunk_text, embed_and_store, delete_document_vectors
from .config import settings

router = APIRouter()

ALLOWED_TYPES = {"md": "md", "pdf": "pdf"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def _doc_to_response(doc: Document) -> DocumentResponse:
    return DocumentResponse(
        id=doc.id,
        filename=doc.filename,
        file_type=doc.file_type,
        file_size=doc.file_size,
        chunk_count=doc.chunk_count,
        chunk_size=doc.chunk_size,
        chunk_overlap=doc.chunk_overlap,
        splitter=doc.splitter,
        created_at=doc.created_at,
    )


def _process_document(doc: Document, text: str, db: Session, chunk_size: int, chunk_overlap: int, splitter: str):
    """Chunk, embed and store a document. Updates doc in place."""
    # Remove existing chunks from DB and ChromaDB
    db.query(Chunk).filter(Chunk.document_id == doc.id).delete()
    delete_document_vectors(doc.id)

    # Chunk text
    chunks = chunk_text(text, chunk_size, chunk_overlap, splitter)

    # Embed and store in ChromaDB
    embed_and_store(doc.id, doc.filename, chunks)

    # Store chunks in SQLite
    for c in chunks:
        db.add(Chunk(
            id=str(uuid4()),
            document_id=doc.id,
            chunk_index=c["index"],
            content=c["content"],
            char_count=c["char_count"],
            chroma_id=f"{doc.id}_{c['index']}",
            has_overlap=c["has_overlap"],
            overlap_chars=c["overlap_chars"],
        ))

    doc.chunk_count = len(chunks)
    doc.chunk_size = chunk_size
    doc.chunk_overlap = chunk_overlap
    doc.splitter = splitter
    db.commit()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=List[DocumentResponse])
def list_documents(db: Session = Depends(get_db), token: str = Depends(verify_token)):
    docs = db.query(Document).order_by(Document.created_at.desc()).all()
    return [_doc_to_response(d) for d in docs]


@router.post("", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    token: str = Depends(verify_token),
):
    # Validate extension
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Nur .md und .pdf Dateien erlaubt")

    # Read content
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Datei zu groß (max 10 MB)")

    # Save file
    os.makedirs(settings.uploads_dir, exist_ok=True)
    file_id = str(uuid4())
    file_path = os.path.join(settings.uploads_dir, f"{file_id}.{ext}")
    with open(file_path, "wb") as f:
        f.write(content)

    # Current chunking settings
    cfg = get_settings_from_db(db)

    # Create DB record
    doc = Document(
        id=file_id,
        filename=file.filename,
        file_type=ext,
        file_size=len(content),
        file_path=file_path,
        chunk_size=cfg["chunk_size"],
        chunk_overlap=cfg["chunk_overlap"],
        splitter=cfg["splitter"],
    )
    db.add(doc)
    db.commit()

    # Extract text and process
    try:
        text = extract_text_from_file(file_path, ext)
        _process_document(doc, text, db, cfg["chunk_size"], cfg["chunk_overlap"], cfg["splitter"])
    except Exception as e:
        # Rollback on failure
        db.delete(doc)
        db.commit()
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Fehler beim Verarbeiten: {str(e)}")

    return _doc_to_response(doc)


@router.get("/{doc_id}", response_model=DocumentDetailResponse)
def get_document(doc_id: str, db: Session = Depends(get_db), token: str = Depends(verify_token)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")

    chunks = db.query(Chunk).filter(Chunk.document_id == doc_id).order_by(Chunk.chunk_index).all()
    chunk_infos = [
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
        for c in chunks
    ]

    return DocumentDetailResponse(
        **_doc_to_response(doc).model_dump(),
        chunks=chunk_infos,
    )


@router.delete("/{doc_id}")
def delete_document(doc_id: str, db: Session = Depends(get_db), token: str = Depends(verify_token)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")

    # Delete from ChromaDB
    delete_document_vectors(doc_id)

    # Delete file
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    db.delete(doc)
    db.commit()
    return {"deleted": True}


@router.post("/{doc_id}/reindex")
def reindex_document(doc_id: str, db: Session = Depends(get_db), token: str = Depends(verify_token)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")

    cfg = get_settings_from_db(db)
    try:
        text = extract_text_from_file(doc.file_path, doc.file_type)
        _process_document(doc, text, db, cfg["chunk_size"], cfg["chunk_overlap"], cfg["splitter"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reindex-Fehler: {str(e)}")

    return {"chunk_count": doc.chunk_count}


@router.delete("/{doc_id}/chunks")
def delete_chunks(doc_id: str, db: Session = Depends(get_db), token: str = Depends(verify_token)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")

    delete_document_vectors(doc_id)
    db.query(Chunk).filter(Chunk.document_id == doc_id).delete()
    doc.chunk_count = 0
    db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# All-chunks endpoint (for chunk browser)
# ---------------------------------------------------------------------------

@router.get("/{doc_id}/chunks", response_model=List[ChunkInfo])
def get_document_chunks(
    doc_id: str,
    db: Session = Depends(get_db),
    token: str = Depends(verify_token),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")

    chunks = db.query(Chunk).filter(Chunk.document_id == doc_id).order_by(Chunk.chunk_index).all()
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
        for c in chunks
    ]
