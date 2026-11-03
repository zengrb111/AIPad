import { useCallback, useEffect, useRef, useState } from 'react'
import { api, url, fmtClock, fmtDur, type Comment, type Narration, type Photo } from '../lib/api'
import { abs, isNativeApp } from '../lib/server'
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
  // 装成 App 之后，原生层已经放开了自动播放，不需要用户先点一下解锁
  const [unlocked, setUnlocked] = useState(() => isNativeApp())
  const [playingVideo, setPlayingVideo] = useState<string | null>(null)
  const [cue, setCue] = useState('')
  const [slideKey, setSlideKey] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)

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
  /** 服务端数据版本号，用来判断要不要重新拉一遍（解说生成完时照片数量不变） */
  const revRef = useRef(0)

  photosRef.current = photos
  recOpenRef.current = recOpen
  busyRef.current = Boolean(playingId || narratingId || playingVideo || panelOpen)

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

  /** 面板里点某条留言播放 */
  const playComment = useCallback(
    (c: Comment) => {
      stopAll()
      const a = new Audio(url(c.audio))
      audioRef.current = a
      setPlayingId(c.id)
      const done = () => {
        setPlayingId(null)
        if (!c.heard) api.markHeard(c.id).catch(() => {})
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

    // 语音一律用子女端（服务端）合成好的 mp3，相框不再自己合成一次。
    // 设备音色不统一是一个原因，更实际的是：这块平板跑 TTS 会卡，
    // 而且老人会把"机器在念"和"孩子留的话"混在一起。
    // 没有音频（合成失败，极少见）就安静显示字幕。
    subtitleTimer.current = window.setTimeout(() => {
      setNarratingId(null)
      setSubtitle('')
    }, 9000)
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
        // 用版本号判断，而不是照片数量：
        // 解说生成完时照片数量没变，但内容变了，必须重新拉一次
        if (s.rev !== revRef.current) {
          revRef.current = s.rev
          refresh()
        }
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

  /* ---------- 实时推送：解说一生成完就推过来 ---------- */

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    let es: EventSource | null = null
    let closed = false

    try {
      es = new EventSource(abs('/api/events?role=parent'))
    } catch {
      return
    }

    es.onmessage = (e) => {
      let m: { type?: string; id?: string; audio?: string; photoId?: string | null; duration?: number }
      try {
        m = JSON.parse(e.data)
      } catch {
        return
      }
      if (m.type === 'photo') {
        // 新照片进来时画面会立刻切过去（新照片排在最前）。
        // 这时候如果还在念上一张，声画就对不上了——先停下，等新的解说推过来。
        stopAll()
        refresh()
        return
      }
      if (m.type === 'photo-deleted') {
        refresh()
        return
      }
      if (m.type === 'narration') {
        // 文案和 mp3 都已经在服务端生成好了，这里只管拉下来播
        refresh()
        return
      }
      if (m.type === 'voice' && m.audio && m.id && !recOpenRef.current) {
        playVoice({
          id: m.id,
          audio: m.audio,
          photoId: m.photoId ?? null,
          duration: m.duration ?? 0,
        })
      }
    }

    // 断线由 EventSource 自己重连；这里不 close，否则会把自动重连搞坏
    return () => {
      closed = true
      es?.close()
      es = null
      void closed
    }
  }, [playVoice, refresh, stopAll])

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
  // 子女留言里爸妈还没听过的
  const unheard = (cur?.comments || []).filter((c) => c.from === 'child' && !c.heard).length

  // 视频播的是它自己，点一下就播；照片点一下是"说话"
  const onFrameClick = () => {
    // 刚滑完不算点击，否则滑一下就进录音了
    if (swipedRef.current) {
      swipedRef.current = false
      return
    }
    // 面板开着时，点画面任意处先收起面板
    if (panelOpen) {
      setPanelOpen(false)
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

  // 左右滑动翻页
  //
  // 踩过的坑：原来只用 pointerdown/pointerup，用鼠标测能过，
  // 真机触屏上没反应——.frame 的 touch-action 允许浏览器接管横滑，
  // 手指一动就触发 pointercancel，pointerup 永远不来。
  // 现在：触屏走 touch 事件，鼠标走 pointer，两边都能用。
  const handleSwipe = (dx: number, dy: number) => {
    if (Math.abs(dx) < 40) return
    // 横向位移要明显大于纵向，避免把上下划当成翻页
    if (Math.abs(dx) < Math.abs(dy) * 1.1) return
    swipedRef.current = true
    stopAll()
    goTo(dx < 0 ? 1 : -1)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    pointerStart.current = { x: t.clientX, y: t.clientY }
    swipedRef.current = false
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = pointerStart.current
    pointerStart.current = null
    if (!s || recOpen) return
    if (panelOpen) {
      setPanelOpen(false)
      return
    }
    const t = e.changedTouches[0]
    if (!t) return
    handleSwipe(t.clientX - s.x, t.clientY - s.y)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    pointerStart.current = { x: e.clientX, y: e.clientY }
    swipedRef.current = false
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const s = pointerStart.current
    pointerStart.current = null
    if (!s || recOpen) return
    if (panelOpen) {
      setPanelOpen(false)
      return
    }
    handleSwipe(e.clientX - s.x, e.clientY - s.y)
  }

  const onPointerCancel = () => {
    pointerStart.current = null
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
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
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
            <div
              className="frame-video-wrap"
              onClick={(e) => {
                e.stopPropagation()
                setPlayingVideo(null)
                setCue('')
              }}
            >
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
                onError={() => {
                  // 播放失败也要退出，否则这一层会一直挡着，后面就滑不动了
                  setPlayingVideo(null)
                  setCue('')
                }}
              />
            </div>
          )}

          {playingVideo && cue && <div className="video-cue">{cue}</div>}
        </>
      )}

      <div className="frame-veil" />

      {/* 右上角气泡：点开看这张照片的讲解和家人留言 */}
      {photos.length > 0 && !recOpen && !playingVideo && (
        <button
          className={`frame-bubble ${panelOpen ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            if (panelOpen) {
              setPanelOpen(false)
            } else {
              stopAll()
              setPanelOpen(true)
            }
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3C6.9 3 2.8 6.4 2.8 10.6c0 2.4 1.4 4.5 3.5 5.9-.2 1.3-.8 2.5-1.6 3.5-.2.3.1.6.4.5 1.8-.4 3.4-1.2 4.6-2.1.9.2 1.9.3 2.9.3 5.1 0 9.2-3.4 9.2-7.6S17.1 3 12 3Z" />
          </svg>
          {unheard > 0 && <span className="bubble-dot" />}
        </button>
      )}

      {/* 右侧信息面板 */}
      {panelOpen && cur && (
        <div className="frame-panel" onClick={(e) => e.stopPropagation()}>
          <button className="panel-close" onClick={() => setPanelOpen(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>

          <div className="panel-title">{cur.caption || '这张照片'}</div>
          <div className="panel-by">
            {cur.from}
            <span className="dot" />
            {new Date(cur.createdAt).toLocaleDateString('zh-CN', {
              month: 'long',
              day: 'numeric',
            })}
          </div>

          {cur.narration?.text && (
            <div className="panel-section">
              <div className="panel-label">它讲到</div>
              <div className="panel-text">{cur.narration.text}</div>
            </div>
          )}

          {!!cur.comments?.length && (
            <div className="panel-section">
              <div className="panel-label">家人留言</div>
              {cur.comments.map((c) => (
                <div
                  key={c.id}
                  className={`panel-voice ${playingId === c.id ? 'on' : ''} ${
                    c.from === 'child' && !c.heard ? 'unheard' : ''
                  }`}
                  onClick={() => playComment(c)}
                >
                  <span className="panel-play">
                    {playingId === c.id ? (
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <rect x="7" y="5" width="3.5" height="14" rx="1" />
                        <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </span>
                  <span className="panel-voice-mid">
                    <b>{c.from === 'parent' ? '爸妈' : '家人'}</b>
                    <em>{fmtDur(c.duration)}</em>
                  </span>
                  {c.from === 'child' && !c.heard && <span className="panel-new">新</span>}
                </div>
              ))}
            </div>
          )}

          {!cur.narration?.text && !cur.comments?.length && (
            <div className="panel-empty">这张还没有讲解，也没有留言</div>
          )}
        </div>
      )}

      {photos.length > 0 && (
        <div className="frame-meta">
          <div>
            {playingVideo ? null : speaking ? (
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
/**
 * 一张照片的呈现：
 *   先把整张照片完整显示（不裁），再缓缓推近，直到刚好铺满屏幕，然后切下一张。
 *   视频不一样——先给封面，点开才播，不推近。
 */
function MediaLayer({ p, top }: { p: Photo; top?: boolean }) {
  const isVid = p.kind === 'video'
  const src = isVid ? (p.cover ? url(p.cover) : null) : url(p.file)
  const boxRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)

  // 铺满屏幕要放大多少倍 = 铺满比例 / 完整显示比例。
  // 每张照片长宽比不同，只能等图片加载完量出来再算。
  const measure = useCallback((img: HTMLImageElement) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box || !img.naturalWidth || !img.naturalHeight) return
    const cover = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight)
    const contain = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight)
    // 多给 1%：算出来的刚好铺满时，边缘会漏一条亚像素的缝
    const k = (cover / contain) * 1.03
    // 上限只是防极端长图（手机截屏那种），正常竖版照片也能真的铺满
    setZoom(Math.min(Math.max(k, 1), 4))
  }, [])

  return (
    <div className="frame-slide show" ref={boxRef} style={top ? { zIndex: 2 } : undefined}>
      {src ? (
        isVid ? (
          <>
            <div className="frame-blur" style={{ backgroundImage: `url(${src})` }} />
            <img className="frame-img contain" src={src} alt="" draggable={false} />
          </>
        ) : (
          <>
            {/* 完整显示时上下/两侧会有空白，用同一张图模糊垫底，比黑边好看 */}
            <div className="frame-blur" style={{ backgroundImage: `url(${src})` }} />
            <img
              key={p.id}
              className="frame-img fit"
              src={src}
              alt=""
              draggable={false}
              ref={(el) => {
                if (el?.complete) measure(el)
              }}
              style={{ '--zoom': zoom } as React.CSSProperties}
              onLoad={(e) => measure(e.currentTarget)}
            />
          </>
        )
      ) : (
        <div className="frame-img" style={{ background: '#1d1814' }} />
      )}
    </div>
  )
}
