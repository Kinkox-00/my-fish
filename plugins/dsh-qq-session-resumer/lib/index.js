export const name = 'dsh-qq-session-resumer'
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
    path: '/dsh-qq-session-resumer/resume',
    handler: async (req, res) => {
      try {
        const input = await body(req)
        const sessionId = String(input.sessionId || '').trim()
        if (!sessionId) return json(res, 400, { ok: false, message: 'sessionId is required' })
        if (!ctx.sessionController || typeof ctx.sessionController.resolveAgent !== 'function') {
          return json(res, 500, { ok: false, message: 'sessionController.resolveAgent unavailable' })
        }
        const found = await ctx.sessionController.resolveAgent(sessionId)
        if (found && found.error) {
          return json(res, 500, { ok: false, sessionId, error: found.error })
        }
        return json(res, 200, { ok: true, sessionId })
      } catch (error) {
        return json(res, 500, { ok: false, message: String(error?.message || error) })
      }
    },
  })
}