/**
 * 一键出 Android APK。
 *
 *   npm run apk
 *
 * 优先用项目里自带的 JDK / Android SDK（tools/ 目录），
 * 没有就退回系统环境变量 JAVA_HOME / ANDROID_HOME。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const TOOLS = path.join(ROOT, 'tools')

function findJDK() {
  if (!fs.existsSync(TOOLS)) return null
  const dirs = fs.readdirSync(TOOLS).filter((d) => /^jdk/i.test(d))
  if (!dirs.length) return null
  // Capacitor 7 的 Android 模块要求 JDK 21，优先拿高版本
  const rank = (d) => {
    const m = d.match(/jdk-(\d+)/i)
    return m ? Number(m[1]) : 0
  }
  dirs.sort((a, b) => rank(b) - rank(a))
  for (const d of dirs) {
    const p = path.join(TOOLS, d)
    if (fs.existsSync(path.join(p, 'bin'))) return p
  }
  return null
}

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) {
    console.error(`\n失败：${cmd} 退出码 ${r.status}`)
    process.exit(r.status || 1)
  }
}

const env = {}

const jdk = findJDK()
if (jdk) {
  env.JAVA_HOME = jdk
  console.log('JDK:', jdk)
} else if (!process.env.JAVA_HOME) {
  console.error('没找到 JDK。装一个 JDK 17，或把 JDK 解压到 tools/ 目录下。')
  process.exit(1)
}

const sdk = path.join(TOOLS, 'android-sdk')
if (fs.existsSync(sdk)) {
  env.ANDROID_HOME = sdk
  console.log('SDK:', sdk)
} else if (!process.env.ANDROID_HOME) {
  console.error('没找到 Android SDK。装 Android Studio，或把 SDK 放到 tools/android-sdk。')
  process.exit(1)
}

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'

// 每个角色单独构建一次：APP_ROLE 会被 vite define 写死进 JS。
// 这样包里自带身份，不依赖运行时读文件或读包名——那两条路都踩过坑。
for (const role of ['frame', 'family']) {
  const label = role === 'frame' ? '相框端' : '子女端'

  console.log(`\n[2/3] 构建${label}网页产物（APP_ROLE=${role}）`)
  run('npm', ['run', 'build'], { env: { ...env, APP_ROLE: role } })

  run('npx', ['cap', 'copy', 'android'], { env })

  console.log(`\n[3/3] 编译${label}`)
  const flavor = role === 'frame' ? 'Frame' : 'Family'
  run(gradlew, [`assemble${flavor}Release`, '--no-daemon'], {
    cwd: path.join(ROOT, 'android'),
    env,
  })
}

const OUTPUTS = [
  {
    dest: '相框-平板-v1.1.apk',
    src: path.join('android', 'app', 'build', 'outputs', 'apk', 'frame', 'release', 'app-frame-release.apk'),
  },
  {
    dest: '子女端-手机-v1.1.apk',
    src: path.join('android', 'app', 'build', 'outputs', 'apk', 'family', 'release', 'app-family-release.apk'),
  },
]

const releaseDir = path.join(ROOT, 'release')
fs.mkdirSync(releaseDir, { recursive: true })

let ok = 0
for (const o of OUTPUTS) {
  const abs = path.join(ROOT, o.src)
  if (!fs.existsSync(abs)) {
    console.error(`没找到 ${o.src}`)
    continue
  }
  const target = path.join(releaseDir, o.dest)
  fs.copyFileSync(abs, target)
  const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1)
  console.log(`  ${o.dest}  (${mb} MB)`)
  ok++
}

if (ok === OUTPUTS.length) {
  console.log(`\n完成，产物在 ${releaseDir}`)
  console.log('「相框-平板」装平板，「子女端-手机」装手机。两个包名不同，可以装在同一台机器上。')
} else {
  console.error('\n有包没生成出来，检查上面的日志。')
  process.exit(1)
}
