import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api, url, relTime, clock, fmtDur, fmtClock, type Comment, type Photo } from '../lib/api'
import { isNativeApp } from '../lib/server'
import { useRecorder } from '../lib/recorder'

/* ---------------- 一条语音 ---------------- */

const BAR_COUNT = 22

function VoiceBubble({
  c,
  onChanged,
}: {
  c: Comment
  onChanged: () => void
}) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const aRef = useRef<HTMLAudioElement | null>(null)
  const [unheard, setUnheard] = useState(!c.heard && c.from === 'parent')

  const toggle = () => {
    if (playing) {
      aRef.current?.pause()
      aRef.current = null
      setPlaying(false)
      setProgress(0)
      return
    }

    const a = new Audio(url(c.audio))
    aRef.current = a
    setPlaying(true)

    a.ontimeupdate = () => {
      if (a.duration && Number.isFinite(a.duration)) setProgress(a.currentTime / a.duration)
    }
    a.onended = () => {
      setPlaying(false)
      setProgress(0)
    }
    a.onerror = () => {
      setPlaying(false)
      setProgress(0)
    }

    a.play().catch(() => setPlaying(false))

    if (unheard) {
      setUnheard(false)
      api.markHeard(c.id).then(onChanged).catch(() => {})
    }
  }

  useEffect(() => {
    return () => {
      aRef.current?.pause()
    }
  }, [])

  const lit = Math.round(progress * BAR_COUNT)

  return (
    <div className={`voice ${unheard ? 'unheard' : ''}`} onClick={toggle}>
      <div className={`voice-play ${playing ? 'playing' : ''}`}>
        {playing ? (
          <svg viewBox="0 0 24 24">
            <rect x="7" y="5" width="3.5" height="14" rx="1" />
            <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </div>

      <div className="voice-mid">
        <div className="voice-bars">
          {Array.from({ length: BAR_COUNT }).map((_, i) => (
            <i
              key={i}
              className={i < lit ? 'lit' : ''}
              style={{
                height: 5 + Math.abs(Math.sin(i * 1.31 + c.id.charCodeAt(0))) * 12,
              }}
            />
          ))}
        </div>
        <div className="voice-info">
          <span className="voice-who">
            {c.from === 'parent' ? '爸妈' : '我'}
          </span>
          <span className="dot" />
          <span>{fmtDur(c.duration)}</span>
          <span className="dot" />
          <span>{clock(c.createdAt)}</span>
          {unheard && <span className="badge-new">新</span>}
        </div>
      </div>
    </div>
  )
}

/* ---------------- AI 解说 ---------------- */

function NarrationBlock({
  photo,
  regenId,
  onRegen,
  onChanged,
}: {
  photo: Photo
  regenId: string | null
  onRegen: (id: string) => void
  onChanged: () => void
}) {
  const n = photo.narration!
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const aRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      aRef.current?.pause()
      try {
        window.speechSynthesis?.cancel()
      } catch {}
    }
  }, [])

  const stop = () => {
    aRef.current?.pause()
    aRef.current = null
    try {
      window.speechSynthesis?.cancel()
    } catch {}
    setPlaying(false)
    setProgress(0)
  }

  const toggle = () => {
    if (playing) {
      stop()
      return
    }
    if (!n.text) return

    // 有合成好的语音就播文件，没有就用浏览器朗读兜底
    if (n.audio) {
      const a = new Audio(url(n.audio))
      aRef.current = a
      setPlaying(true)
      a.ontimeupdate = () => {
        if (a.duration && Number.isFinite(a.duration)) setProgress(a.currentTime / a.duration)
      }
      a.onended = () => {
        setPlaying(false)
        setProgress(0)
      }
      a.onerror = () => {
        setPlaying(false)
        setProgress(0)
      }
      a.play().catch(() => {
        setPlaying(false)
        setProgress(0)
      })
      return
    }

    try {
      const voices = window.speechSynthesis?.getVoices?.() || []
      const zh = voices.find((v) => v.lang?.toLowerCase().startsWith('zh'))
      if (!zh) return
      const u = new SpeechSynthesisUtterance(n.text)
      u.lang = 'zh-CN'
      u.voice = zh
      u.rate = 0.92
      u.onend = () => setPlaying(false)
      u.onerror = () => setPlaying(false)
      setPlaying(true)
      window.speechSynthesis.speak(u)
    } catch {}
  }

  // 正在生成
  if (n.status === 'pending' || regenId === photo.id) {
    return (
      <div className="narr">
        <div className="narr-hint">
          <span className="blink" />
          正在看懂这张照片，相框稍后会讲
        </div>
      </div>
    )
  }

  if (n.status === 'error') {
    return (
      <div className="narr">
        <div className="narr-err">解说没生成成功：{n.error || '未知错误'}</div>
        <div className="narr-foot">
          <button className="link-btn" onClick={() => onRegen(photo.id)} disabled={regenId === photo.id}>
            重新试试
          </button>
        </div>
      </div>
    )
  }

  if (n.status === 'fallback') {
    return (
      <div className="narr">
        <div className="narr-hint">
          {n.note || '未配置 AI，相框只会读出你留的那句话'}
        </div>
      </div>
    )
  }

  const canPlay = Boolean(n.text)

  return (
    <div className="narr">
      <div className="narr-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" />
        </svg>
        <span>{n.mode === 'text' ? '相框会这样讲（只按你写的话）' : '相框会这样讲给爸妈听'}</span>
        {canPlay && (
          <button className={`narr-listen ${playing ? 'on' : ''}`} onClick={toggle}>
            {playing ? (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="7" y="5" width="3.5" height="14" rx="1" />
                <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
            {playing ? '暂停' : '听一遍'}
          </button>
        )}
      </div>

      <div
        className={`narr-text ${canPlay ? 'clickable' : ''} ${playing ? 'playing' : ''}`}
        onClick={canPlay ? toggle : undefined}
      >
        {n.text}
      </div>

      {playing && (
        <div className="narr-progress">
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      <div className="narr-foot">
        <button className="link-btn" onClick={() => onRegen(photo.id)} disabled={regenId === photo.id}>
          {regenId === photo.id ? '生成中…' : '换个说法'}
        </button>
        {n.audio && <span className="ok-tag">已合成语音</span>}
      </div>
    </div>
  )
}

/* ---------------- 录音弹层 ---------------- */

function RecordSheet({
  title,
  lead,
  photoId,
  onClose,
  onDone,
}: {
  title: string
  lead: string
  photoId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const rec = useRecorder()
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  const tap = async () => {
    setErr('')
    if (rec.state === 'recording') {
      setSending(true)
      const r = await rec.stop()
      if (r) {
        try {
          await api.uploadComment(r.blob, photoId, 'child', r.duration)
          onDone()
        } catch (e: any) {
          setErr(e.message || '发送失败')
        }
      }
      setSending(false)
    } else {
      const ok = await rec.start()
      if (!ok) setErr('没有拿到麦克风权限，请检查浏览器设置')
    }
  }

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet mic-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="lead">{lead}</p>

        <button
          className={`mic-orb ${rec.state === 'recording' ? 'recording' : ''}`}
          onClick={tap}
          disabled={sending}
        >
          {rec.state === 'recording' ? (
            <span className="stop" />
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
              <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11Z" />
            </svg>
          )}
        </button>

        <div className="mic-level">
          {Array.from({ length: 19 }).map((_, i) => (
            <i
              key={i}
              style={{
                height:
                  rec.state === 'recording'
                    ? 4 + Math.abs(Math.sin(i * 1.9 + rec.elapsed)) * 22 * rec.level + rec.level * 10
                    : 4,
              }}
            />
          ))}
        </div>

        <div className="mic-time">
          {sending ? '发送中…' : `${Math.floor(rec.elapsed / 60)}:${String(rec.elapsed % 60).padStart(2, '0')}`}
        </div>

        {err && <div className="error-note">{err}</div>}

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- 主界面 ---------------- */

export default function FamilyApp() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState<File | null>(null)
  const [pendingIsVideo, setPendingIsVideo] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [from, setFrom] = useState(() => localStorage.getItem('af_from') || '')
  const [uploading, setUploading] = useState(false)
  const [recTarget, setRecTarget] = useState<{ id: string | null; title: string; lead: string } | null>(
    null
  )
  const [toast, setToast] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const { photos: list } = await api.photos()
      setPhotos(list)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [load])

  const flash = (m: string) => {
    setToast(m)
    window.setTimeout(() => setToast(''), 2600)
  }

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setPending(f)
    setPendingIsVideo(f.type.startsWith('video/'))
    setPreviewUrl(URL.createObjectURL(f))
    setCaption('')
  }

  const submitPhoto = async () => {
    if (!pending) return
    setUploading(true)
    try {
      const name = from.trim() || '家人'
      localStorage.setItem('af_from', name)
      await api.uploadPhoto(pending, caption.trim(), name)
      setPending(null)
      setPreviewUrl('')
      await load()
      flash('传过去了，相框正在看懂这张照片')
    } catch (e: any) {
      flash(e.message || '上传失败')
    }
    setUploading(false)
  }

  const commentCount = photos.reduce(
    (n, p) => n + (p.comments?.filter((c) => c.from === 'parent' && !c.heard).length || 0),
    0
  )

  const [regenId, setRegenId] = useState<string | null>(null)

  const regen = async (id: string) => {
    setRegenId(id)
    try {
      await api.narrate(id)
      await load()
      flash('重新讲好了')
    } catch (e: any) {
      flash(e.message || '生成失败')
      await load()
    }
    setRegenId(null)
  }

  if (!loaded) return <div className="loading">正在加载…</div>

  return (
    <div className="fam">
      <div className="fam-head">
        <div className="fam-head-in">
          <div>
            <div className="fam-title">爸妈的相框</div>
            <div className="fam-sub">
              {photos.length} 张照片
              {commentCount > 0 && ` · ${commentCount} 条新留言`}
            </div>
          </div>
          {isNativeApp() ? (
            <button
              className="fam-link"
              onClick={() => {
                // 地址填错了得能改回来：打个标记刷新，App 会打开设置页
                try {
                  localStorage.setItem('af_force_setup', '1')
                } catch {}
                location.reload()
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3.2" />
                <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
              </svg>
              服务器
            </button>
          ) : (
            <a className="fam-link" href="/frame" target="_blank" rel="noreferrer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 15l5-5 4 4 3-3 6 6" />
              </svg>
              看相框
            </a>
          )}
        </div>
      </div>

      <div className="fam-body">
        {/* 用 label 包住 input：点击是浏览器原生行为，
            在安卓 WebView 里也一定生效（程序触发 display:none 的 input 可能被拦） */}
        <label className="uploader">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*"
            className="uploader-file"
            onChange={pickFile}
          />
          <div className="plus">+</div>
          <strong>传一张照片或一段视频</strong>
          <span>传上去几秒后，相框就会开始播放</span>
        </label>

        {photos.length === 0 && (
          <div className="empty">
            <h3>还没有照片</h3>
            <p>
              先传一张。爸妈那边的相框会自动全屏播放，
              <br />
              他们点一下屏幕就能说句话回给你。
            </p>
          </div>
        )}

        {photos.map((p) => (
          <div className="card" key={p.id}>
            <div
              className="card-img"
              onClick={() => p.kind === 'video' && setVideoSrc(url(p.file))}
              style={p.kind === 'video' ? { cursor: 'pointer' } : undefined}
            >
              <img src={url(p.kind === 'video' ? p.cover || p.file : p.file)} alt="" />
              {p.kind === 'video' && (
                <div className="card-play">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {fmtClock(p.duration)}
                </div>
              )}
              {p.comments?.some((c) => c.from === 'parent' && !c.heard) && (
                <div className="card-badge">爸妈说话了</div>
              )}
            </div>
            <div className="card-body">
              {p.caption && <div className="card-cap">{p.caption}</div>}
              <div className="card-meta">
                <span>{p.from}</span>
                <span className="dot" />
                <span>{relTime(p.createdAt)}</span>
              </div>

              {p.narration && (
                <NarrationBlock
                  photo={p}
                  regenId={regenId}
                  onRegen={regen}
                  onChanged={load}
                />
              )}

              {!!p.comments?.length && (
                <div className="voices">
                  {p.comments.map((c) => (
                    <VoiceBubble key={c.id} c={c} onChanged={load} />
                  ))}
                </div>
              )}

              {p.kind === 'video' && p.transcript && (
                <div className="narr">
                  {p.transcript.status === 'pending' ? (
                    <div className="narr-hint">
                      <span className="blink" />
                      正在听视频里的人说话
                    </div>
                  ) : p.transcript.status === 'done' ? (
                    <>
                      <div className="narr-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M4 4h16v2H4V4Zm0 6h16v2H4v-2Zm0 6h10v2H4v-2Z" />
                        </svg>
                        视频字幕（{p.transcript.chunks.length} 段）
                      </div>
                      <div className="narr-text">
                        {p.transcript.chunks.map((c) => c.text).join(' / ')}
                      </div>
                    </>
                  ) : p.transcript.status === 'empty' ? (
                    <div className="narr-hint">视频里没有说话声</div>
                  ) : p.transcript.status === 'poor' ? (
                    <div className="narr-hint">
                      {p.transcript.note || '这段声音不像正常说话，没生成字幕'}
                    </div>
                  ) : (
                    <div className="narr-hint">字幕没生成成功</div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 13 }}>
                <button
                  className="btn ghost"
                  style={{ height: 40, fontSize: 14 }}
                  onClick={() =>
                    setRecTarget({
                      id: p.id,
                      title: '就这张照片说两句',
                      lead: '爸妈下次看到这张照片时，会听到你说的这段话。',
                    })
                  }
                >
                  语音回复这张
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="fam-bar">
        <div className="fam-bar-in">
          <button
            className="btn"
            onClick={() =>
              setRecTarget({
                id: null,
                title: '给爸妈留句话',
                lead: '不用非得配照片，相框会把这句留言放给他们听。',
              })
            }
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
              <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11Z" />
            </svg>
            给爸妈留句话
          </button>
        </div>
      </div>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 96,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '11px 22px',
            borderRadius: 999,
            background: 'rgba(43,37,33,.9)',
            color: '#fff',
            fontSize: 13.5,
            zIndex: 60,
            whiteSpace: 'nowrap',
          }}
        >
          {toast}
        </div>
      )}

      {pending && (
        <div className="sheet-mask" onClick={() => !uploading && setPending(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>要传这张？</h3>
            <p className="lead">加一句话，爸妈看到时会一起看到。视频会自动截一张封面。</p>
            {pendingIsVideo ? (
              <video className="preview-img" src={previewUrl} controls playsInline />
            ) : (
              <img className="preview-img" src={previewUrl} alt="" />
            )}

            <div className="field">
              <label>想说的话（可以不写）</label>
              <textarea
                rows={2}
                placeholder="不写也行，相框会自己看懂这张照片讲给爸妈听"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="field">
              <label>谁传的</label>
              <input
                placeholder="小彬"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                maxLength={20}
              />
            </div>

            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setPending(null)} disabled={uploading}>
                取消
              </button>
              <button className="btn" onClick={submitPhoto} disabled={uploading}>
                {uploading ? (pendingIsVideo ? '正在处理视频…' : '正在传…') : '传到相框'}
              </button>
            </div>
          </div>
        </div>
      )}

      {videoSrc && (
        <div className="video-mask" onClick={() => setVideoSrc(null)}>
          <video
            src={videoSrc}
            controls
            autoPlay
            playsInline
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {recTarget && (
        <RecordSheet
          title={recTarget.title}
          lead={recTarget.lead}
          photoId={recTarget.id}
          onClose={() => setRecTarget(null)}
          onDone={() => {
            setRecTarget(null)
            load()
            flash('已经发过去了')
          }}
        />
      )}
    </div>
  )
}
