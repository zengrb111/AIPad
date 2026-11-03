import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

/** 是否跑在打包好的 App 里（而不是浏览器） */
const isNative = Boolean(
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// React 挂上了就把启动兜底撤掉
document.getElementById('boot')?.remove()

if (isNative) {
  // App 里不要 Service Worker：
  // 它会缓存 index.html，升级后旧页面指着已经不存在的老文件名，直接白屏。
  // 这里顺手把历史遗留的注册和缓存都清掉。
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((rs) => rs.forEach((r) => r.unregister()))
      .catch(() => {})
  }
  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => keys.forEach((k) => caches.delete(k)))
      .catch(() => {})
  }
}
// 浏览器端也不再注册 SW：
// public/sw.js 现在只负责"删缓存并注销自己"，给已经装过旧版的人收尾。
// 如果这里继续 register，新装的人会装上一个自毁脚本，白折腾一次。
