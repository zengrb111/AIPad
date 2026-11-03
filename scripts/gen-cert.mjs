/**
 * 生成局域网可用的自签证书。
 *
 * 为什么需要：浏览器只有在 https 或 localhost 下才允许录音（getUserMedia）。
 * 相框和手机是另一台设备，只能走 IP 访问，所以必须 https，
 * 否则「点一下说话」这个核心功能直接被浏览器禁用。
 *
 *   node scripts/gen-cert.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIR = path.join(ROOT, 'certs')

function lanIPs() {
  const out = new Set(['127.0.0.1'])
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.add(n.address)
    }
  }
  return [...out]
}

const ips = lanIPs()
fs.mkdirSync(DIR, { recursive: true })

const cnf = `[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = aiframe
[v3]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
[alt]
DNS.1 = localhost
${ips.map((ip, i) => `IP.${i + 1} = ${ip}`).join('\n')}
`

const cnfPath = path.join(DIR, 'openssl.cnf')
fs.writeFileSync(cnfPath, cnf)

const r = spawnSync(
  'openssl',
  [
    'req', '-x509',
    '-newkey', 'rsa:2048',
    '-nodes',
    '-keyout', path.join(DIR, 'key.pem'),
    '-out', path.join(DIR, 'cert.pem'),
    '-days', '3650',
    '-config', cnfPath,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
)

if (r.status !== 0) {
  console.error('生成失败：', r.stderr || r.error?.message)
  console.error('本机没有 openssl？Windows 可以装 Git for Windows，或用 WSL 生成后拷进 certs/')
  process.exit(1)
}

console.log('证书已生成：')
console.log('  ' + path.join(DIR, 'cert.pem'))
console.log('  ' + path.join(DIR, 'key.pem'))
console.log('  覆盖地址：' + ips.join(', '))
console.log('')
console.log('重启服务后会用 https。首次打开浏览器会报「不安全」，')
console.log('点「高级 → 继续前往」即可，之后录音权限就正常了。')
