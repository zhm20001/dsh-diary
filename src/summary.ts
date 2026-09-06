/**
 * AI 总结管线：构建契约 prompt → ctx.llm 流式直调 → 解析四段产出。
 *
 * 输出契约与 v1 journal.py finalize 一致（【今日关键词】/【一句话总结】/【评注】），
 * 另加【当日 emoji】（热力图板已写格的主表示）；这是模型唯一被允许产出的东西——
 * 格式组装永远不经过模型。emoji 为尽力而为字段：缺失/无效不报错，返回 undefined，
 * 热力图渲染时自然降级为绿块。
 *
 * 评注 prompt 用户可编辑（ADR-0001）：系统提示词经三级解析（cordis patch > config.json >
 * 内置默认）注入 runSummary；保存侧与运行期都靠 promptDefects 校验守护输出契约。
 *
 * @module dsh-diary/summary
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, GenerateOptions } from '@deepseek-ai/dsh-llm'

/** 总结调用的 LLM 路由配置（provider/model/temperature 是插件配置，不随会话漂移）。 */
export interface SummaryLlmConfig {
  readonly provider: string
  readonly model: string
  readonly temperature: number
  readonly timeoutMs: number
  /** 生效的系统提示词（三级解析后的评注 prompt，见 service）。 */
  readonly systemPrompt: string
}

/** 内置默认评注 prompt：未自定义时的生效值，也是 prompt 卡「恢复默认」的目标。 */
export const DEFAULT_SUMMARY_PROMPT = [
  '你是用户的私人日记总结助手。基于给出的当天日记全文，严格按以下契约输出，除此之外不要输出任何内容——不要代码围栏、不要寒暄、不要复述契约：',
  '',
  '【今日关键词】2-4 个字的当天核心主题',
  '【一句话总结】一句话概括当天的主要事件或状态变化',
  '【当日 emoji】恰好一枚 emoji，概括今天的整体状态（只输出 emoji 本身，不要文字）',
  '【评注】',
  '有深度的总结性评注（可多行）：今日主题或亮点、情感与思考、建议或反思。必须基于完整原文而非片段；给真实见解，适当温情，不说客套话。【评注】标记后必须先换行再写正文。',
].join('\n')

/** 评注 prompt 长度上限（防呆不防恶意）。 */
export const SUMMARY_PROMPT_MAX = 8000

/** parseSummary 硬依赖的契约标记（缺一则总结必败）；【当日 emoji】为可选字段不入此列。 */
const REQUIRED_MARKERS = ['【今日关键词】', '【一句话总结】', '【评注】'] as const

/**
 * 校验自定义评注 prompt，返回问题列表（空数组 = 合法）。
 * 标记按“包含”匹配：不要求行首、不查重复——解析器取模型输出的首个匹配，
 * prompt 里标记出现两次只是啰嗦不是错误。空与超长按去首尾空白后计。
 */
export function promptDefects(prompt: string): string[] {
  const defects: string[] = []
  const text = prompt.trim()
  if (text.length === 0) defects.push('prompt 不能为空')
  for (const marker of REQUIRED_MARKERS) {
    if (!text.includes(marker)) defects.push(`缺少必需标记${marker}`)
  }
  if (text.length > SUMMARY_PROMPT_MAX) defects.push(`过长（${text.length} > ${SUMMARY_PROMPT_MAX} 字符）`)
  return defects
}

export interface SummaryOutput {
  readonly keyword: string
  readonly oneLine: string
  readonly comment: string
  /** 当日 emoji（尽力而为：解析不出则缺省，热力图降级绿块）。 */
  readonly emoji?: string
}

/** 从【当日 emoji】行提取恰好一枚 emoji（ZWJ 序列整枚保留）；没有则 undefined。 */
export function parseEmoji(raw: string): string | undefined {
  const m = /\p{Extended_Pictographic}(?:\uFE0F|(?:\u200D\p{Extended_Pictographic})+)*/u.exec(raw)
  return m === null ? undefined : m[0]
}

/** 把终态 finish 原因翻译成调用失败（语义同 mytool integrate 的 finishError）。 */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('diary: 总结输出达到 maxTokens 上限')
    case 'tool-calls':
      return new Error('diary: 模型意外请求了工具调用')
    default:
      return new Error(`diary: 不支持的 finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

function textBlocksContent(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/** 解析模型输出；三段评注字段缺失直接抛错（错误消息带原始输出前缀，便于 UI 提示排查）。
 *  【当日 emoji】为尽力而为：字段缺失或行内没有 emoji 都只是缺省，不抛错。 */
export function parseSummary(raw: string): SummaryOutput {
  const kw = /^【今日关键词】[ \t]*(.+?)[ \t]*$/m.exec(raw)
  const ol = /^【一句话总结】[ \t]*(.+?)[ \t]*$/m.exec(raw)
  // 容忍模型把正文直接写在【评注】同一行而不换行：同行捕获 + s 标志跨行
  const body = /^【评注】[ \t]*(.*)$/ms.exec(raw)
  if (kw === null || ol === null || body === null) {
    const missing = [kw === null ? '【今日关键词】' : null, ol === null ? '【一句话总结】' : null, body === null ? '【评注】' : null]
      .filter((s) => s !== null)
      .join('、')
    throw new Error(`diary: 模型输出缺少字段 ${missing}（原始输出前 120 字：${raw.slice(0, 120)}）`)
  }
  const em = /^【当日 emoji】[ \t]*(.+?)[ \t]*$/m.exec(raw)
  // trimStart：宽容正则会把【评注】后的引导换行一并捕获进来，剥掉它
  return { keyword: kw[1], oneLine: ol[1], comment: body[1].trimStart(), emoji: em === null ? undefined : parseEmoji(em[1]) }
}

/** 执行一次完整总结调用。失败在返回前抛出；本函数无任何磁盘副作用。 */
export async function runSummary(ctx: Context, cfg: SummaryLlmConfig, diaryText: string): Promise<SummaryOutput> {
  const messages = [
    createUserMessage({
      content: [{ type: 'text', text: `今天的日记全文如下：\n\n${diaryText}\n\n请按契约输出总结。` }],
      source: { kind: 'plugin', plugin: 'dsh-diary' },
    }),
  ]
  const options: GenerateOptions = deepFreeze({
    provider: cfg.provider,
    model: cfg.model,
    temperature: cfg.temperature,
    messages,
    system: cfg.systemPrompt,
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    assembler.push(chunk)
  }
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  return parseSummary(textBlocksContent(assembler.blocks()))
}
