/**
 * LLM 调用管线共享件：总结调用与画像更新调用是同一套路由（provider/model/temperature/
 * timeout）、同一套流式组装（BlockAssembler），终态翻译与文本块拼接只在这里存一份——
 * 两个消费模块（summary / profile）都从这里导入，不各存副本。
 *
 * @module dsh-diary/llm
 */
import type { ContentBlock, FinishReason } from '@deepseek-ai/dsh-llm'

/** 两条 LLM 调用（总结 / 画像更新）的共同路由：插件配置，不随会话漂移。 */
export interface LlmRoute {
  readonly provider: string
  readonly model: string
  readonly temperature: number
  readonly timeoutMs: number
}

/** 把终态 finish 原因翻译成调用失败；label 进错误消息，区分是哪条调用失败。 */
export function finishError(finish: FinishReason, label: string): Error | undefined {
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
      return new Error(`diary: ${label}输出达到 maxTokens 上限`)
    case 'tool-calls':
      return new Error('diary: 模型意外请求了工具调用')
    default:
      return new Error(`diary: 不支持的 finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/** 拼接一条消息里的全部文本块（其余块类型本插件不消费）。 */
export function textBlocksContent(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}
