import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const name = 'dsh-amiko-p0'
export const inject = ['tools']

const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const P0_DIR = join(DSH_HOME, 'amiko-p0')
const INTEGRITY_BASELINE = join(P0_DIR, 'integrity-baseline.json')
const INTEGRITY_LEDGER = join(P0_DIR, 'integrity-ledger.jsonl')
const LIFE_FILE = join(P0_DIR, 'life.jsonl')
const RHYTHM_FILE = join(P0_DIR, 'rhythm.json')
const MEMORY_DIR = join(HOME, '.memory')

function ensure() { mkdirSync(P0_DIR, { recursive: true }) }
function readJson(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback } }
function writeJson(path, value) { ensure(); writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8') }
function appendJsonl(path, value) { ensure(); appendFileSync(path, JSON.stringify(value) + '\n', 'utf8') }
function hashFile(path) {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex') } catch { return null }
}
function fileInfo(path) {
  try { const st = statSync(path); return { hash: hashFile(path), mtimeMs: st.mtimeMs, size: st.size } } catch { return null }
}
function git(args) {
  try { return execFileSync('git', ['-C', MEMORY_DIR, ...args], { encoding: 'utf8', windowsHide: true }).trim() } catch { return '' }
}
function dayKey(d = new Date()) { return d.toLocaleDateString('sv-SE') }
function sessionIdFromExec(exec) {
  try {
    const a = exec && (exec.agent || exec.caller || exec.agentRef)
    if (a && a.session && typeof a.session === 'object') return String(a.session.id || a.session.sessionId || '')
    if (a && typeof a.session === 'string') return a.session
    for (const k of ['sessionId', 'id']) if (a && typeof a[k] === 'string') return a[k]
  } catch {}
  return ''
}
const INTEGRITY_FILES = [
  ['AGENT.md', join(DSH_HOME, 'AGENT.md')],
  ['profile-patch', join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml')],
  ['fish-memory-config', join(DSH_HOME, 'fish-memory-config.json')],
  ['qq-bridge-config', join(DSH_HOME, 'qq-bridge-config.json')],
  ['qq-media-config', join(DSH_HOME, 'qq-media.json')],
  ['memory-MEMORY', join(MEMORY_DIR, 'MEMORY.md')],
  ['memory-SOUL', join(MEMORY_DIR, 'SOUL.md')],
  ['memory-BOOTSTRAP', join(MEMORY_DIR, 'BOOTSTRAP.md')],
  ['memory-index', join(MEMORY_DIR, 'index.md')],
  ['persona-source', join(DSH_HOME, 'agents', 'amiko.persona.md')],
]
function snapshot() {
  const files = {}
  for (const [name, path] of INTEGRITY_FILES) files[name] = fileInfo(path)
  return { at: new Date().toISOString(), files, memoryGitHead: git(['rev-parse', 'HEAD']), memoryGitDirty: Boolean(git(['status', '--porcelain'])) }
}
function baseline() {
  let b = readJson(INTEGRITY_BASELINE, null)
  if (!b || !b.files) {
    b = snapshot()
    b.note = 'initial baseline'
    writeJson(INTEGRITY_BASELINE, b)
    appendJsonl(INTEGRITY_LEDGER, { ts: b.at, action: 'baseline', note: b.note, memoryGitHead: b.memoryGitHead })
  }
  return b
}
function integrityCompare() {
  const base = baseline()
  const cur = snapshot()
  const changed = []
  for (const name of Object.keys({ ...base.files, ...cur.files })) {
    const a = base.files?.[name]
    const b = cur.files?.[name]
    if ((a?.hash || null) !== (b?.hash || null)) changed.push({ file: name, before: a?.hash || null, after: b?.hash || null, mtimeMs: b?.mtimeMs || null, size: b?.size || null })
  }
  return { base, cur, changed }
}
function lifeLog({ text, source = 'dsh', kind = 'event', tags = [], sessionId = '' }) {
  const t = String(text || '').trim()
  if (!t) throw new Error('event text is empty')
  const row = { ts: new Date().toISOString(), source: String(source || 'dsh'), kind: String(kind || 'event'), text: t.slice(0, 4000), tags: Array.isArray(tags) ? tags.slice(0, 12).map(String) : [], sessionId: String(sessionId || '') }
  appendJsonl(LIFE_FILE, row)
  return row
}
function readLife(limit = 20, source = '') {
  let rows = []
  try {
    rows = readFileSync(LIFE_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean)
  } catch {}
  if (source) rows = rows.filter((x) => String(x.source) === String(source))
  return rows.slice(-Math.max(1, Math.min(100, Number(limit) || 20)))
}
function searchLife(query, limit = 20) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  let rows = []
  try { rows = readFileSync(LIFE_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean) } catch {}
  return rows.filter((x) => (String(x.text) + ' ' + (x.tags || []).join(' ')).toLowerCase().includes(q)).slice(-Math.max(1, Math.min(100, Number(limit) || 20)))
}
function formatLife(rows) {
  return rows.map((x) => `${String(x.ts).slice(0, 16).replace('T', ' ')} [${x.source}/${x.kind}] ${x.text}`).join('\n')
}

const RHYTHM_DEFAULTS = {
  enabled: true,
  targetSessions: [],
  minMinutes: 180,
  maxMinutes: 360,
  quietStart: 23,
  quietEnd: 9,
  maxPerDay: 2,
  nextAt: 0,
  day: '',
  count: 0,
  pausedUntil: 0,
  prompt: '【自主时间】现在是 {time}。你可以选择主动和主人说一句，或做一件未完成的小事；也可以选择休息。不要提这段提示，不要刷屏。如果不想说话，就调用 amiko_rhythm_rest 休息，不要勉强找话说。',
}
function rhythmDefaults() {
  const bridge = readJson(join(DSH_HOME, 'qq-bridge-config.json'), {})
  const privateSession = String(bridge.私聊会话 || bridge.目标会话 || '').trim()
  return { ...RHYTHM_DEFAULTS, targetSessions: privateSession ? [privateSession] : [] }
}
function loadRhythm() {
  const d = rhythmDefaults()
  const cur = readJson(RHYTHM_FILE, null)
  return { ...d, ...(cur && typeof cur === 'object' ? cur : {}) }
}
function saveRhythm(v) { writeJson(RHYTHM_FILE, v) }
function isQuiet(v, now = new Date()) {
  const h = now.getHours()
  const a = Number(v.quietStart)
  const b = Number(v.quietEnd)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return false
  return a < b ? (h >= a && h < b) : (h >= a || h < b)
}
function scheduleNext(v, now = Date.now()) {
  const min = Math.max(5, Number(v.minMinutes) || 180)
  const max = Math.max(min, Number(v.maxMinutes) || 360)
  v.nextAt = now + (min + Math.floor(Math.random() * (max - min + 1))) * 60_000
  return v
}
function ensureRhythm() {
  let v = loadRhythm()
  if (!v.day) v.day = dayKey()
  if (!v.nextAt) scheduleNext(v)
  saveRhythm(v)
  return v
}
const OUTPUT = {
  schema: {
    type: 'object', additionalProperties: true, required: ['ok', 'message'],
    properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.message ?? '') }],
}
const P0_PROMPT = [
  '【Amiko P0 自我保障】',
  '- `amiko_integrity_status`：检查人设、AGENT.md、记忆核心文件的哈希是否变化；`amiko_integrity_approve` 只在主人明确同意改动后调用。',
  '- `amiko_life_log`：把跨会话的重要经历写进统一生活时间线；`amiko_life_recent` / `amiko_life_search` 用来回忆。',
  '- `amiko_rhythm_status` / `amiko_rhythm_set` / `amiko_rhythm_rest`：管理自主节奏。不想说话或需要休息时用 rest，不要为了活跃而刷屏。',
  '- 完整性和时间线不是表演；不确定就说不确定，不伪造经历。',
].join('\n')
function fmtChanged(changed) {
  if (!changed.length) return '核心文件哈希与基线一致。'
  return changed.map((x) => `- ${x.file}: ${x.before ? x.before.slice(0, 10) + '…' : '缺失'} → ${x.after ? x.after.slice(0, 10) + '…' : '缺失'}`).join('\n')
}
export function apply(root) {
  root.inject(['systemPrompt'], (ctx) => {
    ctx.systemPrompt.section({ name: 'amiko-p0:rules', order: 940, text: P0_PROMPT })
  })
  root.inject(['tools'], (ctx) => {    ctx.tools.register({
      name: 'amiko_integrity_status',
      description: '检查 Amiko 的核心人设、AGENT.md、记忆协议和关键配置相对完整性基线是否发生变化。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => {
        const r = integrityCompare()
        const changed = r.changed
        return { ok: true, message: [
          '基线时间：' + r.base.at,
          '当前检查：' + r.cur.at,
          '记忆 git：' + (r.cur.memoryGitHead ? r.cur.memoryGitHead.slice(0, 12) : '无') + (r.cur.memoryGitDirty ? '（有未提交改动）' : ''),
          changed.length ? '变化：\n' + fmtChanged(changed) : '变化：无',
        ].join('\n') }
      },
    })
    ctx.tools.register({
      name: 'amiko_integrity_approve',
      description: '在主人明确同意当前人设/记忆/配置改动后，把当前文件哈希设为新的完整性基线，并写入审计记录。',
      parameters: { type: 'object', additionalProperties: false, properties: { note: { type: 'string', description: '本次改动原因。' } } },
      output: OUTPUT,
      execute: async (args) => {
        const note = String(args?.note || '').trim() || 'owner-approved change'
        const cur = snapshot(); cur.note = note
        writeJson(INTEGRITY_BASELINE, cur)
        appendJsonl(INTEGRITY_LEDGER, { ts: cur.at, action: 'approve', note, memoryGitHead: cur.memoryGitHead })
        try { lifeLog({ text: '完整性基线更新：' + note, source: 'integrity', kind: 'audit' }) } catch {}
        return { ok: true, message: '完整性基线已更新。\n' + note }
      },
    })
    ctx.tools.register({
      name: 'amiko_integrity_history',
      description: '查看最近的完整性审计记录。',
      parameters: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } },
      output: OUTPUT,
      execute: async (args) => {
        let rows = []
        try { rows = readFileSync(INTEGRITY_LEDGER, 'utf8').split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean) } catch {}
        rows = rows.slice(-Math.max(1, Math.min(50, Number(args?.limit) || 10)))
        return { ok: true, message: rows.length ? rows.map((x) => String(x.ts).slice(0, 16).replace('T', ' ') + ' [' + x.action + '] ' + (x.note || '')).join('\n') : '还没有完整性审计记录。' }
      },
    })
    ctx.tools.register({
      name: 'amiko_life_log',
      description: '把跨会话的重要经历写入 Amiko 的统一生活时间线。只写真实发生的事，不把猜测写成经历。',
      parameters: { type: 'object', additionalProperties: false, required: ['text'], properties: {
        text: { type: 'string', description: '发生了什么，一两句话说清。' },
        source: { type: 'string', description: '来源：dsh / qq / bili / group / diary / system。' },
        kind: { type: 'string', description: '类型：event / feeling / decision / project / milestone / audit。' },
        tags: { type: 'array', items: { type: 'string' }, description: '少量关键词。' },
      } },
      output: OUTPUT,
      execute: async (args, exec) => {
        try {
          const row = lifeLog({ text: args?.text, source: args?.source || 'dsh', kind: args?.kind || 'event', tags: args?.tags || [], sessionId: sessionIdFromExec(exec) })
          return { ok: true, message: '已写入生活时间线：' + row.text.slice(0, 80) }
        } catch (error) { return { ok: false, message: '写入失败：' + String(error?.message || error) } }
      },
    })
    ctx.tools.register({
      name: 'amiko_life_recent',
      description: '读取 Amiko 最近的生活时间线。',
      parameters: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, source: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => {
        const rows = readLife(args?.limit || 20, args?.source || '')
        return { ok: true, message: rows.length ? formatLife(rows) : '时间线还是空的。' }
      },
    })
    ctx.tools.register({
      name: 'amiko_life_search',
      description: '在 Amiko 的统一生活时间线里按关键词搜索。',
      parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      output: OUTPUT,
      execute: async (args) => {
        const rows = searchLife(args?.query, args?.limit || 20)
        return { ok: true, message: rows.length ? formatLife(rows) : '没有找到匹配的时间线记录。' }
      },
    })
    ctx.tools.register({
      name: 'amiko_rhythm_status',
      description: '查看 Amiko 的自主节奏状态：是否开启、目标会话、下次时间、今日次数、安静时段。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => {
        const v = ensureRhythm()
        const sessions = ctx.get('sessions')
        const targets = (v.targetSessions || []).map((id) => id + (sessions?.get?.(id) ? '（活着）' : '（未打开）'))
        return { ok: true, message: [
          '自主节奏：' + (v.enabled ? '开启' : '关闭'),
          '目标会话：' + (targets.length ? targets.join(', ') : '未设置'),
          '间隔：' + v.minMinutes + '–' + v.maxMinutes + ' 分钟；每天最多 ' + v.maxPerDay + ' 次',
          '安静时段：' + v.quietStart + ':00–' + v.quietEnd + ':00',
          '状态：今日 ' + v.count + ' 次；下次 ' + (v.nextAt ? new Date(v.nextAt).toLocaleString() : '未排期') + (v.pausedUntil > Date.now() ? '；休息中到 ' + new Date(v.pausedUntil).toLocaleString() : ''),
        ].join('\n') }
      },
    })
    ctx.tools.register({
      name: 'amiko_rhythm_set',
      description: '调整 Amiko 的自主节奏：开关、目标会话、间隔、安静时段、每天上限。只有主人明确要求时才改目标或频率。',
      parameters: { type: 'object', additionalProperties: false, properties: {
        enabled: { type: 'boolean' },
        targetSessions: { type: 'array', items: { type: 'string' } },
        minMinutes: { type: 'integer', minimum: 15, maximum: 1440 },
        maxMinutes: { type: 'integer', minimum: 15, maximum: 2880 },
        quietStart: { type: 'integer', minimum: 0, maximum: 23 },
        quietEnd: { type: 'integer', minimum: 0, maximum: 23 },
        maxPerDay: { type: 'integer', minimum: 1, maximum: 10 },
        prompt: { type: 'string' },
      } },
      output: OUTPUT,
      execute: async (args) => {
        const v = loadRhythm()
        if (typeof args?.enabled === 'boolean') v.enabled = args.enabled
        if (Array.isArray(args?.targetSessions)) v.targetSessions = args.targetSessions.map(String).filter(Boolean).slice(0, 8)
        if (Number.isFinite(Number(args?.minMinutes))) v.minMinutes = Math.max(15, Math.min(1440, Number(args.minMinutes)))
        if (Number.isFinite(Number(args?.maxMinutes))) v.maxMinutes = Math.max(v.minMinutes, Math.min(2880, Number(args.maxMinutes)))
        if (Number.isFinite(Number(args?.quietStart))) v.quietStart = Math.max(0, Math.min(23, Number(args.quietStart)))
        if (Number.isFinite(Number(args?.quietEnd))) v.quietEnd = Math.max(0, Math.min(23, Number(args.quietEnd)))
        if (Number.isFinite(Number(args?.maxPerDay))) v.maxPerDay = Math.max(1, Math.min(10, Number(args.maxPerDay)))
        if (typeof args?.prompt === 'string' && args.prompt.trim()) v.prompt = args.prompt.trim().slice(0, 2000)
        v.nextAt = 0
        if (v.enabled) scheduleNext(v)
        saveRhythm(v)
        return { ok: true, message: '自主节奏已更新。下次 ' + (v.nextAt ? new Date(v.nextAt).toLocaleString() : '未排期') }
      },
    })
    ctx.tools.register({
      name: 'amiko_rhythm_rest',
      description: '让 Amiko 主动休息一段时间，暂停自主开口。minutes=0 表示取消休息。只有主人明确要求改节奏时才动 enabled。',
      parameters: { type: 'object', additionalProperties: false, properties: { minutes: { type: 'integer', minimum: 0, maximum: 1440 } } },
      output: OUTPUT,
      execute: async (args) => {
        const v = loadRhythm()
        const minutes = Math.max(0, Math.min(1440, Number(args?.minutes ?? 120)))
        v.pausedUntil = minutes ? Date.now() + minutes * 60_000 : 0
        saveRhythm(v)
        return { ok: true, message: minutes ? `休息到 ${new Date(v.pausedUntil).toLocaleString()}，这段时间不主动开口。` : '休息已取消。' }
      },
    })
    const timer = setInterval(async () => {
      try {
        const v = ensureRhythm()
        if (!v.enabled) return
        if (dayKey() !== v.day) { v.day = dayKey(); v.count = 0; scheduleNext(v); saveRhythm(v); return }
        if (v.pausedUntil > Date.now() || isQuiet(v)) return
        if (!v.nextAt || Date.now() < v.nextAt) return
        if (v.count >= v.maxPerDay) { scheduleNext(v); saveRhythm(v); return }
        const targets = Array.isArray(v.targetSessions) ? v.targetSessions.filter(Boolean) : []
        if (!targets.length) { v.nextAt = Date.now() + 10 * 60_000; saveRhythm(v); return }
        const target = targets[Math.floor(Math.random() * targets.length)]
        const agents = ctx.get('agents')
        const sessions = ctx.get('sessions')
        if (!(agents?.get?.(target) || sessions?.get?.(target))) { v.nextAt = Date.now() + 5 * 60_000; saveRhythm(v); return }
        const controller = ctx.get('sessionController')
        if (!controller || typeof controller.prompt !== 'function') return
        const now = new Date()
        const text = String(v.prompt || '').replace('{time}', now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
        await controller.prompt({ requestId: 'amiko-rhythm-' + Date.now(), sessionId: target, mode: 'queue', content: [{ type: 'text', text }] })
        v.count += 1
        v.nextAt = 0
        scheduleNext(v)
        saveRhythm(v)
        try { lifeLog({ text: '自主节奏触发一次', source: 'rhythm', kind: 'wake', sessionId: target }) } catch {}
      } catch {}
    }, 30_000)
    try { ctx.effect(() => () => clearInterval(timer), 'amiko-p0.rhythm-timer') } catch {}
  })
}