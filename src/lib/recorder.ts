import { useCallback, useEffect, useRef, useState } from 'react'

/** 挑一个当前浏览器真能录的格式：iPhone 只吃 mp4，安卓一般给 webm */
function pickMime() {
  const list = [
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ]
  for (const m of list) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

export type RecState = 'idle' | 'recording' | 'denied' | 'unsupported'

export function useRecorder() {
  const [state, setState] = useState<RecState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)

  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const stream = useRef<MediaStream | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const raf = useRef(0)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current)
    if (tick.current) {
      clearInterval(tick.current)
      tick.current = null
    }
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    audioCtx.current?.close().catch(() => {})
    audioCtx.current = null
    rec.current = null
    setLevel(0)
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    if (typeof MediaRecorder === 'undefined') {
      setState('unsupported')
      return false
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      stream.current = s

      // 音量条：让老人看得见"它在听"
      const ctx = new AudioContext()
      audioCtx.current = ctx
      const src = ctx.createMediaStreamSource(s)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        analyser.getByteFrequencyData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i]
        setLevel(Math.min(1, sum / buf.length / 80))
        raf.current = requestAnimationFrame(loop)
      }
      loop()

      const mime = pickMime()
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      r.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      r.start(200)
      rec.current = r

      startedAt.current = Date.now()
      setElapsed(0)
      setState('recording')
      tick.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000))
      }, 200)

      return true
    } catch (e) {
      console.warn('[recorder]', e)
      cleanup()
      setState('denied')
      return false
    }
  }, [cleanup])

  const stop = useCallback(async (): Promise<{ blob: Blob; duration: number } | null> => {
    const r = rec.current
    if (!r || r.state === 'inactive') {
      cleanup()
      setState('idle')
      return null
    }
    const duration = Math.round((Date.now() - startedAt.current) / 1000)
    const blob = await new Promise<Blob>((resolve) => {
      r.onstop = () => resolve(new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }))
      r.stop()
    })
    cleanup()
    setState('idle')
    setElapsed(0)
    return { blob, duration: Math.max(1, duration) }
  }, [cleanup])

  const cancel = useCallback(() => {
    try {
      rec.current?.stop()
    } catch {}
    cleanup()
    setState('idle')
    setElapsed(0)
  }, [cleanup])

  return { state, elapsed, level, start, stop, cancel }
}
