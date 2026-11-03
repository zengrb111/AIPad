import { useEffect, useState } from 'react'
import FrameApp from './frame/FrameApp'
import FamilyApp from './family/FamilyApp'
import ServerSetup from './ServerSetup'
import { isNativeApp } from './lib/server'

type Role = 'frame' | 'family'

/**
 * 判断当前该显示哪一端。
 *
 * 浏览器：看路径（/frame 或 /family）。
 * App：路径永远是 '/'，所以读构建时写进去的 /role.json。
 *      不能用 Capacitor 的 appId 判断——那是 capacitor.config 里的静态值，
 *      两个 flavor 打出来一模一样，判断不出区别。
 */
async function detectRole(): Promise<Role> {
  const p = location.pathname.replace(/\/+$/, '')
  if (p === '/frame') return 'frame'
  if (p === '/family') return 'family'

  try {
    const r = await fetch('/role.json', { cache: 'no-store' })
    if (r.ok) {
      const j = await r.json()
      if (j?.role === 'frame' || j?.role === 'family') return j.role
    }
  } catch {
    /* 拿不到就按子女端 */
  }
  return 'family'
}

/**
 * 一份代码，两个 App：
 *   frame  → 装在相框平板上，横屏全屏，左右滑动翻页
 *   family → 装在子女手机上，传照片、听留言
 * 两个包 applicationId 不同，可以同时装在一台机器上。
 */
export default function App() {
  const [role, setRole] = useState<Role | null>(null)
  const [needSetup, setNeedSetup] = useState(() => {
    if (!isNativeApp()) return false
    try {
      if (localStorage.getItem('af_force_setup')) {
        localStorage.removeItem('af_force_setup')
        return true
      }
    } catch {}
    return false
  })

  useEffect(() => {
    let alive = true
    detectRole().then((r) => {
      if (alive) setRole(r)
    })
    return () => {
      alive = false
    }
  }, [])

  // 地址栏颜色：相框深色，子女端浅色
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', role === 'frame' ? '#16120f' : '#f7f3ec')
    document.title = role === 'frame' ? '相框' : '爸妈的相框'
  }, [role])

  if (role === null) return <div className="loading">正在启动…</div>
  if (needSetup) return <ServerSetup onDone={() => setNeedSetup(false)} />
  if (role === 'frame') return <FrameApp />
  return <FamilyApp />
}
