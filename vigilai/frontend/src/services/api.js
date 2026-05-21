const BASE_URL = 'http://localhost:8000'

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`API ${res.status}: ${err}`)
  }
  return res.json()
}

export const api = {
  getAlerts: (limit = 50, severity = null) => {
    const params = new URLSearchParams({ limit })
    if (severity) params.append('severity', severity)
    return request(`/api/alerts?${params}`)
  },

  getIncidents: (limit = 100, actionType = null, cameraId = null) => {
    const params = new URLSearchParams({ limit })
    if (actionType) params.append('action_type', actionType)
    if (cameraId) params.append('camera_id', cameraId)
    return request(`/api/incidents?${params}`)
  },

  getStats: () => request('/api/stats'),

  getVideos: () => request('/api/videos'),

  startDetection: (videoPath, cameraId = 'CAM-01') =>
    request('/api/start-detection', {
      method: 'POST',
      body: JSON.stringify({ video_path: videoPath, camera_id: cameraId }),
    }),

  stopDetection: (cameraId) =>
    request(`/api/stop-detection/${cameraId}`, { method: 'POST' }),

  getDetectionStatus: () => request('/api/detection-status'),

  getThreatStatus: () => request('/api/threat-status'),

  getActiveIncidents: () => request('/api/active-incidents'),

  health: () => request('/health'),
}
