import { format } from 'date-fns'
import { TrendingUp } from 'lucide-react'
import SeverityBadge from './SeverityBadge'

const actionLabel = {
  following: 'Persistent Following',
  chasing:   'Aggressive Chasing',
  loitering: 'Suspicious Loitering',
}

const dotColor = {
  HIGH:   'bg-red-500',
  MEDIUM: 'bg-amber-500',
  LOW:    'bg-green-500',
}

export default function AlertTimeline({ alerts }) {
  if (!alerts.length) {
    return (
      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-4">Alert Timeline</h3>
        <p className="text-gray-600 text-sm text-center py-6">No events recorded yet</p>
      </div>
    )
  }

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-white mb-4">Alert Timeline</h3>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-3 top-0 bottom-0 w-px bg-dark-600" />

        <div className="space-y-4">
          {alerts.slice(0, 20).map((alert, idx) => {
            const score       = alert.threat_score     ?? 0
            const occurrences = alert.occurrence_count ?? 1
            const escalated   = alert.escalated_from   ?? null

            return (
              <div key={alert.id || idx} className="flex gap-4 pl-8 relative">
                {/* Dot */}
                <div
                  className={`absolute left-2 top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-dark-800
                    ${dotColor[alert.severity] || 'bg-gray-500'}
                    ${alert.severity === 'HIGH' ? 'animate-pulse' : ''}`}
                />

                <div className="flex-1 min-w-0">
                  {/* Title row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-white">
                      {actionLabel[alert.action_type] || alert.action_type}
                    </span>
                    <SeverityBadge severity={alert.severity} />

                    {/* Escalation indicator */}
                    {escalated && (
                      <span className="inline-flex items-center gap-0.5 text-purple-400 text-xs">
                        <TrendingUp size={10} />
                        {escalated}→{alert.severity}
                      </span>
                    )}

                    <span className="text-xs text-gray-600 ml-auto">
                      {format(new Date(alert.timestamp), 'HH:mm:ss')}
                    </span>
                  </div>

                  {/* Base description */}
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {alert.description?.split(' | ')[0]}
                  </p>

                  {/* Meta row */}
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600">
                    <span>{alert.camera_id}</span>
                    {occurrences > 1 && (
                      <span className="text-gray-500">×{occurrences}</span>
                    )}
                    {score > 0 && (
                      <span className={
                        score >= 80 ? 'text-red-400' :
                        score >= 40 ? 'text-amber-400' :
                                      'text-green-600'
                      }>
                        score {score}
                      </span>
                    )}
                    {alert.camera_high_risk && (
                      <span className="text-red-400 font-semibold">⚠ HIGH RISK</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
