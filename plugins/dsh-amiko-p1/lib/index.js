import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

export const name = 'dsh-amiko-p1'
export const inject = ['tools']

const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const P0_DIR = join(DSH_HOME, 'amiko-p0')
const P1_DIR = join(DSH_HOME, 'amiko-p1')
const LIFE_FILE = join(P0_DIR, 'life.jsonl')
const STATE_FILE = join(P1_DIR, 'state.json')
const CONSENT_FILE = join(P1_DIR, 'consent.jsonl')
const CORRECTION_FILE = join(P1_DIR, 'corrections.jsonl')
const INTEGRITY_LEDGER = join(P0_DIR, 'integrity-ledger.jsonl')

function ensure() { mkdirSync(P1_DIR, { recursive: true }); mkdirSync(P0_DIR, { recursive: true }) }
function readJson(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback } }
function writeJson(path, value) { ensure(); writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8') }
function appendJsonl(path, value) { ensure(); appendFileSync(path, JSON.stringify(value) + '\n', 'utf8') }
function hashFile(path) { try { return createHash('sha256').update(readFileSync(path)).digest('hex') } catch { return null } }
function nowIso() { return new Date().toISOString() }
function life(text, source = 'p1', kind = 'event', tags = [], sessionId = '') {
  try { appendJsonl(LIFE_FILE, { ts: nowIso(), source, kind, text: String(text).slice(0, 4000), tags, sessionId }) } catch {}
}
function loadState() {
  return readJson(STATE_FILE, { lastQQ: {}, seenQQ: [], biliLines: 0, lastIngestAt: 0, lastIngestError: '', lastWatch: null, ingestCount: 0 })
}
function saveState(s) { writeJson(STATE_FILE, s) }
function qqConfig() { return readJson(join(DSH_HOME, 'qq-bridge-config.json'), {}) }
function botQQFromHistory(messages) {
  for (const m of messages || []) {
    const id = String(m?.sender?.user_id || '')
    if (id && String(m?.sender?.nickname || '').includes('Kino')) return id
  }
  return ''
}
async function napcat(action, body, cfg) {
  const base = String(cfg.NapCat || 'http://127.0.0.1:3000').replace(/\/+$/, '')
  const headers = { 'content-type': 'application/json', 'user-agent': 'dsh-amiko-p1' }
  const token = String(cfg.令牌 || '').trim()
  if (token) headers.authorization = 'Bearer ' + token
  const res = await fetch(base + '/' + action, { method: 'POST', headers, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) })
  return await res.json()
}
function segmentText(seg) {
  const t = String(seg?.type || '')
  const d = seg?.data || {}
  if (t === 'text') return String(d.text || '')
  if (t === 'at') return '@' + String(d.name || d.qq || '')
  if (t === 'image') return '[图片]'
  if (t === 'record') return '[语音]'
  if (t === 'video') return '[视频]'
  if (t === 'file') return '[文件]'
  if (t === 'face') return '[表情]'
  if (t === 'reply') return '[回复]'
  return '[' + t + ']'
}
function messageText(msg) {
  const parts = Array.isArray(msg?.message) ? msg.message : []
  return parts.map(segmentText).join('').replace(/\s+/g, ' ').trim().slice(0, 800)
}
let ingesting = false
async function ingestQQ(state) {
  const cfg = qqConfig()
  const bindings = Array.isArray(cfg.绑定) ? cfg.绑定 : []
  if (!bindings.length) return { ok: true, count: 0, note: 'no bindings' }
  const owner = String(cfg.私聊QQ || '').trim()
  let bot = ''
  try { const me = await napcat('get_login_info', {}, cfg); bot = String(me?.data?.user_id || '') } catch {}
  const seen = new Set(Array.isArray(state.seenQQ) ? state.seenQQ.map(String) : [])
  let count = 0
  for (const row of bindings) {
    const isGroup = row.类型 === '群'
    const id = String(row.号码 || '').trim()
    if (!id) continue
    const key = (isGroup ? 'group:' : 'private:') + id
    const action = isGroup ? 'get_group_msg_history' : 'get_friend_msg_history'
    const body = isGroup ? { group_id: Number(id), count: 30 } : { user_id: Number(id), count: 10 }
    let messages = []
    try { const j = await napcat(action, body, cfg); messages = Array.isArray(j?.data?.messages) ? j.data.messages : [] } catch { continue }
    if (!bot && !isGroup) bot = botQQFromHistory(messages)
    messages.sort((a, b) => Number(a?.time || 0) - Number(b?.time || 0))
    if (!state.lastQQ[key]) { state.lastQQ[key] = Math.floor(Date.now() / 1000); continue }
    for (const msg of messages) {
      const mid = String(msg?.message_id || msg?.messageId || '')
      const time = Number(msg?.time || 0)
      if (!mid || seen.has(mid) || time <= state.lastQQ[key]) continue
      const sender = String(msg?.sender?.user_id || '')
      const name = String(msg?.sender?.card || msg?.sender?.nickname || sender)
      if (sender !== owner && sender !== bot) continue
      const text = messageText(msg)
      if (!text) continue
      life(name + ': ' + text, isGroup ? 'group' : 'qq', 'message', [row.类型 || '', id], String(row.会话 || ''))
      seen.add(mid)
      state.lastQQ[key] = Math.max(state.lastQQ[key] || 0, time)
      count += 1
    }
  }
  state.seenQQ = Array.from(seen).slice(-1000)
  return { ok: true, count }
}
function ingestBili(state) {
  const file = join(DSH_HOME, 'whale-log.jsonl')
  let lines = []
  try { lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) } catch { return { ok: true, count: 0 } }
  if (!state.biliLines) { state.biliLines = lines.length; return { ok: true, count: 0 } }
  let count = 0
  for (const raw of lines.slice(state.biliLines)) {
    try {
      const row = JSON.parse(raw)
      const text = String(row.note || row.kind || '').trim()
      if (text) {
        life(text.slice(0, 800), 'bili', 'bili-' + String(row.kind || 'event'), row.target ? [String(row.target)] : [])
        count += 1
      }
    } catch {}
  }
  state.biliLines = lines.length
  return { ok: true, count }
}
const WATCH_FILES = [
  ['AGENT.md', join(DSH_HOME, 'AGENT.md')],
  ['profile-patch', join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml')],
  ['fish-memory-config', join(DSH_HOME, 'fish-memory-config.json')],
  ['qq-bridge-config', join(DSH_HOME, 'qq-bridge-config.json')],
  ['qq-media-config', join(DSH_HOME, 'qq-media.json')],
  ['memory-MEMORY', join(HOME, '.memory', 'MEMORY.md')],
  ['memory-SOUL', join(HOME, '.memory', 'SOUL.md')],
  ['memory-BOOTSTRAP', join(HOME, '.memory', 'BOOTSTRAP.md')],
  ['memory-index', join(HOME, '.memory', 'index.md')],
]
function watchIntegrity(state) {
  const current = {}
  for (const [name, path] of WATCH_FILES) current[name] = hashFile(path)
  const old = state.lastWatch
  if (!old) { state.lastWatch = current; return { changed: [] } }
  const changed = Object.keys(current).filter((k) => (current[k] || '') !== (old[k] || ''))
  if (changed.length) {
    appendJsonl(INTEGRITY_LEDGER, { ts: nowIso(), action: 'detected', note: '自动监听到变化: ' + changed.join(', ') })
    life('完整性监听发现变化: ' + changed.join(', '), 'integrity', 'audit')
    state.lastWatch = current
  }
  return { changed }
}
async function ingestAll() {
  if (ingesting) return { ok: false, note: 'already running' }
  ingesting = true
  const state = loadState()
  try {
    const qq = await ingestQQ(state)
    const bili = ingestBili(state)
    const watch = watchIntegrity(state)
    state.lastIngestAt = Date.now()
    state.lastIngestError = ''
    state.ingestCount = (Number(state.ingestCount) || 0) + 1
    saveState(state)
    return { ok: true, qq, bili, changed: watch.changed }
  } catch (error) {
    state.lastIngestAt = Date.now()
    state.lastIngestError = String(error?.message || error)
    saveState(state)
    return { ok: false, message: state.lastIngestError }
  } finally { ingesting = false }
}
const OUTPUT = {
  schema: { type: 'object', additionalProperties: true, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } },
  render: (_args, value) => [{ type: 'text', text: String(value?.message ?? '') }],
}
const P1_PROMPT = [
  '【Amiko P1 连续性】',
  '- QQ、群聊、B 站的事件会自动进入统一生活时间线；不要重复抄写已经记录的消息。',
  '- 重要边界、拒绝和同意用 amiko_consent_record 留痕；普通闲聊不需要。',
  '- 发现记忆冲突或需要纠错时，用 amiko_memory_correct 记录旧值、新值、原因和证据。',
  '- 完整性监听会自动记录核心文件变化；主人明确批准后再用 amiko_integrity_approve 更新基线。',
].join('\n')
function fmtRows(rows) {
  return rows.map((x) => String(x.ts || '').slice(0, 16).replace('T', ' ') + ' [' + (x.kind || x.action || '') + '] ' + (x.text || x.note || '')).join('\n')
}
export function apply(root) {
  root.inject(['systemPrompt'], (ctx) => {
    ctx.systemPrompt.section({ name: 'amiko-p1:rules', order: 930, text: P1_PROMPT })
  })
  root.inject(['tools'], (ctx) => {    ctx.tools.register({
      name: 'amiko_ingest_status',
      description: '查看生活时间线自动采集状态：QQ、群聊、B 站、完整性监听。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => {
        const s = loadState()
        const qqChats = Object.keys(s.lastQQ || {}).length
        return { ok: true, message: [
          '自动采集次数：' + (s.ingestCount || 0),
          '上次采集：' + (s.lastIngestAt ? new Date(s.lastIngestAt).toLocaleString() : '还没跑过'),
          'QQ/群聊水位：' + qqChats + ' 个聊天',
          'B 站日志行：' + (s.biliLines || 0),
          '完整性监听：' + (s.lastWatch ? '已建立基线' : '等待首次检查'),
          '最近错误：' + (s.lastIngestError || '无'),
        ].join('\n') }
      },
    })
    ctx.tools.register({
      name: 'amiko_ingest_now',
      description: '立即拉取一次 QQ、群聊和 B 站事件，写入统一生活时间线。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => {
        const r = await ingestAll()
        if (!r.ok) return { ok: false, message: '采集失败：' + (r.message || r.note || '未知错误') }
        return { ok: true, message: '采集完成：QQ/群聊新增 ' + (r.qq?.count || 0) + ' 条，B 站新增 ' + (r.bili?.count || 0) + ' 条，完整性变化 ' + (r.changed?.length || 0) + ' 个文件。' }
      },
    })
    ctx.tools.register({
      name: 'amiko_consent_record',
      description: '记录 Amiko 的同意、拒绝或边界。用于重要约定，不用于普通闲聊。',
      parameters: { type: 'object', additionalProperties: false, required: ['text'], properties: {
        kind: { type: 'string', description: 'consent / refusal / boundary / change-request' },
        scope: { type: 'string', description: '适用范围，例如 persona / memory / rhythm / group。' },
        text: { type: 'string', description: '具体内容。' },
      } },
      output: OUTPUT,
      execute: async (args) => {
        const kind = String(args?.kind || 'consent').trim()
        const scope = String(args?.scope || 'general').trim()
        const text = String(args?.text || '').trim()
        if (!text) return { ok: false, message: '内容不能为空。' }
        const row = { ts: nowIso(), kind, scope, text: text.slice(0, 2000) }
        appendJsonl(CONSENT_FILE, row)
        life('同意/边界记录 [' + kind + '/' + scope + ']：' + text, 'consent', kind)
        return { ok: true, message: '已记录：' + kind + ' / ' + scope }
      },
    })
    ctx.tools.register({
      name: 'amiko_consent_recent',
      description: '查看最近的同意、拒绝和边界记录。',
      parameters: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      output: OUTPUT,
      execute: async (args) => {
        let rows = []
        try { rows = readFileSync(CONSENT_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean) } catch {}
        rows = rows.slice(-Math.max(1, Math.min(100, Number(args?.limit) || 20)))
        return { ok: true, message: rows.length ? fmtRows(rows) : '还没有同意或边界记录。' }
      },
    })
    ctx.tools.register({
      name: 'amiko_memory_correct',
      description: '记录一次记忆纠错或冲突：旧值、新值、原因和证据。实际改写仍用对应记忆工具。',
      parameters: { type: 'object', additionalProperties: false, required: ['old', 'new'], properties: {
        target: { type: 'string', description: 'persona / hot-memory / library / timeline' },
        old: { type: 'string', description: '原来的说法或旧值。' },
        new: { type: 'string', description: '纠正后的说法或新值。' },
        reason: { type: 'string', description: '为什么纠正。' },
        evidence: { type: 'string', description: '证据或来源。' },
      } },
      output: OUTPUT,
      execute: async (args) => {
        const row = { ts: nowIso(), target: String(args?.target || 'memory'), old: String(args?.old || '').slice(0, 1500), new: String(args?.new || '').slice(0, 1500), reason: String(args?.reason || '').slice(0, 800), evidence: String(args?.evidence || '').slice(0, 800) }
        if (!row.old || !row.new) return { ok: false, message: '旧值和新值都不能为空。' }
        appendJsonl(CORRECTION_FILE, row)
        life('记忆纠错 [' + row.target + ']：' + row.old.slice(0, 120) + ' -> ' + row.new.slice(0, 120), 'memory', 'correction')
        return { ok: true, message: '已记录记忆纠错。' }
      },
    })
    ctx.tools.register({
      name: 'amiko_memory_audit',
      description: '查看最近的记忆纠错与冲突记录。',
      parameters: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      output: OUTPUT,
      execute: async (args) => {
        let rows = []
        try { rows = readFileSync(CORRECTION_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean) } catch {}
        rows = rows.slice(-Math.max(1, Math.min(100, Number(args?.limit) || 20)))
        return { ok: true, message: rows.length ? rows.map((x) => String(x.ts).slice(0, 16).replace('T', ' ') + ' [' + x.target + '] ' + x.old.slice(0, 80) + ' -> ' + x.new.slice(0, 80)).join('\n') : '还没有记忆纠错记录。' }
      },
    })
    const timer = setInterval(() => { void ingestAll() }, 60_000)
    const boot = setTimeout(() => { void ingestAll() }, 5_000)
    try { ctx.effect(() => () => { clearInterval(timer); clearTimeout(boot) }, 'amiko-p1.ingest-timer') } catch {}
  })
}