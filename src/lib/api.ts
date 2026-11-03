import { abs } from './server'

export type Comment = {
  id: string
  photoId: string | null
  from: 'parent' | 'child'
  audio: string
  duration: number
  createdAt: number
  heard: boolean
}

export type Narration = {
  status: 'pending' | 'done' | 'fallback' | 'error'
  text: string
  audio: string | null
  error?: string
  note?: string
  /** vision = 模型看了图；text = 只看懂文字（纯文本模型兜底） */
  mode?: 'vision' | 'text'
}

export type Cue = { start: number; end: number; text: string }

export type Transcript = {
  status: 'pending' | 'done' | 'poor' | 'empty' | 'error' | 'off'
  text: string
  chunks: Cue[]
  note?: string
}

export type Photo = {
  id: string
  kind?: 'image' | 'video'
  file: string
  cover?: string | null
  duration?: number
  caption: string
  from: string
  takenAt: number
  createdAt: number
  narration?: Narration
  transcript?: Transcript
  comments?: Comment[]
}

const j = async (r: Response) => {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `请求失败 ${r.status}`)
  return r.json()
}

/** 媒体文件地址。App 里会拼上服务器前缀 */
export const url = (file: string) => abs(`/uploads/${file}`)

export const api = {
  photos: (): Promise<{ photos: Photo[] }> => fetch(abs('/api/photos')).then(j),

  uploadPhoto: (file: File, caption: string, from: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('caption', caption)
    fd.append('from', from)
    return fetch(abs('/api/photos'), { method: 'POST', body: fd }).then(j)
  },

  deletePhoto: (id: string) => fetch(abs(`/api/photos/${id}`), { method: 'DELETE' }).then(j),

  narrate: (id: string) => fetch(abs(`/api/photos/${id}/narrate`), { method: 'POST' }).then(j),

  transcribe: (id: string) =>
    fetch(abs(`/api/photos/${id}/transcribe`), { method: 'POST' }).then(j),

  uploadComment: (blob: Blob, photoId: string | null, from: 'parent' | 'child', duration: number) => {
    const fd = new FormData()
    const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
    fd.append('file', blob, `voice.${ext}`)
    if (photoId) fd.append('photoId', photoId)
    fd.append('from', from)
    fd.append('duration', String(duration))
    return fetch(abs('/api/comments'), { method: 'POST', body: fd }).then(j)
  },

  markHeard: (id: string) => fetch(abs(`/api/comments/${id}/heard`), { method: 'POST' }).then(j),

  sync: (role: 'parent' | 'child', since: number) =>
    fetch(abs(`/api/sync?role=${role}&since=${since}`)).then(j),
}

/* ---------- 时间显示 ---------- */

export function relTime(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000)
  if (d < 60) return '刚刚'
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

export function clock(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function fmtDur(sec: number) {
  if (!sec || sec < 1) return '1 秒'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m ? `${m} 分 ${s} 秒` : `${s} 秒`
}

/** 视频角标用：12.5 → 0:12 */
export function fmtClock(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return '视频'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
