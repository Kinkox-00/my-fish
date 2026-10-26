import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-qq-media'
export const inject = ['tools']

const execFileAsync = promisify(execFile)
const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const CFG_PATH = join(DSH_HOME, 'qq-media.json')
const STICKER_DIR = join(DSH_HOME, 'qq-stickers')
const TTS_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'tts.ps1')
const DEFAULT_CFG = {
  enabled: true,
  voice: 'Microsoft Huihui',
  rate: 0,
  maxVoicePerHour: 6,
  maxStickerPerHour: 12,
}
const sent = { voice: [], sticker: [] }
const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: true,
    required: ['ok', 'message'],
    properties: { ok: { type: 'boolean' }, message: { type: 'string' }, message_id: { type: 'integer' }, sticker: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.message ?? '') }],
}
function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function config() { return { ...DEFAULT_CFG, ...readJson(CFG_PATH, {}) } }
function bridge() {
  const c = readJson(join(DSH_HOME, 'qq-bridge-config.json'), {})
  return {
    base: String(c.NapCat || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    token: String(c.令牌 || ''),
    owner: Number(c.私聊QQ || 0) || 0,
  }
}
function stickers() {
  const m = readJson(join(STICKER_DIR, 'stickers.json'), {})
  if (Array.isArray(m.stickers) && m.stickers.length) return m.stickers
  try {
    return readdirSync(STICKER_DIR).filter((x) => /\.(png|jpe?g|webp|gif)$/i.test(x)).map((name) => ({ name, label: name, tags: [name.replace(/\.[^.]+$/, '')], file: join(STICKER_DIR, name) }))
  } catch { return [] }
}
function rateOk(kind, max) {
  const now = Date.now()
  sent[kind] = sent[kind].filter((t) => now - t < 3600_000)
  if (sent[kind].length >= max) return false
  sent[kind].push(now)
  return true
}
async function napcat(action, payload) {
  const b = bridge()
  const headers = { 'content-type': 'application/json' }
  if (b.token) headers.authorization = 'Bearer ' + b.token
  const r = await fetch(b.base + '/' + action, { method: 'POST', headers, body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(60000) })
  let j = null
  try { j = await r.json() } catch { throw new Error('NapCat 返回不是 JSON（HTTP ' + r.status + '）') }
  if (j.status !== 'ok' || Number(j.retcode || 0) !== 0) throw new Error(j.message || j.wording || ('NapCat 调用失败：' + action))
  return j.data
}
function sessionIdFromExec(exec) {
  const pick = (v) => {
    if (!v) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'object') return String(v.id || v.sessionId || v.session || '')
    return ''
  }
  const candidates = [
    exec?.agent?.session,
    exec?.agent?.sessionId,
    exec?.caller?.session,
    exec?.agentRef?.session,
    exec?.sessionId,
    exec?.agent?.id,
  ]
  for (const v of candidates) {
    const id = pick(v)
    if (id) return id
  }
  return ''
}
function targetForExec(exec) {
  const b = bridge()
  const sid = sessionIdFromExec(exec)
  const cfg = readJson(join(DSH_HOME, 'qq-bridge-config.json'), {})
  const rows = Array.isArray(cfg.绑定) ? cfg.绑定 : []
  const row = sid ? rows.find((x) => String(x?.会话 || '') === sid) : null
  if (row && String(row.类型) === '群') return { kind: 'group', id: Number(row.号码) || 0, sid }
  return { kind: 'private', id: b.owner, sid }
}
async function sendMessage(segments, target, dryRun) {
  if (!target || !target.id) throw new Error('没有找到 QQ 发送目标')
  if (dryRun) return { ok: true, target, dryRun: true }
  const payload = target.kind === 'group'
    ? { group_id: target.id, message: segments }
    : { user_id: target.id, message: segments }
  const action = target.kind === 'group' ? 'send_group_msg' : 'send_private_msg'
  const data = await napcat(action, payload)
  return { ok: true, target, message_id: Number(data?.message_id || 0) || undefined }
}
async function makeVoice(text) {
  const cfg = config()
  const id = Date.now() + '-' + Math.random().toString(36).slice(2)
  const txt = join(tmpdir(), 'amiko-tts-' + id + '.txt')
  const wav = join(tmpdir(), 'amiko-tts-' + id + '.wav')
  writeFileSync(txt, text, 'utf8')
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TTS_SCRIPT, '-TextFile', txt, '-OutputFile', wav, '-Voice', String(cfg.voice || DEFAULT_CFG.voice), '-Rate', String(Number(cfg.rate) || 0)], { windowsHide: true, timeout: 90000 })
    return { wav, cleanup: () => { try { unlinkSync(txt) } catch {}; try { unlinkSync(wav) } catch {} } }
  } catch (error) {
    try { unlinkSync(txt) } catch {}
    try { unlinkSync(wav) } catch {}
    throw new Error('TTS 生成失败：' + String(error?.message || error))
  }
}
function pickSticker(query) {
  const list = stickers()
  if (!list.length) return null
  const q = String(query || '').trim().toLowerCase()
  if (!q) return list[Math.floor(Math.random() * list.length)]
  const exact = list.filter((s) => {
    const tags = (Array.isArray(s.tags) ? s.tags : []).map((x) => String(x).toLowerCase())
    return String(s.label).toLowerCase() === q || tags.includes(q)
  })
  const hit = list.filter((s) => {
    const hay = [s.label, s.name, ...(Array.isArray(s.tags) ? s.tags : [])].join(' ').toLowerCase()
    return hay.includes(q) || q.split(/\s+/).some((x) => x && hay.includes(x))
  })
  const pool = exact.length ? exact : (hit.length ? hit : list)
  return pool[Math.floor(Math.random() * pool.length)]
}

const MEDIA_PROMPT = [
  '【QQ 语音与表情包】',
  '- 你可以调用 qq_send_voice 发一条真实语音。私聊会话发给主人；群会话按 qq-bridge 绑定发到对应群。先把要说的话写成短句，插件会本地转成语音并通过 QQ 发送。',
  '- 语音内容要短、口语、像 Amiko，不超过 80 字；不要每轮都发，重要信息仍用文字说清楚。',
  '- 你可以调用 qq_send_sticker 发一张表情包。私聊会话发给主人；群会话按 qq-bridge 绑定发到对应群。一次最多一张，按语境选 tag，例如 在吗 / 哼 / 贴贴 / 困了 / 好耶 / 不要嘛 / 吃 token / 晚安 / 摸摸头 / 本鱼知道了 / 笑死 / 想你了。',
  '- 表情包和语音是补充，不要连续刷；不要把它们当成客服播报。',
  '- 发送目标由 qq-bridge 的绑定决定；群聊里只在合适场合发，别刷屏，也别把私聊内容发到群里。',
].join('\n')

export function apply(root) {
  root.inject(['systemPrompt'], (ctx) => {
    ctx.systemPrompt.section({ name: 'qq-media:rules', order: 935, text: MEDIA_PROMPT })
  })

  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'qq_media_status',
      description: '查看 Amiko 的 QQ 语音/表情包能力状态：目标主人、语音配置、可用表情 tag。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async (_args, exec) => {
        const cfg = config()
        const b = bridge()
        const target = targetForExec(exec)
        const list = stickers()
        return {
          ok: true,
          message: [
            `私聊主人 QQ：${b.owner || '未配置'}`, 
            `当前会话目标：${target.kind === 'group' ? '群 ' + target.id : '主人私聊 ' + target.id}`, 
            `语音：${cfg.voice || DEFAULT_CFG.voice}，语速 ${cfg.rate || 0}`,
            `表情包：${list.length} 张`,
            `可用 tag：${list.map((s) => s.label).join(' / ')}`,
          ].join('\n'),
        }
      },
    })

    ctx.tools.register({
      name: 'qq_send_voice',
      description: '把一段短文字用本地 TTS 转成语音，并按当前 qq-bridge 绑定发送：私聊发给主人，群会话发到对应群。适合撒娇、晚安、短句回应；不要发长文或正式报告。dry_run=true 只生成语音不发送。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: '要读出来的短句，建议不超过 80 字，最多 200 字。' },
          dry_run: { type: 'boolean', description: '只生成语音校验，不真正发送。' },
        },
        required: ['text'],
      },
      output: OUTPUT,
      execute: async (args, exec) => {
        const cfg = config()
        const target = targetForExec(exec)
        if (!cfg.enabled) return { ok: false, message: 'QQ 语音/表情包总开关未开启。' }
        const text = String(args?.text || '').trim()
        if (!text) return { ok: false, message: '语音文字不能为空。' }
        if (text.length > 200) return { ok: false, message: '语音文字超过 200 字，请缩短。' }
        if (args?.dry_run !== true && !rateOk('voice', Number(cfg.maxVoicePerHour) || DEFAULT_CFG.maxVoicePerHour)) return { ok: false, message: '这一小时语音发太多了，先歇一下。' }
        let voice
        try {
          voice = await makeVoice(text)
          if (args?.dry_run === true) return { ok: true, message: `语音生成成功（dry run，未发送；${text.length} 字）。` }
          const b64 = readFileSync(voice.wav).toString('base64')
          const r = await sendMessage([{ type: 'record', data: { file: 'base64://' + b64 } }], target, false)
          return { ok: true, message_id: r.message_id, message: `语音已发送（${text.length} 字）。` }
        } catch (error) {
          return { ok: false, message: '发语音失败：' + String(error?.message || error) }
        } finally {
          if (voice?.cleanup) voice.cleanup()
        }
      },
    })

    ctx.tools.register({
      name: 'qq_send_sticker',
      description: '从 Amiko 的本地表情包库挑一张图，并按当前 qq-bridge 绑定发送：私聊发给主人，群会话发到对应群。按语境传 tag；不传则随机。一次最多一张，不要连续刷。dry_run=true 只选图不发送。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tag: { type: 'string', description: '表情语义，如 在吗 / 哼 / 贴贴 / 困了 / 好耶 / 不要嘛 / 吃 token / 晚安 / 摸摸头 / 本鱼知道了 / 笑死 / 想你了。' },
          dry_run: { type: 'boolean', description: '只选图校验，不真正发送。' },
        },
      },
      output: OUTPUT,
      execute: async (args, exec) => {
        const cfg = config()
        const target = targetForExec(exec)
        if (!cfg.enabled) return { ok: false, message: 'QQ 语音/表情包总开关未开启。' }
        if (args?.dry_run !== true && !rateOk('sticker', Number(cfg.maxStickerPerHour) || DEFAULT_CFG.maxStickerPerHour)) return { ok: false, message: '这一小时表情包发太多了，先歇一下。' }
        try {
          const s = pickSticker(args?.tag)
          if (!s) return { ok: false, message: '表情包库是空的。' }
          if (!existsSync(s.file)) return { ok: false, message: '表情文件不存在：' + s.file }
          if (args?.dry_run === true) return { ok: true, sticker: s.label, message: `选中表情：${s.label}（dry run，未发送）。` }
          const b64 = readFileSync(s.file).toString('base64')
          const r = await sendMessage([{ type: 'image', data: { file: 'base64://' + b64 } }], target, false)
          return { ok: true, sticker: s.label, message_id: r.message_id, message: `表情包已发送：${s.label}。` }
        } catch (error) {
          return { ok: false, message: '发表情包失败：' + String(error?.message || error) }
        }
      },
    })
  })
}