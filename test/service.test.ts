/**
 * trustedHosts 写围栏回归测试（POST /api/settings 与 /api/prompt 共用）。
 *
 * 背景：cordis 的 ctx 是 Proxy，插件 fiber 上直接读未在 inject 声明的服务属性会抛
 * "cannot get property webRuntime without inject"——曾导致未提供 webRuntime 的宿主上
 * prompt 卡保存 500。回归点：可选服务必须走 ctx.get。
 * 注意必须用 ctx.plugin() 加载（与宿主同款 fiber 结构），直接 new 走 root fiber
 * 的宽松路径，复现不了原 bug。请求体刻意用非法 prompt（400 在写盘前返回），测试不落盘。
 */
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { DiaryService } from '../src/service.ts'
import type { DiaryPluginConfig } from '../src/service.ts'

interface RegisteredRoute {
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** 收集注册路由的桩 webServer（对齐 WebCarrier.register 的最小面）。 */
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

function fakeReq(method: string, url: string, host: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers: { host },
    // readJson 用 for-await 消费请求体
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

function makeConfig(): DiaryPluginConfig {
  return {
    diaryDir: '',
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

/** 宿主同款启动：root 上提供 llm/webServer，再 ctx.plugin 装载 diary；等 3 条路由注册完。 */
async function makeApiHandler(ctx: Context): Promise<RegisteredRoute['handler']> {
  const web = stubWebServer()
  ctx.provide('llm', { listProviders: () => [], listModels: async () => [] })
  ctx.provide('webServer', web)
  ctx.plugin(DiaryService, makeConfig())
  for (let i = 0; i < 200 && web.routes.length < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  const route = web.routes.find((r) => r.path === '/diary/api')
  if (!route) throw new Error('api 前缀路由未注册（插件未启动）')
  return route.handler
}

describe('trustedHosts 写围栏（webRuntime 可选访问）', () => {
  it('宿主未提供 webRuntime：回环请求通过围栏，走到业务校验而非 500 webRuntime 报错', async () => {
    const handler = await makeApiHandler(new Context())
    const res = fakeRes()
    // prompt 非法 → 在写盘前被 promptDefects 拦下；若围栏自身抛错则这里是 500 + webRuntime 字样
    await handler(fakeReq('POST', '/diary/api/prompt', 'localhost:3000', { prompt: '不合法' }), res)
    const { status, body } = await res.capture
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('评注 prompt 无效')
  })

  it('宿主提供了 webRuntime：信任名单外的 Host 拒绝（403），名单内的放行', async () => {
    const ctx = new Context()
    ctx.provide('webRuntime', { trustedHosts: ['diary.example.com'] })
    const handler = await makeApiHandler(ctx)
    const denied = fakeRes()
    await handler(fakeReq('POST', '/diary/api/prompt', 'evil.example.com:8443', { prompt: 'x' }), denied)
    expect((await denied.capture).status).toBe(403)
    const allowed = fakeRes()
    await handler(fakeReq('POST', '/diary/api/prompt', 'diary.example.com', { prompt: '不合法' }), allowed)
    const { status, body } = await allowed.capture
    expect(status).toBe(400)
    expect(JSON.stringify(body)).toContain('评注 prompt 无效')
  })
})
