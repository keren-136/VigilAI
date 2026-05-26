import { useState, useEffect, useRef } from 'react'
import { Camera, Play, Square, Loader, Maximize2, Minimize2, AlertCircle, X } from 'lucide-react'
import { api } from '../services/api'

// Routes through Vite proxy → http://localhost:8000
const STREAM_BASE = '/api/video-feed'

export default function CameraCard({ cameraId, isActive, onStatusChange, alertSeverity }) {
  const [loading, setLoading]             = useState(false)
  const [videoPath, setVideoPath]         = useState('myvideo.mp4')
  const [expanded, setExpanded]           = useState(false)
  const [error, setError]                 = useState(null)
  const [streamLoading, setStreamLoading] = useState(false)
  const [availableVideos, setAvailableVideos] = useState([])

  // streamKey: incremented to force the browser to re-request the MJPEG stream.
  // One key for the card, one stable key for the fullscreen modal.
  // The fullscreen key is set ONCE when the modal opens and never changes while
  // the modal is open — this is critical for MJPEG which breaks on remount.
  const [streamKey, setStreamKey]         = useState(0)
  const [fsKey, setFsKey]                 = useState(0)

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

  // When camera becomes active: brief spinner, then show stream
  useEffect(() => {
    if (isActive) {
      setStreamLoading(true)
      const t = setTimeout(() => {
        setStreamKey(k => k + 1)
        setStreamLoading(false)
      }, 1000)
      return () => clearTimeout(t)
    } else {
      setStreamLoading(false)
      setExpanded(false) // close fullscreen if camera stops
    }
  }, [isActive])

  // Set a stable fullscreen key ONCE when the modal opens.
  // Never use Date.now() inline in JSX — it re-evaluates on every render
  // and causes the <img> to remount continuously, killing the MJPEG stream.
  useEffect(() => {
    if (expanded) {
      setFsKey(Date.now())
    }
  }, [expanded])

  // ESC key closes the modal
  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

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

  const streamUrl   = `${STREAM_BASE}/${cameraId}?k=${streamKey}`
  const fsStreamUrl = `${STREAM_BASE}/${cameraId}?k=${fsKey}`

  const borderClass =
    alertSeverity === 'HIGH'   ? 'border-red-600/70'   :
    alertSeverity === 'MEDIUM' ? 'border-amber-500/60'  :
    isActive                   ? 'border-blue-600/50'   :
                                 'border-dark-600'

  return (
    <>
      {/* ── Camera card ── */}
      <div className={`card transition-all duration-300 border ${borderClass}`}>

        {/* Video area */}
        <div
          className="relative bg-black rounded-lg overflow-hidden mb-3"
          style={{ aspectRatio: '16/9' }}
        >
          {isActive ? (
            <>
              {/*
               * MJPEG stream.
               * Always rendered with display:block — never conditionally hidden.
               * MJPEG is a continuous multipart response; hiding the <img> stops
               * the browser from receiving frames entirely.
               */}
              <img
                key={streamKey}
                src={streamUrl}
                alt={`${cameraId} live feed`}
                className="w-full h-full object-contain"
                style={{ display: 'block' }}
                onError={() => {
                  console.warn(`[${cameraId}] Stream error — retrying in 2s`)
                  setTimeout(() => setStreamKey(k => k + 1), 2000)
                }}
              />

              {/* Spinner overlay during initial 1 s wait */}
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

          {/* Expand button — only when stream is live */}
          {isActive && !streamLoading && (
            <button
              onClick={() => setExpanded(true)}
              title="Fullscreen (ESC to close)"
              className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-gray-400 hover:text-white p-1 rounded transition-colors"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-1.5 text-red-400 text-xs mb-2 px-1">
            <AlertCircle size={12} />
            {error}
          </div>
        )}

        {/* Controls */}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
          onClick={() => setExpanded(false)}
        >
          {/*
           * Stop click propagation so clicking the video/controls doesn't close the modal.
           * Max width 90vw, max height 90vh — preserves aspect ratio on any screen.
           */}
          <div
            className="relative w-full max-w-5xl mx-4"
            style={{ maxHeight: '90vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                <span className="text-white font-mono text-sm">{cameraId} — Live Feed</span>
                {alertSeverity && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    alertSeverity === 'HIGH'   ? 'bg-red-900/80 text-red-300'    :
                    alertSeverity === 'MEDIUM' ? 'bg-amber-900/80 text-amber-300' :
                                                'bg-green-900/80 text-green-300'
                  }`}>
                    {alertSeverity}
                  </span>
                )}
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs px-3 py-1.5 border border-dark-600 hover:border-gray-500 rounded transition-colors"
              >
                <X size={12} />
                Close
              </button>
            </div>

            {/* Stream container — black background, 16:9 aspect ratio */}
            <div
              className="relative bg-black rounded-lg overflow-hidden border border-dark-600"
              style={{ aspectRatio: '16/9', width: '100%' }}
            >
              {/*
               * fsKey is set ONCE via useEffect when the modal opens.
               * It never changes while the modal is open, so this <img> is
               * never remounted — the MJPEG connection stays alive.
               *
               * This is the same backend stream as the card (same camera_id),
               * just a second HTTP connection to the same MJPEG endpoint.
               * No second detection pipeline is created.
               */}
              <img
                key={fsKey}
                src={fsStreamUrl}
                alt={`${cameraId} fullscreen feed`}
                style={{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />

              {/* Camera ID overlay */}
              <div className="absolute top-3 left-3 bg-black/70 text-xs text-gray-300 px-2 py-1 rounded font-mono">
                {cameraId}
              </div>

              {/* REC indicator */}
              <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-black/70 px-2 py-1 rounded">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-400 text-xs font-mono">REC</span>
              </div>

              {/* Minimize button inside the stream */}
              <button
                onClick={() => setExpanded(false)}
                title="Exit fullscreen (ESC)"
                className="absolute bottom-3 right-3 bg-black/60 hover:bg-black/80 text-gray-400 hover:text-white p-1.5 rounded transition-colors"
              >
                <Minimize2 size={14} />
              </button>

              {/* ESC hint */}
              <div className="absolute bottom-3 left-3 text-gray-600 text-xs">
                Press ESC to close
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
