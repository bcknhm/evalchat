# RAG Chatbot - Projektspezifikation für Claude Code

## Projektübersicht

Erstelle einen RAG (Retrieval-Augmented Generation) Chatbot mit Web-Frontend. Der Chatbot durchsucht hochgeladene Markdown- und PDF-Dokumente und beantwortet Fragen basierend auf deren Inhalt.

## Tech-Stack

| Komponente | Technologie |
|------------|-------------|
| Frontend | React 18 + Vite + TailwindCSS |
| Backend | FastAPI + Python 3.11 |
| RAG | LangChain |
| Vector Store | ChromaDB (persistent) |
| Metadata DB | SQLite |
| LLM | OpenAI API (mehrere Modelle) |
| Embeddings | OpenAI text-embedding-3-small |
| Auth | JWT (PyJWT) |
| Deployment | Docker + Docker Compose |

---

## Projektstruktur

```
rag-chatbot/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py           # FastAPI App, CORS, Static Files
│   │   ├── config.py         # Settings aus .env (Pydantic BaseSettings)
│   │   ├── auth.py           # JWT Login/Verify
│   │   ├── models.py         # Pydantic Request/Response Models
│   │   ├── database.py       # SQLite Setup (SQLAlchemy)
│   │   ├── documents.py      # Document CRUD Endpoints
│   │   ├── chat.py           # Chat Endpoint mit SSE Streaming
│   │   └── rag.py            # Chunking, Embedding, Retrieval Logic
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx           # Router, Auth Context
│   │   ├── api.js            # API Client mit Token-Handling
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Chat.jsx
│   │   │   └── Documents.jsx
│   │   ├── components/
│   │   │   ├── Header.jsx        # Logo, Model-Selector, Tabs
│   │   │   ├── MessageList.jsx   # Chat-Nachrichten mit Markdown
│   │   │   ├── ChatInput.jsx     # Input + Send Button
│   │   │   ├── DocumentList.jsx  # Dokument-Liste mit Selection
│   │   │   ├── DocumentDetail.jsx # Details + Actions
│   │   │   ├── UploadZone.jsx    # Drag & Drop Upload
│   │   │   └── AdminPanel.jsx    # Chunk-Settings, Reindex, Clear
│   │   └── index.css         # Tailwind + Custom Colors
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## Farbpalette (Tailwind erweitern)

Hauptsächlich Blautöne verwenden:

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          darkblue: '#0c446c',    // Header, Primary Text
          blue: '#135a8a',        // Buttons, Links
          lightblue: '#5eb3df',   // Borders, Accents, Muted Text
          pale: '#eaf5fb',        // Card Backgrounds, Bot Messages
          white: '#ffffff',       // Base Background
          success: '#95f7ae',     // Success States
        }
      }
    }
  }
}
```

---

## Features

### 1. Authentifizierung

- **Login-Screen**: Einfaches Passwort-Feld, kein Username
- **Passwort**: Wird aus Umgebungsvariable `APP_PASSWORD` gelesen
- **Token**: JWT mit 24h Gültigkeit, gespeichert in localStorage
- **Geschützte Routen**: Alle `/api/*` außer `/api/auth`

### 2. Chat (Tab 1)

- **Modellauswahl** im Header: gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo
- **Streaming**: Server-Sent Events (SSE) für Token-by-Token Ausgabe
- **Markdown-Rendering**: Code-Blöcke, Listen, Inline-Code in Antworten
- **Quellenangabe**: Unter jeder Antwort das Quell-Dokument anzeigen
- **Chat-Historie**: Session-basiert (in-memory), "Neuer Chat" Button zum Löschen
- **Info-Anzeige**: "X Dokumente · Y Chunks" unten im Chat

### 3. Dokumente (Tab 2)

- **Upload-Zone**: Drag & Drop oder Datei-Auswahl (.md, .pdf, max 10MB)
- **Dokumentenliste**: Dateiname, Größe, Chunk-Anzahl, auswählbar
- **Dokument-Details** (bei Auswahl):
  - Metadaten: Größe, Typ, Upload-Datum, Chunk-Anzahl
  - Chunk-Vorschau: Erste Zeichen jedes Chunks
  - Aktionen: "Neu indexieren", "Chunks löschen", "Dokument löschen"
- **Admin-Bereich** (unten in der Sidebar):
  - Chunk-Einstellungen: Chunk-Größe (default 1000), Overlap (default 200)
  - "Alle Dokumente neu indexieren" Button
  - "Vektor-Speicher leeren" Button (danger)

### 4. Verarbeitungs-Pipeline

Beim Upload automatisch:
1. Datei speichern in `/app/uploads/`
2. Text extrahieren (Markdown direkt, PDF via PyMuPDF)
3. Text chunken (RecursiveCharacterTextSplitter)
4. Chunks embedden (OpenAI text-embedding-3-small)
5. In ChromaDB speichern
6. Metadaten in SQLite speichern

---

## API Endpoints

### Auth
```
POST /api/auth
  Body: { "password": "string" }
  Response: { "token": "jwt-string" }

GET /api/auth/verify
  Header: Authorization: Bearer <token>
  Response: { "valid": true }
```

### Documents
```
GET /api/documents
  Response: [{ "id", "filename", "file_type", "file_size", "chunk_count", "created_at" }]

POST /api/documents
  Body: multipart/form-data (file)
  Response: { "id", "filename", "chunk_count", ... }

GET /api/documents/{id}
  Response: { ..., "chunks": [{ "index", "preview" }] }

DELETE /api/documents/{id}
  Response: { "deleted": true }

POST /api/documents/{id}/reindex
  Response: { "chunk_count": n }

DELETE /api/documents/{id}/chunks
  Response: { "deleted": true }
```

### Indexing
```
POST /api/reindex
  Response: { "documents_processed": n, "total_chunks": n }

DELETE /api/vectors
  Response: { "cleared": true }
```

### Settings
```
GET /api/settings
  Response: { "chunk_size": 1000, "chunk_overlap": 200 }

PUT /api/settings
  Body: { "chunk_size": 1000, "chunk_overlap": 200 }
  Response: { "chunk_size": 1000, "chunk_overlap": 200 }
```

### Chat
```
POST /api/chat
  Body: { "message": "string", "model": "gpt-4o-mini" }
  Response: SSE Stream
    data: { "type": "token", "content": "..." }
    data: { "type": "source", "document": "filename.md" }
    data: { "type": "done" }

GET /api/chat/history
  Response: [{ "role": "user"|"assistant", "content": "..." }]

DELETE /api/chat/history
  Response: { "cleared": true }
```

---

## UI Layout

### Login-Screen
- Zentrierte Card auf `#eaf5fb` Hintergrund
- Lock-Icon in `#0c446c` Kreis
- Titel "RAG Chatbot", Untertitel "Dokumentations-Assistent"
- Passwort-Input + "Anmelden" Button (`#135a8a`)

### Hauptlayout (nach Login)
```
┌─────────────────────────────────────────────────────────┐
│ [Logo] RAG Chatbot  [Model-Dropdown]      [Chat] [Docs] │  <- Header (#0c446c)
├─────────────────────────────────────────────────────────┤
│                                                         │
│  (Tab-Content: Chat oder Documents)                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Chat-Tab
- Message-Liste: User rechts (`#135a8a`), Bot links (`#eaf5fb`)
- Quellenangabe unter Bot-Nachrichten
- Input unten: Textfeld + "Senden" Button
- Footer: "X Dokumente · Y Chunks" + "Neuer Chat"

### Documents-Tab
- Links: Upload-Zone (kompakt) + Dokumentenliste
- Rechts: Detail-Panel (wenn Dokument ausgewählt)
- Unten links: Admin-Bereich mit Chunk-Settings + Buttons

---

## Docker Setup

### Dockerfile (Multi-Stage für Frontend + Backend)
```dockerfile
# Frontend Build
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Backend
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./static
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### docker-compose.yml
```yaml
services:
  app:
    build: .
    container_name: rag-chatbot
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data          # SQLite + ChromaDB
      - ./uploads:/app/uploads    # Original-Dateien
    env_file:
      - .env
    networks:
      - proxy

networks:
  proxy:
    external: true
```

### .env.example
```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Auth
APP_PASSWORD=sicheres-passwort-hier
JWT_SECRET=zufaelliger-string-fuer-token-signatur

# Defaults
DEFAULT_MODEL=gpt-4o-mini
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
```

### .gitignore
```
.env
data/
uploads/
__pycache__/
node_modules/
dist/
*.pyc
.venv/
```

---

## Wichtige Implementierungsdetails

### Backend

1. **FastAPI Main**: Static Files aus `/app/static` für React-Build servieren
2. **CORS**: Für lokale Entwicklung `localhost:5173` erlauben
3. **ChromaDB**: Persistent in `/app/data/chroma/`
4. **SQLite**: In `/app/data/database.db`
5. **PDF-Parsing**: PyMuPDF (fitz) verwenden
6. **Streaming**: `StreamingResponse` mit `text/event-stream`

### Frontend

1. **React Router**: `/login`, `/chat`, `/documents`
2. **Auth Context**: Token-State, Login/Logout Funktionen
3. **API Client**: Axios mit Interceptor für Bearer Token
4. **Markdown**: react-markdown mit rehype-highlight für Code
5. **SSE**: EventSource API für Streaming

### RAG Logic

1. **Chunking**: LangChain `RecursiveCharacterTextSplitter`
2. **Embeddings**: LangChain `OpenAIEmbeddings`
3. **Vector Store**: LangChain `Chroma`
4. **Retrieval**: Top-3 ähnlichste Chunks
5. **Prompt**: System-Prompt mit Kontext + Quellenhinweis

---

## Entwicklungs-Workflow

1. Backend starten: `cd backend && uvicorn app.main:app --reload`
2. Frontend starten: `cd frontend && npm run dev`
3. Testen mit lokaler `.env`
4. Build: `docker compose build`
5. Deploy: `git push`, dann auf VPS: `git pull && docker compose up -d --build`

---

## Erste Schritte

Beginne mit:
1. Backend-Grundgerüst (FastAPI + Config + Auth)
2. Einfacher Chat-Endpoint (ohne RAG, nur OpenAI)
3. Frontend mit Login + Chat-UI
4. Dann RAG hinzufügen (Documents, Chunking, Retrieval)
5. Zuletzt Admin-Funktionen

Frage bei Unklarheiten nach, bevor du implementierst.
