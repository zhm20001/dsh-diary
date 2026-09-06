/** 插件根目录（config.json、assets/ 所在地）。 */
export declare const PLUGIN_ROOT: string;
/** 随插件分发的日记模板（config.json 缺失时的 templatePath 兜底）。 */
export declare const BUNDLED_TEMPLATE: string;
/** 纸感信纸风 design tokens vendor 副本（由宿主仓库 assets/sync-tokens.mjs 生成并校验，
 *  生成头记录权威 sha256）。改风格改权威文件后同步，勿手改本文件；
 *  副本随仓库提交，插件在任一机器上都自包含。 */
export declare const PAPER_TOKENS_CSS: string;
export interface ConfigVars {
    diaryDir?: string;
    templatePath?: string;
    /** 自定义评注 prompt（页面 prompt 卡维护；缺省 = 用内置默认）。 */
    summaryPrompt?: string;
}
/** 读取插件根 config.json；targetPath 仅供测试注入，生产调用走默认值。 */
export declare function loadConfigVars(targetPath?: string): ConfigVars;
/** `~` 展开为用户主目录；相对路径基于插件根目录。 */
export declare function absolutize(p: string): string;
/** 日记目录解析优先级：cordis patch 覆盖 > config.json（页面设置卡维护）> 未配置（null）。空串视为未设置。 */
export declare function resolveDirValue(configured: string | undefined, fileValue: string | undefined): string | null;
export interface SaveConfigOpts {
    /** 仅供测试注入的落盘路径；生产调用走默认值。 */
    targetPath?: string;
    /** 从 config.json 删除的键（如 prompt 卡「恢复默认」删 summaryPrompt）。 */
    deletes?: (keyof ConfigVars)[];
}
/**
 * 把 patch 合并进插件根 config.json：read-modify-write 保留未知键，原子落盘（tmp+rename）。
 * deletes 在合并后删除指定键。
 */
export declare function saveConfigVars(patch: Partial<ConfigVars>, opts?: SaveConfigOpts): Promise<void>;
