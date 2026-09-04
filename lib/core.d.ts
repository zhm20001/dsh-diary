/**
 * 日记确定性核心（纯函数，无 IO）：30 小时制、模板填充、追加拼接、评注块组装。
 * IO 全部在 service 层；本文件被 vitest 直接覆盖。
 *
 * @module dsh-diary/core
 */
export interface ThirtyHour {
    readonly date: string;
    readonly clock: string;
}
/**
 * 30 小时制：cutoff 点前视为前一天深夜（如 cutoff=6 时 02:30 → 前一天 26:30）。
 * 时间权威是调用方传入的本地系统时间（new Date()）。
 */
export declare function thirtyHour(now: Date, cutoff?: number): ThirtyHour;
/** 当日日记文件绝对路径：`<diaryDir>/YYYY-MM-DD.md`。 */
export declare function diaryPathFor(diaryDir: string, date: string): string;
/**
 * 从目录项名提取记录日（YYYY-MM-DD）：带后缀的手工文件（如 2026-04-28-测试日记.md）
 * 也算；子目录、无关文件、分量滚动的非法日期（2026-02-30）返回 null。
 */
export declare function extractRecordDate(name: string): string | null;
export type CellState = 'future' | 'blank' | 'written' | 'today';
/**
 * 格子四态（CONTEXT.md）。日期键一律字符串比较；"今天"由调用方按 30 小时制口径传入。
 * 记录优先：手工建的未来日期文件也按已写画——格子陈述"这 天有记录"的事实。
 */
export declare function cellState(dayKey: string, todayKey: string, written: boolean): CellState;
/** 半年帧标识，如 '2026H2'（字符串序即时间序）。输入须为合法日期键。 */
export declare function frameIdOf(dateKey: string): string;
export interface FrameInfo {
    /** 如 '2026H2' */
    readonly id: string;
    /** 如 '2026 下' */
    readonly label: string;
    /** 网格首日（YYYY-MM-DD）：半年首日所在周的周一。 */
    readonly start: string;
    readonly halfStart: string;
    readonly halfEnd: string;
    /** 半年总天数：上半年 181（闰 182），下半年 184。 */
    readonly halfDays: number;
    /** 半年范围内的记录日数（网格冗余边日不算，归属邻帧）。 */
    readonly count: number;
}
/**
 * 列出从最早记录所在半年到"今天"所在半年的所有帧（无记录时只有当前帧）。
 * dates 无需有序；未来日期的手工文件不改变帧范围（网格只按真实时间切帧）。
 */
export declare function framesFor(dates: readonly string[], today: string): FrameInfo[];
export declare const BUILTIN_TEMPLATE = "---\ncategories: \u65E5\u8BB0\ndate: {{date}}\n---\n---\n";
/**
 * 模板填日期：`{{date}}` 占位优先；否则补空 `date:` 字段；两者都没有则原样返回。
 * template 为 null（文件缺失/读取失败）时用内置兜底模板。
 */
export declare function fillTemplate(template: string | null, date: string): string;
/** 追加拼接：块与前文之间恰好空一个空行；文末恒以单个换行收束。 */
export declare function joinBlock(existing: string, block: string): string;
export declare const COMMENT_HEADING = "## AI\u8BC4\u6CE8";
export interface CommentInput {
    /** 今日关键词（2-4 字）。 */
    readonly keyword: string;
    /** 一句话总结。 */
    readonly oneLine: string;
    /** 评注正文（可多行）。 */
    readonly comment: string;
    /** 收尾钟点（30 小时制 HH:MM）。 */
    readonly clock: string;
}
/** 组装 AI 评注收尾块——与 v1 skill 的评注格式逐行一致。 */
export declare function buildCommentBlock(input: CommentInput): string;
/** 去掉模型输出首尾误带的 markdown 代码围栏行。 */
export declare function stripFences(s: string): string;
/**
 * 摘掉文件尾部由本插件生成的评注块（最后一次出现 {@link COMMENT_HEADING} 处到文末），
 * 返回剩余正文；没有旧评注块时返回 null。
 *
 * 用途：同一天再提交时重新生成总结——只裁掉我们自己写的尾部块，
 * 其上的用户内容原样保留。约定：不要手工编辑 AI评注块之下的区域。
 */
export declare function withoutTrailingCommentBlock(content: string): string | null;
