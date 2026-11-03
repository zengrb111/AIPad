import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333 + Math.floor(Math.random() * 200)
const URL = process.argv[2] || 'http://localhost:4000/family'
const W = process.argv[3] || '390'
const H = process.argv[4] || '844'

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--window-size=${W},${H}`,
    `--user-data-dir=${process.env.TEMP}/cdp-${Date.now()}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
)

const EXPR = `JSON.stringify((()=>{
  const g=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.width),Math.round(r.right)]};
  return {
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth,
    root: g('#root'),
    fam: g('.fam'),
    headIn: g('.fam-head-in'),
    link: g('.fam-link'),
    famBody: g('.fam-body'),
    uploader: g('.uploader'),
    card: g('.card'),
    barIn: g('.fam-bar-in')
  };
})())`

let ws
try {
  let list
  for (let i = 0; i < 50; i++) {
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
  await send('Page.navigate', { url: URL })
  await sleep(3000)
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true })
  const val = r.result?.result?.value
  if (!val) {
    console.log(JSON.stringify(r, null, 2).slice(0, 800))
  } else {
    const j = JSON.parse(val)
    for (const [k, v] of Object.entries(j)) {
      console.log(k.padEnd(12), Array.isArray(v) ? `x=${v[0]} w=${v[1]} right=${v[2]}` : v)
    }
  }
} finally {
  try {
    ws?.close()
  } catch {}
  proc.kill()
}
