/**
 * 服务器地址。
 *
 * 装成 App 之后默认连 https://aiphoto.aimemory.cafe，用户什么都不用填。
 * 浏览器/PWA 访问时留空，走同源相对路径。
 * 只有在 App 里手动改过地址（填错救回来）才用本地存的那个。
 */
const KEY = 'af_server'

/** 装成 App 之后默认连这个地址，用户不用填 */
export const DEFAULT_SERVER = 'https://aiphoto.aimemory.cafe'

export function isNativeApp(): boolean {
  const c = (window as any).Capacitor
  return Boolean(c?.isNativePlatform?.() || c?.platform === 'android' || c?.platform === 'ios')
}

export function getServer(): string {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) return saved
  } catch {}
  // App 里连正式域名；浏览器/PWA 留空走同源相对路径
  return isNativeApp() ? DEFAULT_SERVER : ''
}

export function setServer(url: string) {
  const clean = url.trim().replace(/\/+$/, '')
  try {
    if (clean) localStorage.setItem(KEY, clean)
    else localStorage.removeItem(KEY)
  } catch {}
}

/** 把 /api/xxx 拼成完整地址 */
export function abs(path: string): string {
  const base = getServer()
  if (!base) return path
  return base + (path.startsWith('/') ? path : '/' + path)
}

/** 简单校验：能拿到照片列表就算连上了 */
export async function testServer(url: string): Promise<{ ok: boolean; message: string }> {
  const base = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, message: '地址要以 http:// 或 https:// 开头' }
  }
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 8000)
    const r = await fetch(base + '/api/photos', { signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) return { ok: false, message: `服务器返回 ${r.status}` }
    const j = await r.json()
    if (!Array.isArray(j.photos)) return { ok: false, message: '这个地址不太对，没找到相框数据' }
    return { ok: true, message: `连上了，这台服务器上已经有 ${j.photos.length} 条内容` }
  } catch (e: any) {
    const msg = String(e?.message || '')
    if (/abort/i.test(msg)) return { ok: false, message: '连接超时，检查一下地址和网络' }
    return { ok: false, message: '连不上，检查地址、端口，以及手机和电脑是否在同一个网络' }
  }
}
