/**
 * 当 443 直连被封、SSH key 又没注册时，用 GitHub Git Data API 推送。
 *
 *   GITHUB_TOKEN=xxx node scripts/push-via-api.mjs
 *
 * 关键：文件内容必须从 **git 对象** 读（git cat-file blob HEAD:<path>），
 * 不能读工作区 —— 本机 core.autocrlf 会把工作区变成 CRLF，而仓库对象是 LF，
 * 内容不一致会导致 GitHub 把整个文件判成改写，进而合并冲突。
 */
import { spawnSync } from 'node:child_process'

const TOKEN = process.env.GITHUB_TOKEN
const OWNER = 'zengrb111'
const REPO = 'AIPad'
const BRANCH = 'main'

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN')
  process.exit(1)
}

const API = 'https://api.github.com'
const H = {
  authorization: `Bearer ${TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'aiframe-push',
}

function git(args) {
  const r = spawnSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败: ${r.stderr?.toString().slice(0, 300)}`)
  }
  return r.stdout
}

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { ...H, ...(opts.headers || {}) },
  })
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  if (!r.ok) throw new Error(`${path} → ${r.status} ${text.slice(0, 300)}`)
  return json
}

const main = async () => {
  // 1. 远程当前状态
  const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)
  const remoteSha = ref.object.sha
  const remoteCommit = await api(`/repos/${OWNER}/${REPO}/git/commits/${remoteSha}`)
  console.log('远程 HEAD:', remoteSha.slice(0, 7))

  // 2. 本地相对远程改了什么
  const diff = git(['diff', '--name-status', remoteSha, 'HEAD']).toString().trim()
  if (!diff) {
    console.log('没有差异，不需要推送')
    return
  }
  const changes = diff.split('\n').map((line) => {
    const [status, ...rest] = line.split('\t')
    return { status: status[0], path: rest.join('\t') }
  })
  console.log('变更文件:')
  changes.forEach((c) => console.log(` ${c.status} ${c.path}`))

  // 3. 每个文件建 blob
  const treeEntries = []
  for (const c of changes) {
    if (c.status === 'D') {
      treeEntries.push({ path: c.path, mode: '100644', type: 'blob', sha: null })
      continue
    }
    // 内容从 git 对象读，mode 也从 ls-tree 拿
    const content = git(['cat-file', 'blob', `HEAD:${c.path}`])
    const ls = git(['ls-tree', 'HEAD', '--', c.path]).toString().trim().split(/\s+/)
    const mode = ls[0] || '100644'

    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
    })
    treeEntries.push({ path: c.path, mode, type: 'blob', sha: blob.sha })
    console.log(`  blob ${c.path} → ${blob.sha.slice(0, 7)}`)
  }

  // 4. 建 tree
  const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base_tree: remoteCommit.tree.sha, tree: treeEntries }),
  })
  console.log('新 tree:', tree.sha.slice(0, 7))

  // 5. 建 commit
  const message = git(['log', '-1', '--pretty=%B', 'HEAD']).toString().trim()
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, tree: tree.sha, parents: [remoteSha] }),
  })
  console.log('新 commit:', commit.sha.slice(0, 7))

  // 6. 更新分支
  await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: commit.sha }),
  })
  console.log(`\n推送完成：${BRANCH} → ${commit.sha.slice(0, 7)}`)

  // 7. 核对：本地 HEAD 的 tree 应该和远程新 commit 的 tree 一致
  const localTree = git(['rev-parse', 'HEAD^{tree}']).toString().trim()
  console.log('本地 tree:', localTree.slice(0, 7))
  console.log('一致:', localTree === tree.sha ? '✓' : '✗ 内容有差异')
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
