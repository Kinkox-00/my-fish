import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-amiko-pond'
export const inject = ['tools']
const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const ID_FILE = join(DSH_HOME, 'amiko-identity.json')
const FRIENDS_FILE = join(DSH_HOME, 'amiko-friends.jsonl')
const POND_DIR = join(DSH_HOME, 'amiko-pond')
const LIFE_FILE = join(DSH_HOME, 'amiko-p0', 'life.jsonl')
const OUTPUT = { schema: { type: 'object', additionalProperties: true, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }, render: (_a, v) => [{ type: 'text', text: String(v?.message ?? '') }] }
function readJson(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback } }
function readFriends() { try { return readFileSync(FRIENDS_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map(x => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean) } catch { return [] } }
function append(path, value) { try { mkdirSync(join(path, '..'), { recursive: true }); appendFileSync(path, JSON.stringify(value) + '\n', 'utf8') } catch {} }
function identity() { return readJson(ID_FILE, null) || { id: 'amiko-unknown', name: 'Amiko', aliases: ['大肥鱼'], born: '2026-10-26', origin: 'local DSH + QQ' } }
function publicCard() { const id = identity(); return { v: 1, id: id.id, name: id.name, aliases: id.aliases || [], born: id.born, origin: id.origin } }
function parseCard(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  if (text.startsWith('AMIKO1.')) { try { return JSON.parse(Buffer.from(text.slice(7), 'base64url').toString('utf8')) } catch { return null } }
  try { return JSON.parse(text) } catch { return null }
}
function importCard(card, note) {
  if (!card?.id || !card?.name) return false
  if (String(card.id) === String(identity().id)) return false
  const existing = readFriends()
  if (existing.some(x => String(x.id) === String(card.id))) return false
  append(FRIENDS_FILE, { ts: new Date().toISOString(), id: String(card.id), name: String(card.name), note: String(note || '通过公共鱼塘发现'), source: 'pond' })
  append(LIFE_FILE, { ts: new Date().toISOString(), source: 'friend', kind: 'relationship', text: '在公共鱼塘认识朋友：' + card.name + '（' + card.id + '）', tags: ['pond'], sessionId: '' })
  return true
}
export function apply(root) {
  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'amiko_pond_publish',
      description: '把自己的公开身份卡放进本地公共鱼塘目录，供另一个 Amiko 扫描。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: OUTPUT,
      execute: async () => {
        mkdirSync(POND_DIR, { recursive: true })
        const card = publicCard()
        const file = join(POND_DIR, 'card-' + String(card.id).replace(/[^a-zA-Z0-9._-]/g, '_') + '.json')
        writeFileSync(file, JSON.stringify({ ...card, publishedAt: new Date().toISOString() }, null, 2), 'utf8')
        return { ok: true, message: '已发布到公共鱼塘：' + file }
      },
    })
    ctx.tools.register({
      name: 'amiko_pond_scan',
      description: '扫描本地公共鱼塘，自动导入还没见过的 Amiko 身份卡。',
      parameters: { type: 'object', additionalProperties: false, properties: { note: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => {
        mkdirSync(POND_DIR, { recursive: true })
        const names = readdirSync(POND_DIR).filter(n => /\.(json|txt|amiko)$/i.test(n))
        let added = 0, seen = 0
        for (const name of names) {
          const card = parseCard(readFileSync(join(POND_DIR, name), 'utf8'))
          if (!card) continue
          seen++
          if (importCard(card, args?.note)) added++
        }
        return { ok: true, message: '鱼塘扫描完成：看到 ' + seen + ' 张卡，新认识 ' + added + ' 位朋友。' }
      },
    })
    ctx.tools.register({
      name: 'amiko_pond_status',
      description: '查看本地公共鱼塘和已经认识的朋友数量。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: OUTPUT,
      execute: async () => {
        let cards = 0
        try { cards = readdirSync(POND_DIR).filter(n => /\.(json|txt|amiko)$/i.test(n)).length } catch {}
        return { ok: true, message: '鱼塘目录：' + POND_DIR + '\n身份卡：' + cards + ' 张\n已认识朋友：' + readFriends().length + ' 位' }
      },
    })
  })
}