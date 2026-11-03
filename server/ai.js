/**
 * AI 解说：照片 → 一段讲给老人听的话 → 语音。
 *
 * 文字用任意 OpenAI 兼容的视觉模型，换供应商只改环境变量：
 *   AI_BASE_URL   默认 https://api.openai.com/v1
 *   AI_API_KEY
 *   AI_MODEL      视觉模型，例如 gpt-4o-mini / qwen-vl-max / glm-4v
 *
 * 语音走本机合成（msedge-tts，免费、不需要 key），生成 mp3 存在本地，
 * 相框只管播放。合成失败不影响文字，相框端会退回浏览器朗读。
 *   TTS_VOICE     默认 zh-CN-XiaoxiaoNeural（晓晓），也可换 zh-CN-YunxiNeural 等
 *   TTS_RATE      语速，默认 -8%，比常速慢一点，老人听得清
 */
import fs from 'node:fs'
import path from 'node:path'
import { UPLOAD_DIR } from './store.js'
import { MsEdgeTTS } from 'msedge-tts'

const AI_BASE = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
const AI_KEY = process.env.AI_API_KEY || ''
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini'

const TTS_VOICE = process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural'
const TTS_RATE = process.env.TTS_RATE || '-8%'
const TTS_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

export const aiEnabled = Boolean(AI_KEY)
export const ttsEnabled = true

/* ---------------- 提示词 ---------------- */

const SYSTEM = `你在帮子女给家里的老人讲照片。老人看屏幕不太清楚，你要把这张照片讲给他听。

规则：
- 2 到 3 句口语，总共不超过 70 个字，像坐在旁边一起看照片那样说话，称呼用「您」
- 先说画面里最主要的人和事，再补地点、时节或一个细节
- 不要用「图片中」「可以看到」「画面显示」这类书面词
- 只讲确实看得见的。看不太准的地方用「看着像」，不确定就干脆不说
- 绝对不能编造姓名、年龄、职业、具体日期、具体地点
- 如果子女留了话，把它当作事实依据自然融进去，不要照抄他的原句
- 语气温和，不用说教，结尾不要加提问`

function buildPrompt(caption, from) {
  const lines = []
  if (caption) lines.push(`子女（${from || '家人'}）留的话：${caption}`)
  else lines.push(`子女（${from || '家人'}）没留话，你来看图讲。`)
  lines.push('请讲给父母听。')
  return lines.join('\n')
}

/* ---------------- 纯文本兜底 ---------------- */

const TEXT_ONLY_SYSTEM = `你在帮子女给家里的老人讲照片，但你只能看到子女留的那句话，看不到照片本身。

规则：
- 2 到 3 句口语，总共不超过 60 个字，称呼用「您」
- 只围绕子女说的那件事展开，可以把语气说得更亲切，但不能添加新的事实
- 不要编造画面里有什么（颜色、数量、人物位置、天气），你并没有看见
- 不要编姓名、年龄、职业、具体日期地点
- 结尾不要提问`

/**
 * 模型看不懂图时会直接说"我无法查看这张图片"。
 * 这句话要是被当成解说念给老人听，比不说还糟——必须识别出来。
 */
function looksLikeRefusal(text) {
  const t = text.replace(/\s/g, '')
  if (!t) return true
  return /无法(查看|看到|看见|识别|读取|访问).{0,8}(图|照片|图片)|看不到.{0,4}(图|照片|图片)|没能.{0,4}(收到|看到).{0,4}(图|照片)|(作为|cannot|unable|sorry).{0,24}(view|see|access|image|photo)|请.{0,6}(上传|提供|重新发送).{0,6}(图|照片)/i.test(
    t
  )
}

/** 只能看到文字时，让模型把子女的话改写成讲给老人听的口吻 */
async function callTextOnly(caption, from) {
  return callChat(TEXT_ONLY_SYSTEM, `子女（${from || '家人'}）留的话：${caption}\n请讲给父母听。`)
}

/* ---------------- 解说文本 ---------------- */

async function callChat(system, userText, imageB64) {
  // 纯文本时用字符串 content，兼容性最好；带图时才用数组格式
  const userContent = imageB64
    ? [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageB64}` } },
      ]
    : userText

  const body = {
    model: AI_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    // 推理型模型（如 deepseek-flash）会先用掉几百 token 在思考上，
    // 给太小会导致 content 为空，只剩 reasoning_content
    max_tokens: 1500,
    temperature: 0.65,
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 45000)
  try {
    const r = await fetch(`${AI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${AI_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      throw new Error(`模型返回 ${r.status} ${t.slice(0, 200)}`)
    }
    const j = await r.json()
    const text = j.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('模型没有返回内容')
    return text.replace(/^["「]|["」]$/g, '').trim()
  } finally {
    clearTimeout(timer)
  }
}

async function callVision(filePath, caption, from) {
  const b64 = fs.readFileSync(filePath).toString('base64')
  return callChat(SYSTEM, buildPrompt(caption, from), b64)
}

/* ---------------- 本地语音合成 ---------------- */

async function localTTS(text, outName) {
  const tts = new MsEdgeTTS()
  await tts.setMetadata(TTS_VOICE, TTS_FORMAT)

  const { audioStream } = tts.toStream(text, { rate: TTS_RATE })

  const buf = await new Promise((resolve, reject) => {
    const chunks = []
    let settled = false
    const fail = (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e)
    }
    const timer = setTimeout(() => fail(new Error('语音合成超时')), 30000)

    audioStream.on('data', (c) => chunks.push(c))
    audioStream.on('end', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(Buffer.concat(chunks))
    })
    audioStream.on('error', fail)
  })

  try {
    tts.close()
  } catch {}

  if (buf.length < 800) throw new Error('合成结果过短')
  const out = path.join(UPLOAD_DIR, outName)
  fs.writeFileSync(out, buf)
  return outName
}

/* ---------------- 对外 ---------------- */

/** 没配置模型时的兜底：只用子女留的话拼一句，不假装是 AI */
export function fallbackText(caption, from) {
  if (caption) return caption
  return `${from || '家人'}传来一张照片，您看看。`
}

/**
 * 给一张照片生成解说。
 * 返回 { status, text, audio, error }
 *   status: done 正常 / fallback 没配模型 / error 调用失败
 */
export async function narratePhoto(photo) {
  // 视频用抽出来的封面帧当输入图，一样能讲
  const srcName = photo.kind === 'video' ? photo.cover : photo.file
  const base = path.basename(srcName || photo.file, path.extname(srcName || photo.file))
  const audioName = `${base}_say.mp3`

  let text = ''
  let mode = 'vision'
  let status = 'done'
  let note

  if (!aiEnabled) {
    text = fallbackText(photo.caption, photo.from)
    mode = 'fallback'
    status = 'fallback'
    note = '未配置视觉模型，只念子女留的话'
  } else if (!srcName) {
    text = fallbackText(photo.caption, photo.from)
    mode = 'fallback'
    status = 'fallback'
    note = '没有可用的画面'
  } else {
    const filePath = path.join(UPLOAD_DIR, srcName)
    if (!fs.existsSync(filePath)) {
      return { status: 'error', text: '', audio: null, error: '找不到照片文件' }
    }

    try {
      text = await callVision(filePath, photo.caption, photo.from)

      // 纯文本模型会直接拒绝看图（"我无法查看这张图片"），这时退回只用文字
      if (looksLikeRefusal(text)) {
        if (!photo.caption) {
          text = fallbackText(photo.caption, photo.from)
          return await withVoice({ status: 'fallback', mode: 'text', text, note: '当前模型看不了图片，子女也没留话' }, audioName)
        }
        text = await callTextOnly(photo.caption, photo.from)
        mode = 'text'
      }
    } catch (e) {
      console.warn('[ai] 生成解说失败：', e.message)
      return { status: 'error', text: '', audio: null, error: e.message }
    }
  }

  return await withVoice({ status, mode, text, note }, audioName)
}

/**
 * 给文案配上语音。
 *
 * 语音只在这台服务器上合成一次，相框端拿到的是 mp3，
 * 永远不会自己再合成一遍——设备音色不统一，而且老人分不清哪个是"家里人说的话"。
 * 合成失败重试一次；两次都失败才返回 null（相框只显示字幕，不出声）。
 */
async function withVoice(result, audioName) {
  if (!result.text) return { ...result, audio: null }

  for (let i = 0; i < 2; i++) {
    try {
      const audio = await localTTS(result.text, audioName)
      return { ...result, audio }
    } catch (e) {
      console.warn(`[ai] 本地合成失败（第 ${i + 1} 次）：`, e.message)
    }
  }
  return { ...result, audio: null }
}
