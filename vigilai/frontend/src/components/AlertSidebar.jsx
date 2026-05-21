import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  Bell, AlertTriangle, AlertCircle, Info,
  TrendingUp, Zap, ChevronDown, ChevronRight,
  Clock, Archive,
} from 'lucide-react'
import SeverityBadge from './SeverityBadge'

const SEV_ICON = {
  HIGH:   <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />,
  MEDIUM: <AlertCircle   size={13} className="text-amber-400 flex-shrink-0" />,
  LOW:    <Info          size={13} className="text-green-400 flex-shrink-0" />,
}

const ACTION_LABEL = {
  following: 'Persistent Following',
  chasing:   'Aggressive Chasing',
  loitering: 'Suspicious Loitering',
}

const BORDER = {
  HIGH:   'border-red-700/60 bg-red-950/20',
  MEDIUM: 'border-amber-700/50 bg-amber-950/15',
  LOW:    'border-green-700/40 bg-green-950/10',
}

// ── Group alerts by camera ────────────────────────────────────────────────────
function groupByCamera(alerts) {
  const map = {}
  alerts.forEach(a => {
    const cam = a.camera_id || 'UNKNOWN'
    if (!map[cam]) map[cam] = []
    map[cam].push(a)
  })
  // Sort cameras: highest severity first
  return Object.entries(map).sort(([, a], [, b]) => {
    const sevA = Math.max(...a.map(x => ({ HIGH: 2, MEDIUM: 1, LOW: 0 }[x.severity] ?? 0)))
    const sevB = Math.max(...b.map(x => ({ HIGH: 2, MEDIUM: 1, LOW: 0 }[x.severity] ?? 0)))
    return sevB - sevA
  })
}

export default function AlertSidebar({ alerts }) {
  const [tab, setTab]               = useState('active')   // 'active' | 'archived'
  const [expandedCams, setExpandedCams] = useState({})

  const active   = alerts.filter(a => !a.archived)
  const archived = alerts.filter(a =>  a.archived)
  const shown    = tab === 'active' ? active : archived

  const toggleCam = (cam) =>
    setExpandedCams(prev => ({ ...prev, [cam]: !prev[cam] }))

  const grouped = groupByCamera(shown)

  const highCount = active.filter(a => a.severity === 'HIGH').length

  return (
    <div className="w-80 min-h-screen bg-dark-800 border-l border-dark-600 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-dark-600">
        <div className="flex items-center gap-2 mb-3">
          <Bell size={15} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-white">Live Alerts</h2>
          {highCount > 0 && (
            <span className="ml-auto bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
              {highCount} HIGH
            </span>
          )}
        </div>
        {/* Tabs */}
        <div className="flex gap-1">
          {[
            { id: 'active',   label: 'Active',   count: active.length },
            { id: 'archived', label: 'Archived', count: archived.length, icon: Archive },
          ].map(({ id, label, count }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 text-xs py-1.5 rounded-lg transition-colors ${
                tab === id
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-700/40'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
              {count > 0 && (
                <span className="ml-1 opacity-70">({count})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {shown.length === 0 ? (
          <div className="text-center text-gray-600 text-sm mt-10">
            <Bell size={28} className="mx-auto mb-2 opacity-20" />
            <p>{tab === 'active' ? 'No active alerts' : 'No archived alerts'}</p>
            {tab === 'active' && (
              <p className="text-xs mt-1 text-gray-700">Start detection to monitor</p>
            )}
          </div>
        ) : (
          grouped.map(([camId, camAlerts]) => (
            <CameraGroup
              key={camId}
              camId={camId}
              alerts={camAlerts}
              expanded={expandedCams[camId] !== false}   // default open
              onToggle={() => toggleCam(camId)}
              archived={tab === 'archived'}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Camera group (collapsible) ────────────────────────────────────────────────
function CameraGroup({ camId, alerts, expanded, onToggle, archived }) {
  const maxSev = alerts.reduce((best, a) => {
    const order = { HIGH: 2, MEDIUM: 1, LOW: 0 }
    return order[a.severity] > order[best] ? a.severity : best
  }, 'LOW')

  const dotColor = maxSev === 'HIGH' ? 'bg-red-500' : maxSev === 'MEDIUM' ? 'bg-amber-500' : 'bg-green-500'

  return (
    <div className="rounded-lg border border-dark-600 overflow-hidden">
      {/* Group header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-dark-700/50 hover:bg-dark-700 transition-colors text-left"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${maxSev === 'HIGH' ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-mono text-gray-300 flex-1">{camId}</span>
        <div className="flex items-center gap-1.5">
          {/* Mini type counts */}
          {['following', 'chasing', 'loitering'].map(type => {
            const n = alerts.filter(a => a.action_type === type).length
            if (!n) return null
            return (
              <span key={type} className="text-xs text-gray-600">
                {type.slice(0, 3)}×{n}
              </span>
            )
          })}
          <span className="text-gray-600 ml-1">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        </div>
      </button>

      {/* Alert cards */}
      {expanded && (
        <div className="p-2 space-y-2 bg-dark-800/50">
          {alerts.map((alert, idx) => (
            <AlertCard key={alert.incident_key || alert.id || idx} alert={alert} archived={archived} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Individual alert card ─────────────────────────────────────────────────────
function AlertCard({ alert, archived }) {
  const score       = alert.threat_score     ?? 0
  const occurrences = alert.occurrence_count ?? 1
  const escalated   = alert.escalated_from   ?? null
  const highRisk    = alert.camera_high_risk ?? false
  const duration    = alert.duration_seconds ?? 0

  const borderCls = archived
    ? 'border-dark-600 bg-dark-700/20 opacity-60'
    : BORDER[alert.severity] || 'border-dark-600'

  const isHighActive = alert.severity === 'HIGH' && !archived

  return (
    <div className={`border rounded-lg p-2.5 transition-all duration-300 ${borderCls} ${
      isHighActive ? 'shadow-lg shadow-red-900/20' : ''
    }`}>
      {/* Title row */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {SEV_ICON[alert.severity]}
        <span className="text-xs font-semibold text-white flex-1 truncate">
          {ACTION_LABEL[alert.action_type] || alert.action_type}
        </span>
        <SeverityBadge severity={alert.severity} />
      </div>

      {/* Escalation badge */}
      {escalated && (
        <div className="mb-1.5">
          <span className="inline-flex items-center gap-1 bg-purple-900/40 border border-purple-700/40 text-purple-300 text-xs px-1.5 py-0.5 rounded-full">
            <TrendingUp size={9} />
            {escalated} → {alert.severity}
          </span>
        </div>
      )}

      {/* High risk badge */}
      {highRisk && (
        <div className="mb-1.5">
          <span className="inline-flex items-center gap-1 bg-red-900/40 border border-red-700/40 text-red-300 text-xs px-1.5 py-0.5 rounded-full">
            <Zap size={9} />
            HIGH RISK ZONE
          </span>
        </div>
      )}

      {/* Description */}
      <p className="text-xs text-gray-400 leading-relaxed mb-2 line-clamp-2">
        {alert.description?.split(' | ')[0]}
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs text-gray-600 mb-2">
        {occurrences > 1 && (
          <span className="text-gray-400">×{occurrences}</span>
        )}
        {duration > 0 && (
          <span className="flex items-center gap-0.5">
            <Clock size={9} />
            {duration.toFixed(0)}s
          </span>
        )}
        {score > 0 && (
          <span className={
            score >= 80 ? 'text-red-400' :
            score >= 40 ? 'text-amber-400' : 'text-green-500'
          }>
            score {score}
          </span>
        )}
      </div>

      {/* Threat score bar */}
      {score > 0 && <ThreatBar score={score} />}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-700 mt-2">
        <span className="font-mono">{alert.track_ids}</span>
        <span>
          {alert.timestamp
            ? formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })
            : ''}
        </span>
      </div>
    </div>
  )
}

// ── Threat score bar ──────────────────────────────────────────────────────────
function ThreatBar({ score }) {
  const pct   = Math.min(100, Math.round((score / 120) * 100))
  const color = score >= 80 ? 'bg-red-500' : score >= 40 ? 'bg-amber-500' : 'bg-green-500'
  const text  = score >= 80 ? 'text-red-400' : score >= 40 ? 'text-amber-400' : 'text-green-400'
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-gray-700">Threat</span>
        <span className={text}>{score}</span>
      </div>
      <div className="h-1 bg-dark-600 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
