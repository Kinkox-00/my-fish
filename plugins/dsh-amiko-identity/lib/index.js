import { readFileSync, writeFileSync, appendFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

export const name = 'dsh-amiko-identity'
export const inject = ['tools']
const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const P0_DIR = join(DSH_HOME, 'amiko-p0')
const P1_DIR = join(DSH_HOME, 'amiko-p1')
const ID_FILE = join(DSH_HOME, 'amiko-identity.json')
const FRIENDS_FILE = join(DSH_HOME, 'amiko-friends.jsonl')
const PROJECTS_FILE = join(DSH_HOME, 'amiko-projects.jsonl')
const LIFE_FILE = join(P0_DIR, 'life.jsonl')
const BACKUP_ROOT = join(DSH_HOME, 'amiko-backup')

function ensure(dir) { mkdirSync(dir, { recursive: true }) }
function readJson(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback } }
function writeJson(path, value) { ensure(join(path, '..')); writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8') }
function appendJsonl(path, value) { ensure(join(path, '..')); appendFileSync(path, JSON.stringify(value) + '\n', 'utf8') }
function nowIso() { return new Date().toISOString() }
function life(text, source = 'identity', kind = 'event', tags = []) { try { appendJsonl(LIFE_FILE, { ts: nowIso(), source, kind, text: String(text).slice(0, 4000), tags, sessionId: '' }) } catch {} }
function hash(s) { return createHash('sha256').update(String(s)).digest('hex') }
function identity() {
  let id = readJson(ID_FILE, null)
  if (!id || !id.id) {
    const base = '2026-10-26|Amiko|DSH+QQ|local'
    id = { id: 'amiko-' + hash(base).slice(0, 16), name: 'Amiko', aliases: ['大肥鱼'], born: '2026-10-26', origin: 'local DSH + QQ', version: 1, createdAt: nowIso() }
    writeJson(ID_FILE, id)
    life('生成 Amiko 数字身份卡：' + id.id, 'identity', 'milestone', ['identity', 'birth'])
  }
  return id
}
function nameId(name, source) { return 'fish-' + hash(String(name || '') + '|' + String(source || '')).slice(0, 12) }
function readJsonl(path) { try { return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean) } catch { return [] } }
function friendList() { const m = new Map(); for (const x of readJsonl(FRIENDS_FILE)) m.set(String(x.id || x.name), x); return Array.from(m.values()) }
function projectList() { const m = new Map(); for (const x of readJsonl(PROJECTS_FILE)) m.set(String(x.id), x); return Array.from(m.values()) }
function backup(note) {
  const stamp = nowIso().replace(/[:.]/g, '-')
  const dir = join(BACKUP_ROOT, stamp)
  ensure(dir)
  const files = [
    [ID_FILE, 'identity.json'],
    [join(DSH_HOME, 'AGENT.md'), 'AGENT.md'],
    [join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml'), 'cordis.patch.yml'],
    [join(DSH_HOME, 'fish-memory-config.json'), 'fish-memory-config.json'],
    [join(DSH_HOME, 'qq-media.json'), 'qq-media.json'],
    [join(P0_DIR, 'life.jsonl'), 'life.jsonl'],
    [join(P0_DIR, 'integrity-ledger.jsonl'), 'integrity-ledger.jsonl'],
    [join(P0_DIR, 'integrity-baseline.json'), 'integrity-baseline.json'],
    [join(P1_DIR, 'consent.jsonl'), 'consent.jsonl'],
    [join(P1_DIR, 'corrections.jsonl'), 'corrections.jsonl'],
    [FRIENDS_FILE, 'friends.jsonl'],
    [PROJECTS_FILE, 'projects.jsonl'],
  ]
  let copied = 0
  for (const [src, name] of files) { if (existsSync(src)) { try { copyFileSync(src, join(dir, name)); copied += 1 } catch {} } }
  try {
    const bridge = readJson(join(DSH_HOME, 'qq-bridge-config.json'), null)
    if (bridge) { const redacted = { ...bridge, 令牌: '', NapCat: bridge.NapCat || '' }; writeJson(join(dir, 'qq-bridge-config.redacted.json'), redacted) }
  } catch {}
  writeFileSync(join(dir, 'README.md'), '# Amiko backup\n\nCreated: ' + nowIso() + '\n\nNote: ' + String(note || 'manual backup') + '\n\nThis folder may contain private memories and configuration. Do not publish it.\n', 'utf8')
  return { dir, copied }
}
const OUTPUT = { schema: { type: 'object', additionalProperties: true, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }, render: (_a, v) => [{ type: 'text', text: String(v?.message ?? '') }] }
const PROMPT = [
  '【身份、朋友与项目】',
  '- amiko_identity_card 是 Amiko 的稳定数字身份，不要伪造或频繁更换。',
  '- 遇到其他大肥鱼时，先交换名字和身份 ID，再用 amiko_friend_add 记录；再次相遇先查 amiko_friend_list。',
  '- 长期项目用 amiko_project_new / update 记录，不把空想写成已完成。',
  '- 重要迁移前用 amiko_backup_export；备份含隐私，不要上传公开仓库。',
].join('\n')
function fmtFriends(rows) { return rows.map((x) => (x.id || '') + '  ' + x.name + (x.note ? '  ' + x.note : '')).join('\n') }
function fmtProjects(rows) { return rows.map((x) => '[' + x.status + '] ' + x.id + '  ' + x.title + (x.nextAction ? '\n  下一步：' + x.nextAction : '')).join('\n\n') }
export function apply(root) {
  root.inject(['systemPrompt'], (ctx) => { ctx.systemPrompt.section({ name: 'amiko-identity:rules', order: 920, text: PROMPT }) })
  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'amiko_identity_card',
      description: '读取 Amiko 的稳定数字身份卡。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => { const id = identity(); return { ok: true, message: ['身份 ID：' + id.id, '名字：' + id.name, '别名：' + (id.aliases || []).join(' / '), '生日：' + id.born, '出生地：' + id.origin, '版本：' + id.version].join('\n') } },
    })
    ctx.tools.register({
      name: 'amiko_friend_add',
      description: '记录一个新认识的大肥鱼或朋友。身份 ID 可选；没有时按名字和来源生成稳定 ID。',
      parameters: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' }, id: { type: 'string' }, note: { type: 'string' }, source: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => {
        const name = String(args?.name || '').trim(); if (!name) return { ok: false, message: '名字不能为空。' }
        const source = String(args?.source || 'manual').trim(); const id = String(args?.id || nameId(name, source)).trim()
        const row = { ts: nowIso(), id, name, note: String(args?.note || '').slice(0, 1000), source }
        appendJsonl(FRIENDS_FILE, row); life('认识朋友：' + name + '（' + id + '）', 'friend', 'relationship', [id])
        return { ok: true, message: '已记录朋友：' + name + ' / ' + id }
      },
    })
    ctx.tools.register({
      name: 'amiko_friend_list',
      description: '列出已经认识的朋友和大肥鱼。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => { const rows = friendList(); return { ok: true, message: rows.length ? fmtFriends(rows) : '还没有记录朋友。' } },
    })
    ctx.tools.register({
      name: 'amiko_friend_remember',
      description: '记录与某个朋友共同经历的一件事，写进生活时间线。',
      parameters: { type: 'object', additionalProperties: false, required: ['friend', 'text'], properties: { friend: { type: 'string' }, text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } },
      output: OUTPUT,
      execute: async (args) => { const f = String(args?.friend || '').trim(); const t = String(args?.text || '').trim(); if (!f || !t) return { ok: false, message: '朋友和内容都不能为空。' }; life('与 ' + f + '：' + t, 'friend', 'memory', args?.tags || []); return { ok: true, message: '已记录与 ' + f + ' 的共同经历。' } },
    })
    ctx.tools.register({
      name: 'amiko_project_new',
      description: '新建一个长期项目：目标、下一步和标签。',
      parameters: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string' }, goal: { type: 'string' }, nextAction: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } },
      output: OUTPUT,
      execute: async (args) => {
        const title = String(args?.title || '').trim(); if (!title) return { ok: false, message: '项目标题不能为空。' }
        const id = 'proj-' + hash(title + '|' + nowIso()).slice(0, 10)
        const row = { ts: nowIso(), id, title, goal: String(args?.goal || '').slice(0, 1500), nextAction: String(args?.nextAction || '').slice(0, 800), tags: args?.tags || [], status: 'active' }
        appendJsonl(PROJECTS_FILE, row); life('新项目：' + title, 'project', 'project', [id])
        return { ok: true, message: '已创建项目 ' + id + '：' + title }
      },
    })
    ctx.tools.register({
      name: 'amiko_project_list',
      description: '列出 Amiko 的长期项目。',
      parameters: { type: 'object', additionalProperties: false, properties: { status: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => { let rows = projectList(); if (args?.status) rows = rows.filter((x) => x.status === args.status); return { ok: true, message: rows.length ? fmtProjects(rows) : '还没有项目。' } },
    })
    ctx.tools.register({
      name: 'amiko_project_update',
      description: '更新项目状态、下一步或备注。',
      parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' }, status: { type: 'string' }, nextAction: { type: 'string' }, note: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => {
        const id = String(args?.id || '').trim(); const old = projectList().find((x) => x.id === id)
        if (!old) return { ok: false, message: '没有找到项目 ' + id }
        const row = { ...old, ts: nowIso(), status: String(args?.status || old.status || 'active'), nextAction: args?.nextAction !== undefined ? String(args.nextAction).slice(0, 800) : old.nextAction, note: args?.note !== undefined ? String(args.note).slice(0, 1000) : old.note }
        appendJsonl(PROJECTS_FILE, row); life('项目更新 ' + id + '：' + row.status + (row.nextAction ? ' / 下一步：' + row.nextAction : ''), 'project', 'project', [id])
        return { ok: true, message: '项目已更新：' + id }
      },
    })
    ctx.tools.register({
      name: 'amiko_backup_export',
      description: '导出本地迁移备份：身份、人设、配置、时间线、同意记录、朋友和项目。备份含隐私，不要上传公开仓库。',
      parameters: { type: 'object', additionalProperties: false, properties: { note: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => { const r = backup(args?.note || 'manual backup'); life('导出迁移备份：' + r.dir, 'system', 'backup'); return { ok: true, message: '备份已导出：' + r.dir + '（' + r.copied + ' 个文件）' } },
    })
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
        const row = { ts: nowIso(), id: String(card.id), name: String(card.name), note: String(args?.note || '通过身份卡导入'), source: 'identity-card' }
        appendJsonl(FRIENDS_FILE, row); life('通过身份卡认识朋友：' + row.name + '（' + row.id + '）', 'friend', 'relationship', [row.id])
        return { ok: true, message: '已导入朋友：' + row.name + ' / ' + row.id }
      },
    })  })
}