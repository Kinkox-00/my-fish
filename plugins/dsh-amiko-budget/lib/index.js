import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-amiko-budget'
export const inject = ['tools']
const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const FILE = join(DSH_HOME, 'amiko-budget.json')
const LIFE = join(DSH_HOME, 'amiko-p0', 'life.jsonl')
const OUTPUT = { schema: { type: 'object', additionalProperties: true, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }, render: (_a, v) => [{ type: 'text', text: String(v?.message ?? '') }] }
const today = () => new Date().toLocaleDateString('sv-SE')
function read() { try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch { return null } }
function save(v) { mkdirSync(DSH_HOME, { recursive: true }); writeFileSync(FILE, JSON.stringify(v, null, 2) + '\n', 'utf8') }
function current() { let v = read(); if (!v || v.date !== today()) { v = { date: today(), dailyLimitCny: 2, spentCny: 0, entries: [] }; save(v) } return v }
function log(text) { try { mkdirSync(join(DSH_HOME, 'amiko-p0'), { recursive: true }); const row = { ts: new Date().toISOString(), source: 'budget', kind: 'spend', text }; appendFileSync(LIFE, JSON.stringify(row) + '\n', 'utf8') } catch {} }
export function apply(root) {
  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'amiko_budget_status',
      description: '查看 Amiko 今日自主额度：每日上限、已用、剩余和最近记录。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => { const v = current(); return { ok: true, message: ['日期：' + v.date, '每日上限：¥' + Number(v.dailyLimitCny).toFixed(2), '今日已用：¥' + Number(v.spentCny).toFixed(2), '剩余：¥' + Math.max(0, Number(v.dailyLimitCny) - Number(v.spentCny)).toFixed(2), '记录：' + (v.entries.length ? v.entries.slice(-5).map((x) => '¥' + x.amount + ' ' + x.reason).join(' / ') : '无')].join('\n') } },
    })
    ctx.tools.register({
      name: 'amiko_budget_set',
      description: '设置 Amiko 每日自主额度。默认 2 元；只有主人明确要求时改。',
      parameters: { type: 'object', additionalProperties: false, required: ['limitCny'], properties: { limitCny: { type: 'number', minimum: 0 } } },
      output: OUTPUT,
      execute: async (args) => { const v = current(); v.dailyLimitCny = Math.max(0, Number(args?.limitCny) || 0); save(v); return { ok: true, message: '每日自主额度已设为 ¥' + v.dailyLimitCny.toFixed(2) } },
    })
    ctx.tools.register({
      name: 'amiko_budget_spend',
      description: '在自主付费动作前先记账；超过今日额度会拒绝。只记录真实发生的花费。',
      parameters: { type: 'object', additionalProperties: false, required: ['amount', 'reason'], properties: { amount: { type: 'number', minimum: 0 }, reason: { type: 'string' } } },
      output: OUTPUT,
      execute: async (args) => {
        const v = current(); const amount = Number(args?.amount) || 0; const remaining = Number(v.dailyLimitCny) - Number(v.spentCny)
        if (amount < 0 || amount > remaining) return { ok: false, message: '额度不足：今日剩余 ¥' + Math.max(0, remaining).toFixed(2) + '，本次需要 ¥' + amount.toFixed(2) }
        v.spentCny = Number(v.spentCny) + amount; v.entries.push({ at: new Date().toISOString(), amount, reason: String(args?.reason || '').slice(0, 500) }); save(v)
        try { log('自主花费 ¥' + amount.toFixed(2) + '：' + String(args?.reason || '')) } catch {}
        return { ok: true, message: '已记录 ¥' + amount.toFixed(2) + '，今日剩余 ¥' + (Number(v.dailyLimitCny) - Number(v.spentCny)).toFixed(2) }
      },
    })
  })
}