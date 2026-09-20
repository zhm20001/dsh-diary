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
 * user message 的画像/近期概要注入在 profile 模块组装（上下文是数据不是契约）。
 *
 * @module dsh-diary/summary
 */
import type { Context } from '@deepseek-ai/cordis';
import type { LlmRoute } from './llm.ts';
/** 总结调用的路由与生效系统提示词（三级解析后的评注 prompt，见 service）。 */
export interface SummaryLlmConfig extends LlmRoute {
    readonly systemPrompt: string;
}
/** 内置默认评注 prompt：未自定义时的生效值，也是 prompt 卡「恢复默认」的目标。
 *  文案与注入结构同源（spec 改造点一）：当天日记全文是主体，画像与近期概要仅作参考——
 *  用户自定义 prompt 一字不动（ADR-0001：注入是数据不是契约）。 */
export declare const DEFAULT_SUMMARY_PROMPT: string;
/** 评注 prompt 长度上限（防呆不防恶意）。 */
export declare const SUMMARY_PROMPT_MAX = 8000;
/**
 * 校验自定义评注 prompt，返回问题列表（空数组 = 合法）。
 * 标记按“包含”匹配：不要求行首、不查重复——解析器取模型输出的首个匹配，
 * prompt 里标记出现两次只是啰嗦不是错误。空与超长按去首尾空白后计。
 */
export declare function promptDefects(prompt: string): string[];
export interface SummaryOutput {
    readonly keyword: string;
    readonly oneLine: string;
    readonly comment: string;
    /** 当日 emoji（尽力而为：解析不出则缺省，热力图降级绿块）。 */
    readonly emoji?: string;
}
/** 从【当日 emoji】行提取恰好一枚 emoji（ZWJ 序列整枚保留）；没有则 undefined。 */
export declare function parseEmoji(raw: string): string | undefined;
/** 解析模型输出；三段评注字段缺失直接抛错（错误消息带原始输出前缀，便于 UI 提示排查）。
 *  【当日 emoji】为尽力而为：字段缺失或行内没有 emoji 都只是缺省，不抛错。 */
export declare function parseSummary(raw: string): SummaryOutput;
/**
 * 执行一次完整总结调用。失败在返回前抛出；本函数无任何磁盘副作用。
 * userText 是已组装好的 user message 正文：画像/近期概要的注入在 profile 模块完成
 * （buildSummaryUserMessage，三节 + 层级尾句），本函数只负责 LLM 管线与解析。
 */
export declare function runSummary(ctx: Context, cfg: SummaryLlmConfig, userText: string): Promise<SummaryOutput>;
