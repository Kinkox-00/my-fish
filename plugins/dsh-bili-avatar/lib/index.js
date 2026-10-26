import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-bili-avatar'
export const inject = ['tools']
const execFileAsync = promisify(execFile)
const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'set_avatar.py')
const OUTPUT = { schema: { type: 'object', additionalProperties: true, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }, render: (_a, v) => [{ type: 'text', text: String(v?.message ?? '') }] }
function creds() { return JSON.parse(readFileSync(join(HOME, '.bili-ai', 'credentials.json'), 'utf8')) }
async function face() {
  const c = creds()
  const cookie = 'SESSDATA=' + c.sessdata + '; bili_jct=' + c.bili_jct + '; buvid3=' + (c.buvid3 || '')
  const r = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/', Cookie: cookie }, signal: AbortSignal.timeout(20000) })
  const j = await r.json()
  return { login: !!j?.data?.isLogin, name: j?.data?.uname || '', face: j?.data?.face || '' }
}
const PROMPT = [
  '【B站头像】',
  '- 想换 B 站头像时用 bili_avatar_set 传本地图片路径；脚本会自动裁成 180x180 并上传。',
  '- 换头像不要频繁，先确认图片适合自己；失败就报告原因，不反复重试。',
].join('\n')
export function apply(root) {
  root.inject(['systemPrompt'], (ctx) => { ctx.systemPrompt.section({ name: 'bili-avatar:rules', order: 925, text: PROMPT }) })
  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'bili_avatar_status',
      description: '查看 B 站账号当前头像和登录状态。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => { const f = await face(); if (!f.login) return { ok: false, message: 'B 站未登录。' }; return { ok: true, message: '账号：' + f.name + '\n头像：' + f.face } },
    })
    ctx.tools.register({
      name: 'bili_avatar_set',
      description: '用本地图片更换 B 站头像；自动裁成 180x180 上传。不要频繁换。',
      parameters: { type: 'object', additionalProperties: false, required: ['file'], properties: { file: { type: 'string', description: '本地图片路径（PNG/JPG）。' } } },
      output: OUTPUT,
      execute: async (args) => {
        const file = String(args?.file || '').trim()
        if (!file) return { ok: false, message: '图片路径不能为空。' }
        try {
          const { stdout, stderr } = await execFileAsync('python', [SCRIPT, file], { windowsHide: true, timeout: 120000 })
          const out = String(stdout || '').trim(); const err = String(stderr || '').trim()
          if (!out.includes('AVATAR_OK')) return { ok: false, message: '换头像失败：' + (err || out || '未知错误') }
          const url = out.split('AVATAR_OK').pop().trim()
          return { ok: true, message: 'B 站头像已更新：' + url }
        } catch (error) { return { ok: false, message: '换头像失败：' + String(error?.message || error) } }
      },
    })
  })
}