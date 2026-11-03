/**
 * 自毁版 Service Worker。
 *
 * 之前它把 /index.html 缓存在设备上（cache-first）。App 升级后，
 * 缓存的 index.html 还指着旧的文件名（index-XXXX.js），那个文件已经不在新包里，
 * 请求 404 —— 页面就是一片白。
 *
 * 原生 App 根本不需要 SW（页面就在安装包里，断网也能开），
 * 所以这一版只做一件事：删光缓存、注销自己、把打开的页面刷一次。
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      } catch {}
      try {
        await self.registration.unregister()
      } catch {}
      // 把当前打开的白屏页面重新加载一次，立刻拿到包里最新的页面
      try {
        const list = await self.clients.matchAll({ type: 'window' })
        for (const c of list) c.navigate(c.url)
      } catch {}
    })()
  )
})

// 自毁期间不接管任何请求，全部走网络
self.addEventListener('fetch', () => {})
