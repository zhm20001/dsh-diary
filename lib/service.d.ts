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
    }>, Schemastery.ObjectT<{
        diaryDir: z<string, string>;
        templatePath: z<string, string>;
        pagePath: z<string, string>;
        provider: z<string, string>;
        model: z<string, string>;
        temperature: z<number, number>;
        timeoutMs: z<number, number>;
        nightCutoff: z<number, number>;
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
    /** 宿主 webRuntime 的信任域名单（可能未注入，取不到就当空表）。 */
    private trustedHosts;
    private handleSubmit;
    private handleRetry;
    private summarize;
    private loadTemplate;
}
