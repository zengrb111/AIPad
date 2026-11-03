/**
 * 生成安装图标，两套：
 *   相框端（frame）—— 深褐底 + 米白框 + 赭色山，装上平板的那个
 *   子女端（family）—— 赭色底 + 米白框 + 深褐山，装子女手机的那个
 *
 * 用 CDP 把 SVG 渲染成 PNG（ffmpeg 解不了 SVG），再缩放成各种尺寸。
 *
 *   node scripts/make-icons.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUB = path.join(ROOT, 'public')
const TMP = path.join(ROOT, 'tmp')
const ANDROID = path.join(ROOT, 'android', 'app', 'src')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const FRAME = { bg: '#241c17', line: '#efe2d2', hill: '#c07a4f' }
const FAMILY = { bg: '#b4653a', line: '#fdf6ec', hill: '#3d2a1f' }

const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }

/** pad: 0 = 普通图标；0.18 = maskable（系统会裁成圆形，内容要缩进安全区） */
function svg(size, pad, c) {
  const inset = Math.round(size * pad)
  const box = size - inset * 2
  const s = box / 512
  const tx = inset
  const r = pad ? 0 : Math.round(size * 0.22)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${c.bg}"/>
  <g transform="translate(${tx},${tx}) scale(${s})">
    <rect x="118" y="150" width="276" height="212" rx="20" fill="none" stroke="${c.line}" stroke-width="17"/>
    <circle cx="204" cy="216" r="21" fill="${c.line}" opacity="0.62"/>
    <path d="M136 330 L216 252 L264 300 L300 264 L376 338"
          fill="none" stroke="${c.hill}" stroke-width="19"
          stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`
}

async function render(outFile, size, pad, colors) {
  const htmlFile = path.join(TMP, `_icon_${size}_${pad}_${Date.now()}.html`)
  fs.writeFileSync(
    htmlFile,
    `<!doctype html><html><body style="margin:0;padding:0;background:transparent">${svg(size, pad, colors)}</body></html>`
  )

  const PORT = 9800 + Math.floor(Math.random() * 180)
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${process.env.TEMP}/cdp-icon-${Date.now()}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  )

  let ws
  try {
    let list = []
    for (let i = 0; i < 60; i++) {
      try {
        list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
        if (list.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break
      } catch {}
      await sleep(150)
    }
    const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (!target) {
      console.error('找不到调试目标')
      return
    }
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = () => rej(new Error('ws fail'))
    })

    let id = 0
    const pending = new Map()
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m)
        pending.delete(m.id)
      }
    }
    const send = (method, params = {}) =>
      new Promise((res) => {
        const i = ++id
        pending.set(i, res)
        ws.send(JSON.stringify({ id: i, method, params }))
      })

    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: size,
      height: size,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await send('Page.navigate', { url: 'file:///' + htmlFile.replace(/\\/g, '/') })
    await sleep(600)

    const shot = await send('Page.captureScreenshot', { format: 'png', omitBackground: true })
    fs.writeFileSync(outFile, Buffer.from(shot.result.data, 'base64'))
  } finally {
    try {
      ws?.close()
    } catch {}
    proc.kill()
    try {
      fs.unlinkSync(htmlFile)
    } catch {}
  }
}

function resize(src, dest, size) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const p = spawn(
      'ffmpeg',
      ['-y', '-i', src, '-vf', `scale=${size}:${size}:flags=lanczos`, dest],
      { stdio: 'ignore' }
    )
    p.on('close', resolve)
  })
}

/* ---------------- 相框端（Web / 主图标） ---------------- */

async function buildFrameIcons() {
  fs.mkdirSync(PUB, { recursive: true })
  const big = path.join(TMP, 'icon-512-src.png')
  await render(big, 512, 0, FRAME)

  fs.copyFileSync(big, path.join(PUB, 'icon-512.png'))
  await resize(big, path.join(PUB, 'icon-192.png'), 192)
  await resize(big, path.join(PUB, 'icon-180.png'), 180)
  await resize(big, path.join(PUB, 'favicon.png'), 64)
  await render(path.join(PUB, 'icon-maskable-512.png'), 512, 0.18, FRAME)

  // 给 @capacitor/assets 用的源图
  fs.mkdirSync(path.join(ROOT, 'resources'), { recursive: true })
  await resize(big, path.join(ROOT, 'resources', 'icon-only.png'), 1024)

  console.log('相框端图标 → public/')
}

/* ---------------- 子女端（Android flavor） ---------------- */

async function buildFamilyIcons() {
  const res = path.join(ANDROID, 'family', 'res')
  const src = path.join(TMP, 'icon-family-1024.png')
  await render(src, 1024, 0, FAMILY)

  for (const [d, size] of Object.entries(DENSITIES)) {
    await resize(src, path.join(res, `mipmap-${d}`, 'ic_launcher.png'), size)
    await resize(src, path.join(res, `mipmap-${d}`, 'ic_launcher_round.png'), size)
  }

  console.log('子女端图标 → android/app/src/family/res/')
}

const main = async () => {
  await buildFrameIcons()
  await buildFamilyIcons()

  console.log('\npublic/:')
  for (const f of fs.readdirSync(PUB).filter((f) => f.endsWith('.png'))) {
    const b = fs.readFileSync(path.join(PUB, f))
    console.log(' ', f, `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
