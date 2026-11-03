import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
export const DATA_DIR = path.join(ROOT, 'data')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
const DB_FILE = path.join(DATA_DIR, 'db.json')

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const EMPTY = { photos: [], comments: [] }

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  } catch {
    return structuredClone(EMPTY)
  }
}

let db = read()

// 原子写：先写临时文件再 rename，避免半截文件导致数据丢失
let writing = false
let dirty = false

function flush() {
  if (writing) {
    dirty = true
    return
  }
  writing = true
  const tmp = DB_FILE + '.tmp'
  try {
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
    fs.renameSync(tmp, DB_FILE)
  } catch (e) {
    console.error('[store] 写入失败', e)
  }
  writing = false
  if (dirty) {
    dirty = false
    flush()
  }
}

export const store = {
  get photos() {
    return db.photos
  },
  get comments() {
    return db.comments
  },

  save() {
    flush()
  },

  addPhoto(p) {
    db.photos.unshift(p)
    flush()
    return p
  },

  getPhoto(id) {
    return db.photos.find((x) => x.id === id) || null
  },

  updatePhoto(id, patch) {
    const p = db.photos.find((x) => x.id === id)
    if (!p) return null
    Object.assign(p, patch)
    flush()
    return p
  },

  removePhoto(id) {
    const idx = db.photos.findIndex((x) => x.id === id)
    if (idx === -1) return null
    const [p] = db.photos.splice(idx, 1)
    db.comments = db.comments.filter((c) => c.photoId !== id)
    flush()
    return p
  },

  addComment(c) {
    db.comments.push(c)
    flush()
    return c
  },

  markHeard(id) {
    const c = db.comments.find((x) => x.id === id)
    if (c) {
      c.heard = true
      flush()
    }
    return c
  },

  // 给相框端用：还没听过的、来自子女的语音
  pendingForParent() {
    return db.comments.filter((c) => c.from === 'child' && !c.heard)
  },

  // 给子女端用：还没听过的、来自父母的评论
  pendingForChild() {
    return db.comments.filter((c) => c.from === 'parent' && !c.heard)
  },
}
