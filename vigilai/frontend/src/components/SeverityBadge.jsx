export default function SeverityBadge({ severity }) {
  const map = {
    LOW: 'badge-low',
    MEDIUM: 'badge-medium',
    HIGH: 'badge-high',
  }
  return (
    <span className={map[severity] || 'badge-low'}>
      {severity}
    </span>
  )
}
