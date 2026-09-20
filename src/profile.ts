/**
 * 长期记忆「画像」模块：画像的存放与读写、近期概要、注入组装、更新回路、全量重算。
 *
 * 定位（spec.md「Implementation Decisions」）：
 *   - 画像是派生状态——日记是唯一主数据，画像丢失的最坏后果是下次更新前上下文略旧；
 *   - 存放为日记目录隐藏文件夹内的单一 markdown（`.diary-meta/profile.md`），与 emoji 元表
 *     相邻但概念独立，不进「日记元表」；换机器 = 拷贝该文件，运行期没有导入检测代码路径；
 *   - 更新由一份内置固定的规则文档驱动（PROFILE_RULES，随 PROFILE_UPDATE_PROMPT 植入），
 *     不开放用户编辑——ADR-0002 划界：ADR-0001 管「怎么用上下文」，这个管「怎么改画像」；
 *   - 更新复用总结调用的同一套 LLM 路由（provider/model/temperature/timeout 由调用方传入），
 *     不新增任何配置键；
 *   - 三个数值旋钮（保留期/固化阈值/容量上限）是 prompt 调参范畴，定值前集中挂在 TUNING。
 *
 * IO 只有三处：读画像、写画像、ctx.llm 流式调用；其余全是纯函数（本文件被 vitest 直接覆盖）。
 *
 * @module dsh-diary/profile
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { finishError, textBlocksContent } from './llm.ts'
import type { LlmRoute } from './llm.ts'
import { COMMENT_HEADING } from './core.ts'

// ---------- 旋钮：三个数值的占位常量（集中一处，等 prompt 研究定值） ----------

/** 三个数值旋钮（决策条目 03 留白项）。规则文档按这些常量生成，定值只改这里。 */
export const TUNING = deepFreeze({
  /** 近期事件保留期（天）：超期无复提由模型裁决去留。 */
  recentRetentionDays: 14,
  /** 复现固化阈值：近期事件同主题复现达标后提炼进阶段性状态。 */
  reproduceThreshold: 3,
  /** 画像容量硬上限（字符）：超限先压近期、再合并阶段、核心只合并不删。 */
  maxProfileChars: 6000,
})

/** 记忆窗口：今天及前 6 个记录日（内置固定，不是用户旋钮）。 */
export const MEMORY_WINDOW_DAYS = 7

/** 全量重算的分块大小（记录日/块）：让每次更新调用的输入有界，复用日常更新机制。 */
export const REBUILD_CHUNK_DAYS = 7

// ---------- 画像文件：存放与读写 ----------

/** 画像文件名：与 `YYYY.json` 元表同居 `.diary-meta/`，ASCII 命名。 */
export const PROFILE_FILE_NAME = 'profile.md'

/** 画像文件路径：`<diaryDir>/.diary-meta/profile.md`。 */
export function profilePathOf(diaryDir: string): string {
  return `${diaryDir.replace(/\/+$/, '')}/.diary-meta/${PROFILE_FILE_NAME}`
}

/** 画像文件是否存在（全量重算守卫用：存在即拒绝，永不覆盖维护中的画像）。 */
export async function profileExists(diaryDir: string): Promise<boolean> {
  try {
    await stat(profilePathOf(diaryDir))
    return true
  } catch {
    return false
  }
}

/**
 * 读画像全文。文件缺失/为空/读不了 → 空串（空态）：调用方按「无画像」降级，
 * 不报错、不顺带创建文件——新用户/新机器的第一天就有完整可用的日记体验。
 */
export async function readProfileText(diaryDir: string): Promise<string> {
  try {
    return await readFile(profilePathOf(diaryDir), 'utf8')
  } catch {
    return ''
  }
}

/**
 * 写画像全文（整文件由模型重写）。同进程内串行由 JS 事件循环保证、last-writer-wins——
 * 画像是派生状态，丢一次的后果仅是上下文略旧，不引入原子写/锁（决策条目 01 Q4）。
 */
export async function writeProfileText(diaryDir: string, text: string): Promise<void> {
  await mkdir(dirname(profilePathOf(diaryDir)), { recursive: true })
  await writeFile(profilePathOf(diaryDir), text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

// ---------- 内置更新 prompt 与规则文档 ----------

/**
 * 固定更新规则文档（决策条目 03 定案原文，三个数字按 TUNING 常量生成）。
 * 随 PROFILE_UPDATE_PROMPT 植入每次更新调用：规则与实现同源，不给用户留出破坏规则的口子。
 */
export const PROFILE_RULES = [
  '# 画像更新规则',
  '',
  '画像 = 单一 markdown，三区分层，越上越稳定。画像永远落后于本人：一切条目都是快照、不是定律；强证据出现时大胆改写任何一层，包括核心。',
  '',
  '## 人格核心',
  '跨场景稳定者：价值观、认知特点、行为因果律。',
  '- 单日事件无权改动（防噪）',
  '- 强证据可改写、合并、删除：显式自我推翻，或跨多日的一致新证据——大胆更新，不死板',
  '- 新条目需 ≥2 次独立复现方可入区',
  '- 每条带复现次数',
  '',
  '## 阶段性状态',
  '当前阶段的执念、项目、生活重心，可附一行「来向 → 去向」。',
  '- 阶段迁移时整组退役：压成一行轨迹，明细出区',
  '',
  '## 近期事件',
  '当日及最近的具体事件、情绪、计划。每条带「末次提及」日期。',
  `- 衰减主力：超保留期（${TUNING.recentRetentionDays} 天）无复提 → 三选一：删除 / 留观一期 / 提炼上层`,
  '',
  '## 固化',
  `近期事件同主题复现 ≥${TUNING.reproduceThreshold} 次 → 提炼进阶段状态；阶段状态跨阶段仍稳定 → 升入核心。沉默不是证据：上层不因「最近没提」被删。`,
  '',
  '## 容量',
  `硬上限（${TUNING.maxProfileChars} 字符）；超限先压近期、再合并阶段、核心最后动且只合并不删——大小不是删除的理由，证据才是。遗忘只发生在画像层，日记原文永不改动。`,
].join('\n')

/**
 * 画像更新的系统提示词：内置固定、不开放编辑。输入 = 旧画像全文 + 当天日记全文，
 * 输出 = 新画像全文（完整 markdown，不是 diff）。遗忘规则全文见 {@link PROFILE_RULES}。
 */
export const PROFILE_UPDATE_PROMPT = [
  '你是用户的长期记忆维护助手，唯一任务是维护一份关于用户的画像。',
  '',
  '每次给你两部分输入：【旧画像】（可能为空）与【今天的日记】。',
  '输出 = 更新后的完整画像全文——不是 diff、不是片段、不是任何说明文字。',
  '',
  '输出格式要求：',
  '- 只输出画像本体（markdown），从 `# 用户画像` 一级标题开始；不要解释、不要寒暄、不要代码围栏',
  '- 保持三分区与标题用字：`## 人格核心` / `## 阶段性状态` / `## 近期事件`',
  '- 人格核心每条带（复现 N 次）；近期事件每条带（末次提及 YYYY-MM-DD）',
  '- 旧画像为空时，只从今天的日记建一份最小可用画像；核心区没有 ≥2 次复现的证据就不放条目',
  '',
  '更新时严格遵循以下规则文档：',
  '',
  PROFILE_RULES,
].join('\n')

/** 更新调用的输入组装：旧画像节 → 今天全文节（纯数据拼接，顺序即主次暗示）。 */
export function buildUpdateInput(oldProfile: string, diaryText: string): string {
  const profile = oldProfile.trim().length > 0 ? oldProfile.trim() : '（空，尚无画像）'
  return `【旧画像】\n${profile}\n\n【今天的日记】\n${diaryText}`
}

// ---------- 近期概要：从过往日记的尾部评注块提取（零 LLM 成本） ----------

export interface DayDigest {
  readonly keyword: string
  readonly oneLine: string
}

/**
 * 从一篇日记全文提取当日 digest：定位尾部 AI 评注块，取【今日关键词】与收尾行的
 * 一句话总结。坏文件降级：无评注块/字段缺失 → null（该日不出现在概要里，不影响其余）。
 * 收尾行取块内**最后**一条匹配：评注正文里出现「9:00 | 起床」式行不该劫持当日一句话。
 */
export function parseDayDigest(content: string): DayDigest | null {
  const at = content.lastIndexOf(`\n${COMMENT_HEADING}`)
  const block = at !== -1 ? content.slice(at + 1) : content.startsWith(COMMENT_HEADING) ? content : null
  if (block === null) return null
  const kw = /^\*\*今日关键词\*\*：[ \t]*(.+?)[ \t]*$/m.exec(block)
  const trailers = [...block.matchAll(/^\d{1,2}:\d{2}[ \t]*\|[ \t]*(.+?)[ \t]*$/gm)]
  const ol = trailers.at(-1) ?? null
  if (kw === null || ol === null) return null
  return { keyword: kw[1], oneLine: ol[1] }
}

/** 概要行：`- MM-DD【关键词】一句话总结`；emoji 可选（来自 emoji 元表，同为现成数据）。 */
export function formatDigestLine(date: string, digest: DayDigest, emoji?: string): string {
  const tail = emoji !== undefined && emoji.length > 0 ? ` ${emoji}` : ''
  return `- ${date.slice(5)}【${digest.keyword}】${digest.oneLine}${tail}`
}

/**
 * 记忆窗口：今天及前 windowDays-1 个记录日（内置常量，非记录日自然跳过）。
 * 返回**过去**的记录日（不含今天——当日文件本身不进概要），按时间升序：
 * 离今天最近的排最后，顺势接上「今天的日记全文」那一节。
 */
export function memoryWindow(recordDates: readonly string[], today: string, windowDays = MEMORY_WINDOW_DAYS): string[] {
  const unique = [...new Set(recordDates)].filter((d) => d <= today).sort()
  if (unique.length === 0) return []
  // 今天本身是记录日时占窗口一格（当日文件不进概要，要剔掉）；今天还没建文件则取前 6 个
  const hasToday = unique[unique.length - 1] === today
  const scoped = hasToday ? unique.slice(-windowDays) : unique.slice(-(windowDays - 1))
  return hasToday ? scoped.slice(0, -1) : scoped
}

// ---------- 注入：总结调用的 user message 组装 ----------

/** 注入的层级尾句：代码侧组装，用户在 prompt 卡的任何编辑都碰不到它（防稀释第三道防线）。 */
const HIERARCHY_TAIL = '今天的日记是唯一主体，画像与概要仅作参考。'

export interface MemoryContext {
  /** 画像全文；空串 = 缺失/为空，注入时整节省略。 */
  readonly profileText: string
  /** 近期概要行（{@link formatDigestLine} 的产物），按时间升序；空数组 = 无概要可注。 */
  readonly digestLines: readonly string[]
}

/**
 * 组装总结调用的 user message：单条消息分三节——【用户画像】（画像非空时）→
 * 【近期日记概要】→【今天的日记全文】，末尾附层级说明。画像为空时整节省略，
 * 消息退化为「今天全文 + 概要」。上下文是数据不是契约：系统提示词不经过这里。
 */
export function buildSummaryUserMessage(diaryText: string, memory: MemoryContext): string {
  const sections: string[] = []
  if (memory.profileText.trim().length > 0) sections.push(`【用户画像】\n${memory.profileText.trim()}`)
  if (memory.digestLines.length > 0) sections.push(`【近期日记概要】\n${memory.digestLines.join('\n')}`)
  sections.push(`【今天的日记全文】\n${diaryText}`)
  return `${sections.join('\n\n')}\n\n${HIERARCHY_TAIL}`
}

// ---------- 更新回路：LLM 调用与落盘 ----------

/**
 * 一次画像更新调用（旧画像全文 + 当天日记全文 → 新画像全文），无磁盘副作用。
 * 失败在返回前抛出；落盘由调用方决定（日常更新立即写，全量重算最后一次性写）。
 */
export async function generateProfile(
  ctx: Context,
  cfg: LlmRoute,
  oldProfile: string,
  diaryText: string,
): Promise<string> {
  const messages = [
    createUserMessage({
      content: [{ type: 'text', text: buildUpdateInput(oldProfile, diaryText) }],
      source: { kind: 'plugin', plugin: 'dsh-diary' },
    }),
  ]
  const options: GenerateOptions = deepFreeze({
    provider: cfg.provider,
    model: cfg.model,
    temperature: cfg.temperature,
    messages,
    system: PROFILE_UPDATE_PROMPT,
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    assembler.push(chunk)
  }
  const terminalError = finishError(assembler.finish, '画像更新')
  if (terminalError !== undefined) throw terminalError
  const text = textBlocksContent(assembler.blocks())
  if (text.trim().length === 0) throw new Error('diary: 画像更新输出为空')
  return text
}

/**
 * 日常画像更新：生成并立即落盘（同步完成、提交响应返回前写完）。
 * 失败抛出、画像文件保持旧值——无重试入口、无待重试标记，下次提交天然自愈。
 */
export async function runProfileUpdate(
  ctx: Context,
  cfg: LlmRoute,
  diaryDir: string,
  oldProfile: string,
  diaryText: string,
): Promise<string> {
  const text = await generateProfile(ctx, cfg, oldProfile, diaryText)
  await writeProfileText(diaryDir, text)
  return text
}

// ---------- 全量重算：按时间顺序分块累积 ----------

export interface RebuildEntry {
  readonly date: string
  readonly text: string
}

/**
 * 全量重算：从全部历史日记（entries 已按时间升序）分块累积生成初始画像——
 * 从最旧分块起，每块跑一次标准更新调用（旧画像 + 该块全文 → 新画像），接力至最新。
 * 每次输入有界，不引入第二条生成路径；画像只在全部成功后一次性落盘，
 * 中途失败即抛错且不留半成品（文件保持不存在或旧值）。
 */
export async function rebuildProfile(
  ctx: Context,
  cfg: LlmRoute,
  diaryDir: string,
  entries: readonly RebuildEntry[],
): Promise<string> {
  let profile = ''
  for (let i = 0; i < entries.length; i += REBUILD_CHUNK_DAYS) {
    const chunk = entries.slice(i, i + REBUILD_CHUNK_DAYS)
    const blockText = chunk.map((e) => `【${e.date}】\n${e.text.trim()}`).join('\n\n')
    profile = await generateProfile(ctx, cfg, profile, blockText)
  }
  if (entries.length === 0) return profile
  await writeProfileText(diaryDir, profile)
  return profile
}
