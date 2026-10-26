export const name = 'dsh-qq-session-opener'
export const inject = ['webServer', 'sessionController']

async function body(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  try { return JSON.parse(text || '{}') } catch { return {} }
}
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export function apply(ctx) {
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-qq-session-opener/open',
    handler: async (req, res) => {
      try {
        const input = await body(req)
        const sessionId = String(input.sessionId || '').trim()
        const cwd = String(input.cwd || '').trim()
        if (!sessionId || !cwd) return json(res, 400, { ok: false, message: 'sessionId and cwd are required' })
        if (!ctx.sessionController || typeof ctx.sessionController.create !== 'function') {
          return json(res, 500, { ok: false, message: 'sessionController.create unavailable' })
        }
        const created = await ctx.sessionController.create({ sessionId, cwd })
        return json(res, 200, { ok: true, sessionId: String(created?.sessionId || sessionId), created })
      } catch (error) {
        return json(res, 500, { ok: false, message: String(error?.message || error) })
      }
    },
  })
}