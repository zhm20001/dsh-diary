/**
 * 长期记忆的 HTTP 行为：提交链路的注入与画像更新、失败语义、全量重算守卫与分块。
 *
 * 范式同 service.test.ts：fake 请求/响应 + ctx.plugin() 装载插件 fiber；
 * LLM 流式调用用桩 llm 代替（只覆盖组装与降级，不 mock 模型裁决质量）。
 * 日记目录一律指到临时沙箱（config.diaryDir 优先于 config.json，不碰真实日记）。
 */
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiaryService } from '../src/service.ts'
import type { DiaryPluginConfig } from '../src/service.ts'
import { PROFILE_UPDATE_PROMPT } from '../src/profile.ts'
import { thirtyHour } from '../src/core.ts'

interface RegisteredRoute {
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

function stubWebServer() {
  const routes: RegisteredRoute[] = []
  return {
    routes,
    register(route: { path: string; handler: RegisteredRoute['handler'] }) {
      routes.push(route)
      return () => {}
    },
  }
}

function fakeReq(method: string, url: string, host = 'localhost:3000', body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers: { host },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  } as unknown as IncomingMessage
}

interface CapturedResponse {
  status: number
  body: Record<string, unknown>
}

function fakeRes(): ServerResponse & { capture: Promise<CapturedResponse> } {
  let resolveCapture!: (value: CapturedResponse) => void
  const capture = new Promise<CapturedResponse>((resolve) => {
    resolveCapture = resolve
  })
  const res = {
    status: 0,
    headersSent: false,
    writeHead(status: number) {
      res.status = status
      res.headersSent = true
      return res
    },
    end(body?: string) {
      resolveCapture({ status: res.status, body: JSON.parse(body ?? '{}') })
    },
    capture,
  }
  return res as unknown as ServerResponse & { capture: Promise<CapturedResponse> }
}

// ---------- 桩 llm：记录每次调用，按系统提示词分流总结/画像更新 ----------

interface LlmCall {
  system: string
  userText: string
  provider: string
  model: string
}

/** 返回字符串 = 正常产出；返回 Error = 该次调用以 error finish 结束。 */
type Responder = (call: LlmCall, index: number) => string | Error

function stubLlm(respond: Responder) {
  const calls: LlmCall[] = []
  const llm = {
    calls,
    listProviders: () => [],
    listModels: async () => [],
    async *stream(options: { system?: string; provider: string; model: string; messages: { content: { text: string }[] }[] }) {
      const userText = options.messages[0].content[0].text
      const call: LlmCall = { system: options.system ?? '', userText, provider: options.provider, model: options.model }
      const index = calls.length
      calls.push(call)
      const out = respond(call, index)
      const failed = out instanceof Error
      const body = failed ? '' : out
      yield { type: 'block-start', index: 0, blockType: 'text' }
      if (body.length > 0) yield { type: 'text-delta', index: 0, text: body }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: body } }
      yield failed
        ? { type: 'finish', reason: { kind: 'error', failure: { message: (out as Error).message, code: 'stub' } } }
        : { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  return llm
}

function makeConfig(diaryDir: string): DiaryPluginConfig {
  return {
    diaryDir,
    templatePath: '',
    pagePath: '/diary',
    provider: 'deepseek-official',
    model: 'deepseek-chat',
    temperature: 0.6,
    timeoutMs: 120_000,
    nightCutoff: 6,
    summaryPrompt: '',
  }
}

async function makeApiHandler(ctx: Context, diaryDir: string, respond: Responder) {
  const web = stubWebServer()
  ctx.provide('llm', stubLlm(respond))
  ctx.provide('webServer', web)
  ctx.plugin(DiaryService, makeConfig(diaryDir))
  for (let i = 0; i < 200 && web.routes.length < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const route = web.routes.find((r) => r.path === '/diary/api')
  if (!route) throw new Error('api 前缀路由未注册（插件未启动）')
  return route.handler
}

// ---------- 测试数据 ----------

const SUMMARY_OUT = ['【今日关键词】测试', '【一句话总结】测试一句话', '【当日 emoji】😄', '【评注】', '评注正文'].join('\n')
const PROFILE_OUT = '# 用户画像\n\n## 人格核心\n\n- 新条目（复现 2 次）\n\n## 阶段性状态\n\n## 近期事件\n'

/** 默认响应：总结走契约输出，画像更新返回一份新画像。 */
const respondBoth: Responder = (call) => (call.system === PROFILE_UPDATE_PROMPT ? PROFILE_OUT : SUMMARY_OUT)

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 日期键 ±n 天（UTC 钟面做纯算术，避开本地时区坑）。 */
function dayKeyAdd(key: string, n: number): string {
  const p = key.split('-').map(Number)
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** 今天的记录日键（30 小时制口径，与插件同规则）。 */
function todayKey(): string {
  return thirtyHour(new Date(), 6).date
}

/** 一篇带完整评注块的日记。 */
function diaryWithComment(date: string, keyword: string, oneLine: string): string {
  return [
    '---',
    'categories: 日记',
    `date: ${date}`,
    '---',
    '',
    '正文。',
    '',
    '## AI评注',
    '',
    `**今日关键词**：${keyword}`,
    '',
    '一段评注。',
    '',
    '---',
    '',
    `23:30 | ${oneLine}`,
    '',
  ].join('\n')
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diary-memory-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('提交：注入画像与近期概要 + 画像更新', () => {
  it('画像非空时注入三节（画像→概要→今天全文，当日不进概要），评注落盘后画像被更新', async () => {
    const today = todayKey()
    const d1 = dayKeyAdd(today, -5)
    const d2 = dayKeyAdd(today, -3)
    const d3 = dayKeyAdd(today, -1)
    await writeFile(join(dir, `${d1}.md`), diaryWithComment(d1, '旧词一', '第一天的一句话'))
    await writeFile(join(dir, `${d2}.md`), '没有评注块的坏文件')
    await writeFile(join(dir, `${d3}.md`), diaryWithComment(d3, '近词', '近一天的一句话'))
    await mkdir(join(dir, '.diary-meta'), { recursive: true })
    await writeFile(join(dir, '.diary-meta/profile.md'), '# 用户画像\n\n## 人格核心\n\n- 旧画像条目（复现 4 次）\n')
    await writeFile(join(dir, `.diary-meta/${d3.slice(0, 4)}.json`), `${JSON.stringify({ [d3]: { emoji: '😄' } }, null, 2)}\n`)

    const ctx = new Context()
    const handler = await makeApiHandler(ctx, dir, respondBoth)
    const res = fakeRes()
    await handler(fakeReq('POST', '/diary/api/submit', 'localhost:3000', { text: '今天的日记正文' }), res)
    const { status, body } = await res.capture
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.warning).toBeUndefined()

    // 原文 + 评注均已落盘
    const saved = await readFile(join(dir, `${today}.md`), 'utf8')
    expect(saved).toContain('今天的日记正文')
    expect(saved).toContain('## AI评注')
    expect(saved).toContain('**今日关键词**：测试')

    // 画像已更新为新画像全文
    expect(await readFile(join(dir, '.diary-meta/profile.md'), 'utf8')).toBe(PROFILE_OUT)

    // 第一次调用是总结：三节顺序 + 窗口内两天的概要行（坏文件降级跳过）+ 当日不进概要
    const llm = (ctx as unknown as { get: (k: string) => { calls: LlmCall[] } }).get('llm')
    expect(llm.calls).toHaveLength(2)
    const summary = llm.calls[0]
    const iProfile = summary.userText.indexOf('【用户画像】')
    const iDigest = summary.userText.indexOf('【近期日记概要】')
    const iToday = summary.userText.indexOf('【今天的日记全文】')
    expect(iProfile).toBeGreaterThanOrEqual(0)
    expect(iDigest).toBeGreaterThan(iProfile)
    expect(iToday).toBeGreaterThan(iDigest)
    expect(summary.userText).toContain('- ' + d1.slice(5) + '【旧词一】第一天的一句话')
    expect(summary.userText).toContain('- ' + d3.slice(5) + '【近词】近一天的一句话 😄')
    expect(summary.userText).not.toContain(d2.slice(5)) // 坏文件不出现在概要里
    expect(summary.userText).not.toContain('- ' + today.slice(5)) // 当日文件本身不进概要
    expect(summary.userText).toContain('今天的日记正文')

    // 第二次调用是画像更新：内置 prompt + 旧画像全文 + 今天全文
    const update = llm.calls[1]
    expect(update.system).toBe(PROFILE_UPDATE_PROMPT)
    expect(update.userText).toContain('【旧画像】\n# 用户画像')
    expect(update.userText).toContain('旧画像条目（复现 4 次）')
    expect(update.userText).toContain('【今天的日记】\n---\ncategories: 日记')
    expect(update.userText).toContain('今天的日记正文')
    // 路由与总结调用同源（同一 provider/model）
    expect(update.provider).toBe(summary.provider)
    expect(update.model).toBe(summary.model)
  })

  it('画像更新失败 → 提交仍 200 并附非致命警告；原文与评注已落盘，画像保持旧值', async () => {
    const today = todayKey()
    await mkdir(join(dir, '.diary-meta'), { recursive: true })
    await writeFile(join(dir, '.diary-meta/profile.md'), '# 旧画像原文，保持不动\n')

    const ctx = new Context()
    const handler = await makeApiHandler(ctx, dir, (call, index) => (index === 0 ? SUMMARY_OUT : new Error('模型服务不可用')))
    const res = fakeRes()
    await handler(fakeReq('POST', '/diary/api/submit', 'localhost:3000', { text: '今天的日记正文' }), res)
    const { status, body } = await res.capture
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.warning).toBe('画像更新失败，不影响保存')

    const saved = await readFile(join(dir, `${today}.md`), 'utf8')
    expect(saved).toContain('## AI评注')
    expect(await readFile(join(dir, '.diary-meta/profile.md'), 'utf8')).toBe('# 旧画像原文，保持不动\n')
  })

  it('画像缺失且无历史日记 → 注入退化为「今天全文 + 层级说明」', async () => {
    const ctx = new Context()
    const handler = await makeApiHandler(ctx, dir, respondBoth)
    const res = fakeRes()
    await handler(fakeReq('POST', '/diary/api/submit', 'localhost:3000', { text: '第一篇日记' }), res)
    expect((await res.capture).status).toBe(200)

    const llm = (ctx as unknown as { get: (k: string) => { calls: LlmCall[] } }).get('llm')
    const summary = llm.calls[0]
    expect(summary.userText).not.toContain('【用户画像】')
    expect(summary.userText).not.toContain('【近期日记概要】')
    expect(summary.userText).toContain('【今天的日记全文】')
    expect(summary.userText).toContain('第一篇日记')
    expect(summary.userText.endsWith('今天的日记是唯一主体，画像与概要仅作参考。')).toBe(true)
  })

  it('总结失败 → 502（stage: summary）且不执行画像更新', async () => {
    const ctx = new Context()
    const handler = await makeApiHandler(ctx, dir, () => new Error('总结模型挂了'))
    const res = fakeRes()
    await handler(fakeReq('POST', '/diary/api/submit', 'localhost:3000', { text: '今天的日记正文' }), res)
    const { status, body } = await res.capture
    expect(status).toBe(502)
    expect(body.stage).toBe('summary')

    const llm = (ctx as unknown as { get: (k: string) => { calls: LlmCall[] } }).get('llm')
    expect(llm.calls).toHaveLength(1)
    expect(llm.calls[0].system).not.toBe(PROFILE_UPDATE_PROMPT)
    await expect(readFile(join(dir, '.diary-meta/profile.md'), 'utf8')).rejects.toThrow()
  })
})

describe('全量重算端点', () => {
  it('画像文件已存在 → 拒绝（409），一次 LLM 调用都不发起', async () => {
    await mkdir(join(dir, '.diary-meta'), { recursive: true })
    await writeFile(join(dir, '.diary-meta/profile.md'), '# 维护中的画像\n')
    await writeFile(join(dir, `${dayKeyAdd(todayKey(), -2)}.md`), diaryWithComment(dayKeyAdd(todayKey(), -2), '旧词', '旧一句话'))

    const ctx = new Context()
    const handler = await makeApiHandler(ctx, dir, respondBoth)
    const res = fakeRes()
    await handler(fakeReq('POST', '/diary/api/rebuild-profile', 'localhost:3000', {}), res)
    const { status, body } = await res.capture
    expect(status).toBe(409)
    expect(String(body.error)).toContain('已存在用户画像')
    const llm = (ctx as unknown as { get: (k: string) => { calls: LlmCall[] } }).get('llm')
    expect(llm.calls).toHaveLength(0)
  })

  it('无画像 → 按时间顺序分块累积（最旧分块优先），成功后落盘最终画像', async () => {
    const today = todayKey()
    const dates = [-9, -8, -7, -6, -5, -4, -3, -2, -1].map((n) => dayKeyAdd(today, n))
    for (const d of dates) await writeFile(join(dir, `${d}.md`), diaryWithComment(d, `词${d}`, `${d} 的一句话`))

    const ctx = new Context()
    // 每次画像更新调用返回带序号的画像，便于验证接力与最终落盘值
    const handler = await makeApiHandler(ctx, dir, (call, index) =>
      call.system === PROFILE_UPDATE_PROMPT ? `# 画像-第${index + 1}次生成\n` : SUMMARY_OUT,
    )
    const res = fakeRes()
    await handler(fakeReq('POST', '/diary/api/rebuild-profile', 'localhost:3000', {}), res)
    const { status, body } = await res.capture
    expect(status).toBe(200)
    expect(body.ok).toBe(true)

    const llm = (ctx as unknown as { get: (k: string) => { calls: LlmCall[] } }).get('llm')
    // 9 个记录日 ÷ 每块 7 天 = 2 次更新调用
    expect(llm.calls).toHaveLength(2)
    const first = llm.calls[0]
    const second = llm.calls[1]
    // 最旧分块优先：第一块是最老的 7 天，且以空画像起步
    expect(first.userText).toContain('【旧画像】\n（空，尚无画像）')
    expect(first.userText).toContain(dates[0])
    expect(first.userText).toContain(dates[6])
    expect(first.userText).not.toContain(dates[7])
    // 第二块接力：输入是上一轮的产出 + 剩下的最新日记
    expect(second.userText).toContain('【旧画像】\n# 画像-第1次生成')
    expect(second.userText).toContain(dates[7])
    expect(second.userText).toContain(dates[8])
    // 喂给模型的是用户原文：过往评注块被剥掉，不复用日常更新路径以外的第二种输入形态
    expect(first.userText).not.toContain('## AI评注')
    expect(first.userText).not.toContain(`${dates[6]} 的一句话`)
    expect(first.userText).toContain('正文。')
    expect(second.userText).not.toContain('## AI评注')
    // 成功后落盘的是最后一次产出
    expect(await readFile(join(dir, '.diary-meta/profile.md'), 'utf8')).toBe('# 画像-第2次生成\n')
  })

  it('重算中途失败 → 502 且不留半成品画像（文件保持不存在）', async () => {
    const today = todayKey()
    const dates = [-9, -8, -7, -6, -5, -4, -3, -2, -1].map((n) => dayKeyAdd(today, n))
    for (const d of dates) await writeFile(join(dir, `${d}.md`), diaryWithComment(d, `词${d}`, `${d} 的一句话`))

    const ctx = new Context()
    const handler = await makeApiHandler(ctx, dir, (call, index) =>
      call.system === PROFILE_UPDATE_PROMPT ? (index === 0 ? '# 半成品\n' : new Error('第二块挂了')) : SUMMARY_OUT,
    )
    const res = fakeRes()
    await handler(fakeReq('POST', '/diary/api/rebuild-profile', 'localhost:3000', {}), res)
    const { status, body } = await res.capture
    expect(status).toBe(502)
    expect(String(body.hint)).toContain('未写入')
    await expect(readFile(join(dir, '.diary-meta/profile.md'), 'utf8')).rejects.toThrow()
  })
})

describe('设置端点：画像存在性（页面按钮的守卫态）', () => {
  it('GET /api/settings 报告 profileExists，随画像文件出现/消失而变', async () => {
    const ctx = new Context()
    const handler = await makeApiHandler(ctx, dir, respondBoth)
    const before = fakeRes()
    await handler(fakeReq('GET', '/diary/api/settings'), before)
    expect((await before.capture).body.profileExists).toBe(false)

    await mkdir(join(dir, '.diary-meta'), { recursive: true })
    await writeFile(join(dir, '.diary-meta/profile.md'), '# 画像\n')
    const after = fakeRes()
    await handler(fakeReq('GET', '/diary/api/settings'), after)
    expect((await after.capture).body.profileExists).toBe(true)
  })
})
