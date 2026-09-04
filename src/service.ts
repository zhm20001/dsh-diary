/**
 * DiaryService —— 日记插件入口（类即插件，同 mytool-dsh-notes 形态）。
 *
 * 路由（挂在宿主 webServer 上）：
 *   GET  <pagePath>               自包含 web UI（零构建，vanilla JS）
 *   GET  <pagePath>/guide         使用指南（自包含双语静态页）
 *   GET  <pagePath>/api/today     今日状态：目标日期/钟点/文件内容（未配置时 configured:false）
 *   GET  <pagePath>/api/dates     热力图数据：记录日聚合 + 当日 emoji + 半年帧窗口
 *   GET  <pagePath>/api/models    可选评注模型（provider 分组，来自 ctx.llm 模型目录）
 *   GET/POST <pagePath>/api/settings  日记目录设置：GET 读生效值；POST 写 config.json（仅本机请求）
 *   POST <pagePath>/api/submit    追加条目 + 生成总结（同日再提交 = 追加并重新总结；可选 provider/model 覆盖）
 *   POST <pagePath>/api/retry-summary  仅重新生成总结（总结失败后的补救，不重复追加条目）
 *
 * 纪律（ADR-0005 同款）：日期判断/模板/拼装/落盘永远是代码；LLM 只产总结内容（含当日 emoji）。
 * 崩溃顺序保证：原文先落盘、评注后落盘——总结失败绝不丢用户原文。
 * 「是否有日记」派生纪律：永远由日记目录文件存在性当场推导（readdir 列名，不读内容），
 * 绝不落盘缓存——手建/手删文件即时生效；.diary-meta 年表只存派生不出的字段（当日 emoji）。
 * 目录解析纪律：cordis patch 覆盖 > config.json（页面设置卡写它，每次请求现读）> 未配置。
 *
 * @module dsh-diary
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import {
  buildCommentBlock,
  diaryPathFor,
  extractRecordDate,
  fillTemplate,
  framesFor,
  joinBlock,
  thirtyHour,
  withoutTrailingCommentBlock,
} from './core.ts'
import { BUNDLED_TEMPLATE, absolutize, loadPathVars, resolveDirValue, savePathVars } from './paths.ts'
import { renderGuide } from './guide.ts'
import { renderPage } from './page.ts'
import { runSummary, type SummaryOutput } from './summary.ts'

export interface DiaryPluginConfig {
  diaryDir: string
  templatePath: string
  pagePath: string
  provider: string
  model: string
  temperature: number
  timeoutMs: number
  nightCutoff: number
}

/** 路由注册的最小结构形状（对齐 dsh-host-webserver 的 WebRoute，内部版与 npm rc 同形）。 */
interface WebRouteLike {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

type WebCarrier = { register(route: WebRouteLike): () => void }

/**
 * 宿主 web 承载服务的名字在版本间漂移过：内部 harness 版是 ctx.webServer，
 * npm 0.0.1-rc 改叫 ctx.httpServer，注册面同形。这里按结构双名兼容，
 * 类型不再耦合具体包版本（inject 仍声明主名 webServer，即现行 dsh 宿主）。
 */
function webCarrier(ctx: Context): WebCarrier {
  const c = ctx as Context & { webServer?: WebCarrier; httpServer?: WebCarrier }
  const carrier = c.webServer ?? c.httpServer
  if (!carrier) throw new Error('dsh-diary: 宿主未提供 webServer/httpServer 路由服务（需要 dsh web 宿主）')
  return carrier
}

export class DiaryService extends Service {
  static inject = ['llm', 'webServer']

  // diaryDir 不做 config.json 默认值（本 schemastery 无 .optional()，用 default('') 表达"未设置"）：
  // cordis patch 给了非空值就是覆盖，否则每次请求现读插件根 config.json（页面设置卡维护）。
  static Config = (() => {
    const pathVars = loadPathVars()
    return z.object({
      diaryDir: z.string().default('').description('日记目录（YYYY-MM-DD.md）；缺省时读插件根 config.json（页面「设置」卡维护），都没有则未配置'),
      templatePath: z
        .string()
        .default(pathVars.templatePath ?? BUNDLED_TEMPLATE)
        .description('模板路径；默认取 config.json，兜底为插件内置 assets/diary-template.md'),
      pagePath: z.string().default('/diary').description('web UI 页面路由'),
      provider: z.string().default('deepseek-official').description('总结调用的 provider 路由'),
      model: z.string().default('deepseek-chat').description('总结调用的模型'),
      temperature: z.number().default(0.6).description('总结生成温度'),
      timeoutMs: z.number().default(120_000).description('总结调用超时（毫秒）'),
      nightCutoff: z.number().default(6).description('30 小时制截止小时：此点前归前一天'),
    })
  })()

  readonly config: DiaryPluginConfig
  readonly pluginCtx: Context

  constructor(ctx: Context, config: DiaryPluginConfig) {
    super(ctx, 'diary')
    this.config = config
    this.pluginCtx = ctx
    const web = webCarrier(ctx)
    ctx.effect(
      () =>
        web.register({
          kind: 'exact',
          path: config.pagePath,
          handler: (_req, res) => {
            void this.handlePage(res)
          },
        }),
      'diary.route(page)',
    )
    ctx.effect(
      () =>
        web.register({
          kind: 'exact',
          path: `${config.pagePath}/guide`,
          handler: (req, res) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.writeHead(405, { allow: 'GET, HEAD' })
              res.end()
              return
            }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
            res.end(req.method === 'HEAD' ? undefined : renderGuide(config.pagePath))
          },
        }),
      'diary.route(guide)',
    )
    ctx.effect(
      () =>
        web.register({
          kind: 'prefix',
          path: `${config.pagePath}/api`,
          handler: (req, res) => {
            this.handleApi(req, res).catch((err: unknown) => {
              // 最后防线：任何逃逸异常都必须变成可见响应——空 body 会变成
              // 浏览器端晦涩的 "Unexpected end of JSON input"
              try {
                if (!res.headersSent) json(res, 500, { ok: false, error: messageOf(err) })
                else res.destroy()
              } catch {
                // 连接已断，忽略
              }
            })
          },
        }),
      'diary.route(api)',
    )
  }

  // ---------- 页面 ----------

  private handlePage(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(renderPage(this.config.pagePath))
  }

  // ---------- API 分发 ----------

  private async handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    try {
      if (req.method === 'GET' && path === `${this.config.pagePath}/api/today`) return await this.handleToday(res)
      if (req.method === 'GET' && path === `${this.config.pagePath}/api/dates`) return await this.handleDates(res)
      if (req.method === 'GET' && path === `${this.config.pagePath}/api/models`) return await this.handleModels(res)
      if (path === `${this.config.pagePath}/api/settings`) return await this.handleSettings(req, res)
      if (req.method === 'POST' && path === `${this.config.pagePath}/api/submit`) return await this.handleSubmit(req, res)
      if (req.method === 'POST' && path === `${this.config.pagePath}/api/retry-summary`) return await this.handleRetry(req, res)
      json(res, 404, { ok: false, error: `未知端点：${req.method} ${path}` })
    } catch (err) {
      json(res, 500, { ok: false, error: messageOf(err) })
    }
  }

  /** 每次请求现解析日记目录（页面设置卡写 config.json 后无需重载即生效）。null = 未配置。 */
  private diaryDir(): string | null {
    return resolveDirValue(this.config.diaryDir, loadPathVars().diaryDir)
  }

  /** patch/profile 给了非空目录且与 config.json 不同 → 页面设置被覆盖，写入不会生效。 */
  private patchOverridden(): boolean {
    return this.config.diaryDir !== '' && this.config.diaryDir !== loadPathVars().diaryDir
  }

  private async todayState(): Promise<
    | { configured: false }
    | { configured: true; dir: string; date: string; clock: string; path: string; exists: boolean; content: string }
  > {
    const dir = this.diaryDir()
    if (dir === null) return { configured: false }
    const { date, clock } = thirtyHour(new Date(), this.config.nightCutoff)
    const path = diaryPathFor(dir, date)
    let content: string | null = null
    try {
      content = await readFile(path, 'utf8')
    } catch {
      // 当日文件尚不存在
    }
    return { configured: true, dir, date, clock, path, exists: content !== null, content: content ?? '' }
  }

  private handleToday(res: ServerResponse): Promise<void> {
    return this.todayState().then((state) => json(res, 200, { ok: true, ...state }))
  }

  // ---------- 热力图：记录日聚合 + 日记元表 ----------

  /** 日记元表目录（CONTEXT.md「日记元表」）：`<diaryDir>/.diary-meta/`，一年一个 YYYY.json。 */
  private metaDirOf(dir: string): string {
    return `${dir.replace(/\/+$/, '')}/.diary-meta`
  }

  /**
   * GET /api/dates：热力图板数据。days 的键集合 = readdir 派生的记录日（唯一真相源），
   * 元表只补充 emoji 等非派生字段；frames 由 core.framesFor 纯函数算出。
   */
  private async handleDates(res: ServerResponse): Promise<void> {
    const { date: today } = thirtyHour(new Date(), this.config.nightCutoff)
    const dir = this.diaryDir()
    let names: string[] = []
    if (dir !== null) {
      try {
        names = await readdir(dir)
      } catch {
        // 目录尚不存在 → 无记录日，只回当前帧
      }
    }
    const dates = [...new Set(names.map(extractRecordDate).filter((d): d is string => d !== null))].sort()
    const metas = dir === null ? {} : await this.readDayMetas(dir)
    const days: Record<string, { emoji?: string }> = {}
    for (const d of dates) days[d] = metas[d] ?? {}
    json(res, 200, { ok: true, today, days, frames: framesFor(dates, today) })
  }

  /** 读取全部日历年表并按日期合并；单个年表缺失/损坏只降级该部分（无 emoji → 绿块）。 */
  private async readDayMetas(dir: string): Promise<Record<string, { emoji?: string }>> {
    let names: string[] = []
    try {
      names = await readdir(this.metaDirOf(dir))
    } catch {
      return {}
    }
    const merged: Record<string, { emoji?: string }> = {}
    for (const name of names) {
      if (!/^\d{4}\.json$/.test(name)) continue
      try {
        const raw: unknown = JSON.parse(await readFile(resolve(this.metaDirOf(dir), name), 'utf8'))
        if (typeof raw !== 'object' || raw === null) continue
        for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof value !== 'object' || value === null) continue
          const emoji = (value as Record<string, unknown>).emoji
          merged[date] = typeof emoji === 'string' && emoji.length > 0 ? { emoji } : {}
        }
      } catch {
        // 该年表损坏 → 跳过，热力图对该年降级绿块
      }
    }
    return merged
  }

  /** keep-last 写入当日 emoji 到年表（同日重提交/重试随评注覆盖；首写建目录建文件）。 */
  private async saveDayEmoji(dir: string, date: string, emoji: string): Promise<void> {
    const path = resolve(this.metaDirOf(dir), `${date.slice(0, 4)}.json`)
    let table: Record<string, { emoji?: string }> = {}
    try {
      const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (typeof raw === 'object' && raw !== null) table = raw as Record<string, { emoji?: string }>
    } catch {
      // 首写或旧表不可解析 → 重建（丢的只是 emoji，记录日本身由文件派生，不受影响）
    }
    table[date] = { emoji }
    try {
      await mkdir(this.metaDirOf(dir), { recursive: true })
      await writeFile(path, `${JSON.stringify(table, null, 2)}\n`, 'utf8')
    } catch {
      // 元表写失败不拖垮提交：原文与评注均已落盘，热力图当日降级绿块
    }
  }

  // ---------- 可选模型：页面「AI 评注模型」选择器的数据源 ----------

  /**
   * 列出所有已注册 provider 及其各自可用的模型（单个 provider 枚举失败只降级该组，
   * 不拖垮整个列表）。目录为空时 providers 为空数组，页面回退到插件默认配置。
   */
  private async handleModels(res: ServerResponse): Promise<void> {
    const providers: { provider: string; name: string; models: { id: string; name: string }[] }[] = []
    for (const info of this.pluginCtx.llm.listProviders()) {
      let models: { id: string; name: string }[] = []
      try {
        models = (await this.pluginCtx.llm.listModels(info.id)).map((m) => ({ id: m.id, name: m.name }))
      } catch {
        // 该 provider 枚举失败（如远端不可达）→ 留空组，模型仍可手选不可见
      }
      providers.push({ provider: info.id, name: info.name ?? info.id, models })
    }
    json(res, 200, {
      ok: true,
      providers,
      current: { provider: this.config.provider, model: this.config.model },
    })
  }

  /**
   * 解析页面随提交带来的可选模型覆盖：仅当 provider+model 确实出现在模型目录里
   * 才采纳，否则静默回退插件默认配置——页面选择器是唯一入口，不做开放透传。
   */
  private async resolveModelOverride(body: Record<string, unknown>): Promise<{ provider?: string; model?: string }> {
    const provider = typeof body.provider === 'string' ? body.provider : ''
    const model = typeof body.model === 'string' ? body.model : ''
    if (provider.length === 0 || model.length === 0) return {}
    let models: readonly { id: string }[] = []
    try {
      models = await this.pluginCtx.llm.listModels(provider)
    } catch {
      return {}
    }
    return models.some((m) => m.id === model) ? { provider, model } : {}
  }

  // ---------- 设置：日记目录（页面「设置」卡的后端） ----------

  /**
   * GET /api/settings：生效目录 + 是否被 cordis 覆盖。
   * POST /api/settings：写 config.json（仅本机请求；~ 展开、mkdir 探测），即时生效。
   */
  private async handleSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      const effective = this.diaryDir()
      return json(res, 200, {
        ok: true,
        configured: effective !== null,
        diaryDir: effective,
        overridden: this.patchOverridden(),
      })
    }
    if (req.method !== 'POST') {
      return json(res, 404, { ok: false, error: `未知端点：${req.method} /api/settings` })
    }
    if (!isLocalRequest(req, this.trustedHosts())) {
      return json(res, 403, { ok: false, error: '设置端点仅接受本机（回环地址）请求' })
    }
    const body = await readJson(req)
    const raw = typeof body.diaryDir === 'string' ? body.diaryDir.trim() : ''
    if (raw.length === 0) {
      return json(res, 400, { ok: false, error: '日记目录不能为空' })
    }
    const dir = absolutize(raw)
    try {
      await mkdir(dir, { recursive: true })
    } catch (err) {
      return json(res, 400, { ok: false, error: `目录无法创建：${messageOf(err)}` })
    }
    if (this.patchOverridden()) {
      return json(res, 409, {
        ok: false,
        error: `当前目录由 profile/patch 配置覆盖（${this.config.diaryDir}），页面修改不会生效`,
      })
    }
    try {
      await savePathVars({ diaryDir: dir })
    } catch (err) {
      return json(res, 500, { ok: false, error: `config.json 写入失败：${messageOf(err)}` })
    }
    json(res, 200, { ok: true, diaryDir: dir })
  }

  /** 宿主 webRuntime 的信任域名单（可能未注入，取不到就当空表）。 */
  private trustedHosts(): readonly string[] {
    const runtime = (this.pluginCtx as { webRuntime?: { trustedHosts?: readonly string[] } }).webRuntime
    return runtime?.trustedHosts ?? []
  }

  // ---------- 提交：追加条目 + 总结 ----------

  private async handleSubmit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (text.length === 0) {
      return json(res, 400, { ok: false, stage: 'save', error: '日记内容为空' })
    }

    const { date, clock } = thirtyHour(new Date(), this.config.nightCutoff)
    const dir = this.diaryDir()
    if (dir === null) {
      return json(res, 400, { ok: false, stage: 'save', error: '尚未配置日记目录：点页面右上角「设置」填写存储路径' })
    }
    await mkdir(dir, { recursive: true })
    const path = diaryPathFor(dir, date)

    let prior: string | null = null
    try {
      prior = await readFile(path, 'utf8')
    } catch {
      // 当日文件尚不存在 → 按模板新建
    }

    // 再提交：摘掉上一轮我们自己写的尾部评注块（其上内容原样保留），条目追加其后
    const stripped = prior === null ? null : withoutTrailingCommentBlock(prior)
    const regenerated = stripped !== null
    const base = prior === null ? fillTemplate(await this.loadTemplate(), date) : (stripped ?? prior)

    const content = joinBlock(base, text)
    await writeFile(path, content, 'utf8') // 原文先落盘

    try {
      const summary = await this.summarize(content, await this.resolveModelOverride(body))
      await writeFile(path, joinBlock(content, buildCommentBlock({ ...summary, clock })), 'utf8')
      if (summary.emoji !== undefined) await this.saveDayEmoji(dir, date, summary.emoji)
      json(res, 200, { ok: true, date, clock, path, regenerated, ...summary })
    } catch (err) {
      json(res, 502, {
        ok: false,
        stage: 'summary',
        date,
        clock,
        path,
        error: messageOf(err),
        hint: '原文已保存；可点「仅重试总结」补生成评注',
      })
    }
  }

  // ---------- 重试：仅重新生成总结 ----------

  private async handleRetry(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req)
    const state = await this.todayState()
    if (!state.configured) {
      return json(res, 400, { ok: false, error: '尚未配置日记目录：点页面右上角「设置」填写存储路径' })
    }
    const { dir, date, clock, path, content, exists } = state
    if (!exists || content.trim().length === 0) {
      return json(res, 400, { ok: false, error: '今天还没有日记内容' })
    }
    const base = withoutTrailingCommentBlock(content) ?? content
    try {
      const summary = await this.summarize(base, await this.resolveModelOverride(body))
      await writeFile(path, joinBlock(base, buildCommentBlock({ ...summary, clock })), 'utf8')
      if (summary.emoji !== undefined) await this.saveDayEmoji(dir, date, summary.emoji)
      json(res, 200, { ok: true, date, clock, path, ...summary })
    } catch (err) {
      json(res, 502, { ok: false, stage: 'summary', error: messageOf(err), hint: '原文未受影响，可稍后再试' })
    }
  }

  // ---------- 内部 ----------

  private summarize(diaryText: string, override: { provider?: string; model?: string } = {}): Promise<SummaryOutput> {
    return runSummary(this.pluginCtx, {
      provider: override.provider ?? this.config.provider,
      model: override.model ?? this.config.model,
      temperature: this.config.temperature,
      timeoutMs: this.config.timeoutMs,
    }, diaryText)
  }

  private async loadTemplate(): Promise<string | null> {
    try {
      return await readFile(this.config.templatePath, 'utf8')
    } catch {
      return null // 缺失时 fillTemplate 走内置兜底
    }
  }
}

// ---------- 小工具 ----------

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 写端点围栏：Host 头须为回环地址（本机 web UI 场景），或在宿主信任域名单内。
 * 参考 palette-board 的同款设计——跨网访问的读端点不受限，只有改配置的写端点设卡。
 */
function isLocalRequest(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = (req.headers.host ?? '').toLowerCase()
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  if (hostname === '' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true
  return trustedHosts.includes(hostname)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}
