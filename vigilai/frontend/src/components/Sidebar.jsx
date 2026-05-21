import { NavLink } from 'react-router-dom'
import { LayoutDashboard, FileText, BarChart3, Shield, Activity } from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/incidents', icon: FileText, label: 'Incidents' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
]

export default function Sidebar({ wsStatus }) {
  return (
    <aside className="w-64 min-h-screen bg-dark-800 border-r border-dark-600 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-dark-600">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-none">VigilAI</h1>
            <p className="text-gray-500 text-xs mt-0.5">Surveillance Intelligence</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-dark-700'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* WS Status */}
      <div className="p-4 border-t border-dark-600">
        <div className="flex items-center gap-2 text-xs">
          <Activity size={12} className={wsStatus === 'connected' ? 'text-green-400' : 'text-red-400'} />
          <span className={wsStatus === 'connected' ? 'text-green-400' : 'text-red-400'}>
            {wsStatus === 'connected' ? 'Live Feed Active' : 'Connecting…'}
          </span>
          <span
            className={`ml-auto w-2 h-2 rounded-full ${
              wsStatus === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-red-400'
            }`}
          />
        </div>
      </div>
    </aside>
  )
}
