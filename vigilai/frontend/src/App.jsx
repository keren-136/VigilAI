import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import AlertSidebar from './components/AlertSidebar'
import Dashboard from './pages/Dashboard'
import Incidents from './pages/Incidents'
import Analytics from './pages/Analytics'
import { alertWS } from './services/websocket'

const MAX_ALERTS      = 50    // max unique active incidents shown
const ARCHIVE_AFTER   = 45000 // ms — move to archived after silence
const SEV_ORDER       = { LOW: 0, MEDIUM: 1, HIGH: 2 }

/**
 * Client-side smart alert merge.
 * Keeps one entry per incident_key, updating it in-place on repeat events.
 * Sorts: HIGH > MEDIUM > LOW, escalated first, newest last_seen first.
 */
function mergeAlert(prev, incoming) {
  const key = incoming.incident_key || incoming.id || Math.random().toString()
  const idx  = prev.findIndex(a => (a.incident_key || a.id) === key)

  let next
  if (idx !== -1) {
    // Update existing entry in-place
    const existing = prev[idx]
    next = prev.filter((_, i) => i !== idx)
    next.unshift({
      ...existing,
      ...incoming,
      // Keep highest severity seen
      severity: SEV_ORDER[incoming.severity] >= SEV_ORDER[existing.severity]
        ? incoming.severity : existing.severity,
      // Keep highest score
      threat_score: Math.max(existing.threat_score ?? 0, incoming.threat_score ?? 0),
      last_seen: Date.now(),
      archived: false,
    })
  } else {
    next = [{ ...incoming, last_seen: Date.now(), archived: false }, ...prev]
  }

  // Sort: HIGH first, escalated first, newest first
  next.sort((a, b) => {
    const sevDiff = (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0)
    if (sevDiff !== 0) return sevDiff
    const escDiff = (b.escalated_from ? 1 : 0) - (a.escalated_from ? 1 : 0)
    if (escDiff !== 0) return escDiff
    return (b.last_seen ?? 0) - (a.last_seen ?? 0)
  })

  return next.slice(0, MAX_ALERTS)
}

export default function App() {
  const [liveAlerts, setLiveAlerts] = useState([])
  const [wsStatus, setWsStatus]     = useState('disconnected')
  const archiveTimer = useRef(null)

  const handleMessage = useCallback((data) => {
    if (data.type === 'connection') {
      setWsStatus(data.status)
      return
    }
    if (data.type === 'alert') {
      setLiveAlerts(prev => mergeAlert(prev, data))
    }
  }, [])

  // Auto-archive stale alerts every 10 s
  useEffect(() => {
    archiveTimer.current = setInterval(() => {
      const now = Date.now()
      setLiveAlerts(prev =>
        prev.map(a =>
          !a.archived && (now - (a.last_seen ?? 0)) > ARCHIVE_AFTER
            ? { ...a, archived: true }
            : a
        )
      )
    }, 10_000)
    return () => clearInterval(archiveTimer.current)
  }, [])

  useEffect(() => {
    alertWS.connect()
    const unsub = alertWS.subscribe(handleMessage)
    return () => {
      unsub()
      alertWS.disconnect()
    }
  }, [handleMessage])

  return (
    <div className="flex min-h-screen bg-dark-900">
      <Sidebar wsStatus={wsStatus} />

      <main className="flex-1 flex overflow-hidden">
        <Routes>
          <Route path="/"          element={<Dashboard liveAlerts={liveAlerts} />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/analytics" element={<Analytics liveAlerts={liveAlerts} />} />
        </Routes>
      </main>

      <AlertSidebar alerts={liveAlerts} />
    </div>
  )
}
