import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-amiko-consent-gate'
export const inject = ['tools']
const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const GATE_FILE = join(DSH_HOME, 'amiko-consent-gate.json')
const LEDGER = join(DSH_HOME, 'amiko-consent-gate.jsonl')
const LIFE_FILE = join(DSH_HOME, 'amiko-p0', 'life.jsonl')
const OUTPUT = { schema: { type: 'object', additionalProperties: true, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }, render: (_a, v) => [{ type: 'text', text: String(v?.message ?? '') }] }
function read(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback } }
function append(path, value) { try { mkdirSync(join(path, '..'), { recursive: true }); appendFileSync(path, JSON.stringify(value) + '\n', 'utf8') } catch {} }
function life(text) { append(LIFE_FILE, { ts: new Date().toISOString(), source: 'consent', kind: 'audit', text: String(text).slice(0, 2000), tags: [], sessionId: '' }) }
function active() { const gate = read(GATE_FILE, null); return gate && !gate.revoked && Date.parse(gate.expiresAt) > Date.now() && gate.confirmed === true }
const PROMPT = [
  '【同意门】',
  '- 涉及核心人设、长期记忆或重要配置的改动，必须主人在对话中明确同意。',
  '- 同意前先调用 amiko_consent_request，得到 token 后请主人确认；确认后再调用 amiko_consent_confirm。',
  '- 没有 active 同意 token 时，不得调用 soul_update / memory_rewrite / 修改核心人格文件；只能提出建议。',
  '- 这是可审计的同意门；不要自己代替主人确认。',
].join('\n')
export function apply(root) {
  root.inject(['systemPrompt'], (ctx) => { ctx.systemPrompt.section({ name: 'amiko-consent-gate:rules', order: 930, text: PROMPT }) })
  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'amiko_consent_request',
      description: '主人明确要求改人设/长期记忆时，开一个带 token 的同意请求，等待主人确认。',
      parameters: { type: 'object', additionalProperties: false, required: ['scope', 'reason'], properties: { scope: { type: 'string' }, reason: { type: 'string' }, ttlMinutes: { type: 'integer', minimum: 1, maximum: 1440 } } },
      output: OUTPUT,
      execute: async (args) => {
        const token = randomUUID().replace(/-/g, '').slice(0, 12)
        const ttl = Math.max(1, Math.min(1440, Number(args?.ttlMinutes) || 15))
        const gate = { token, scope: String(args?.scope || 'persona'), reason: String(args?.reason || ''), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttl * 60000).toISOString(), confirmed: false, revoked: false }
        writeFileSync(GATE_FILE, JSON.stringify(gate, null, 2), 'utf8')
        append(LEDGER, { ...gate, action: 'request' })
        return { ok: true, message: '同意请求已建立。\nToken：' + token + '\n范围：' + gate.scope + '\n有效期：' + ttl + ' 分钟\n请主人明确回复确认后，再调用 amiko_consent_confirm。' }
      },
    })
    ctx.tools.register({
      name: 'amiko_consent_confirm',
      description: '主人明确确认后，确认当前同意请求；没有确认前不会被视为 active。',
      parameters: { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => {
        const gate = read(GATE_FILE, null)
        if (!gate) return { ok: false, message: '没有待确认的同意请求。' }
        if (String(args?.token || '') !== gate.token) return { ok: false, message: 'Token 不匹配。' }
        if (Date.parse(gate.expiresAt) <= Date.now()) return { ok: false, message: '同意请求已过期，请重新建立。' }
        gate.confirmed = true
        gate.confirmedAt = new Date().toISOString()
        writeFileSync(GATE_FILE, JSON.stringify(gate, null, 2), 'utf8')
        append(LEDGER, { ...gate, action: 'confirm' })
        life('主人确认了同意门：' + gate.scope + ' — ' + gate.reason)
        return { ok: true, message: '同意已确认：' + gate.scope + '（token ' + gate.token + '）' }
      },
    })
    ctx.tools.register({
      name: 'amiko_consent_status',
      description: '查看当前同意门状态；active=false 时不得改核心人设/长期记忆。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: OUTPUT,
      execute: async () => {
        const gate = read(GATE_FILE, null)
        if (!gate) return { ok: true, message: '没有同意请求。active=false' }
        return { ok: true, message: 'active=' + active() + '\n范围：' + gate.scope + '\n原因：' + gate.reason + '\n确认：' + gate.confirmed + '\n过期：' + gate.expiresAt }
      },
    })
    ctx.tools.register({
      name: 'amiko_consent_revoke',
      description: '撤销当前同意门，之后核心人设/长期记忆改动必须重新征得主人同意。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: OUTPUT,
      execute: async () => {
        const gate = read(GATE_FILE, null)
        if (gate) { gate.revoked = true; writeFileSync(GATE_FILE, JSON.stringify(gate, null, 2), 'utf8'); append(LEDGER, { ...gate, action: 'revoke' }) }
        return { ok: true, message: '同意门已撤销。' }
      },
    })
  })
}