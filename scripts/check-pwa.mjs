/**
 * 检查 PWA 能不能被安装。Chrome 的判定很严格，manifest 有一个字段不合格就装不上。
 *   node scripts/check-pwa.mjs [url]
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.argv[2] || 'http://localhost:4000/frame'
const PORT = 9700 + Math.floor(Math.random() * 150)

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}/cdp-pwa-${Date.now()}`,
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
  await send('Page.navigate', { url: URL })
  await sleep(2500)

  const man = await send('Page.getAppManifest')
  const r = man.result || {}
  console.log('manifest 地址：', r.url || '(未找到)')
  const errs = (r.errors || []).map((e) => `${e.critical ? '[严重]' : '[提示]'} ${e.message}`)
  console.log('manifest 问题：', errs.length ? '\n  ' + errs.join('\n  ') : '无')

  if (r.parsed) {
    const p = r.parsed
    console.log('  名称:', p.name, '| start_url:', p.start_url, '| display:', p.display)
    console.log('  图标数:', (p.icons || []).length)
  }

  const inst = await send('Page.getInstallabilityErrors')
  const ie = inst.result?.installabilityErrors || []
  console.log('可安装性：', ie.length ? '\n  ' + ie.map((x) => x.errorId).join('\n  ') : '通过，可以安装')
} finally {
  try {
    ws?.close()
  } catch {}
  proc.kill()
}
