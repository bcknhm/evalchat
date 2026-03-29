import os
import uuid
from typing import List, Dict, Any

import chromadb
from openai import OpenAI

from .config import settings

# ---------------------------------------------------------------------------
# ChromaDB client (singleton)
# ---------------------------------------------------------------------------

_chroma_client = None
_collection = None


def get_chroma_client() -> chromadb.PersistentClient:
    global _chroma_client
    if _chroma_client is None:
        chroma_path = os.path.join(settings.data_dir, "chroma")
        os.makedirs(chroma_path, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(path=chroma_path)
    return _chroma_client


def get_collection():
    global _collection
    if _collection is None:
        client = get_chroma_client()
        _collection = client.get_or_create_collection(
            name="documents",
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


# ---------------------------------------------------------------------------
# Text splitters
# ---------------------------------------------------------------------------

def _split_recursive(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    """Simple recursive splitter that tries paragraph → newline → word boundaries."""
    separators = ["\n\n", "\n", " ", ""]

    def _split(text: str, seps: List[str]) -> List[str]:
        if not text.strip():
            return []
        if len(text) <= chunk_size or not seps:
            return [text.strip()] if text.strip() else []

        sep = seps[0]
        parts = text.split(sep) if sep else list(text)

        chunks: List[str] = []
        current = ""
        for part in parts:
            candidate = (current + sep + part) if current else part
            if len(candidate) <= chunk_size:
                current = candidate
            else:
                if current:
                    chunks.append(current.strip())
                if len(part) > chunk_size:
                    sub = _split(part, seps[1:])
                    if sub:
                        chunks.extend(sub[:-1])
                        current = sub[-1]
                    else:
                        current = ""
                else:
                    current = part
        if current:
            chunks.append(current.strip())
        return [c for c in chunks if c]

    raw = _split(text, separators)
    if chunk_overlap <= 0 or len(raw) <= 1:
        return raw

    overlapped: List[str] = [raw[0]]
    for i in range(1, len(raw)):
        prev = raw[i - 1]
        tail = prev[-chunk_overlap:] if len(prev) > chunk_overlap else prev
        overlapped.append(tail + raw[i])
    return overlapped


def _split_markdown(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    """Markdown-aware splitter: prefers heading boundaries."""
    separators = ["\n## ", "\n### ", "\n#### ", "\n\n", "\n", " ", ""]
    # Normalise heading markers back to text after split
    raw: List[str] = []
    current = ""
    for sep in separators:
        if sep and sep in text:
            parts = text.split(sep)
            for i, part in enumerate(parts):
                segment = (sep.lstrip("\n") + part) if (i > 0 and sep.startswith("\n")) else part
                candidate = (current + "\n\n" + segment) if current else segment
                if len(candidate) <= chunk_size:
                    current = candidate
                else:
                    if current:
                        raw.append(current.strip())
                    current = segment
            if current:
                raw.append(current.strip())
            current = ""
            text = ""
            break
    if text.strip():
        raw = _split_recursive(text, chunk_size, chunk_overlap)

    if not raw:
        return []
    if chunk_overlap <= 0 or len(raw) <= 1:
        return [c for c in raw if c]
    overlapped: List[str] = [raw[0]]
    for i in range(1, len(raw)):
        prev = raw[i - 1]
        tail = prev[-chunk_overlap:] if len(prev) > chunk_overlap else prev
        overlapped.append(tail + raw[i])
    return [c for c in overlapped if c]


def chunk_text(
    text: str,
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
    splitter: str = "recursive",
) -> List[Dict[str, Any]]:
    """Split text into chunks and return structured list."""
    if splitter == "markdown":
        raw_chunks = _split_markdown(text, chunk_size, chunk_overlap)
    else:
        raw_chunks = _split_recursive(text, chunk_size, chunk_overlap)

    result = []
    for i, content in enumerate(raw_chunks):
        if not content.strip():
            continue
        has_overlap = i > 0 and chunk_overlap > 0
        overlap_chars = min(chunk_overlap, len(content)) if has_overlap else 0
        result.append(
            {
                "index": i,
                "content": content,
                "char_count": len(content),
                "has_overlap": has_overlap,
                "overlap_chars": overlap_chars,
            }
        )
    return result


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------

_openai_client = None


def get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    return _openai_client


def embed_texts(texts: List[str]) -> List[List[float]]:
    client = get_openai_client()
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts,
    )
    return [item.embedding for item in response.data]


# ---------------------------------------------------------------------------
# Store / delete
# ---------------------------------------------------------------------------

def embed_and_store(doc_id: str, filename: str, chunks: List[Dict[str, Any]]) -> None:
    """Embed chunks and add to ChromaDB."""
    collection = get_collection()
    texts = [c["content"] for c in chunks]
    embeddings = embed_texts(texts)

    ids = [f"{doc_id}_{c['index']}" for c in chunks]
    metadatas = [
        {
            "document_id": doc_id,
            "filename": filename,
            "chunk_index": c["index"],
        }
        for c in chunks
    ]

    collection.add(
        ids=ids,
        documents=texts,
        embeddings=embeddings,
        metadatas=metadatas,
    )


def delete_document_vectors(doc_id: str) -> None:
    """Remove all ChromaDB entries for a document."""
    collection = get_collection()
    collection.delete(where={"document_id": doc_id})


def clear_all_vectors() -> None:
    """Drop and recreate the ChromaDB collection."""
    global _collection
    client = get_chroma_client()
    try:
        client.delete_collection("documents")
    except Exception:
        pass
    _collection = client.get_or_create_collection(
        name="documents",
        metadata={"hnsw:space": "cosine"},
    )


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------

def retrieve(query: str, k: int = 4) -> List[Dict[str, Any]]:
    """Return top-k chunks most similar to query."""
    collection = get_collection()
    count = collection.count()
    if count == 0:
        return []

    k = min(k, count)
    query_emb = embed_texts([query])[0]
    results = collection.query(
        query_embeddings=[query_emb],
        n_results=k,
        include=["documents", "metadatas", "distances"],
    )

    chunks = []
    for i in range(len(results["ids"][0])):
        distance = results["distances"][0][i]
        # cosine distance → similarity
        similarity = 1.0 - distance
        chunks.append(
            {
                "chroma_id": results["ids"][0][i],
                "content": results["documents"][0][i],
                "metadata": results["metadatas"][0][i],
                "similarity": round(similarity, 4),
            }
        )
    return chunks


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

def extract_text_from_file(file_path: str, file_type: str) -> str:
    if file_type == "md":
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    elif file_type == "pdf":
        import fitz  # PyMuPDF
        doc = fitz.open(file_path)
        pages = [page.get_text() for page in doc]
        doc.close()
        return "\n\n".join(pages)
    raise ValueError(f"Unsupported file type: {file_type}")
