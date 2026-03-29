# RAGAS Evaluator

Ein RAG-Chatbot mit eingebetteter RAGAS-Evaluation. Beantwortet Fragen auf Basis hochgeladener Dokumente und bewertet jede Antwort automatisch mit vier Qualitätsmetriken.

---

## Inhalt

- [Übersicht](#übersicht)
- [Features](#features)
- [Tech-Stack](#tech-stack)
- [Projektstruktur](#projektstruktur)
- [Schnellstart (Docker)](#schnellstart-docker)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Konfiguration](#konfiguration)
- [API-Referenz](#api-referenz)
- [RAGAS-Metriken](#ragas-metriken)
- [RAG-Pipeline](#rag-pipeline)
- [Deployment auf VPS](#deployment-auf-vps)

---

## Übersicht

```
┌──────────────────────────────────────────────────────────┐
│  Header: RAGAS Evaluator   [Chat & Evaluation] [Dokumente]│
├─────────────────────────┬────────────────────────────────┤
│  Chat                   │  Evaluation                    │
│  [Modell ▼]             │  [Eval-Modell ▼]               │
│                         │                                 │
│  [Assistent]            │  ┌─────────┬─────────┐        │
│  Antwort auf Basis       │  │Faith.   │Relevancy│        │
│  der Dokumente…         │  │  1.00   │  0.88   │        │
│                         │  ├─────────┼─────────┤        │
│  Quelle: dokument.md    │  │Precision│Recall   │        │
│                         │  │  0.71   │  0.75   │        │
├─────────────────────────┤  └─────────┴─────────┘        │
│ [Eingabe…]   [Senden]   │  Chunks · System Prompt        │
└─────────────────────────┴────────────────────────────────┘
```

Jede Antwort durchläuft automatisch vier RAGAS-Metriken. Die Scores erscheinen im rechten Panel direkt nach der Antwort. Alle Werte sind erklärbar — ein Klick auf `?` öffnet die Formel und Interpretation.

---

## Features

### Chat & Evaluation
- **Streaming** — Token-by-Token Ausgabe via Server-Sent Events
- **Zwei LLM-Selektoren** — Chat-Modell und Evaluations-Modell unabhängig wählbar
- **Markdown-Rendering** — Code-Blöcke, Listen, Inline-Code in Antworten
- **Quellenangabe** — welche Dokumente zur Antwort beigetragen haben
- **RAGAS-Scores** — vier Metriken nach jeder Antwort, mit aufklappbarer Erklärung
- **Verwendete Chunks** — die tatsächlich abgerufenen Kontext-Passagen mit Ähnlichkeits-Score
- **System-Prompt-Anzeige** — Transparenz über den verwendeten Prompt

### Dokumente
- **Upload** — Drag & Drop oder Datei-Auswahl (`.md`, `.pdf`, max. 10 MB)
- **Chunk-Browser** — alle Chunks aller Dokumente, filterbar, mit Overlap-Markierung
- **Chunk-Detail-Modal** — vollständiger Chunk-Inhalt, Overlap-Bereich separat hervorgehoben
- **Chunking-Parameter zur Laufzeit** — Chunk-Größe, Overlap und Splitter per Slider änderbar
- **Neu indexieren** — einzelnes Dokument oder alle Dokumente mit aktuellen Parametern
- **Löschen** — Dokument + Chunks einzeln oder Vektor-Speicher komplett leeren

---

## Tech-Stack

| Schicht | Technologie |
|---------|-------------|
| Frontend | React 18 + Vite + TailwindCSS |
| Backend | FastAPI + Python 3.11 |
| Vektordatenbank | ChromaDB (persistent) |
| Metadaten-DB | SQLite (SQLAlchemy) |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | OpenAI API (gpt-4o-mini, gpt-4o, gpt-4-turbo, gpt-3.5-turbo) |
| Authentifizierung | JWT (PyJWT), Single-Password |
| Deployment | Docker + Docker Compose |

> **Hinweis:** Das `ragas` Python-Paket wird **nicht** verwendet. Alle vier Metriken sind direkt über OpenAI-LLM-Calls implementiert — ohne externe RAGAS-Bibliothek, ohne Versions-Konflikte.

---

## Projektstruktur

```
evalchat/
├── backend/
│   ├── app/
│   │   ├── config.py         # Einstellungen aus .env (pydantic-settings)
│   │   ├── auth.py           # JWT Login & Verifikation
│   │   ├── models.py         # Pydantic Request/Response-Modelle
│   │   ├── database.py       # SQLite-Schema (Documents, Chunks, Settings)
│   │   ├── rag.py            # Chunking, Embeddings, ChromaDB, Retrieval
│   │   ├── evaluation.py     # RAGAS-Metriken via LLM-Prompts
│   │   ├── documents.py      # Upload, CRUD, Reindex-Endpoints
│   │   ├── chat.py           # SSE-Streaming + Evaluation-Trigger
│   │   └── main.py           # FastAPI-App, alle Routes, SPA-Serving
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Router + AuthContext
│   │   ├── api.js            # API-Client (axios + fetch-SSE)
│   │   ├── index.css         # Custom CSS (Farbschema, Komponenten)
│   │   └── pages/
│   │       ├── Login.jsx
│   │       ├── Chat.jsx      # Chat-Pane + Eval-Pane
│   │       └── Documents.jsx # Upload, Chunk-Browser, Einstellungen
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
├── Dockerfile                # Multi-stage (Node → Python)
├── docker-compose.yml
├── .env.example
└── .gitignore
```

---

## Schnellstart (Docker)

### Voraussetzungen

- Docker + Docker Compose
- OpenAI API Key

### 1. Repository klonen / Dateien bereitstellen

```bash
cd ~/docker
# Projekt liegt bereits unter evalchat/
```

### 2. Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
```

`.env` bearbeiten:

```bash
OPENAI_API_KEY=sk-...         # OpenAI API Key
APP_PASSWORD=mein-passwort    # Login-Passwort für die App
JWT_SECRET=zufaelliger-string # Beliebiger langer zufälliger String
```

JWT-Secret generieren:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 3. Docker-Netzwerk sicherstellen

```bash
docker network create proxy 2>/dev/null || true
```

### 4. Bauen und starten

```bash
docker compose up -d --build
```

Die Anwendung ist danach unter `http://localhost:8000` erreichbar.

Beim **ersten Start** wird `server-dokumentation.md` automatisch importiert und indexiert, sofern die Datei im Projektverzeichnis liegt.

### 5. Einloggen

Passwort: Wert aus `APP_PASSWORD` in der `.env`.

---

## Lokale Entwicklung

### Backend

```bash
cd evalchat

# Virtuelle Umgebung anlegen
python3 -m venv .venv
source .venv/bin/activate

# Abhängigkeiten installieren
pip install -r backend/requirements.txt

# Backend starten (liest .env aus dem Projektverzeichnis)
PYTHONPATH=backend uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # → http://localhost:5173
```

Der Vite-Dev-Server leitet `/api/*` automatisch an `localhost:8000` weiter (konfiguriert in `vite.config.js`).

---

## Konfiguration

### Umgebungsvariablen (`.env`)

| Variable | Pflicht | Beschreibung |
|----------|---------|--------------|
| `OPENAI_API_KEY` | ✓ | OpenAI API Key (`sk-...`) |
| `APP_PASSWORD` | ✓ | Login-Passwort für die Web-UI |
| `JWT_SECRET` | ✓ | Geheimer Schlüssel für JWT-Signierung |
| `DEFAULT_MODEL` | – | Standard-LLM (default: `gpt-4o-mini`) |
| `CHUNK_SIZE` | – | Initiale Chunk-Größe (default: `1000`) |
| `CHUNK_OVERLAP` | – | Initialer Overlap (default: `200`) |

### Chunking-Parameter (zur Laufzeit)

Die Chunking-Einstellungen sind in der Web-UI unter **Dokumente → Chunking-Parameter** änderbar und werden in der SQLite-Datenbank gespeichert:

| Parameter | Bereich | Beschreibung |
|-----------|---------|--------------|
| `chunk_size` | 100–4000 | Maximale Zeichen pro Chunk |
| `chunk_overlap` | 0–½ chunk_size | Überlappende Zeichen zwischen benachbarten Chunks |
| `splitter` | recursive / character / markdown | Trennstrategie |

Nach einer Änderung der Parameter müssen die Dokumente über **„Alle neu indexieren"** neu verarbeitet werden.

---

## API-Referenz

Alle Endpunkte außer `/api/auth` erfordern einen `Authorization: Bearer <token>` Header.

### Authentifizierung

```
POST /api/auth
  Body:     { "password": "string" }
  Response: { "token": "jwt-string" }

GET /api/auth/verify
  Response: { "valid": true }
```

### Dokumente

```
GET  /api/documents
POST /api/documents                  multipart/form-data (file)
GET  /api/documents/{id}             inkl. Chunk-Liste
DELETE /api/documents/{id}
POST /api/documents/{id}/reindex
DELETE /api/documents/{id}/chunks
GET  /api/documents/{id}/chunks
```

### Chunks (Browser)

```
GET /api/chunks?document_id=<id>     document_id optional (alle wenn weggelassen)
```

### Einstellungen

```
GET /api/settings
PUT /api/settings
  Body: { "chunk_size": 1000, "chunk_overlap": 200, "splitter": "recursive" }
```

### Globale Aktionen

```
POST   /api/reindex    Alle Dokumente mit aktuellen Einstellungen neu indexieren
DELETE /api/vectors    Vektor-Speicher komplett leeren
```

### Chat

```
POST /api/chat
  Body: { "message": "...", "model": "gpt-4o-mini", "eval_model": "gpt-4o-mini" }
  Response: SSE-Stream

SSE-Events:
  { "type": "sources",     "sources": [{document, chunk_index, similarity, preview}] }
  { "type": "token",       "content": "..." }
  { "type": "eval_start" }
  { "type": "eval_result", "scores": {faithfulness, answer_relevancy, context_precision, context_recall} }
  { "type": "done" }
  { "type": "error",       "message": "..." }

GET    /api/chat/history
DELETE /api/chat/history
```

---

## RAGAS-Metriken

Alle vier Metriken werden direkt über OpenAI-LLM-Calls berechnet — kein externes `ragas`-Paket nötig.

### Faithfulness

> Sind alle Aussagen der Antwort durch den abgerufenen Kontext belegbar?

1. Das LLM extrahiert alle Einzelaussagen aus der Antwort.
2. Jede Aussage wird gegen die Chunks geprüft (ja/nein).
3. Score = belegte Aussagen / Aussagen gesamt

```
score = supported_statements / total_statements
Bereich: 0.0 (alles halluziniert) → 1.0 (alles belegt)
```

### Answer Relevancy

> Beantwortet die Antwort tatsächlich die gestellte Frage?

1. Das LLM generiert 3 Rückfragen aus der Antwort.
2. Alle 4 Fragen (Original + generierte) werden mit `text-embedding-3-small` eingebettet.
3. Score = mittlere Cosine-Ähnlichkeit zwischen Original und generierten Fragen.

```
score = avg(cosine_sim(q_original, q_generated_i))
Bereich: 0.0 (Antwort völlig vage) → 1.0 (Antwort präzise auf Frage zugeschnitten)
```

### Context Precision

> Sind die abgerufenen Chunks überwiegend relevant für die Frage?

1. Das LLM bewertet jeden abgerufenen Chunk einzeln (relevant / nicht relevant).
2. Gewichtete Präzision: relevante Chunks an erster Position zählen mehr.

```
score = Σ(precision@k für jeden relevanten Chunk k) / Anzahl relevanter Chunks
Bereich: 0.0 (alle Chunks irrelevant) → 1.0 (alle Chunks relevant, wichtigste zuerst)
```

### Context Recall

> Enthält der Kontext alle Informationen, die für eine vollständige Antwort nötig wären?

Da kein manuelles Test-Set vorhanden ist, wird die Ground Truth **synthetisch** generiert:

1. Das LLM schreibt eine ideale Musterantwort auf Basis des gesamten Kontexts.
2. Aus der Musterantwort werden Einzelaussagen (Claims) extrahiert.
3. Jeder Claim wird gegen den abgerufenen Kontext geprüft.

```
score = abgedeckte_Claims / Claims_gesamt
Bereich: 0.0 (Kontext fehlt viel) → 1.0 (Kontext vollständig)
```

### Score-Interpretation

| Bereich | Bewertung |
|---------|-----------|
| ≥ 0.8 | gut (grün) |
| 0.5–0.8 | mittel (gelb) |
| < 0.5 | schlecht (rot) |

---

## RAG-Pipeline

```
Upload
  │
  ▼
Textextraktion
  ├─ .md  → direktes Lesen
  └─ .pdf → PyMuPDF (fitz)
  │
  ▼
Chunking (RecursiveCharacterTextSplitter o.ä.)
  └─ Overlap-Markierung: first chunk_overlap chars jedes Chunks ≥ 1
  │
  ▼
Embedding (OpenAI text-embedding-3-small)
  │
  ├─► ChromaDB (Vektoren + Metadaten)
  └─► SQLite   (Chunk-Inhalte, Metadaten, Overlap-Info)

Anfrage
  │
  ▼
Query-Embedding → ChromaDB-Similarity-Search (top-4)
  │
  ▼
Kontext-Aufbau → System-Prompt
  │
  ▼
LLM-Streaming (OpenAI)
  │
  ├─► SSE: tokens
  ├─► SSE: sources
  │
  ▼
RAGAS-Evaluation (parallel, 4× LLM-Call)
  │
  └─► SSE: eval_result
```

### Unterstützte Splitter

| Wert | Beschreibung |
|------|--------------|
| `recursive` | RecursiveCharacterTextSplitter — trennt an `\n\n`, `\n`, Leerzeichen |
| `character` | Wie recursive, aber mit festen Zeichen-Grenzen |
| `markdown` | Markdown-bewusst — bevorzugt Trennung an Überschriften |

---

## Deployment auf VPS

Das Projekt ist für den Einsatz hinter einem **Nginx Proxy Manager** ausgelegt.

### docker-compose.yml (Auszug)

```yaml
services:
  app:
    build: .
    container_name: evalchat
    restart: unless-stopped
    volumes:
      - ./data:/app/data        # SQLite + ChromaDB (persistent)
      - ./uploads:/app/uploads  # Original-Dateien
    env_file: .env
    networks:
      - proxy

networks:
  proxy:
    external: true
```

### NPM-Proxy-Host einrichten

| Feld | Wert |
|------|------|
| Domain | `evalchat.bstlr.eu` (o.ä.) |
| Scheme | http |
| Forward Hostname | `evalchat` |
| Forward Port | `8000` |
| SSL | Let's Encrypt |

### Update

```bash
cd ~/docker/evalchat
git pull
docker compose up -d --build
docker image prune -f
```

### Datensicherung

```bash
# Datenbank + Vektoren sichern
tar -czvf backup-evalchat-$(date +%Y%m%d).tar.gz data/ uploads/
```

---

## Dateiablage im Container

```
/app/
├── app/          ← Python-Backend
├── static/       ← React-Build (aus Multi-Stage)
├── data/
│   ├── database.db   ← SQLite
│   └── chroma/       ← ChromaDB (persistent)
└── uploads/      ← Original-Dateien (.md, .pdf)
```

`/app/data/` und `/app/uploads/` werden als Docker-Volumes gemountet und bleiben über Container-Neustarts erhalten.
