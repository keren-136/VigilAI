import { useState, useEffect, useRef } from 'react'
import { Camera, Play, Square, Loader, Maximize2, AlertCircle } from 'lucide-react'
import { api } from '../services/api'

// Routes through Vite proxy → http://localhost:8000
const STREAM_BASE = '/api/video-feed'

export default function CameraCard({ cameraId, isActive, onStatusChange, alertSeverity }) {
  const [loading, setLoading]           = useState(false)
  const [videoPath, setVideoPath]       = useState('myvideo.mp4')
  const [expanded, setExpanded]         = useState(false)
  const [error, setError]               = useState(null)
  const [streamLoading, setStreamLoading] = useState(false)
  const [availableVideos, setAvailableVideos] = useState([])
  // Increment to force the browser to re-request the MJPEG stream
  const [streamKey, setStreamKey]       = useState(0)

  // Fetch available video files from backend on mount
  useEffect(() => {
    api.getVideos()
      .then(data => {
        if (data.videos?.length) {
          setAvailableVideos(data.videos)
          setVideoPath(data.videos[0])
        }
      })
      .catch(() => {})
  }, [])

  // When camera becomes active: show spinner briefly, then reveal stream
  useEffect(() => {
    if (isActive) {
      setStreamLoading(true)
      // Give the backend ~1 s to produce the first frame, then show the img
      const t = setTimeout(() => {
        setStreamKey(k => k + 1)
        setStreamLoading(false)
      }, 1000)
      return () => clearTimeout(t)
    } else {
      setStreamLoading(false)
    }
  }, [isActive])

  const handleStart = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.startDetection(videoPath || 'demo', cameraId)
      onStatusChange(cameraId, true)
    } catch (e) {
      console.error('Start detection failed:', e)
      setError('Failed to start — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    setLoading(true)
    setError(null)
    try {
      await api.stopDetection(cameraId)
      onStatusChange(cameraId, false)
    } catch (e) {
      console.error('Stop detection failed:', e)
    } finally {
      setLoading(false)
    }
  }

  // Cache-bust on every new stream key
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
            <>
              {/*
               * MJPEG stream.
               *
               * IMPORTANT: do NOT use display:none or conditional rendering on this
               * <img>. MJPEG is a multipart/x-mixed-replace stream — the browser
               * updates the image in-place as frames arrive. Hiding it prevents
               * the browser from making the request at all.
               *
               * We always render it; the spinner overlay sits on top while loading.
               */}
              <img
                key={streamKey}
                src={streamUrl}
                alt={`${cameraId} live feed`}
                className="w-full h-full object-contain"
                style={{ display: 'block' }}
                onError={() => {
                  // If stream errors, retry after 2 s
                  console.warn(`[${cameraId}] Stream error — retrying in 2s`)
                  setTimeout(() => setStreamKey(k => k + 1), 2000)
                }}
              />

              {/* Spinner overlay — shown only during the initial 1 s wait */}
              {streamLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                  <div className="text-center">
                    <Loader size={20} className="animate-spin text-blue-400 mx-auto mb-1" />
                    <p className="text-xs text-gray-400">Starting stream…</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Inactive placeholder */
            <div className="w-full h-full flex items-center justify-center text-gray-700">
              <div className="text-center">
                <Camera size={28} className="mx-auto mb-1.5" />
                <p className="text-xs">Feed Inactive</p>
                <p className="text-xs mt-1 text-gray-800">Select video and click Start</p>
              </div>
            </div>
          )}

          {/* Camera ID badge */}
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
          {isActive && !streamLoading && (
            <button
              onClick={() => setExpanded(true)}
              className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-gray-400 hover:text-white p-1 rounded"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>

        {/* ── Error message ── */}
        {error && (
          <div className="flex items-center gap-1.5 text-red-400 text-xs mb-2 px-1">
            <AlertCircle size={12} />
            {error}
          </div>
        )}

        {/* ── Controls ── */}
        <div className="flex items-center gap-2">
          {availableVideos.length > 0 ? (
            <select
              value={videoPath}
              onChange={e => setVideoPath(e.target.value)}
              disabled={isActive}
              className="flex-1 bg-dark-700 border border-dark-500 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600 disabled:opacity-40"
            >
              {availableVideos.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
              <option value="demo">demo (synthetic)</option>
            </select>
          ) : (
            <input
              type="text"
              value={videoPath}
              onChange={e => setVideoPath(e.target.value)}
              placeholder="myvideo.mp4 or demo"
              disabled={isActive}
              className="flex-1 bg-dark-700 border border-dark-500 rounded-lg px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600 disabled:opacity-40"
            />
          )}

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
              key={`fullscreen-${Date.now()}`}
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
