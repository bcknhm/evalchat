import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { login as apiLogin } from '../api.js'
import { useAuth } from '../App.jsx'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (!password.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await apiLogin(password)
      login(res.data.token)
      navigate('/chat')
    } catch {
      setError('Falsches Passwort')
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">
          <svg viewBox="0 0 24 24">
            <path d="M12 1C8.676 1 6 3.676 6 7v1H4v15h16V8h-2V7c0-3.324-2.676-6-6-6zm0 2c2.276 0 4 1.724 4 4v1H8V7c0-2.276 1.724-4 4-4zm0 9a2 2 0 0 1 1 3.732V18h-2v-2.268A2 2 0 0 1 12 12z" />
          </svg>
        </div>
        <h1>evalchat</h1>
        <p className="login-subtitle">Edukatives RAG-Demonstrationssystem</p>
        <form onSubmit={handleSubmit}>
          <label className="login-label">Passwort</label>
          <input
            ref={inputRef}
            type="password"
            className="login-input"
            placeholder="Zugangspasswort eingeben"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  )
}
