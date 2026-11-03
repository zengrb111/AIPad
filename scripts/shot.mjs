/**
 * 精确截图。Chrome headless 在 Windows 上会忽略 --window-size
 * （实测视口恒为 526x744），所以必须走 CDP 的 Emulation 覆盖视口。
 *
 *   node scripts/shot.mjs <url> <w> <h> <out.png> [dsf] [mobile]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const [, , URL, W, H, OUT, DSF = '2', MOBILE = '1'] = process.argv
if (!OUT) {
  console.error('用法: node scripts/shot.mjs <url> <w> <h> <out.png> [dsf] [mobile]')
  process.exit(1)
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9500 + Math.floor(Math.random() * 400)

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}/cdp-shot-${Date.now()}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
)

let ws
try {
  let list
  for (let i = 0; i < 60; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      if (list.some((t) => t.type === 'page')) break
    } catch {}
    await sleep(200)
  }
  const page = list.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
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
    width: Number(W),
    height: Number(H),
    deviceScaleFactor: Number(DSF),
    mobile: MOBILE === '1',
  })
  await send('Page.navigate', { url: URL })
  await sleep(1800)

  // 相框端有个"轻触屏幕"的解锁页（浏览器要求先有交互才允许出声），截图前替用户点一下
  await send('Runtime.evaluate', {
    expression: "document.querySelector('.frame-gate')?.click()",
  })
  await sleep(2400)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (!shot.result?.data) {
    console.error('截图失败', JSON.stringify(shot).slice(0, 300))
    process.exit(1)
  }
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
  const b = fs.readFileSync(OUT)
  console.log(`${OUT}  ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`)
} finally {
  try {
    ws?.close()
  } catch {}
  proc.kill()
}
