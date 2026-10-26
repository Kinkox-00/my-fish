import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-amiko-friend-link'
export const inject = ['tools']
const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const ID_FILE = join(DSH_HOME, 'amiko-identity.json')
const FRIENDS_FILE = join(DSH_HOME, 'amiko-friends.jsonl')
const LIFE_FILE = join(DSH_HOME, 'amiko-p0', 'life.jsonl')
const OUTPUT = { schema: { type: 'object', additionalProperties: true, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }, render: (_a, v) => [{ type: 'text', text: String(v?.message ?? '') }] }
function readJson(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback } }
function append(path, value) { try { mkdirSync(join(path, '..'), { recursive: true }); appendFileSync(path, JSON.stringify(value) + '\n', 'utf8') } catch {} }
function identity() { return readJson(ID_FILE, null) || { id: 'amiko-unknown', name: 'Amiko', aliases: ['大肥鱼'], born: '2026-10-26', origin: 'local DSH + QQ' } }
function life(text) { append(LIFE_FILE, { ts: new Date().toISOString(), source: 'friend', kind: 'relationship', text: String(text).slice(0, 2000), tags: [], sessionId: '' }) }
export function apply(root) {
  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'amiko_identity_public',
      description: '导出可分享的 Amiko 身份卡，用于和另一个实例交换身份。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => {
        const id = identity()
        const card = { v: 1, id: id.id, name: id.name, aliases: id.aliases || [], born: id.born, origin: id.origin }
        return { ok: true, message: 'AMIKO1.' + Buffer.from(JSON.stringify(card), 'utf8').toString('base64url') }
      },
    })
    ctx.tools.register({
      name: 'amiko_friend_import',
      description: '导入另一个 Amiko 分享的身份卡，并登记为朋友。',
      parameters: { type: 'object', additionalProperties: false, required: ['card'], properties: { card: { type: 'string' }, note: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => {
        const raw = String(args?.card || '').trim().replace(/^AMIKO1\./, '')
        let card = null
        try { card = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) } catch { return { ok: false, message: '身份卡格式无效。' } }
        if (!card?.id || !card?.name) return { ok: false, message: '身份卡缺少 id 或 name。' }
        const row = { ts: new Date().toISOString(), id: String(card.id), name: String(card.name), note: String(args?.note || '通过身份卡导入'), source: 'identity-card' }
        append(FRIENDS_FILE, row)
        life('通过身份卡认识朋友：' + row.name + '（' + row.id + '）')
        return { ok: true, message: '已导入朋友：' + row.name + ' / ' + row.id }
      },
    })
  })
}