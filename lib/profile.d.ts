import type { Context } from '@deepseek-ai/cordis';
import type { LlmRoute } from './llm.ts';
/** 三个数值旋钮（决策条目 03 留白项）。规则文档按这些常量生成，定值只改这里。 */
export declare const TUNING: {
    /** 近期事件保留期（天）：超期无复提由模型裁决去留。 */
    recentRetentionDays: number;
    /** 复现固化阈值：近期事件同主题复现达标后提炼进阶段性状态。 */
    reproduceThreshold: number;
    /** 画像容量硬上限（字符）：超限先压近期、再合并阶段、核心只合并不删。 */
    maxProfileChars: number;
};
/** 记忆窗口：今天及前 6 个记录日（内置固定，不是用户旋钮）。 */
export declare const MEMORY_WINDOW_DAYS = 7;
/** 全量重算的分块大小（记录日/块）：让每次更新调用的输入有界，复用日常更新机制。 */
export declare const REBUILD_CHUNK_DAYS = 7;
/** 画像文件名：与 `YYYY.json` 元表同居 `.diary-meta/`，ASCII 命名。 */
export declare const PROFILE_FILE_NAME = "profile.md";
/** 画像文件路径：`<diaryDir>/.diary-meta/profile.md`。 */
export declare function profilePathOf(diaryDir: string): string;
/** 画像文件是否存在（全量重算守卫用：存在即拒绝，永不覆盖维护中的画像）。 */
export declare function profileExists(diaryDir: string): Promise<boolean>;
/**
 * 读画像全文。文件缺失/为空/读不了 → 空串（空态）：调用方按「无画像」降级，
 * 不报错、不顺带创建文件——新用户/新机器的第一天就有完整可用的日记体验。
 */
export declare function readProfileText(diaryDir: string): Promise<string>;
/**
 * 写画像全文（整文件由模型重写）。同进程内串行由 JS 事件循环保证、last-writer-wins——
 * 画像是派生状态，丢一次的后果仅是上下文略旧，不引入原子写/锁（决策条目 01 Q4）。
 */
export declare function writeProfileText(diaryDir: string, text: string): Promise<void>;
/**
 * 固定更新规则文档（决策条目 03 定案原文，三个数字按 TUNING 常量生成）。
 * 随 PROFILE_UPDATE_PROMPT 植入每次更新调用：规则与实现同源，不给用户留出破坏规则的口子。
 */
export declare const PROFILE_RULES: string;
/**
 * 画像更新的系统提示词：内置固定、不开放编辑。输入 = 旧画像全文 + 当天日记全文，
 * 输出 = 新画像全文（完整 markdown，不是 diff）。遗忘规则全文见 {@link PROFILE_RULES}。
 */
export declare const PROFILE_UPDATE_PROMPT: string;
/** 更新调用的输入组装：旧画像节 → 今天全文节（纯数据拼接，顺序即主次暗示）。 */
export declare function buildUpdateInput(oldProfile: string, diaryText: string): string;
export interface DayDigest {
    readonly keyword: string;
    readonly oneLine: string;
}
/**
 * 从一篇日记全文提取当日 digest：定位尾部 AI 评注块，取【今日关键词】与收尾行的
 * 一句话总结。坏文件降级：无评注块/字段缺失 → null（该日不出现在概要里，不影响其余）。
 * 收尾行取块内**最后**一条匹配：评注正文里出现「9:00 | 起床」式行不该劫持当日一句话。
 */
export declare function parseDayDigest(content: string): DayDigest | null;
/** 概要行：`- MM-DD【关键词】一句话总结`；emoji 可选（来自 emoji 元表，同为现成数据）。 */
export declare function formatDigestLine(date: string, digest: DayDigest, emoji?: string): string;
/**
 * 记忆窗口：今天及前 windowDays-1 个记录日（内置常量，非记录日自然跳过）。
 * 返回**过去**的记录日（不含今天——当日文件本身不进概要），按时间升序：
 * 离今天最近的排最后，顺势接上「今天的日记全文」那一节。
 */
export declare function memoryWindow(recordDates: readonly string[], today: string, windowDays?: number): string[];
export interface MemoryContext {
    /** 画像全文；空串 = 缺失/为空，注入时整节省略。 */
    readonly profileText: string;
    /** 近期概要行（{@link formatDigestLine} 的产物），按时间升序；空数组 = 无概要可注。 */
    readonly digestLines: readonly string[];
}
/**
 * 组装总结调用的 user message：单条消息分三节——【用户画像】（画像非空时）→
 * 【近期日记概要】→【今天的日记全文】，末尾附层级说明。画像为空时整节省略，
 * 消息退化为「今天全文 + 概要」。上下文是数据不是契约：系统提示词不经过这里。
 */
export declare function buildSummaryUserMessage(diaryText: string, memory: MemoryContext): string;
/**
 * 一次画像更新调用（旧画像全文 + 当天日记全文 → 新画像全文），无磁盘副作用。
 * 失败在返回前抛出；落盘由调用方决定（日常更新立即写，全量重算最后一次性写）。
 */
export declare function generateProfile(ctx: Context, cfg: LlmRoute, oldProfile: string, diaryText: string): Promise<string>;
/**
 * 日常画像更新：生成并立即落盘（同步完成、提交响应返回前写完）。
 * 失败抛出、画像文件保持旧值——无重试入口、无待重试标记，下次提交天然自愈。
 */
export declare function runProfileUpdate(ctx: Context, cfg: LlmRoute, diaryDir: string, oldProfile: string, diaryText: string): Promise<string>;
export interface RebuildEntry {
    readonly date: string;
    readonly text: string;
}
/**
 * 全量重算：从全部历史日记（entries 已按时间升序）分块累积生成初始画像——
 * 从最旧分块起，每块跑一次标准更新调用（旧画像 + 该块全文 → 新画像），接力至最新。
 * 每次输入有界，不引入第二条生成路径；画像只在全部成功后一次性落盘，
 * 中途失败即抛错且不留半成品（文件保持不存在或旧值）。
 */
export declare function rebuildProfile(ctx: Context, cfg: LlmRoute, diaryDir: string, entries: readonly RebuildEntry[]): Promise<string>;
