// Connect directly to the backend — bypasses the Vite proxy entirely.
// The backend has CORS open for all origins so this works in dev without issues.
// For production, replace with your deployed WS URL.
const WS_URL = 'ws://localhost:8000/ws/alerts'

class AlertWebSocket {
  constructor() {
    this.ws = null
    this.listeners = new Set()
    this.reconnectDelay = 2000
    this.maxReconnectDelay = 30000
    this._reconnectTimer = null
    this._intentionalClose = false
  }

  connect() {
    this._intentionalClose = false
    this._createSocket()
  }

  disconnect() {
    this._intentionalClose = true
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  _createSocket() {
    try {
      this.ws = new WebSocket(WS_URL)

      this.ws.onopen = () => {
        console.log('[VigilAI WS] Connected')
        this.reconnectDelay = 2000
        this._emit({ type: 'connection', status: 'connected' })
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          this._emit(data)
        } catch (e) {
          console.warn('[VigilAI WS] Bad message:', event.data)
        }
      }

      this.ws.onclose = () => {
        this._emit({ type: 'connection', status: 'disconnected' })
        if (!this._intentionalClose) {
          console.log(`[VigilAI WS] Reconnecting in ${this.reconnectDelay}ms …`)
          this._reconnectTimer = setTimeout(() => {
            this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay)
            this._createSocket()
          }, this.reconnectDelay)
        }
      }

      this.ws.onerror = (err) => {
        console.warn('[VigilAI WS] Error:', err)
      }
    } catch (e) {
      console.error('[VigilAI WS] Failed to create socket:', e)
    }
  }

  _emit(data) {
    this.listeners.forEach((fn) => {
      try { fn(data) } catch (e) { console.error('[VigilAI WS] Listener error:', e) }
    })
  }
}

// Singleton
export const alertWS = new AlertWebSocket()
