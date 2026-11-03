/**
 * 演示数据：3 张照片 + 4 条语音。
 * 只为把界面填满、方便看效果，正式用的时候直接在子女端传自己的照片即可。
 *   node scripts/seed.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const BASE = process.env.BASE || 'http://localhost:4000'

const photo = async (file, caption, from) => {
  const buf = fs.readFileSync(path.join(ROOT, 'tmp', file))
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: 'image/jpeg' }), file)
  fd.append('caption', caption)
  fd.append('from', from)
  const r = await fetch(`${BASE}/api/photos`, { method: 'POST', body: fd })
  const j = await r.json()
  if (!j.ok) throw new Error(JSON.stringify(j))
  return j.photo.id
}

const voice = async (file, photoId, from) => {
  const buf = fs.readFileSync(path.join(ROOT, 'tmp', file))
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), file)
  if (photoId) fd.append('photoId', photoId)
  fd.append('from', from)
  fd.append('duration', '5')
  const r = await fetch(`${BASE}/api/comments`, { method: 'POST', body: fd })
  const j = await r.json()
  if (!j.ok) throw new Error(JSON.stringify(j))
  return j.comment.id
}

const main = async () => {
  const a = await photo('s1.jpg', '上周包的饺子，你包的那个最好看', '小彬')
  const b = await photo('s2.jpg', '楼下玉兰开了，今年开得早', '姐姐')
  const c = await photo('s3.jpg', '小满今天自己走了三步', '小彬')

  await voice('v1.wav', a, 'parent')
  await voice('v2.wav', b, 'parent')
  await voice('v3.wav', a, 'child')
  await voice('v4.wav', c, 'parent')

  console.log('已写入：3 张照片 / 4 条语音')
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
