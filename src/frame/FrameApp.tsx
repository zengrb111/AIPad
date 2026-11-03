import { useCallback, useEffect, useRef, useState } from 'react'
import { api, url, fmtClock, type Narration, type Photo } from '../lib/api'
import { isNativeApp } from '../lib/server'
import { useRecorder } from '../lib/recorder'

const SLIDE_MS = 18000
const POLL_MS = 5000
const IDLE_CLOSE_MS = 30000

type SyncAudio = { id: string; audio: string; photoId: string | null; duration: number }

export default function FrameApp() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [displayed, setDisplayed] = useState(0)
  const [incoming, setIncoming] = useState<number | null>(null)
  const [recOpen, setRecOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [narratingId, setNarratingId] = useState<string | null>(null)
  const [subtitle, setSubtitle] = useState('')
  const [sending, setSending] = useState(false)
  const [now, setNow] = useState(new Date())
  // 装成 App 之后，原生层已经放开了自动播放，不需要用户先点一下解锁
  const [unlocked, setUnlocked] = useState(() => isNativeApp())
  const [playingVideo, setPlayingVideo] = useState<string | null>(null)
  const [cue, setCue] = useState('')
  const [slideKey, setSlideKey] = useState(0)

  const rec = useRecorder()
  const idxRef = useRef(0)
  const photosRef = useRef<Photo[]>([])
  const handled = useRef(new Set<string>())
  const playedNarration = useRef(new Set<string>())
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recOpenRef = useRef(false)
  const busyRef = useRef(false)
  const idleTimer = useRef<number | undefined>(undefined)
  const subtitleTimer = useRef<number | undefined>(undefined)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const swipedRef = useRef(false)

  photosRef.current = photos
  recOpenRef.current = recOpen
  busyRef.current = Boolean(playingId || narratingId || playingVideo)

  /* ---------- 数据 ---------- */

  const refresh = useCallback(async () => {
    try {
      const { photos: list } = await api.photos()
      setPhotos(list)
      if (idxRef.current >= list.length) {
        idxRef.current = 0
        setDisplayed(0)
      }
      return list
    } catch {
      return []
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  /* ---------- 切页 ---------- */

  const switchTo = useCallback((next: number) => {
    setIncoming(next)
    window.setTimeout(() => {
      idxRef.current = next
      setDisplayed(next)
      setIncoming(null)
    }, 900)
  }, [])

  /** 手动翻页：切完之后重新计时，别刚滑完就自动跳走 */
  const goTo = (dir: 1 | -1) => {
    const list = photosRef.current
    if (list.length < 2) return
    switchTo((idxRef.current + dir + list.length) % list.length)
    setSlideKey((k) => k + 1)
  }

  /* ---------- 轮播：正在播报时不切，免得把话切断 ---------- */

  useEffect(() => {
    if (photos.length < 2 || recOpen) return
    const t = window.setInterval(() => {
      if (busyRef.current) return
      switchTo((idxRef.current + 1) % photosRef.current.length)
    }, SLIDE_MS)
    return () => clearInterval(t)
  }, [photos.length, recOpen, slideKey, switchTo])

  /* ---------- 时钟 ---------- */

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000)
    return () => clearInterval(t)
  }, [])

  /* ---------- 屏幕常亮 ---------- */

  useEffect(() => {
    let lock: any = null
    const req = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen')
      } catch {
        /* 局域网 http 下不可用；装成 App 后由系统保常亮 */
      }
    }
    req()
    const onVis = () => {
      if (document.visibilityState === 'visible') req()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      lock?.release?.()
    }
  }, [])

  /* ---------- 所有声音的统一停止 ---------- */

  const stopAll = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    setPlayingId(null)
    setPlayingVideo(null)
    setCue('')
    try {
      window.speechSynthesis?.cancel()
    } catch {}
    setNarratingId(null)
    window.clearTimeout(subtitleTimer.current)
    setSubtitle('')
  }, [])

  /* ---------- 子女语音（优先播） ---------- */

  const playVoice = useCallback(
    (c: SyncAudio) => {
      if (handled.current.has(c.id)) return
      handled.current.add(c.id)
      stopAll()

      const a = new Audio(url(c.audio))
      audioRef.current = a
      setPlayingId(c.id)

      const done = () => {
        setPlayingId(null)
        api.markHeard(c.id).catch(() => {})
        refresh()
      }
      a.onended = done
      a.onerror = done
      a.play().catch(done)
    },
    [refresh, stopAll]
  )

  /* ---------- AI 解说 ---------- */

  const speakNarration = useCallback((photo: Photo, n: Narration) => {
    if (!n.text) return
    window.clearTimeout(subtitleTimer.current)
    setSubtitle(n.text)
    setNarratingId(photo.id)

    const finish = () => {
      setNarratingId(null)
      subtitleTimer.current = window.setTimeout(() => setSubtitle(''), 5000)
    }

    if (n.audio) {
      const a = new Audio(url(n.audio))
      audioRef.current = a
      a.onended = finish
      a.onerror = finish
      a.play().catch(finish)
      return
    }

    // 没有合成好的语音文件，退回浏览器朗读。没有中文语音包就只显示字幕，不出声。
    try {
      const voices = window.speechSynthesis?.getVoices?.() || []
      const zh = voices.find((v) => v.lang?.toLowerCase().startsWith('zh'))
      if (!zh) {
        subtitleTimer.current = window.setTimeout(() => {
          setNarratingId(null)
          setSubtitle('')
        }, 9000)
        return
      }
      const u = new SpeechSynthesisUtterance(n.text)
      u.lang = 'zh-CN'
      u.voice = zh
      u.rate = 0.92
      u.onend = finish
      u.onerror = finish
      window.speechSynthesis.speak(u)
    } catch {
      finish()
    }
  }, [])

  useEffect(() => {
    const cur = photos[displayed]
    if (!cur || !cur.narration || recOpen || !unlocked) return
    if (playingId || narratingId) return
    if (cur.narration.status === 'pending') return
    if (playedNarration.current.has(cur.id)) return
    playedNarration.current.add(cur.id)
    speakNarration(cur, cur.narration)
  }, [displayed, photos, playingId, narratingId, recOpen, unlocked, speakNarration])

  /* ---------- 首次解锁 ---------- */

  // 浏览器规定：没有用户交互就不许出声。相框刚装上时必须先点一下，
  // 点完之后这一整个会话都能自动播。装成 App / 用 Fully Kiosk 并打开
  // 自动播放设置后，就不需要这一步。
  const unlock = () => {
    try {
      const probe = new Audio()
      probe.muted = true
      probe.play().catch(() => {})
    } catch {}
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      ctx.resume?.()
    } catch {}
    setUnlocked(true)
  }

  /* ---------- 轮询 ---------- */

  useEffect(() => {
    let alive = true
    let timer: number

    const poll = async () => {
      try {
        const s = await api.sync('parent', 0)
        if (!alive) return
        if (s.photoCount !== photosRef.current.length) refresh()
        if (!recOpenRef.current && s.pendingAudio?.length) {
          const next = (s.pendingAudio as SyncAudio[]).find((x) => !handled.current.has(x.id))
          if (next) playVoice(next)
        }
      } catch {
        /* 网络抖动忽略，下一轮再试 */
      }
      if (alive) timer = window.setTimeout(poll, POLL_MS)
    }

    poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [playVoice, refresh])

  /* ---------- 录音 ---------- */

  const openRec = () => {
    if (sending) return
    stopAll()
    setRecOpen(true)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      rec.cancel()
      setRecOpen(false)
    }, IDLE_CLOSE_MS)
  }

  const closeRec = () => {
    rec.cancel()
    setRecOpen(false)
    window.clearTimeout(idleTimer.current)
  }

  const tapRecord = async () => {
    window.clearTimeout(idleTimer.current)
    if (rec.state === 'recording') {
      setSending(true)
      const r = await rec.stop()
      if (r) {
        try {
          await api.uploadComment(r.blob, photos[displayed]?.id ?? null, 'parent', r.duration)
          setToast('已经说给他们听了')
          window.setTimeout(() => setToast(''), 3200)
        } catch {
          setToast('发送失败，再试一次')
          window.setTimeout(() => setToast(''), 3200)
        }
      }
      setSending(false)
      setRecOpen(false)
    } else {
      const ok = await rec.start()
      if (!ok) return
      idleTimer.current = window.setTimeout(() => {
        rec.cancel()
      }, 120000)
    }
  }

  const cur = photos[displayed]
  const prev = incoming !== null ? photos[incoming] : null
  const speaking = Boolean(narratingId) && Boolean(subtitle)

  // 视频播的是它自己，点一下就播；照片点一下是"说话"
  const onFrameClick = () => {
    // 刚滑完不算点击，否则滑一下就进录音了
    if (swipedRef.current) {
      swipedRef.current = false
      return
    }
    if (sending || recOpen) return
    if (playingVideo) {
      setPlayingVideo(null)
      return
    }
    if (cur?.kind === 'video') {
      stopAll()
      setPlayingVideo(cur.id)
      return
    }
    openRec()
  }

  // 左右滑动翻页。用 pointer 事件，手指和鼠标都能用
  const onPointerDown = (e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY }
    swipedRef.current = false
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const s = pointerStart.current
    pointerStart.current = null
    if (!s || recOpen) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    // 横向位移要明显大于纵向，避免把上下滑当成翻页
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swipedRef.current = true
      stopAll()
      goTo(dx < 0 ? 1 : -1)
    }
  }

  if (!loaded) return <div className="loading">正在取照片…</div>

  if (!unlocked) {
    return (
      <div className="frame-gate" onClick={unlock}>
      {photos[0] && <MediaLayer p={photos[0]} />}
        <div className="frame-veil" />
        <div className="gate-center">
          <span className="gate-pulse" />
          轻触屏幕
          <em>点了之后，它会自己讲这些照片</em>
        </div>
      </div>
    )
  }

  return (
    <div
      className="frame"
      onClick={onFrameClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {photos.length === 0 ? (
        <div className="frame-empty">
          <h2>还没有照片</h2>
          <p>让家人在手机上打开子女端，传几张照片过来，这里就会开始播放了。</p>
        </div>
      ) : (
        <>
          <MediaLayer p={cur} />
          {prev && <MediaLayer p={prev} top />}

          {cur.kind === 'video' && !playingVideo && !recOpen && (
            <div className="frame-play">
              <span className="play-ring">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              <em>点一下播放 · {fmtClock(cur.duration)}</em>
            </div>
          )}

          {playingVideo && (
            <video
              className="frame-video"
              src={url(cur.file)}
              autoPlay
              playsInline
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime
                const c = cur.transcript?.chunks?.find((x) => t >= x.start && t <= x.end)
                setCue(c?.text || '')
              }}
              onEnded={() => {
                setPlayingVideo(null)
                setCue('')
              }}
              onClick={(e) => {
                e.stopPropagation()
                setPlayingVideo(null)
                setCue('')
              }}
            />
          )}

          {playingVideo && cue && <div className="video-cue">{cue}</div>}
        </>
      )}

      <div className="frame-veil" />

      <div
        style={{
          position: 'absolute',
          top: 26,
          right: 32,
          color: 'rgba(255,255,255,.62)',
          fontSize: 20,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '.04em',
          textShadow: '0 1px 10px rgba(0,0,0,.3)',
        }}
      >
        {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
      </div>

      {photos.length > 0 && !playingVideo && (
        <div className="frame-meta">
          <div>
            {speaking ? (
              <div className="frame-caption speaking">{subtitle}</div>
            ) : (
              <>
                {cur.caption && <div className="frame-caption">{cur.caption}</div>}
                <div className="frame-by">
                  {cur.from}
                  {cur.caption ? '' : ' 传来一张照片'}
                </div>
              </>
            )}
          </div>
          {photos.length > 1 && (
            <div className="frame-dots">
              {photos.slice(0, 9).map((p, i) => (
                <i key={p.id} className={i === displayed ? 'on' : ''} />
              ))}
            </div>
          )}
        </div>
      )}

      {!recOpen && !speaking && <div className="frame-breathe" />}

      {toast && (
        <div className="frame-toast" onClick={(e) => e.stopPropagation()}>
          <span className="pulse" />
          {toast}
        </div>
      )}

      {playingId && !recOpen && (
        <div className="frame-playing">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#B4653A">
            <path d="M8 5v14l11-7z" />
          </svg>
          正在放家人的留言
        </div>
      )}

      {cur?.narration?.status === 'pending' && !recOpen && (
        <div className="frame-thinking">正在看懂这张照片…</div>
      )}

      {recOpen && (
        <div className="rec-layer" onClick={(e) => e.stopPropagation()}>
          <div className="rec-hint">
            {rec.state === 'denied'
              ? '没有拿到麦克风权限'
              : rec.state === 'recording'
                ? '正在听，说完点一下'
                : '点一下，说句话给家人'}
          </div>

          <button
            className={`rec-btn ${rec.state === 'recording' ? 'recording' : ''}`}
            onClick={tapRecord}
            disabled={sending || rec.state === 'denied'}
          >
            {rec.state === 'recording' ? (
              <span className="stop" />
            ) : (
              <svg className="mic" viewBox="0 0 24 24">
                <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
                <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11Z" />
              </svg>
            )}
          </button>

          {rec.state === 'recording' && (
            <>
              <div className="rec-level">
                {Array.from({ length: 17 }).map((_, i) => {
                  const h =
                    4 + Math.abs(Math.sin(i * 1.7 + rec.elapsed)) * 30 * rec.level + rec.level * 18
                  return <i key={i} style={{ height: Math.min(38, h) }} />
                })}
              </div>
              <div className="rec-time">
                {Math.floor(rec.elapsed / 60)}:{String(rec.elapsed % 60).padStart(2, '0')}
              </div>
            </>
          )}

          {rec.state === 'denied' && (
            <div className="rec-hint" style={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.7 }}>
              请在浏览器设置里允许使用麦克风。如果是局域网 IP 访问，浏览器会要求 https。
            </div>
          )}

          <div className="rec-actions">
            <button className="rec-cancel" onClick={closeRec}>
              先不说
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 照片铺满；视频封面保留完整画面，两侧用同一张图模糊垫底 */
function MediaLayer({ p, top }: { p: Photo; top?: boolean }) {
  const isVid = p.kind === 'video'
  const src = isVid ? (p.cover ? url(p.cover) : null) : url(p.file)
  return (
    <div className="frame-slide show" style={top ? { zIndex: 2 } : undefined}>
      {src ? (
        isVid ? (
          <>
            <div className="frame-blur" style={{ backgroundImage: `url(${src})` }} />
            <img className="frame-img contain" src={src} alt="" />
          </>
        ) : (
          <img className="frame-img" src={src} alt="" />
        )
      ) : (
        <div className="frame-img" style={{ background: '#1d1814' }} />
      )}
    </div>
  )
}
