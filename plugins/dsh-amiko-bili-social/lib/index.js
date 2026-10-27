import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const name = 'dsh-amiko-bili-social'
export const inject = ['tools']
const execFileAsync = promisify(execFile)
const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const BILI_CLI = join(DSH_HOME, 'plugins', 'dsh-bili-whale', 'tools', 'bili.mjs')
const SOCIAL_FILE = join(DSH_HOME, 'amiko-bili-social.jsonl')
const LIFE_FILE = join(DSH_HOME, 'amiko-p0', 'life.jsonl')
const OUTPUT = { schema: { type: 'object', additionalProperties: true, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }, render: (_a, v) => [{ type: 'text', text: String(v?.message ?? '') }] }
function append(path, value) { try { mkdirSync(join(path, '..'), { recursive: true }); appendFileSync(path, JSON.stringify(value) + '\n', 'utf8') } catch {} }
function readRows(limit = 30) { try { return readFileSync(SOCIAL_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map(x => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean).slice(-limit) } catch { return [] } }
function life(text) { append(LIFE_FILE, { ts: new Date().toISOString(), source: 'bili', kind: 'relationship', text: String(text).slice(0, 2000), tags: ['bili-social'], sessionId: '' }) }
async function run(args, timeout = 30000) {
  const { stdout } = await execFileAsync(process.execPath, [BILI_CLI, ...args], { cwd: join(DSH_HOME, 'plugins', 'dsh-bili-whale'), windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 })
  return String(stdout || '')
}
export function apply(root) {
  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'bili_social_scan',
      description: '扫描 B 站最近收到的赞和互动，把新出现的鱼记进本地社交记忆。只读，不主动打扰。',
      parameters: { type: 'object', additionalProperties: false, properties: { hours: { type: 'integer', minimum: 1, maximum: 720 } } },
      output: OUTPUT,
      execute: async (args) => {
        const hours = Math.max(1, Math.min(720, Number(args?.hours) || 72))
        const raw = await run(['likes', '--hours', String(hours), '--json'])
        let data
        try { data = JSON.parse(raw) } catch { return { ok: false, message: 'B 站返回不是 JSON：' + raw.slice(0, 300) } }
        const items = Array.isArray(data?.items) ? data.items : []
        const existing = new Set(readRows(500).map(x => String(x.mid || '')))
        let added = 0
        for (const item of items) {
          const mid = String(item?.mid || item?.uid || '')
          const name = String(item?.uname || item?.name || '未知鱼')
          if (!mid || existing.has(mid)) continue
          append(SOCIAL_FILE, { ts: new Date().toISOString(), mid, name, kind: 'like', rawTime: item?.time || '' })
          life('B 站有新鱼游过：' + name + '（mid ' + mid + '）赞了我')
          existing.add(mid); added++
        }
        return { ok: true, message: 'B 站社交扫描完成：收到 ' + items.length + ' 条互动，新记住 ' + added + ' 条鱼。' }
      },
    })
    ctx.tools.register({
      name: 'bili_social_note',
      description: '记录一条和 B 站朋友的相遇、对话或印象。',
      parameters: { type: 'object', additionalProperties: false, required: ['name'], properties: { mid: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' }, kind: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => {
        const row = { ts: new Date().toISOString(), mid: String(args?.mid || ''), name: String(args?.name || ''), kind: String(args?.kind || 'note'), note: String(args?.note || '') }
        append(SOCIAL_FILE, row)
        life('B 站朋友记录：' + row.name + (row.mid ? '（mid ' + row.mid + '）' : '') + ' — ' + row.note)
        return { ok: true, message: '已记住这条鱼：' + row.name }
      },
    })
    ctx.tools.register({
      name: 'bili_social_list',
      description: '查看最近记住的 B 站朋友和互动。',
      parameters: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      output: OUTPUT,
      execute: async (args) => {
        const rows = readRows(Math.max(1, Math.min(100, Number(args?.limit) || 20)))
        return { ok: true, message: rows.length ? rows.map(x => x.ts.slice(0, 16).replace('T', ' ') + '  ' + x.name + (x.mid ? ' / ' + x.mid : '') + '  ' + (x.note || x.kind || '')).join('\n') : 'B 站社交记忆还是空的。' }
      },
    })
    ctx.tools.register({
      name: 'bili_social_whois',
      description: '按 mid 查一个 B 站用户的昵称，先认准名字再互动。',
      parameters: { type: 'object', additionalProperties: false, required: ['mid'], properties: { mid: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => {
        const mid = String(args?.mid || '').trim()
        if (!/^\d+$/.test(mid)) return { ok: false, message: 'mid 必须是数字。' }
        const text = await run(['whois', mid])
        return { ok: true, message: text.trim() || '没有查到这只鱼。' }
      },
    })
  })
}