export default function StatCard({ label, value, icon: Icon, color = 'blue', trend }) {
  const colorMap = {
    blue: 'text-blue-400 bg-blue-900/20 border-blue-800/30',
    green: 'text-green-400 bg-green-900/20 border-green-800/30',
    amber: 'text-amber-400 bg-amber-900/20 border-amber-800/30',
    red: 'text-red-400 bg-red-900/20 border-red-800/30',
    purple: 'text-purple-400 bg-purple-900/20 border-purple-800/30',
  }

  return (
    <div className="card flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl border flex items-center justify-center flex-shrink-0 ${colorMap[color]}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
        {trend && <p className="text-xs text-gray-600 mt-0.5">{trend}</p>}
      </div>
    </div>
  )
}
