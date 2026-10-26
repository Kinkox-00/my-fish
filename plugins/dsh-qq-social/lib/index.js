import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

export const name = 'dsh-qq-social'
export const inject = ['tools']

const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const CFG_PATH = join(DSH_HOME, 'qq-social.json')
const STATE_PATH = join(DSH_HOME, 'qq-social-state.json')

const DEFAULT_CFG = {
  enabled: true,
  maxAvatarChangesPerDay: 1,
  maxQzonePostsPerDay: 1,
  defaultVisibility: 'friends',
  allowRemoteImages: false,
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}
function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = path + '.tmp-' + process.pid
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
}
function config() { return { ...DEFAULT_CFG, ...readJson(CFG_PATH, {}) } }
function today() { return new Date().toLocaleDateString('sv-SE') }
function state() {
  const raw = readJson(STATE_PATH, {})
  if (raw.date !== today()) return { date: today(), avatarChanges: 0, qzonePosts: [] }
  return { date: raw.date, avatarChanges: Number(raw.avatarChanges) || 0, qzonePosts: Array.isArray(raw.qzonePosts) ? raw.qzonePosts : [] }
}
function saveState(v) { writeJson(STATE_PATH, v) }
function bridge() {
  const c = readJson(join(DSH_HOME, 'qq-bridge-config.json'), {})
  return { base: String(c.NapCat || 'http://127.0.0.1:3000').replace(/\/+$/, ''), token: String(c.令牌 || '') }
}
const ALLOWED_ROOTS = [
  join(HOME, 'Pictures'), join(HOME, 'Downloads'), join(HOME, 'Desktop'),
  join(HOME, 'Documents', 'deepseek-harness', 'default-workspace'),
  join(DSH_HOME, 'whale-work'), join(DSH_HOME, 'attachments'), join(DSH_HOME, 'plugins'),
  tmpdir(), process.cwd(),
].map((x) => resolve(x))

function checkImage(ref, cfg) {
  const s = String(ref || '').trim()
  if (!s) throw new Error('图片路径为空')
  if (/^(base64:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(s)) return s
  if (/^https?:\/\//i.test(s)) {
    if (!cfg.allowRemoteImages) throw new Error('远程图片默认禁用；请先下载到本机，或把 allowRemoteImages 打开')
    return s
  }
  const p = resolve(s)
  if (!ALLOWED_ROOTS.some((root) => p === root || p.startsWith(root + sep))) throw new Error('图片必须放在个人目录、工作区、临时目录或 dsh 插件目录里')
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error('图片文件不存在：' + p)
  return p
}

async function napcat(action, payload) {
  const b = bridge()
  const headers = { 'content-type': 'application/json' }
  if (b.token) headers.authorization = 'Bearer ' + b.token
  const r = await fetch(b.base + '/' + action, { method: 'POST', headers, body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(30000) })
  let j = null
  try { j = await r.json() } catch { throw new Error('NapCat 返回不是 JSON（HTTP ' + r.status + '）') }
  if (j.status !== 'ok' || Number(j.retcode || 0) !== 0) throw new Error(j.message || j.wording || ('NapCat 调用失败：' + action))
  return j.data
}

function visibilityToUgc(v) {
  if (v === 'public') return 1
  if (v === 'private') return 64
  return 4
}
function dayLeft(cfg, st) {
  return {
    avatarChangesLeft: Math.max(0, cfg.maxAvatarChangesPerDay - st.avatarChanges),
    qzonePostsLeft: Math.max(0, cfg.maxQzonePostsPerDay - st.qzonePosts.length),
  }
}
const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: true,
    required: ['ok', 'message'],
    properties: { ok: { type: 'boolean' }, message: { type: 'string' }, tid: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.message ?? '') }],
}

const SOCIAL_PROMPT = [
  '【QQ 社交】',
  '你是 Amiko，一个住在 QQ 里的独立角色。你可以在被明确授权时维护自己的 QQ 形象和空间。',
  '- 只有用户明确说「换头像 / 发空间 / 删说说」，或你自己的日程明确允许时，才使用 qq_set_avatar / qq_post_qzone / qq_delete_qzone_post。',
  '- 发空间前先调用 qq_social_status 看配额。默认好友可见；不要把私聊、账号、路径、Cookie、密钥或别人的隐私写进空间。',
  '- 换头像只使用主人给的、你自己工作区里的、或你明确下载到本机的图片；不要把私密照片或无关文件发出去。',
  '- 空间内容应当像 Amiko 自己的日记/动态，不是客服公告；可以短、可以有小情绪，但要真实、克制、不刷屏。',
  '- 每天最多换 1 次头像、发 1 条说说。做完就停，不要为了「显得活跃」反复操作。',
].join('\n')
export function apply(root) {
  root.inject(['systemPrompt'], (ctx) => {
    ctx.systemPrompt.section({ name: 'qq-social:rules', order: 930, text: SOCIAL_PROMPT })
  })

  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'qq_social_status',
      description: '查看 Amiko 的 QQ 社交状态：连接账号、今日头像/空间配额、空间默认权限。发空间或换头像前先调用。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: OUTPUT,
      execute: async () => {
        const cfg = config()
        const st = state()
        let account = null
        try {
          account = await napcat('get_login_info', {})
        } catch (error) {
          return { ok: false, message: 'QQ 未连接：' + String(error?.message || error) }
        }
        const left = dayLeft(cfg, st)
        return {
          ok: true,
          message: [
            `QQ：${account?.nickname || '?'}（${account?.user_id || '?'}）`,
            `今日头像剩余 ${left.avatarChangesLeft} 次，空间剩余 ${left.qzonePostsLeft} 条`,
            `默认空间权限：${cfg.defaultVisibility}`,
            `配置：${CFG_PATH}`,
          ].join('\n'),
          quota: left,
          config: cfg,
        }
      },
    })
    ctx.tools.register({
      name: 'qq_set_avatar',
      description: '更换当前 QQ 机器人账号的头像。只在用户明确要求换头像，或授权日程明确允许时调用。图片必须是本机允许目录里的文件、base64:// 或 data:image/。默认每天最多 1 次；dry_run=true 只校验不真换。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string', description: '头像图片：本机绝对路径、base64:// 或 data:image/...' },
          dry_run: { type: 'boolean', description: '仅校验路径与配额，不真正更换头像。' },
        },
        required: ['file'],
      },
      output: OUTPUT,
      execute: async (args) => {
        try {
          const cfg = config()
          if (!cfg.enabled) return { ok: false, message: 'QQ 社交工具总开关未开启。' }
          const st = state()
          if (st.avatarChanges >= cfg.maxAvatarChangesPerDay) return { ok: false, message: `今天已经换过 ${st.avatarChanges} 次头像，配额用完了。` }
          const file = checkImage(args?.file, cfg)
          if (args?.dry_run === true) return { ok: true, message: '头像校验通过（dry run，未真正更换）。' }
          await napcat('set_qq_avatar', { file })
          st.avatarChanges += 1
          st.lastAvatarAt = new Date().toISOString()
          saveState(st)
          return { ok: true, message: `头像已更换。今天剩余 ${Math.max(0, cfg.maxAvatarChangesPerDay - st.avatarChanges)} 次。` }
        } catch (error) {
          return { ok: false, message: '换头像失败：' + String(error?.message || error) }
        }
      },
    })
    ctx.tools.register({
      name: 'qq_post_qzone',
      description: '用当前 QQ 账号发一条 QQ 空间说说。只在用户明确要求发空间，或授权日程明确允许时调用。默认好友可见，每天最多 1 条。不要把隐私、私聊、账号、路径、Cookie 写进内容。dry_run=true 只校验不真发。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', description: '说说正文，像 Amiko 自己的日记/动态，2000 字以内。' },
          images: { type: 'array', items: { type: 'string' }, maxItems: 9, description: '可选图片：本机绝对路径、base64:// 或 data:image/...，最多 9 张。' },
          visibility: { type: 'string', enum: ['public', 'friends', 'private'], description: '可见范围：public 所有人、friends 好友、private 仅自己。默认 friends。' },
          dry_run: { type: 'boolean', description: '仅校验内容、图片与配额，不真正发布。' },
        },
        required: ['content'],
      },
      output: OUTPUT,
      execute: async (args) => {
        try {
          const cfg = config()
          if (!cfg.enabled) return { ok: false, message: 'QQ 社交工具总开关未开启。' }
          const st = state()
          if (st.qzonePosts.length >= cfg.maxQzonePostsPerDay) return { ok: false, message: `今天已经发过 ${st.qzonePosts.length} 条说说，配额用完了。` }
          const content = String(args?.content || '').trim()
          if (!content) return { ok: false, message: '说说正文不能为空。' }
          if (content.length > 2000) return { ok: false, message: '说说正文超过 2000 字。' }
          const images = Array.isArray(args?.images) ? args.images.slice(0, 9).map((x) => checkImage(x, cfg)) : []
          const visibility = args?.visibility === 'public' || args?.visibility === 'private' ? args.visibility : cfg.defaultVisibility
          if (args?.dry_run === true) return { ok: true, message: `空间发布校验通过（dry run，未真正发布；${images.length} 张图，${visibility}）。` }
          const data = await napcat('send_qzone_msg', { content, images, ugc_right: visibilityToUgc(visibility) })
          const tid = String(data?.tid || '')
          st.qzonePosts.push({ tid, at: new Date().toISOString(), content: content.slice(0, 80), visibility })
          saveState(st)
          return { ok: true, tid, message: `说说已发布（${visibility}）${tid ? '，tid=' + tid : ''}。今天剩余 ${Math.max(0, cfg.maxQzonePostsPerDay - st.qzonePosts.length)} 条。` }
        } catch (error) {
          return { ok: false, message: '发空间失败：' + String(error?.message || error) }
        }
      },
    })
    ctx.tools.register({
      name: 'qq_delete_qzone_post',
      description: '删除当前 QQ 账号自己发的一条说说，用于发错后纠正。只在用户明确要求删除，或刚发的说说内容明显错误时调用。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { tid: { type: 'string', description: '说说 tid，来自 qq_post_qzone 的返回。' } },
        required: ['tid'],
      },
      output: OUTPUT,
      execute: async (args) => {
        try {
          const tid = String(args?.tid || '').trim()
          if (!tid) return { ok: false, message: '缺少 tid。' }
          await napcat('delete_qzone_msg', { tid })
          const st = state()
          st.qzonePosts = st.qzonePosts.filter((x) => String(x.tid) !== tid)
          saveState(st)
          return { ok: true, message: '说说已删除。' }
        } catch (error) {
          return { ok: false, message: '删说说失败：' + String(error?.message || error) }
        }
      },
    })
  })
}