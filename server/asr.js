/**
 * 视频语音识别出字幕。
 *
 * 用本机跑的 whisper（@huggingface/transformers + ONNX），不需要任何 key。
 *   ASR_MODEL  默认 Xenova/whisper-base；想更准可换 Xenova/whisper-small（模型更大、更慢）
 *   ASR_OFF=1  关掉这个功能
 *   HF_MIRROR  模型下载镜像，默认走 hf-mirror.com
 *
 * 已知边界：whisper 认的是「说话」，唱歌、现场喊麦、强背景音乐的素材会出乱码，
 * 这类视频宁可不出字幕——错字比没字幕更糟。所以识别结果会做一次质量判断。
 */
import { execFile } from 'node:child_process'

const MODEL = process.env.ASR_MODEL || 'Xenova/whisper-base'
export const asrEnabled = process.env.ASR_OFF !== '1'

// 依赖做成懒加载：transformers 会拉 onnxruntime，包缺失或装失败时
// 不应该拖垮整个服务——只是这个视频没字幕而已。
let depsPromise = null
let asrPromise = null

function loadDeps() {
  if (!depsPromise) {
    depsPromise = (async () => {
      const tf = await import('@huggingface/transformers')
      const OpenCC = await import('opencc-js')
      // 国内直连 huggingface.co 基本不通，默认走镜像
      tf.env.remoteHost = process.env.HF_MIRROR || 'https://hf-mirror.com'
      return {
        pipeline: tf.pipeline,
        toSimplified: OpenCC.Converter({ from: 'tw', to: 'cn' }),
      }
    })().catch((e) => {
      depsPromise = null
      throw e
    })
  }
  return depsPromise
}

function getAsr() {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline } = await loadDeps()
      return pipeline('automatic-speech-recognition', MODEL)
    })().catch((e) => {
      asrPromise = null
      throw e
    })
  }
  return asrPromise
}

/** 服务预热：只在你确认内存够用时开（ASR_WARMUP=1） */
export function warmUp() {
  if (!asrEnabled) return
  getAsr()
    .then(() => console.log(`[asr] 模型就绪 ${MODEL}`))
    .catch((e) => console.warn('[asr] 模型加载失败：', e.message))
}

function extractPcm(file) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'],
      { maxBuffer: 1 << 28, encoding: 'buffer' },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
}

/**
 * 判断一段识别结果像不像「人正常说话」。
 *
 * 实测样本（4-gram 重复率 / 去重率）：
 *   正常说话   0.000 / 0.77~0.90
 *   唱歌乱码A  0.114 / 0.523
 *   唱歌乱码B  0.024 / 0.622
 *
 * 唱歌和嘈杂环境里模型会反复吐同一小句，或者把词拆碎重组，
 * 表现为重复率升高、用字集中。错字幕比没字幕更糟，所以宁可判掉。
 */
function ngramRepeat(text, n = 4) {
  const clean = text.replace(/[\s，。、！？,.!?]/g, '')
  if (clean.length < n * 3) return 0
  const m = new Map()
  for (let i = 0; i <= clean.length - n; i++) {
    const g = clean.slice(i, i + n)
    m.set(g, (m.get(g) || 0) + 1)
  }
  let rep = 0
  for (const c of m.values()) if (c > 1) rep++
  return rep / m.size
}

function looksReasonable(text, chunks) {
  const clean = text.replace(/[\s，。、！？,.!?]/g, '')
  if (clean.length < 4) return false
  if (!chunks.length) return false

  // 反复吐同一句 = 幻觉
  if (ngramRepeat(text) > 0.08) return false

  // 用字太集中，只在中等长度内判断；太长的正常文本重复用字本来就多
  if (clean.length >= 12 && clean.length <= 60) {
    if (new Set(clean).size / clean.length < 0.64) return false
  }

  return true
}

/**
 * 给一个视频生成字幕。
 * 返回 { status, text, chunks:[{start,end,text}], note }
 */
export async function transcribeVideo(filePath) {
  if (!asrEnabled) return { status: 'off', text: '', chunks: [] }

  let audio
  try {
    const buf = await extractPcm(filePath)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    audio = new Float32Array(ab)
  } catch (e) {
    // 视频本来就没有音轨是很常见的情况（比如手机拍的静音片段），不算出错
    const msg = String(e.message || '') + String(e.stderr || '')
    if (/does not contain any stream|matches no streams|no audio|Output file .* is empty/i.test(msg)) {
      return { status: 'empty', text: '', chunks: [] }
    }
    return { status: 'error', text: '', chunks: [], note: '提取音频失败' }
  }

  // 不到 0.6 秒没什么可识别的
  if (audio.length / 16000 < 0.6) {
    return { status: 'empty', text: '', chunks: [] }
  }

  let out
  let toSimplified
  try {
    const asr = await getAsr()
    ;({ toSimplified } = await loadDeps())
    out = await asr(audio, {
      language: 'chinese',
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
    })
  } catch (e) {
    return { status: 'error', text: '', chunks: [], note: e.message }
  }

  const chunks = (out.chunks || [])
    .map((c) => ({
      start: Number(c.timestamp?.[0] ?? 0),
      end: Number(c.timestamp?.[1] ?? 0),
      text: toSimplified(String(c.text || '')).trim(),
    }))
    .filter((c) => c.text)

  const text = toSimplified(String(out.text || '')).trim()

  if (!looksReasonable(text, chunks)) {
    return {
      status: 'poor',
      text: '',
      chunks: [],
      note: '这段声音不像正常说话（可能是唱歌或太吵），没有生成字幕',
    }
  }

  return { status: 'done', text, chunks }
}
