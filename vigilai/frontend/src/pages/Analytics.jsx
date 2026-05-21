import { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, AreaChart, Area,
} from 'recharts'
import { api } from '../services/api'

const SEVERITY_COLORS = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444' }
const TYPE_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4']

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-xs">
      {label && <p className="text-gray-400 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  )
}

export default function Analytics({ liveAlerts }) {
  const [stats, setStats] = useState({ total: 0, by_severity: {}, by_type: {} })
  const [incidents, setIncidents] = useState([])

  useEffect(() => {
    const load = async () => {
      try {
        const [s, inc] = await Promise.all([api.getStats(), api.getIncidents(200)])
        setStats(s)
        setIncidents(inc)
      } catch (e) {
        console.error(e)
      }
    }
    load()
  }, [liveAlerts.length])

  // Severity pie data
  const severityData = Object.entries(stats.by_severity || {}).map(([name, value]) => ({
    name, value,
  }))

  // Type bar data
  const typeData = Object.entries(stats.by_type || {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
  }))

  // Timeline: group incidents by hour
  const timelineData = buildHourlyTimeline(incidents)

  // Recent 20 alerts for live chart
  const recentData = liveAlerts.slice(-20).map((a, i) => ({
    i,
    severity: a.severity === 'HIGH' ? 3 : a.severity === 'MEDIUM' ? 2 : 1,
    label: a.action_type,
  }))

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Analytics</h1>
        <p className="text-gray-500 text-sm mt-0.5">Behavioural pattern analysis</p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Incidents', value: stats.total, color: 'text-blue-400' },
          { label: 'Following Events', value: stats.by_type?.following || 0, color: 'text-purple-400' },
          { label: 'Chasing Events', value: stats.by_type?.chasing || 0, color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
            <p className="text-gray-500 text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Severity distribution */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Severity Distribution</h3>
          {severityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={severityData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {severityData.map((entry) => (
                    <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] || '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  formatter={(value) => <span className="text-xs text-gray-400">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-600 text-sm">
              No data yet
            </div>
          )}
        </div>

        {/* Behaviour type breakdown */}
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Behaviour Types</h3>
          {typeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={typeData} barSize={40}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a35" />
                <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
                  {typeData.map((_, i) => (
                    <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-600 text-sm">
              No data yet
            </div>
          )}
        </div>
      </div>

      {/* Hourly timeline */}
      <div className="card mb-6">
        <h3 className="text-sm font-semibold text-white mb-4">Incidents by Hour</h3>
        {timelineData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={timelineData}>
              <defs>
                <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a35" />
              <XAxis dataKey="hour" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="count" name="Incidents" stroke="#3b82f6" fill="url(#blueGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-600 text-sm">
            No data yet
          </div>
        )}
      </div>

      {/* Live severity stream */}
      {recentData.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-white mb-4">Live Alert Severity Stream</h3>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={recentData}>
              <YAxis domain={[0, 3]} ticks={[1, 2, 3]} tickFormatter={(v) => ['', 'LOW', 'MED', 'HIGH'][v]} tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="stepAfter" dataKey="severity" name="Severity" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function buildHourlyTimeline(incidents) {
  const counts = {}
  incidents.forEach((inc) => {
    const hour = new Date(inc.timestamp).getHours()
    const key = `${String(hour).padStart(2, '0')}:00`
    counts[key] = (counts[key] || 0) + 1
  })
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, count]) => ({ hour, count }))
}
