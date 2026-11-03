import { useEffect, useState } from 'react'
import FrameApp from './frame/FrameApp'
import FamilyApp from './family/FamilyApp'
import ServerSetup from './ServerSetup'
import { isNativeApp } from './lib/server'

type Role = 'frame' | 'family'

// 打包时由 vite.config 注入（APP_ROLE 环境变量）
declare const __APP_ROLE__: string

/**
 * 判断该显示哪一端。
 *
 * 浏览器：看路径（/frame 或 /family）。
 * App：路径永远是 '/'，所以用打包时写死进来的 __APP_ROLE__。
 *
 * 为什么不用读文件/读包名：
 *   - 读 capacitor.config 的 appId 不可行（两个 flavor 共用一份配置）
 *   - 运行时 fetch 角色文件在 WebView 里不一定拿得到
 *   - 编译期常量没有失败的可能
 */
function detectRole(): Role {
  const p = location.pathname.replace(/\/+$/, '')
  if (p === '/frame') return 'frame'
  if (p === '/family') return 'family'
  if (__APP_ROLE__ === 'frame' || __APP_ROLE__ === 'family') return __APP_ROLE__
  return 'family'
}

/**
 * 一份代码，两个 App：
 *   frame  → 装在相框平板上，横屏全屏，左右滑动翻页
 *   family → 装在子女手机上，传照片、听留言
 */
export default function App() {
  const [role] = useState<Role>(() => detectRole())
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

  // 地址栏颜色：相框深色，子女端浅色
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', role === 'frame' ? '#16120f' : '#f7f3ec')
    document.title = role === 'frame' ? '相框' : '爸妈的相框'
  }, [role])

  if (needSetup) return <ServerSetup onDone={() => setNeedSetup(false)} />
  if (role === 'frame') return <FrameApp />
  return <FamilyApp />
}
