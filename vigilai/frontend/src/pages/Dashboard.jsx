import { useState, useEffect } from 'react'
import { AlertTriangle, Camera, Activity, Shield, Zap, TrendingUp } from 'lucide-react'
import StatCard from '../components/StatCard'
import CameraCard from '../components/CameraCard'
import AlertTimeline from '../components/AlertTimeline'
import { api } from '../services/api'

const CAMERAS = ['CAM-01', 'CAM-02', 'CAM-03', 'CAM-04']

function ThreatBar({ score }) {
  const pct      = Math.min(100, Math.round((score / 120) * 100))
  const barColor = score >= 80 ? 'bg-red-500' : score >= 40 ? 'bg-amber-500' : 'bg-green-500'
  const txtColor = score >= 80 ? 'text-red-400' : score >= 40 ? 'text-amber-400' : 'text-green-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-dark-600 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-mono w-6 text-right ${txtColor}`}>{score}</span>
    </div>
  )
}

export default function Dashboard({ liveAlerts }) {
  const [stats, setStats]               = useState({ total: 0, by_severity: {}, by_type: {} })
  const [activeCams, setActiveCams]     = useState({})
  const [backendOnline, setBackendOnline] = useState(false)
  const [threatStatus, setThreatStatus] = useState([])

  // Stats polling
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const s = await api.getStats()
        setStats(s)
        setBackendOnline(true)
      } catch {
        setBackendOnline(false)
      }
    }
    fetchStats()
    const id = setInterval(fetchStats, 5000)
    return () => clearInterval(id)
  }, [liveAlerts])

  // Threat status polling
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await api.getThreatStatus()
        setThreatStatus(data.cameras || [])
      } catch { /* backend offline */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  const handleCamStatus = (camId, active) => {
    setActiveCams(prev => ({ ...prev, [camId]: active }))
  }

  const activeCamCount = Object.values(activeCams).filter(Boolean).length
  const highRiskCams   = threatStatus.filter(c => c.high_risk)
  const escalatedCount = liveAlerts.filter(a => a.escalated_from && !a.archived).length

  // Highest active severity per camera — drives CameraCard glow
  const camSeverity = liveAlerts.reduce((acc, a) => {
    if (!a.archived) {
      const order = { HIGH: 2, MEDIUM: 1, LOW: 0 }
      if (!acc[a.camera_id] || order[a.severity] > order[acc[a.camera_id]]) {
        acc[a.camera_id] = a.severity
      }
    }
    return acc
  }, {})

  return (
    <div className="flex-1 p-6 overflow-y-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Surveillance Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">Real-time behavioural monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${backendOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className={`text-xs ${backendOnline ? 'text-green-400' : 'text-red-400'}`}>
            {backendOnline ? 'Backend Online' : 'Backend Offline'}
          </span>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Incidents" value={stats.total}                  icon={Shield}        color="blue" />
        <StatCard label="High Severity"   value={stats.by_severity?.HIGH || 0} icon={AlertTriangle} color="red" />
        <StatCard label="Active Cameras"  value={activeCamCount}               icon={Camera}        color="purple" />
        <StatCard label="Escalated"       value={escalatedCount}               icon={TrendingUp}    color="amber" />
      </div>

      {/* ── Severity breakdown ── */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'LOW',    value: stats.by_severity?.LOW    || 0, cls: 'border-green-700/30 bg-green-950/10 text-green-400' },
          { label: 'MEDIUM', value: stats.by_severity?.MEDIUM || 0, cls: 'border-amber-700/30 bg-amber-950/10 text-amber-400' },
          { label: 'HIGH',   value: stats.by_severity?.HIGH   || 0, cls: 'border-red-700/30 bg-red-950/10 text-red-400' },
        ].map(({ label, value, cls }) => (
          <div key={label} className={`border rounded-xl p-4 text-center ${cls}`}>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs font-semibold mt-1 opacity-70">{label} SEVERITY</p>
          </div>
        ))}
      </div>

      {/* ── HIGH RISK banner ── */}
      {highRiskCams.length > 0 && (
        <div className="mb-6 border border-red-700/50 bg-red-950/20 rounded-xl p-4 flex items-center gap-3">
          <Zap size={18} className="text-red-400 flex-shrink-0 animate-pulse" />
          <div>
            <p className="text-red-400 text-sm font-semibold">
              HIGH RISK ZONE — {highRiskCams.map(c => c.camera_id).join(', ')}
            </p>
            <p className="text-red-500/70 text-xs mt-0.5">
              5+ alerts detected within 2 minutes. Immediate attention required.
            </p>
          </div>
        </div>
      )}

      {/* ── Camera feeds ── */}
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
        Camera Feeds
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {CAMERAS.map(camId => (
          <CameraCard
            key={camId}
            cameraId={camId}
            isActive={!!activeCams[camId]}
            onStatusChange={handleCamStatus}
            alertSeverity={camSeverity[camId] || null}
          />
        ))}
      </div>

      {/* ── Live threat scores ── */}
      {threatStatus.length > 0 && (
        <div className="card mb-6">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Zap size={14} className="text-amber-400" />
            Live Threat Scores
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {threatStatus.map(cam => (
              <div
                key={cam.camera_id}
                className={`rounded-lg p-3 border ${
                  cam.high_risk
                    ? 'border-red-700/50 bg-red-950/20'
                    : 'border-dark-600 bg-dark-700/30'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-gray-300">{cam.camera_id}</span>
                  <div className="flex items-center gap-1.5">
                    {cam.high_risk && (
                      <span className="text-red-400 text-xs font-semibold">⚠</span>
                    )}
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      cam.severity === 'HIGH'   ? 'bg-red-900/40 text-red-400' :
                      cam.severity === 'MEDIUM' ? 'bg-amber-900/40 text-amber-400' :
                                                  'bg-green-900/40 text-green-400'
                    }`}>
                      {cam.severity}
                    </span>
                  </div>
                </div>
                <ThreatBar score={cam.max_score} />
                <p className="text-xs text-gray-600 mt-1.5">
                  {cam.alert_count} alert{cam.alert_count !== 1 ? 's' : ''} / 2 min
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Alert timeline ── */}
      <AlertTimeline alerts={liveAlerts.filter(a => !a.archived)} />
    </div>
  )
}
