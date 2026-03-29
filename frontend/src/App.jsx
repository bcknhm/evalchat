import { createContext, useContext, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Chat from './pages/Chat.jsx'
import Documents from './pages/Documents.jsx'
import { verifyToken } from './api.js'

// ── Auth Context ─────────────────────────────────────────────────────────
const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [checking, setChecking] = useState(!!localStorage.getItem('token'))

  useEffect(() => {
    if (!token) { setChecking(false); return }
    verifyToken()
      .then(() => setChecking(false))
      .catch(() => { logout(); setChecking(false) })
  }, [])

  const login = (tok) => {
    localStorage.setItem('token', tok)
    setToken(tok)
  }
  const logout = () => {
    localStorage.removeItem('token')
    setToken(null)
  }

  if (checking) return null

  return (
    <AuthContext.Provider value={{ token, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// ── Protected Route ──────────────────────────────────────────────────────
function Protected({ children }) {
  const { token } = useAuth()
  return token ? children : <Navigate to="/login" replace />
}

// ── App Shell ────────────────────────────────────────────────────────────
// Chat und Documents werden IMMER gerendert (nur per CSS ein-/ausgeblendet),
// damit der Chat-State beim Tab-Wechsel erhalten bleibt.
function AppShell() {
  const { logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const active = location.pathname.startsWith('/documents') ? 'docs' : 'chat'

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-logo">
          <div className="logo-box">
            <svg viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>
          <span className="header-title">
            evalchat
          </span>
        </div>
        <nav className="tab-nav">
          <button
            className={`tab-btn ${active === 'chat' ? 'active' : ''}`}
            onClick={() => navigate('/chat')}
          >
            Chat &amp; Evaluation
          </button>
          <button
            className={`tab-btn ${active === 'docs' ? 'active' : ''}`}
            onClick={() => navigate('/documents')}
          >
            Dokumente
          </button>
        </nav>
        <button
          onClick={logout}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 5, color: 'rgba(255,255,255,0.7)', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
        >
          Abmelden
        </button>
      </header>

      {/* Beide Seiten immer im DOM – nur sichtbar wechseln */}
      <div style={{ flex: 1, display: active === 'chat' ? 'flex' : 'none', overflow: 'hidden' }}>
        <Chat />
      </div>
      <div style={{ flex: 1, display: active === 'docs' ? 'flex' : 'none', overflow: 'hidden' }}>
        <Documents />
      </div>
    </div>
  )
}

// ── Router ───────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/chat"
            element={<Protected><AppShell /></Protected>}
          />
          <Route
            path="/documents"
            element={<Protected><AppShell /></Protected>}
          />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
