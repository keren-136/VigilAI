import { useState, useEffect } from 'react'
import { Camera, Play, Square, Loader, Maximize2 } from 'lucide-react'
import { api } from '../services/api'

const STREAM_BASE = 'http://localhost:8000/api/video-feed'

export default function CameraCard({ cameraId, isActive, onStatusChange, alertSeverity }) {
  const [loading, setLoading]     = useState(false)
  const [videoPath, setVideoPath] = useState('demo')
  const [expanded, setExpanded]   = useState(false)
  // Bust the cache every time the camera starts so the browser re-requests
  const [streamKey, setStreamKey] = useState(0)

  useEffect(() => {
    if (isActive) {
      // Small delay so the backend detector has time to produce the first frame
      const t = setTimeout(() => setStreamKey(k => k + 1), 600)
      return () => clearTimeout(t)
    }
  }, [isActive])

  const handleStart = async () => {
    setLoading(true)
    try {
      await api.startDetection(videoPath, cameraId)
      onStatusChange(cameraId, true)
    } catch (e) {
      console.error('Start detection failed:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    setLoading(true)
    try {
      await api.stopDetection(cameraId)
      onStatusChange(cameraId, false)
    } catch (e) {
      console.error('Stop detection failed:', e)
    } finally {
      setLoading(false)
    }
  }

  const streamUrl = `${STREAM_BASE}/${cameraId}?k=${streamKey}`

  const borderClass =
    alertSeverity === 'HIGH'   ? 'border-red-600/70'   :
    alertSeverity === 'MEDIUM' ? 'border-amber-500/60'  :
    isActive                   ? 'border-blue-600/50'   :
                                 'border-dark-600'

  return (
    <>
      <div className={`card transition-all duration-300 border ${borderClass}`}>

        {/* ── Video area ── */}
        <div
          className="relative bg-black rounded-lg overflow-hidden mb-3"
          style={{ aspectRatio: '16/9' }}
        >
          {isActive ? (
            /*
             * MJPEG stream.
             * The browser keeps this <img> alive and updates it as new
             * JPEG frames arrive from the multipart/x-mixed-replace stream.
             * No onLoad gating — just show it directly.
             */
            <img
              key={streamKey}
              src={streamUrl}
              alt={`${cameraId} live feed`}
              className="w-full h-full object-contain"
              style={{ display: 'block' }}
            />
          ) : (
            /* Inactive placeholder */
            <div className="w-full h-full flex items-center justify-center text-gray-700">
              <div className="text-center">
                <Camera size={28} className="mx-auto mb-1.5" />
                <p className="text-xs">Feed Inactive</p>
              </div>
            </div>
          )}

          {/* Camera ID badge — always visible */}
          <div className="absolute top-2 left-2 bg-black/70 text-xs text-gray-300 px-2 py-0.5 rounded font-mono">
            {cameraId}
          </div>

          {/* REC badge */}
          {isActive && (
            <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/70 px-2 py-0.5 rounded">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-400 text-xs font-mono">REC</span>
            </div>
          )}

          {/* Severity badge */}
          {isActive && alertSeverity && (
            <div className={`absolute bottom-2 left-2 text-xs font-bold px-2 py-0.5 rounded ${
              alertSeverity === 'HIGH'   ? 'bg-red-900/80 text-red-300'    :
              alertSeverity === 'MEDIUM' ? 'bg-amber-900/80 text-amber-300' :
                                          'bg-green-900/80 text-green-300'
            }`}>
              {alertSeverity}
            </div>
          )}

          {/* Expand button */}
          {isActive && (
            <button
              onClick={() => setExpanded(true)}
              className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-gray-400 hover:text-white p-1 rounded"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>

        {/* ── Controls ── */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={videoPath}
            onChange={(e) => setVideoPath(e.target.value)}
            placeholder="video.mp4 or demo"
            disabled={isActive}
            className="flex-1 bg-dark-700 border border-dark-500 rounded-lg px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600 disabled:opacity-40"
          />
          {isActive ? (
            <button
              onClick={handleStop}
              disabled={loading}
              className="flex items-center gap-1.5 bg-red-600/20 hover:bg-red-600/30 border border-red-700/50 text-red-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? <Loader size={12} className="animate-spin" /> : <Square size={12} />}
              Stop
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading}
              className="flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-700/50 text-blue-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
              Start
            </button>
          )}
        </div>
      </div>

      {/* ── Fullscreen modal ── */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-6"
          onClick={() => setExpanded(false)}
        >
          <div className="relative w-full max-w-5xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-mono text-sm">{cameraId} — Live Feed</span>
              <button
                onClick={() => setExpanded(false)}
                className="text-gray-400 hover:text-white text-xs px-3 py-1 border border-dark-600 rounded"
              >
                Close ✕
              </button>
            </div>
            <img
              src={`${STREAM_BASE}/${cameraId}?k=${Date.now()}`}
              alt={`${cameraId} fullscreen`}
              className="w-full rounded-lg border border-dark-600"
              style={{ display: 'block' }}
            />
          </div>
        </div>
      )}
    </>
  )
}
