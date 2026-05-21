import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Search, Filter, RefreshCw } from 'lucide-react'
import SeverityBadge from '../components/SeverityBadge'
import { api } from '../services/api'

const ACTION_LABELS = {
  following: 'Persistent Following',
  chasing: 'Aggressive Chasing',
  loitering: 'Suspicious Loitering',
}

export default function Incidents() {
  const [incidents, setIncidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')

  const fetchIncidents = async () => {
    setLoading(true)
    try {
      const data = await api.getIncidents(200)
      setIncidents(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIncidents()
  }, [])

  const filtered = incidents.filter((inc) => {
    const matchSev = severityFilter === 'ALL' || inc.severity === severityFilter
    const matchType = typeFilter === 'ALL' || inc.action_type === typeFilter
    const matchSearch =
      !search ||
      inc.description?.toLowerCase().includes(search.toLowerCase()) ||
      inc.camera_id?.toLowerCase().includes(search.toLowerCase()) ||
      inc.track_ids?.includes(search)
    return matchSev && matchType && matchSearch
  })

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Incident Log</h1>
          <p className="text-gray-500 text-sm mt-0.5">{filtered.length} incidents</p>
        </div>
        <button
          onClick={fetchIncidents}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white border border-dark-600 hover:border-dark-500 px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            type="text"
            placeholder="Search incidents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-dark-800 border border-dark-600 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600"
          />
        </div>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600"
        >
          <option value="ALL">All Severities</option>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-dark-800 border border-dark-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600"
        >
          <option value="ALL">All Types</option>
          <option value="following">Following</option>
          <option value="chasing">Chasing</option>
          <option value="loitering">Loitering</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">ID</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Timestamp</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Severity</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Camera</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tracks</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Duration</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-600">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-600">
                    No incidents found
                  </td>
                </tr>
              ) : (
                filtered.map((inc) => (
                  <tr
                    key={inc.id}
                    className="border-b border-dark-700/50 hover:bg-dark-700/30 transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">#{inc.id}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {format(new Date(inc.timestamp), 'MMM d, HH:mm:ss')}
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={inc.severity} />
                    </td>
                    <td className="px-4 py-3 text-gray-300 text-xs">
                      {ACTION_LABELS[inc.action_type] || inc.action_type}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">{inc.camera_id}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{inc.track_ids}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">{inc.description}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {inc.duration_seconds > 0 ? `${inc.duration_seconds}s` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
