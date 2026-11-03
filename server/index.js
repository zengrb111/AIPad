import express from 'express'
import multer from 'multer'
import https from 'node:https'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { store, UPLOAD_DIR, ROOT } from './store.js'
import { processImage, processVideo, processAudio, hasFfmpeg } from './media.js'
import { narratePhoto, aiEnabled, ttsEnabled, fallbackText as photoFallback } from './ai.js'
import { transcribeVideo, asrEnabled, warmUp } from './asr.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 4000

const app = express()

// 打包成 App 后页面是本地的（capacitor://localhost），取数据是跨域请求，
// 没这几个头就会被浏览器拦掉。
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Max-Age', '86400')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json({ limit: '1mb' }))

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 300 * 1024 * 1024 },
})

const id = () => crypto.randomUUID()
const num = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

/* ---------------- 照片 ---------------- */

app.get('/api/photos', (req, res) => {
  const list = store.photos.map((p) => ({
    ...p,
    comments: store.comments
      .filter((c) => c.photoId === p.id)
      .sort((a, b) => a.createdAt - b.createdAt),
  }))
  res.json({ photos: list })
})

app.post('/api/photos', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '没有收到文件' })

    const isVideo = (req.file.mimetype || '').startsWith('video/')
    let file
    let cover = null
    let duration = 0

    if (isVideo) {
      // 视频要转码，会比图片慢很多，前端显示"上传中"顶着
      const v = await processVideo(req.file.path, UPLOAD_DIR)
      file = v.file
      cover = v.cover
      duration = v.duration
    } else {
      file = await processImage(req.file.path, UPLOAD_DIR)
    }

    const photo = {
      id: id(),
      kind: isVideo ? 'video' : 'image',
      file,
      cover,
      duration,
      caption: (req.body.caption || '').slice(0, 200),
      from: (req.body.from || '家人').slice(0, 20),
      takenAt: num(req.body.takenAt, Date.now()),
      createdAt: Date.now(),
      narration: aiEnabled
        ? { status: 'pending', text: '', audio: null }
        : { status: 'fallback', text: photoFallback(req.body.caption, req.body.from), audio: null },
      transcript: isVideo ? { status: 'pending', text: '', chunks: [] } : undefined,
    }
    store.addPhoto(photo)

    // 视频再跑一遍语音识别，出字幕。慢（要解音频+过模型），放后台。
    if (isVideo && asrEnabled) {
      transcribeVideo(path.join(UPLOAD_DIR, file))
        .then((t) => store.updatePhoto(photo.id, { transcript: t }))
        .catch((e) => {
          console.error('[asr]', e)
          store.updatePhoto(photo.id, {
            transcript: { status: 'error', text: '', chunks: [], note: e.message },
          })
        })
    }

    // 解说在后台生成，不挡住上传响应：模型看一张图要几秒
    if (aiEnabled) {
      narratePhoto(photo)
        .then((r) => store.updatePhoto(photo.id, { narration: r }))
        .catch((e) => {
          console.error('[ai]', e)
          store.updatePhoto(photo.id, {
            narration: { status: 'error', text: '', audio: null, error: e.message },
          })
        })
    }

    res.json({ ok: true, photo })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// 重新生成解说（改过文案、或第一次生成失败时用）
app.post('/api/photos/:id/narrate', async (req, res) => {
  const photo = store.getPhoto(req.params.id)
  if (!photo) return res.status(404).json({ error: '照片不存在' })

  store.updatePhoto(photo.id, {
    narration: { status: 'pending', text: photo.narration?.text || '', audio: photo.narration?.audio || null },
  })

  try {
    const r = await narratePhoto(photo)
    store.updatePhoto(photo.id, { narration: r })
    res.json({ ok: true, narration: r })
  } catch (e) {
    const r = { status: 'error', text: '', audio: null, error: e.message }
    store.updatePhoto(photo.id, { narration: r })
    res.status(500).json({ error: e.message, narration: r })
  }
})

app.delete('/api/photos/:id', (req, res) => {
  const p = store.removePhoto(req.params.id)
  if (p) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, p.file))
    } catch {}
  }
  res.json({ ok: true })
})

/* ---------------- 语音 ---------------- */

app.post('/api/comments', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '没有收到录音' })

    const from = req.body.from === 'child' ? 'child' : 'parent'
    const audio = await processAudio(req.file.path, UPLOAD_DIR)

    const comment = {
      id: id(),
      photoId: req.body.photoId || null,
      from,
      audio,
      duration: num(req.body.duration, 0),
      createdAt: Date.now(),
      heard: false,
    }
    store.addComment(comment)
    res.json({ ok: true, comment })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/comments/:id/heard', (req, res) => {
  store.markHeard(req.params.id)
  res.json({ ok: true })
})

// 重新识别视频字幕（识别失败、或想再试一次时用）
app.post('/api/photos/:id/transcribe', async (req, res) => {
  const photo = store.getPhoto(req.params.id)
  if (!photo) return res.status(404).json({ error: '照片不存在' })
  if (photo.kind !== 'video') return res.status(400).json({ error: '这条不是视频' })

  store.updatePhoto(photo.id, { transcript: { status: 'pending', text: '', chunks: [] } })
  try {
    const t = await transcribeVideo(path.join(UPLOAD_DIR, photo.file))
    store.updatePhoto(photo.id, { transcript: t })
    res.json({ ok: true, transcript: t })
  } catch (e) {
    const t = { status: 'error', text: '', chunks: [], note: e.message }
    store.updatePhoto(photo.id, { transcript: t })
    res.status(500).json({ error: e.message, transcript: t })
  }
})

/* ---------------- 同步（相框轮询用） ---------------- */

app.get('/api/sync', (req, res) => {
  const since = num(req.query.since, 0)
  const role = req.query.role === 'child' ? 'child' : 'parent'

  const pending = role === 'child' ? store.pendingForChild() : store.pendingForParent()

  res.json({
    serverTime: Date.now(),
    photoCount: store.photos.length,
    latestPhotoAt: store.photos[0]?.createdAt || 0,
    newPhotos: store.photos.filter((p) => p.createdAt > since).length,
    pendingAudio: pending.map((c) => ({
      id: c.id,
      audio: c.audio,
      photoId: c.photoId,
      duration: c.duration,
      createdAt: c.createdAt,
    })),
  })
})

/* ---------------- 静态资源 ---------------- */

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }))

const dist = path.join(ROOT, 'dist')
app.use(express.static(dist))

app.get(/^\/(?!api|uploads).*/, (req, res) => {
  const index = path.join(dist, 'index.html')
  if (fs.existsSync(index)) return res.sendFile(index)
  res
    .status(503)
    .send('前端还没构建。开发模式请访问 Vite 端口（默认 5173），或先执行 npm run build。')
})

/* ---------------- 启动 ---------------- */

function lanIP() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address
    }
  }
  return 'localhost'
}

const certFile = path.join(ROOT, 'certs', 'cert.pem')
const keyFile = path.join(ROOT, 'certs', 'key.pem')
const useHttps = fs.existsSync(certFile) && fs.existsSync(keyFile)
const proto = useHttps ? 'https' : 'http'

const server = useHttps
  ? https.createServer(
      { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) },
      app
    )
  : app

server.listen(PORT, '0.0.0.0', async () => {
  const ip = lanIP()
  const ff = await hasFfmpeg()
  console.log('')
  console.log('  AI 相框已启动')
  console.log('  ' + '─'.repeat(50))
  console.log(`  子女端   ${proto}://${ip}:${PORT}/family   ← 手机上打开这个`)
  console.log(`  相框端   ${proto}://${ip}:${PORT}/frame    ← 相框上打开这个`)
  console.log('  ' + '─'.repeat(50))
  console.log(`  音视频      ${ff ? 'ffmpeg 可用（自动压缩转码）' : '未检测到 ffmpeg（原文件直存）'}`)
  console.log(`  AI 解说     ${aiEnabled ? `已开启（${process.env.AI_MODEL || 'gpt-4o-mini'}）` : '未配置，用子女留的话代替'}`)
  console.log(`  语音合成    ${ttsEnabled ? '本地合成（msedge-tts）' : '未开启'}`)
  console.log(`  视频字幕    ${asrEnabled ? `本地识别（${process.env.ASR_MODEL || 'whisper-base'}）` : '已关闭'}`)
  console.log(`  访问协议    ${useHttps ? 'https（自签证书，录音可用）' : 'http（本机 localhost 可录音，其他设备不行）'}`)
  if (!useHttps) {
    console.log('  提示        要在手机/相框上录音，先执行 npm run cert 生成证书再重启')
  }
  console.log(`  数据目录    ${path.join(ROOT, 'data')}`)
  console.log('')

  // 识别模型改成懒加载：第一次传视频才拉起，省内存。
  // 小内存机器（2G/4G 云主机）常驻一个 whisper 会把可用内存吃光。
  if (process.env.ASR_WARMUP === '1') warmUp()
})
