/**
 * 校验 APK 里装的网页产物是不是预期的那个角色。
 *
 * 为什么需要：两个 flavor 共用同一个 assets 目录，
 * `cap copy` 会把最后一次构建的 dist 写进去。如果只跑 gradle 而不重新 copy，
 * 相框包就会装着子女端的页面——表面现象是"白屏"。
 *
 *   node scripts/verify-apk.mjs <apk> <期望的 dist/index-xxx.js>
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

/** 从 zip 里读一个文件（只实现必要的 stored/deflate 两种） */
export function readZipEntry(zipPath, matcher) {
  const buf = fs.readFileSync(zipPath)

  // 从尾部找 EOCD
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip')

  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)

    if (matcher(name)) {
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const start = localOff + 30 + lNameLen + lExtraLen
      const data = buf.subarray(start, start + compSize)
      return {
        name,
        content: method === 0 ? data : zlib.inflateRawSync(data),
      }
    }

    off += 46 + nameLen + extraLen + commentLen
  }
  throw new Error('APK 里没找到网页产物')
}

const isMain = process.argv[1] && process.argv[1].endsWith('verify-apk.mjs')

if (isMain) {
  const [, , apk, expectedJs] = process.argv
  if (!apk || !expectedJs) {
    console.error('用法: node scripts/verify-apk.mjs <apk> <dist/assets/index-xxx.js>')
    process.exit(1)
  }

  const entry = readZipEntry(apk, (n) => /assets\/public\/assets\/index-.*\.js$/.test(n))
  const got = crypto.createHash('md5').update(entry.content).digest('hex')
  const want = crypto.createHash('md5').update(fs.readFileSync(expectedJs)).digest('hex')

  const name = path.basename(apk)
  if (got === want) {
    console.log(`  ✓ ${name} 里的页面与预期一致（${got.slice(0, 8)}）`)
  } else {
    console.error(`  ✗ ${name} 里的页面不是预期的那个！`)
    console.error(`     包里: ${got.slice(0, 8)}   预期: ${want.slice(0, 8)}`)
    console.error('     原因：两个 flavor 共用 assets，gradle 前没重新 cap copy。')
    process.exit(1)
  }
}
