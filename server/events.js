/**
 * 极简 SSE 推送。
 *
 * 为什么不用轮询：解说要等视觉模型几秒才出来，轮询要么延迟大、
 * 要么请求多。攒一个长连接，服务端一生成完就推过去，
 * 相框那边听到的就是"刚说完子女就收到"。
 */

const clients = new Set()

/** 挂一个 SSE 连接，返回清理函数 */
export function addClient(res, role) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // 关键：nginx 默认会缓冲响应，SSE 就变成"积一批再发"，等于没有推送
    'x-accel-buffering': 'no',
  })
  res.write(': connected\n\n')

  const client = { res, role }
  clients.add(client)

  // 20 秒一次心跳，防止中间层掐掉空闲连接
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* 连接已经断了，close 事件会清掉 */
    }
  }, 20000)

  return () => {
    clearInterval(ping)
    clients.delete(client)
  }
}

/**
 * 广播事件。
 * role 传了就只发给该角色（相框不需要知道子女端的界面事件）。
 */
export function broadcast(type, data = {}, role = null) {
  if (!clients.size) return
  const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`
  for (const c of [...clients]) {
    if (role && c.role !== role) continue
    try {
      c.res.write(msg)
    } catch {
      clients.delete(c)
    }
  }
}

export function clientCount() {
  return clients.size
}
