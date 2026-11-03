/**
 * 只缓存"外壳"（HTML/JS/CSS/图标），让相框断网也能打开界面。
 * 照片和视频不做缓存——体积太大，而且相框本来就该显示出最新的。
 */
const CACHE = 'aiframe-shell-v2'
const SHELL = ['/', '/frame', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  if (url.origin !== location.origin) return

  // 接口、上传的文件、视频流一律走网络
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return

  // 外壳：先给缓存，后台再更新，这样打开是秒开的
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => hit)
      return hit || net
    })
  )
})
