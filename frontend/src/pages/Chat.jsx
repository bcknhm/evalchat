import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { streamChat, clearChatHistory } from '../api.js'

const MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo']

const DEFAULT_SYSTEM_PROMPT =
`Du bist ein hilfreicher Assistent. Beantworte Fragen ausschließlich auf Basis des bereitgestellten Kontexts.

Kontext:
{context}

Falls die Frage nicht aus dem Kontext beantwortet werden kann, antworte:
"Diese Information ist nicht in den Dokumenten enthalten."`

const METRIC_META = {
  faithfulness: {
    label: 'Faithfulness',
    sub: 'Antwort durch Kontext belegt?',
    desc: 'Misst, ob alle Aussagen in der generierten Antwort durch den bereitgestellten Kontext belegbar sind. Halluzinationen senken diesen Score.',
    detail: 'RAGAS zerlegt die Antwort in Einzelaussagen und prüft jede gegen die Chunks.',
    formula: 'score = belegte Aussagen / Aussagen gesamt',
  },
  answer_relevancy: {
    label: 'Answer Relevancy',
    sub: 'Wie relevant ist die Antwort?',
    desc: 'Bewertet, ob die Antwort die gestellte Frage direkt adressiert. Vage oder ausweichende Antworten werden bestraft.',
    detail: 'Das LLM generiert aus der Antwort Rückfragen und vergleicht deren Embeddings mit der Originalfrage.',
    formula: 'score = avg cosine_sim(q_orig, q_gen_i)',
  },
  context_precision: {
    label: 'Context Precision',
    sub: 'Relevanz der Chunks',
    desc: 'Prüft, ob die abgerufenen Chunks überwiegend relevant für die Frage sind. Irrelevante Chunks senken diesen Wert.',
    detail: 'Bewertet die Qualität des Retrievers: Werden die richtigen Passagen geholt?',
    formula: 'score = relevante Chunks / Chunks gesamt (gewichtet)',
  },
  context_recall: {
    label: 'Context Recall',
    sub: 'Vollständigkeit des Kontexts',
    desc: 'Enthält der abgerufene Kontext alle Informationen, die für eine vollständige Antwort nötig waren?',
    detail: 'Ground Truth wird synthetisch per zweitem LLM-Call generiert. RAGAS prüft, welcher Anteil der GT-Aussagen durch die Chunks abgedeckt wird.',
    formula: 'score = GT-Aussagen in Kontext / GT-Aussagen gesamt',
  },
}

function scoreClass(v) {
  if (v >= 0.8) return 'high'
  if (v >= 0.5) return 'mid'
  return 'low'
}

function ScoreCard({ metricKey, value, open, onToggle }) {
  const m = METRIC_META[metricKey]
  const cls = scoreClass(value)
  const pct = Math.round(value * 100)
  return (
    <div className={`score-card ${cls}`}>
      <div className="score-card-top">
        <div className="metric-name">{m.label}</div>
        <button className={`info-btn ${open ? 'active' : ''}`} onClick={onToggle} title="Erklärung">?</button>
      </div>
      <div className="metric-val">{value.toFixed(2)}</div>
      <div className="score-bar">
        <div className="score-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="metric-label">{m.sub}</div>
      <div className={`score-explanation ${open ? 'open' : ''}`}>
        <div className="score-explanation-inner">
          <p>{m.desc}</p>
          <p>{m.detail}</p>
          <div className="score-formula">{m.formula}</div>
          <div className="score-range">
            <span className="range-pill range-good">≥ 0.8 gut</span>
            <span className="range-pill range-mid">0.5 – 0.8</span>
            <span className="range-pill range-low">&lt; 0.5 schlecht</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── System Prompt Editor ─────────────────────────────────────────────────
function SystemPromptEditor({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const isModified = value !== DEFAULT_SYSTEM_PROMPT

  return (
    <div className="eval-section">
      <div className="section-title" style={{ marginBottom: 8 }}>
        <span className="dot dot-green" />
        System Prompt
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {isModified && (
            <button
              onClick={() => { onChange(DEFAULT_SYSTEM_PROMPT); setEditing(false) }}
              style={{
                fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 8px',
                background: 'var(--amber-bg)', color: 'var(--amber)',
                border: '1px solid var(--amber-border)', borderRadius: 3, cursor: 'pointer',
              }}
              title="Auf Standard zurücksetzen"
            >
              zurücksetzen
            </button>
          )}
          <button
            onClick={() => setEditing((e) => !e)}
            style={{
              fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 8px',
              background: editing ? 'var(--pale)' : 'none',
              color: editing ? 'var(--blue)' : 'var(--muted2)',
              border: `1px solid ${editing ? 'var(--mid)' : 'var(--border)'}`,
              borderRadius: 3, cursor: 'pointer',
            }}
          >
            {editing ? 'schließen' : 'bearbeiten'}
          </button>
        </div>
      </div>

      {editing ? (
        <div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%', minHeight: 220, padding: '12px 14px',
              fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7,
              color: 'var(--text)', background: '#1a2e3a',
              border: '1px solid #2a4555', borderRadius: 6,
              resize: 'vertical', outline: 'none',
              colorScheme: 'dark',
            }}
          />
          <p style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 6, fontFamily: 'var(--mono)' }}>
            Platzhalter: <code style={{ color: 'var(--light)' }}>{'{context}'}</code> wird durch die abgerufenen Chunks ersetzt.
          </p>
        </div>
      ) : (
        <div
          className="prompt-box"
          onClick={() => setEditing(true)}
          style={{ cursor: 'text' }}
          title="Klicken zum Bearbeiten"
        >
          {value}
          {isModified && (
            <div style={{ marginTop: 8, borderTop: '1px solid #2a4555', paddingTop: 6, fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--mono)' }}>
              ✎ angepasst
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Eval Pane ────────────────────────────────────────────────────────────
function EvalPane({ evalState, evalData, evalModel, setEvalModel, systemPrompt, setSystemPrompt }) {
  const [openCards, setOpenCards] = useState({})
  const toggleCard = (key) => setOpenCards((s) => ({ ...s, [key]: !s[key] }))

  return (
    <div className="eval-pane">
      <div className="eval-pane-header">
        <span className="pane-label">Evaluation</span>
        <select className="model-select" value={evalModel} onChange={(e) => setEvalModel(e.target.value)}>
          {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* RAGAS scores — conditional */}
      {evalState === 'empty' && (
        <div className="eval-empty" style={{ flex: 'none', padding: '24px 20px' }}>
          <svg viewBox="0 0 24 24">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14l4-4h12c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
          </svg>
          <p>RAGAS-Scores erscheinen hier<br />nach der ersten Antwort</p>
        </div>
      )}

      {evalState === 'loading' && (
        <div className="eval-loading" style={{ flex: 'none', padding: '24px 20px' }}>
          <div className="thinking-indicator" style={{ maxWidth: 180 }}>
            <div className="dots"><span /><span /><span /></div>
            <span>Evaluiere…</span>
          </div>
          <p style={{ color: 'var(--muted2)', fontSize: 12 }}>RAGAS-Metriken werden berechnet</p>
        </div>
      )}

      {evalState === 'ready' && evalData && (
        <>
          <div className="eval-section">
            <div className="section-title">
              <span className="dot dot-amber" />RAGAS Scores
            </div>
            <div className="score-grid">
              {Object.keys(METRIC_META).map((key) => (
                <ScoreCard
                  key={key}
                  metricKey={key}
                  value={evalData.scores[key] ?? 0}
                  open={!!openCards[key]}
                  onToggle={() => toggleCard(key)}
                />
              ))}
            </div>
          </div>

          <div className="eval-section">
            <div className="section-title">
              <span className="dot dot-blue" />Herangezogene Chunks
            </div>
            <div className="eval-chunks-list">
              {evalData.sources.map((s, i) => (
                <div key={i} className="eval-chunk-item">
                  <div className="eval-chunk-meta">
                    <span className="chunk-num">#{i + 1}</span>
                    <span className="chunk-doc">{s.document}</span>
                    <span className="chunk-score">sim {s.similarity?.toFixed(3)}</span>
                  </div>
                  <div className="chunk-text">{s.preview}</div>
                </div>
              ))}
              {evalData.sources.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--muted2)' }}>Keine Chunks abgerufen</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* System Prompt — immer sichtbar */}
      <SystemPromptEditor value={systemPrompt} onChange={setSystemPrompt} />
    </div>
  )
}

// ── Chat Page ────────────────────────────────────────────────────────────
export default function Chat() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Willkommen! Stell mir eine Frage zu den hochgeladenen Dokumenten. Ich antworte auf Basis der relevanten Chunks, RAGAS bewertet anschließend die Antwort.' },
  ])
  const [input, setInput] = useState('')
  const [chatModel, setChatModel] = useState('gpt-4o-mini')
  const [evalModel, setEvalModel] = useState('gpt-4o-mini')
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [isStreaming, setIsStreaming] = useState(false)
  const [evalState, setEvalState] = useState('empty')
  const [evalData, setEvalData] = useState(null)
  const messagesEndRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    setIsStreaming(true)
    setEvalState('loading')
    setEvalData(null)

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', streaming: true },
    ])

    const controller = new AbortController()
    abortRef.current = controller
    let pendingSources = []

    try {
      await streamChat(text, chatModel, evalModel, systemPrompt, (event) => {
        if (event.type === 'token') {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, content: last.content + event.content }
            }
            return next
          })
        } else if (event.type === 'sources') {
          pendingSources = event.sources
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, sources: event.sources }
            }
            return next
          })
        } else if (event.type === 'eval_start') {
          setEvalState('loading')
        } else if (event.type === 'eval_result') {
          setEvalData({ scores: event.scores, sources: pendingSources })
          setEvalState('ready')
        } else if (event.type === 'eval_error') {
          setEvalState('empty')
        } else if (event.type === 'done') {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.streaming) next[next.length - 1] = { ...last, streaming: false }
            return next
          })
          setIsStreaming(false)
        } else if (event.type === 'error') {
          setMessages((prev) => {
            const next = [...prev]
            next[next.length - 1] = { role: 'assistant', content: `Fehler: ${event.message}`, streaming: false }
            return next
          })
          setIsStreaming(false)
          setEvalState('empty')
        }
      }, controller.signal)
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: `Verbindungsfehler: ${err.message}`, streaming: false }
          return next
        })
      }
      setIsStreaming(false)
      setEvalState('empty')
    }
  }, [input, chatModel, evalModel, systemPrompt, isStreaming])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const newChat = async () => {
    if (isStreaming) { abortRef.current?.abort(); setIsStreaming(false) }
    await clearChatHistory().catch(() => {})
    setMessages([{ role: 'assistant', content: 'Willkommen! Stell mir eine Frage zu den hochgeladenen Dokumenten.' }])
    setEvalState('empty')
    setEvalData(null)
  }

  return (
    <div className="chat-tab">
      {/* Chat pane */}
      <div className="chat-pane">
        <div className="chat-pane-header">
          <span className="pane-label">Chat</span>
          <select className="model-select" value={chatModel} onChange={(e) => setChatModel(e.target.value)}>
            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="messages">
          {messages.map((msg, i) => (
            <div key={i} className={`msg ${msg.role === 'user' ? 'user' : 'bot'}`}>
              <span className="msg-lbl">{msg.role === 'user' ? 'Du' : 'Assistent'}</span>
              <div className="msg-bubble">
                {msg.streaming && !msg.content ? (
                  <div className="thinking-indicator">
                    <div className="dots"><span /><span /><span /></div>
                  </div>
                ) : (
                  <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{msg.content}</ReactMarkdown>
                )}
              </div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="msg-source">
                  Quellen: {[...new Set(msg.sources.map((s) => s.document))].join(', ')}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <div className="input-row">
            <textarea
              className="chat-textarea"
              placeholder="Frage zu den Dokumenten…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              rows={1}
            />
            <button className="btn-send" onClick={sendMessage} disabled={isStreaming || !input.trim()}>
              <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
              Senden
            </button>
          </div>
          <button className="new-chat-btn" onClick={newChat}>+ Neuer Chat</button>
        </div>
      </div>

      {/* Eval pane */}
      <EvalPane
        evalState={evalState}
        evalData={evalData}
        evalModel={evalModel}
        setEvalModel={setEvalModel}
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
      />
    </div>
  )
}
