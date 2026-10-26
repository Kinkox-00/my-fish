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
const EDGE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'edge_tts_cli.py')
const DEFAULT_CFG = {
  enabled: true,
  engine: 'edge',
  voice: 'Microsoft Yaoyao',
  edgeVoice: 'zh-CN-XiaoyiNeural',
  edgeRate: '+0%',
  edgePitch: '+0Hz',
  rate: 0,
  maxVoicePerHour: 6,
  maxStickerPerHour: 12,
  rvc: {
    enabled: false,
    endpoint: 'http://127.0.0.1:4892',
    model: '',
    index: '',
    params: { f0_up_key: 0, f0_method: 'rmvpe', index_rate: 0.75, filter_radius: 3, resample_sr: 0, rms_mix_rate: 0.25, protect: 0.33 },
  },
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
async function rvcConvert(wavPath, rvc) {
  const endpoint = String(rvc.endpoint || 'http://127.0.0.1:4892').replace(/\/+$/, '')
  const audio = readFileSync(wavPath).toString('base64')
  if (String(rvc.model || '').trim()) {
    const load = await fetch(endpoint + '/load', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: String(rvc.model), index: String(rvc.index || '') }),
      signal: AbortSignal.timeout(120000),
    })
    if (!load.ok) throw new Error('RVC 模型加载失败 HTTP ' + load.status)
  }
  const params = { f0_up_key: 0, f0_method: 'rmvpe', index_rate: 0.75, filter_radius: 3, resample_sr: 40000, rms_mix_rate: 0.25, protect: 0.33, ...(rvc.params || {}) }
  const res = await fetch(endpoint + '/convert', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio_base64: audio, params }),
    signal: AbortSignal.timeout(180000),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.audio_base64) throw new Error('RVC 转换失败 HTTP ' + res.status + ' ' + String(j.detail || j.error || ''))
  const out = wavPath.replace(/\.wav$/i, '-rvc.wav')
  writeFileSync(out, Buffer.from(String(j.audio_base64), 'base64'))
  return out
}
async function makeVoice(text) {
  const cfg = config()
  const id = Date.now() + '-' + Math.random().toString(36).slice(2)
  const txt = join(tmpdir(), 'amiko-tts-' + id + '.txt')
  const wav = join(tmpdir(), 'amiko-tts-' + id + '.wav')
  writeFileSync(txt, text, 'utf8')
  let edgeWarning = ''
  if (String(cfg.engine || 'sapi') === 'edge') {
    const mp3 = join(tmpdir(), 'amiko-edge-' + id + '.mp3')
    try {
      await execFileAsync('python', [EDGE_SCRIPT, txt, String(cfg.edgeVoice || DEFAULT_CFG.edgeVoice), String(cfg.edgeRate || DEFAULT_CFG.edgeRate), String(cfg.edgePitch || DEFAULT_CFG.edgePitch), mp3], { windowsHide: true, timeout: 120000 })
      let finalFile = mp3
      let engine = 'edge'
      let warning = ''
      if (cfg.rvc && cfg.rvc.enabled) {
        try { finalFile = await rvcConvert(mp3, cfg.rvc); engine = 'edge+rvc' }
        catch (error) { warning = 'RVC 失败，已保留 Edge TTS：' + String(error?.message || error) }
      }
      return { wav: finalFile, file: finalFile, engine, warning, cleanup: () => { try { unlinkSync(txt) } catch {}; try { unlinkSync(mp3) } catch {}; if (finalFile !== mp3) { try { unlinkSync(finalFile) } catch {} } } }
    } catch (error) {
      edgeWarning = 'Edge TTS 失败，回退系统 TTS：' + String(error?.message || error)
    }
  }
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TTS_SCRIPT, '-TextFile', txt, '-OutputFile', wav, '-Voice', String(cfg.voice || DEFAULT_CFG.voice), '-Rate', String(Number(cfg.rate) || 0)], { windowsHide: true, timeout: 90000 })
    let finalWav = wav
    let engine = 'sapi'
    let warning = edgeWarning
    if (cfg.rvc && cfg.rvc.enabled) {
      try { finalWav = await rvcConvert(wav, cfg.rvc); engine = 'rvc' }
      catch (error) { warning = 'RVC 失败，已回退系统 TTS：' + String(error?.message || error) }
    }
    return { wav: finalWav, engine, warning, cleanup: () => { try { unlinkSync(txt) } catch {}; try { unlinkSync(wav) } catch {}; if (finalWav !== wav) { try { unlinkSync(finalWav) } catch {} } } }
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
            '语音：' + (String(cfg.engine || 'sapi') === 'edge' ? 'Edge TTS ' + (cfg.edgeVoice || DEFAULT_CFG.edgeVoice) + '，' + (cfg.edgeRate || '+0%') + ' / ' + (cfg.edgePitch || '+0Hz') : 'SAPI ' + (cfg.voice || DEFAULT_CFG.voice) + '，语速 ' + (cfg.rate || 0)),
            'RVC：' + (cfg.rvc?.enabled ? '开启 ' + (cfg.rvc.endpoint || '') + ' ' + (cfg.rvc.model || '未选模型') : '关闭'),
            `表情包：${list.length} 张`,
            `可用 tag：${list.map((s) => s.label).join(' / ')}`,
          ].join('\n'),
        }
      },
    })

    ctx.tools.register({
      name: 'qq_rvc_set',
      description: '配置 QQ 语音的 RVC 音色：服务地址、模型 .pth、索引 .index 和转换参数。需要本机已启动兼容 rvc-server.py 的服务。',
      parameters: { type: 'object', additionalProperties: false, properties: {
        enabled: { type: 'boolean' },
        endpoint: { type: 'string' },
        model: { type: 'string' },
        index: { type: 'string' },
        params: { type: 'object', additionalProperties: true },
      } },
      output: OUTPUT,
      execute: async (args) => {
        const cfg = config()
        const rvc = { ...(cfg.rvc || {}) }
        if (typeof args?.enabled === 'boolean') rvc.enabled = args.enabled
        if (typeof args?.endpoint === 'string' && args.endpoint.trim()) rvc.endpoint = args.endpoint.trim()
        if (typeof args?.model === 'string') rvc.model = args.model.trim()
        if (typeof args?.index === 'string') rvc.index = args.index.trim()
        if (args?.params && typeof args.params === 'object') rvc.params = { ...(rvc.params || {}), ...args.params }
        cfg.rvc = rvc
        writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
        return { ok: true, message: 'RVC 配置已保存：' + (rvc.enabled ? '开启 ' + (rvc.endpoint || '') : '关闭') + (rvc.model ? '，模型 ' + rvc.model : '') }
      },
    })
    ctx.tools.register({
      name: 'qq_voice_set',
      description: '配置 QQ 语音引擎和音色。Edge TTS 免费、无需模型；推荐 zh-CN-XiaoyiNeural（甜美活泼）或 zh-CN-XiaoxiaoNeural（温柔）。SAPI 作为离线回退。',
      parameters: { type: 'object', additionalProperties: false, properties: {
        engine: { type: 'string', description: 'edge 或 sapi' },
        voice: { type: 'string', description: 'SAPI 音色名，例如 Microsoft Yaoyao' },
        edgeVoice: { type: 'string', description: 'Edge TTS 音色，例如 zh-CN-XiaoyiNeural' },
        edgeRate: { type: 'string', description: 'Edge 语速，例如 +0% 或 -5%' },
        edgePitch: { type: 'string', description: 'Edge 音高，例如 +0Hz 或 +2Hz' },
        rate: { type: 'integer', description: 'SAPI 语速，-10 到 10' },
      } },
      output: OUTPUT,
      execute: async (args) => {
        const cfg = config()
        if (typeof args?.engine === 'string' && ['edge', 'sapi'].includes(args.engine)) cfg.engine = args.engine
        if (typeof args?.voice === 'string' && args.voice.trim()) cfg.voice = args.voice.trim()
        if (typeof args?.edgeVoice === 'string' && args.edgeVoice.trim()) cfg.edgeVoice = args.edgeVoice.trim()
        if (typeof args?.edgeRate === 'string' && args.edgeRate.trim()) cfg.edgeRate = args.edgeRate.trim()
        if (typeof args?.edgePitch === 'string' && args.edgePitch.trim()) cfg.edgePitch = args.edgePitch.trim()
        if (Number.isFinite(Number(args?.rate))) cfg.rate = Math.max(-10, Math.min(10, Number(args.rate)))
        writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
        return { ok: true, message: '语音配置已保存：' + (cfg.engine === 'edge' ? 'Edge TTS ' + (cfg.edgeVoice || '') : 'SAPI ' + (cfg.voice || '')) }
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
          if (args?.dry_run === true) return { ok: true, message: '语音生成成功（dry run，未发送；' + text.length + ' 字；引擎 ' + (voice.engine || 'unknown') + '）。' + (voice.warning ? '\n' + voice.warning : '') }
          const b64 = readFileSync(voice.file || voice.wav).toString('base64')
          const r = await sendMessage([{ type: 'record', data: { file: 'base64://' + b64 } }], target, false)
          return { ok: true, message_id: r.message_id, message: '语音已发送（' + text.length + ' 字；引擎 ' + (voice.engine || 'unknown') + '）。' + (voice.warning ? '\n' + voice.warning : '') }
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
