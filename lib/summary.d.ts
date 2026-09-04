/**
 * AI 总结管线：构建契约 prompt → ctx.llm 流式直调 → 解析四段产出。
 *
 * 输出契约与 v1 journal.py finalize 一致（【今日关键词】/【一句话总结】/【评注】），
 * 另加【当日 emoji】（热力图板已写格的主表示）；这是模型唯一被允许产出的东西——
 * 格式组装永远不经过模型。emoji 为尽力而为字段：缺失/无效不报错，返回 undefined，
 * 热力图渲染时自然降级为绿块。
 *
 * @module dsh-diary/summary
 */
import type { Context } from '@deepseek-ai/cordis';
/** 总结调用的 LLM 路由配置（provider/model/temperature 是插件配置，不随会话漂移）。 */
export interface SummaryLlmConfig {
    readonly provider: string;
    readonly model: string;
    readonly temperature: number;
    readonly timeoutMs: number;
}
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
/** 执行一次完整总结调用。失败在返回前抛出；本函数无任何磁盘副作用。 */
export declare function runSummary(ctx: Context, cfg: SummaryLlmConfig, diaryText: string): Promise<SummaryOutput>;
