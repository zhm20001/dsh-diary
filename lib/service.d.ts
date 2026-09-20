import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export interface DiaryPluginConfig {
    diaryDir: string;
    templatePath: string;
    pagePath: string;
    provider: string;
    model: string;
    temperature: number;
    timeoutMs: number;
    nightCutoff: number;
    summaryPrompt: string;
}
export declare class DiaryService extends Service {
    static inject: string[];
    static Config: z<Schemastery.ObjectS<{
        diaryDir: z<string, string>;
        templatePath: z<string, string>;
        pagePath: z<string, string>;
        provider: z<string, string>;
        model: z<string, string>;
        temperature: z<number, number>;
        timeoutMs: z<number, number>;
        nightCutoff: z<number, number>;
        summaryPrompt: z<string, string>;
    }>, Schemastery.ObjectT<{
        diaryDir: z<string, string>;
        templatePath: z<string, string>;
        pagePath: z<string, string>;
        provider: z<string, string>;
        model: z<string, string>;
        temperature: z<number, number>;
        timeoutMs: z<number, number>;
        nightCutoff: z<number, number>;
        summaryPrompt: z<string, string>;
    }>>;
    readonly config: DiaryPluginConfig;
    readonly pluginCtx: Context;
    constructor(ctx: Context, config: DiaryPluginConfig);
    private handlePage;
    private handleApi;
    /** 每次请求现解析日记目录（页面设置卡写 config.json 后无需重载即生效）。null = 未配置。 */
    private diaryDir;
    /** patch/profile 给了非空目录且与 config.json 不同 → 页面设置被覆盖，写入不会生效。 */
    private patchOverridden;
    /** 评注 prompt 三级解析（ADR-0001，与目录同款优先级）：cordis patch > config.json > 内置默认。 */
    private effectivePrompt;
    private todayState;
    private handleToday;
    /** 日记元表目录（CONTEXT.md「日记元表」）：`<diaryDir>/.diary-meta/`，一年一个 YYYY.json。 */
    private metaDirOf;
    /**
     * GET /api/dates：热力图板数据。days 的键集合 = readdir 派生的记录日（唯一真相源），
     * 元表只补充 emoji 等非派生字段；frames 由 core.framesFor 纯函数算出。
     */
    private handleDates;
    /** 读取全部日历年表并按日期合并；单个年表缺失/损坏只降级该部分（无 emoji → 绿块）。 */
    private readDayMetas;
    /** keep-last 写入当日 emoji 到年表（同日重提交/重试随评注覆盖；首写建目录建文件）。 */
    private saveDayEmoji;
    /**
     * 列出所有已注册 provider 及其各自可用的模型（单个 provider 枚举失败只降级该组，
     * 不拖垮整个列表）。目录为空时 providers 为空数组，页面回退到插件默认配置。
     */
    private handleModels;
    /**
     * 解析页面随提交带来的可选模型覆盖：仅当 provider+model 确实出现在模型目录里
     * 才采纳，否则静默回退插件默认配置——页面选择器是唯一入口，不做开放透传。
     */
    private resolveModelOverride;
    /**
     * GET /api/settings：生效目录 + 是否被 cordis 覆盖。
     * POST /api/settings：写 config.json（仅本机请求；~ 展开、mkdir 探测），即时生效。
     */
    private handleSettings;
    /** 宿主 webRuntime 的信任域名单（可能未提供，取不到就当空表）。 */
    private trustedHosts;
    /**
     * GET /api/prompt：生效 prompt（三级解析后的值）+ customized（config.json 有自定义）+ overridden（patch 覆盖）。
     * POST /api/prompt：{ prompt } 保存自定义（契约校验）；{ reset: true } 删键恢复内置默认。
     * 与 /api/settings 同款围栏：仅本机（回环）请求可写；被 patch 覆盖时 409。
     */
    private handlePrompt;
    private handleSubmit;
    private handleRetry;
    /**
     * 评注落盘后执行一次画像更新（旧画像全文 + 当天日记全文 → 新画像全文，同步落盘）。
     * 失败语义：保存与总结已成功 → 响应仍 200，只回一条非致命警告字段；画像文件保持旧值，
     * 无重试入口、无待重试标记、无断路器（下次提交天然自愈）。
     */
    private updateProfile;
    /**
     * POST /api/rebuild-profile：受守卫的全量重算。检测到画像文件已存在 → 拒绝
     * （该按钮对此用户无意义，永不覆盖一份维护中的画像）；否则从全部历史日记按时间顺序
     * 分块累积生成（每块一次标准更新调用，最旧分块优先），成功后一次性落盘。
     * 成本警告与二次确认在页面侧完成，端点不重复拦截。
     */
    private handleRebuildProfile;
    /** 总结调用的 LLM 路由（画像更新复用同一套，不新增配置键）。 */
    private llmRoute;
    /**
     * 注入用的记忆上下文：画像全文 + 记忆窗口内过往记录日的概要行（零 LLM 成本）。
     * 画像缺失/为空 → 空串（注入时整节省略）；坏日记文件（无评注块/字段缺失）降级跳过。
     */
    private buildMemory;
    /** 列日记目录里的记录日文件（按记录日、文件名排序；「有没有日记」永远当场派生）。 */
    private listDiaryFiles;
    /** 某记录日的 digest：同日多文件按序取第一个能解析出评注块的；都坏 → null。 */
    private readDayDigest;
    /** 全量重算的输入：每个记录日一条（同日多文件合并），按时间升序。 */
    private historyEntries;
    private summarize;
    private loadTemplate;
}
