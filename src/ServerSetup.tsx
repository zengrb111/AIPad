import { useState } from 'react'
import { getServer, setServer, testServer } from './lib/server'

/**
 * App 第一次打开时让用户填服务器地址。
 * 相框的数据在用户自己的机器上（或者他那台云服务器），App 只是个壳，
 * 不知道地址就没法取照片。
 */
export default function ServerSetup({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState(getServer() || 'http://')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)

  const connect = async () => {
    setBusy(true)
    setMsg('')
    const r = await testServer(v)
    setBusy(false)
    setOk(r.ok)
    setMsg(r.message)
    if (r.ok) {
      setServer(v)
      window.setTimeout(onDone, 700)
    }
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="4" width="18" height="14" rx="2" />
            <path d="M3 15l5-5 4 4 3-3 6 6" />
            <path d="M8 21h8" />
          </svg>
        </div>

        <h1>连到你的相框服务器</h1>
        <p className="setup-lead">
          相框里的照片来自你自己的一台服务器。在电脑上启动服务后，
          终端会打出「相框端」的地址，填到这里。
        </p>

        <input
          className="setup-input"
          value={v}
          onChange={(e) => {
            setV(e.target.value)
            setOk(false)
            setMsg('')
          }}
          placeholder="http://192.168.1.5:4000"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />

        <button className="btn setup-btn" onClick={connect} disabled={busy}>
          {busy ? '正在连…' : ok ? '连上了' : '连接'}
        </button>

        {msg && (
          <div className={`setup-msg ${ok ? 'ok' : 'bad'}`}>{msg}</div>
        )}

        <div className="setup-tip">
          提示：手机或平板要和那台电脑在同一个 WiFi 下。
          如果服务是 https，地址也要用 https。
        </div>
      </div>
    </div>
  )
}
