import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function run(bin, args, timeout = 30000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok, err) => {
      if (done) return
      done = true
      resolve({ ok, err })
    }
    let child
    try {
      child = spawn(bin, args, { stdio: 'ignore' })
    } catch (e) {
      return finish(false, e.message)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
      finish(false, 'timeout')
    }, timeout)
    child.on('error', (e) => {
      clearTimeout(timer)
      finish(false, e.message)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code === 0, code === 0 ? null : `exit ${code}`)
    })
  })
}

export async function hasFfmpeg() {
  const r = await run('ffmpeg', ['-version'], 8000)
  return r.ok
}

/**
 * 图片：等比缩到最长边 1600，转 jpg。
 * 相框端不需要原图，5MB 的原图存下来既慢又占空间。
 * 失败时保留原始文件，不阻断上传。
 */
export async function processImage(inputPath, outDir) {
  const base = path.basename(inputPath, path.extname(inputPath))
  const out = path.join(outDir, base + '.jpg')
  const r = await run('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', "scale='min(1600,iw)':-2",
    '-q:v', '3',
    out,
  ])
  if (r.ok && fs.existsSync(out)) {
    if (inputPath !== out) {
      try {
        fs.unlinkSync(inputPath)
      } catch {}
    }
    return path.basename(out)
  }
  return path.basename(inputPath)
}

/**
 * 音频：统一转 aac/m4a 16k 单声道。
 * 原因：安卓录出来是 webm/opus，iPhone 播不了；iPhone 录的是 mp4，
 * 统一转 m4a 后两端都能播。16k 单声道对语音足够，体积压到 1/5。
 */
export async function processAudio(inputPath, outDir) {
  const base = path.basename(inputPath, path.extname(inputPath))
  const out = path.join(outDir, base + '.m4a')
  const r = await run('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-c:a', 'aac',
    '-b:a', '64k',
    '-ar', '16000',
    '-ac', '1',
    out,
  ])
  if (r.ok && fs.existsSync(out)) {
    if (inputPath !== out) {
      try {
        fs.unlinkSync(inputPath)
      } catch {}
    }
    return path.basename(out)
  }
  // 没有 ffmpeg 或转码失败：原文件照用，浏览器未必都能播，但至少不丢数据
  return path.basename(inputPath)
}

/* ---------------- 视频 ---------------- */

function probeDuration(file) {
  return new Promise((resolve) => {
    let out = ''
    let child
    try {
      child = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1',
        file,
      ])
    } catch {
      return resolve(0)
    }
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => resolve(0))
    child.on('close', () => resolve(parseFloat(out.trim()) || 0))
  })
}

/**
 * 视频：转成相框播得动的样子，并抽一张封面。
 *
 * 手机随手的视频常见是 4K/60fps、几十兆，安卓相框直接播会卡死。
 * 统一压到 720p / h264 / 2Mbps 左右，加 faststart 让拖动能立刻出画面。
 * 封面取第 1 秒而不是第 0 秒——很多视频第一帧是黑屏或过曝。
 */
export async function processVideo(inputPath, outDir) {
  const base = path.basename(inputPath, path.extname(inputPath))
  const out = path.join(outDir, base + '.mp4')
  const cover = path.join(outDir, base + '_cover.jpg')

  const r = await run(
    'ffmpeg',
    [
      '-y',
      '-i', inputPath,
      '-vf', "scale='min(1280,iw)':-2",
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '26',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      out,
    ],
    180000
  )

  if (!r.ok || !fs.existsSync(out)) {
    // 转码失败就把原文件留下，至少能存
    return { file: path.basename(inputPath), cover: null, duration: 0 }
  }

  try {
    if (inputPath !== out) fs.unlinkSync(inputPath)
  } catch {}

  let coverName = null
  const c = await run('ffmpeg', [
    '-y',
    '-ss', '1',
    '-i', out,
    '-frames:v', '1',
    '-q:v', '3',
    cover,
  ])
  if (c.ok && fs.existsSync(cover)) {
    coverName = path.basename(cover)
  } else {
    // 视频不足 1 秒时退回到第一帧
    const c2 = await run('ffmpeg', ['-y', '-i', out, '-frames:v', '1', '-q:v', '3', cover])
    if (c2.ok && fs.existsSync(cover)) coverName = path.basename(cover)
  }

  return { file: path.basename(out), cover: coverName, duration: await probeDuration(out) }
}
