import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getDocuments, uploadDocument, deleteDocument, reindexDocument,
  deleteDocumentChunks, getSettings, updateSettings, reindexAll,
  clearVectors, getAllChunks,
} from '../api.js'

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('de-DE')
}

// ── Chunk Detail Modal ────────────────────────────────────────────────────
function ChunkModal({ chunk, onClose }) {
  if (!chunk) return null
  const overlapText = chunk.has_overlap ? chunk.content.slice(0, chunk.overlap_chars) : ''
  const mainText = chunk.has_overlap ? chunk.content.slice(chunk.overlap_chars) : chunk.content

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h4>Chunk #{chunk.chunk_index} — {chunk.document_name}</h4>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-meta">
          <span className="cb-idx">#{chunk.chunk_index}</span>
          <span className="cb-doc-tag">{chunk.document_name}</span>
          <span className="cb-chars">{chunk.char_count} Zeichen</span>
          {chunk.has_overlap && (
            <span className="cb-ov-tag">overlap {chunk.overlap_chars} ch</span>
          )}
        </div>
        <div className="modal-body">
          {chunk.has_overlap && (
            <div className="modal-ov-section">
              <div className="modal-ov-label">Overlap-Bereich</div>
              <pre className="modal-ov-text">{overlapText}</pre>
            </div>
          )}
          <pre style={{ marginTop: chunk.has_overlap ? 12 : 0 }}>{chunk.has_overlap ? mainText : chunk.content}</pre>
        </div>
      </div>
    </div>
  )
}

// ── Chunk Browser ─────────────────────────────────────────────────────────
function ChunkBrowser({ docs, settingsChanged, onSettingsApplied }) {
  const [chunks, setChunks] = useState([])
  const [filter, setFilter] = useState(null)
  const [selectedChunk, setSelectedChunk] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getAllChunks(filter)
      setChunks(res.data)
    } catch { /* silent */ }
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  const filtered = filter ? chunks.filter((c) => c.document_id === filter) : chunks

  return (
    <div className="panel">
      <div className="panel-header" style={{ cursor: 'default' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--mid)">
          <path d="M9 3H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 6H5V5h4v4zm10-6h-4c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 6h-4V5h4v4zM9 13H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h4c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2zm0 6H5v-4h4v4zm10-6h-4c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h4c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2zm0 6h-4v-4h4v4z" />
        </svg>
        <h3>Chunk-Browser</h3>
        <span className="panel-meta">{filtered.length} Chunks</span>
      </div>

      {settingsChanged && (
        <div className="reindex-notice">
          ⚠ Chunking-Parameter wurden geändert. Dokumente neu indexieren?
          <button className="reindex-btn" onClick={onSettingsApplied}>Jetzt neu indexieren</button>
        </div>
      )}

      {/* Filter bar */}
      <div className="chunk-browser-filters">
        <span className="filter-label">Dokument</span>
        <button
          className={`doc-filter-btn ${!filter ? 'active' : ''}`}
          onClick={() => setFilter(null)}
        >
          Alle
        </button>
        {docs.map((doc) => (
          <button
            key={doc.id}
            className={`doc-filter-btn ${filter === doc.id ? 'active' : ''}`}
            onClick={() => setFilter(doc.id)}
          >
            {doc.filename.length > 20 ? doc.filename.slice(0, 18) + '…' : doc.filename}
          </button>
        ))}
        <span className="cb-showing">{filtered.length} von {chunks.length}</span>
      </div>

      <div className="cb-list">
        {loading && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted2)', fontSize: 12 }}>
            Lade Chunks…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted2)', fontSize: 12 }}>
            Keine Chunks vorhanden. Lade ein Dokument hoch.
          </div>
        )}
        {filtered.map((chunk) => (
          <div key={chunk.id} className="cb-row" onClick={() => setSelectedChunk(chunk)}>
            <div className="cb-gutter">
              <span className="cb-idx">#{chunk.chunk_index}</span>
              <span className="cb-chars">{chunk.char_count} ch</span>
            </div>
            <div className="cb-content">
              <span className="cb-doc-tag">{chunk.document_name}</span>
              {chunk.has_overlap && <span className="cb-ov-tag">overlap</span>}
              <div style={{ marginTop: 2 }}>{chunk.content.slice(0, 180)}{chunk.content.length > 180 ? '…' : ''}</div>
            </div>
          </div>
        ))}
      </div>

      {selectedChunk && (
        <ChunkModal chunk={selectedChunk} onClose={() => setSelectedChunk(null)} />
      )}
    </div>
  )
}

// ── Main Documents Page ───────────────────────────────────────────────────
export default function Documents() {
  const [docs, setDocs] = useState([])
  const [settings, setSettings] = useState({ chunk_size: 1000, chunk_overlap: 200, splitter: 'recursive' })
  const [savedSettings, setSavedSettings] = useState(null)
  const [settingsChanged, setSettingsChanged] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState({})   // per-doc loading state
  const [globalBusy, setGlobalBusy] = useState(false)
  const [uploadCollapsed, setUploadCollapsed] = useState(false)
  const [chunkingCollapsed, setChunkingCollapsed] = useState(false)
  const [chunkBrowserKey, setChunkBrowserKey] = useState(0)
  const fileInputRef = useRef(null)

  const loadDocs = async () => {
    try {
      const res = await getDocuments()
      setDocs(res.data)
    } catch { /* silent */ }
  }
  const loadSettings = async () => {
    try {
      const res = await getSettings()
      setSettings(res.data)
      setSavedSettings(res.data)
    } catch { /* silent */ }
  }

  useEffect(() => {
    loadDocs()
    loadSettings()
  }, [])

  const totalChunks = docs.reduce((s, d) => s + d.chunk_count, 0)

  // ── Upload ──────────────────────────────────────────────────────────────
  const handleFiles = async (files) => {
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!['md', 'pdf'].includes(ext)) continue
      setUploading(true)
      setUploadProgress(0)
      try {
        await uploadDocument(file, (ev) => {
          if (ev.total) setUploadProgress(Math.round((ev.loaded / ev.total) * 100))
        })
        await loadDocs()
        setChunkBrowserKey((k) => k + 1)
      } catch (err) {
        alert(`Upload-Fehler: ${err.response?.data?.detail || err.message}`)
      }
      setUploading(false)
    }
  }

  const onFilePick = (e) => handleFiles(e.target.files)
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }

  // ── Doc actions ─────────────────────────────────────────────────────────
  const deleteDoc = async (id) => {
    if (!confirm('Dokument und alle Chunks löschen?')) return
    setBusy((b) => ({ ...b, [id]: true }))
    try { await deleteDocument(id); await loadDocs(); setChunkBrowserKey((k) => k + 1) } catch { /* */ }
    setBusy((b) => ({ ...b, [id]: false }))
  }
  const reindexDoc = async (id) => {
    setBusy((b) => ({ ...b, [id]: 'reindex' }))
    try { await reindexDocument(id); await loadDocs(); setChunkBrowserKey((k) => k + 1) } catch { /* */ }
    setBusy((b) => ({ ...b, [id]: false }))
  }

  // ── Settings ────────────────────────────────────────────────────────────
  const handleSettingsChange = (key, value) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    setSettingsChanged(true)
  }
  const saveSettings = async () => {
    try {
      const res = await updateSettings(settings)
      setSavedSettings(res.data)
      setSettingsChanged(false)
    } catch (err) {
      alert('Einstellungen konnten nicht gespeichert werden')
    }
  }

  // ── Global actions ──────────────────────────────────────────────────────
  const doReindexAll = async () => {
    if (!confirm('Alle Dokumente neu indexieren?')) return
    setGlobalBusy(true)
    try {
      await saveSettings()
      await reindexAll()
      await loadDocs()
      setChunkBrowserKey((k) => k + 1)
      setSettingsChanged(false)
    } catch { /* */ }
    setGlobalBusy(false)
  }
  const doClearVectors = async () => {
    if (!confirm('Vektor-Speicher und alle Chunks wirklich löschen?')) return
    setGlobalBusy(true)
    try { await clearVectors(); await loadDocs(); setChunkBrowserKey((k) => k + 1) } catch { /* */ }
    setGlobalBusy(false)
  }

  return (
    <div className="docs-tab">
      <div className="docs-grid">
        {/* ── Left column ── */}
        <div>
          {/* Upload zone */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div
              className="panel-header"
              onClick={() => setUploadCollapsed((c) => !c)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--mid)">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
              </svg>
              <h3>Dokument hochladen</h3>
              <button
                className={`panel-toggle ${uploadCollapsed ? 'collapsed' : ''}`}
                onClick={(e) => { e.stopPropagation(); setUploadCollapsed((c) => !c) }}
              >
                <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z" /></svg>
              </button>
            </div>
            <div className={`panel-collapsible ${uploadCollapsed ? 'collapsed' : ''}`}>
              <div className="panel-body">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.pdf"
                  multiple
                  style={{ display: 'none' }}
                  onChange={onFilePick}
                />
                <div
                  className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                >
                  {uploading ? (
                    <div style={{ color: 'var(--mid)', fontSize: 13 }}>
                      Hochladen… {uploadProgress}%
                      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 8 }}>
                        <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--mid)', borderRadius: 2, transition: 'width 0.2s' }} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="upload-icon">
                        <svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" /></svg>
                      </div>
                      <h4>Dateien ablegen oder klicken</h4>
                      <p>Markdown- und PDF-Dokumente, max. 10 MB</p>
                      <div className="file-types">
                        <span className="file-badge">.md</span>
                        <span className="file-badge">.pdf</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Document list */}
          <div className="panel">
            <div className="panel-header" style={{ cursor: 'default' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--mid)">
                <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
              </svg>
              <h3>Hochgeladene Dokumente</h3>
            </div>
            <div className="doc-list">
              {docs.length === 0 && (
                <div style={{ padding: '20px 16px', color: 'var(--muted2)', fontSize: 12, textAlign: 'center' }}>
                  Noch keine Dokumente vorhanden
                </div>
              )}
              {docs.map((doc) => (
                <div key={doc.id} className="doc-item">
                  <div className={`doc-icon ${doc.file_type}`}>
                    {doc.file_type.toUpperCase()}
                  </div>
                  <div className="doc-info">
                    <div className="doc-name" title={doc.filename}>{doc.filename}</div>
                    <div className="doc-meta">{fmtSize(doc.file_size)} · {fmtDate(doc.created_at)}</div>
                  </div>
                  <span className="doc-chunks">{doc.chunk_count} chunks</span>
                  <button
                    className="doc-delete-btn"
                    title="Dokument löschen"
                    onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id) }}
                    disabled={busy[doc.id]}
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="stat-bar">
              <div className="stat-item"><strong>{docs.length}</strong> Dokumente</div>
              <div className="stat-item"><strong>{totalChunks}</strong> Chunks gesamt</div>
            </div>
          </div>
        </div>

        {/* ── Right column ── */}
        <div>
          {/* Chunking params */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div
              className="panel-header"
              onClick={() => setChunkingCollapsed((c) => !c)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--mid)">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
              </svg>
              <h3>Chunking-Parameter</h3>
              <button
                className={`panel-toggle ${chunkingCollapsed ? 'collapsed' : ''}`}
                onClick={(e) => { e.stopPropagation(); setChunkingCollapsed((c) => !c) }}
              >
                <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z" /></svg>
              </button>
            </div>
            <div className={`panel-collapsible ${chunkingCollapsed ? 'collapsed' : ''}`}>
              <div className="panel-body">
                {/* Chunk size */}
                <div className="param-row">
                  <div className="param-label">
                    <span>Chunk-Größe</span>
                    <code>{settings.chunk_size}</code>
                  </div>
                  <input
                    type="range"
                    min={100} max={4000} step={50}
                    value={settings.chunk_size}
                    onChange={(e) => handleSettingsChange('chunk_size', Number(e.target.value))}
                  />
                  <p className="param-hint">Zeichen pro Chunk (100–4000)</p>
                </div>

                {/* Overlap */}
                <div className="param-row">
                  <div className="param-label">
                    <span>Overlap</span>
                    <code>{settings.chunk_overlap}</code>
                  </div>
                  <input
                    type="range"
                    min={0} max={Math.floor(settings.chunk_size / 2)} step={25}
                    value={Math.min(settings.chunk_overlap, Math.floor(settings.chunk_size / 2))}
                    onChange={(e) => handleSettingsChange('chunk_overlap', Number(e.target.value))}
                  />
                  <p className="param-hint">Überlappende Zeichen zwischen Chunks</p>
                </div>

                {/* Chunk visualization */}
                <div className="chunk-vis">
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ display: 'flex', gap: 2 }}>
                      {i > 0 && settings.chunk_overlap > 0 && (
                        <div
                          className="chunk-block cb-overlap"
                          style={{ width: `${Math.max(24, (settings.chunk_overlap / settings.chunk_size) * 80)}px` }}
                        >
                          ↔
                        </div>
                      )}
                      <div
                        className="chunk-block cb-text"
                        style={{ width: `${Math.max(40, 80 - (settings.chunk_overlap / settings.chunk_size) * 80)}px` }}
                      >
                        #{i + 1}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Splitter */}
                <div className="param-row">
                  <div className="param-label"><span>Splitter</span></div>
                  <select
                    className="splitter-select"
                    value={settings.splitter}
                    onChange={(e) => handleSettingsChange('splitter', e.target.value)}
                  >
                    <option value="recursive">RecursiveCharacterTextSplitter</option>
                    <option value="character">CharacterTextSplitter</option>
                    <option value="markdown">MarkdownTextSplitter</option>
                  </select>
                  <p className="param-hint">Strategie zur Texttrennung</p>
                </div>

                {/* Actions */}
                <div className="action-row">
                  <button
                    className="btn-secondary"
                    onClick={doReindexAll}
                    disabled={globalBusy}
                  >
                    {globalBusy ? 'Läuft…' : '↺ Alle neu indexieren'}
                  </button>
                  <button className="btn-danger" onClick={doClearVectors} disabled={globalBusy}>
                    ✕ Vektor-Speicher leeren
                  </button>
                </div>
                {settingsChanged && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                    <button className="btn-secondary" style={{ flex: 1, background: 'var(--pale)' }} onClick={saveSettings}>
                      ✓ Einstellungen speichern
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Chunk browser */}
          <ChunkBrowser
            key={chunkBrowserKey}
            docs={docs}
            settingsChanged={settingsChanged}
            onSettingsApplied={doReindexAll}
          />
        </div>
      </div>
    </div>
  )
}
