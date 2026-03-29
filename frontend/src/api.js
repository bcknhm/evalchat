import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// Auth
export const login = (password) => api.post('/auth', { password })
export const verifyToken = () => api.get('/auth/verify')

// Documents
export const getDocuments = () => api.get('/documents')
export const uploadDocument = (file, onProgress) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/documents', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  })
}
export const getDocument = (id) => api.get(`/documents/${id}`)
export const deleteDocument = (id) => api.delete(`/documents/${id}`)
export const reindexDocument = (id) => api.post(`/documents/${id}/reindex`)
export const deleteDocumentChunks = (id) => api.delete(`/documents/${id}/chunks`)
export const getDocumentChunks = (id) => api.get(`/documents/${id}/chunks`)

// Settings
export const getSettings = () => api.get('/settings')
export const updateSettings = (data) => api.put('/settings', data)

// Reindex all / clear
export const reindexAll = () => api.post('/reindex')
export const clearVectors = () => api.delete('/vectors')

// Chunks browser
export const getAllChunks = (documentId) =>
  api.get('/chunks', { params: documentId ? { document_id: documentId } : {} })

// Chat history
export const getChatHistory = () => api.get('/chat/history')
export const clearChatHistory = () => api.delete('/chat/history')

/**
 * Streaming chat via fetch + ReadableStream.
 * Calls onEvent(parsedEvent) for each SSE message.
 */
export async function streamChat(message, model, evalModel, systemPrompt, onEvent, signal) {
  const token = localStorage.getItem('token')
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message, model, eval_model: evalModel, system_prompt: systemPrompt }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6))
          onEvent(event)
        } catch {
          // ignore malformed
        }
      }
    }
  }
}

export default api
