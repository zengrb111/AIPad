/**
 * 把两个签名 APK 传到 GitHub Release，生成可分享的下载链接。
 * 用法：GITHUB_TOKEN=xxx node tmp/upload-release.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const TOKEN = process.env.GITHUB_TOKEN
const OWNER = 'zengrb111'
const REPO = 'AIPad'
const TAG = 'v1.3'

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN')
  process.exit(1)
}

const API = 'https://api.github.com'
const UPLOAD = 'https://uploads.github.com'
const H = {
  authorization: `Bearer ${TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'aiframe-release',
}

const BODY = `## 两个包，看名字分：tablet = 平板，phone = 手机

| 文件 | 装在哪 | 图标 | 包名 |
|---|---|---|---|
| aiframe-**tablet**-v1.3.apk | **平板 / 相框屏** | 深褐底 | cafe.aimemory.frame |
| aiframe-**phone**-v1.3.apk | **子女的手机** | 赭红底 | cafe.aimemory.family |

包名不同，可以同时装在一台机器上。

## 这一版有什么

- 相框端：横屏全屏（**状态栏也隐藏**）、18 秒自动轮播、**左右滑动翻页**、点屏说话、AI 解说带字幕
- 相框端：照片**先完整显示，再缓缓推近到铺满屏幕**，然后切下一张
- 相框端：去掉顶上那条白带（系统状态栏留白），真正全屏
- 解说**在服务端生成一次，实时推送到相框**；相框只播这份 mp3，不会自己再识别或合成
- 相框端：视频浮在当前画面上播放（不跳页），播放中也能滑动切走
- 相框端：右上角气泡点开看这张照片的讲解和家人留言
- 子女端：竖屏，传照片/视频、听留言、回语音、解说可试听
- AI 解说：接 DeepSeek 视觉模型，自动看图写 2-3 句口语并合成语音

服务地址已内置 **https://aiphoto.aimemory.cafe**，装完直接能用，不用填地址。

> 这是内部测试版，未上架应用商店。安装时需要允许「未知来源应用」。
> 签名用的是个人证书，以后升级必须用同一个包，别混装别的来源。`

async function req(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } })
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`)
  return json
}

const main = async () => {
  // 已有同名 release 就先删掉，避免重复
  const existing = await req(`${API}/repos/${OWNER}/${REPO}/releases`)
  const old = existing.find((r) => r.tag_name === TAG)
  if (old) {
    console.log(`删除旧的 ${TAG} release…`)
    await req(`${API}/repos/${OWNER}/${REPO}/releases/${old.id}`, { method: 'DELETE' })
  }

  console.log(`创建 release ${TAG}…`)
  const rel = await req(`${API}/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tag_name: TAG,
      name: '相框 v1.3（内测）',
      body: BODY,
      draft: false,
      prerelease: true,
    }),
  })
  console.log('release id:', rel.id)

  const files = [
    { local: 'release/相框-平板-v1.3.apk', name: 'aiframe-tablet-v1.3.apk' },
    { local: 'release/子女端-手机-v1.3.apk', name: 'aiframe-phone-v1.3.apk' },
  ]

  for (const f of files) {
    const buf = fs.readFileSync(f.local)
    console.log(`上传 ${f.name} (${(buf.length / 1024 / 1024).toFixed(1)}MB)…`)
    const asset = await req(
      `${UPLOAD}/repos/${OWNER}/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(f.name)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/vnd.android.package-archive' },
        body: buf,
      }
    )
    console.log('  ✓', asset.browser_download_url)
  }

  console.log('\n下载页：' + rel.html_url)
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
