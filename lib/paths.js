/**
 * 插件路径变量：从插件根目录的 config.json 读取；页面「设置」卡经 /api/settings 写回。
 *
 * 约定：
 *   - 相对路径基于插件根目录解析（src/ 与 lib/ 都恰在根下一层，tsx 直载与 tsc 产物共用）；
 *   - `~/` 开头按用户主目录展开；
 *   - config.json 缺失/不可解析/字段为空 → 返回空对象，调用方按「未配置」处理；
 *   - diaryDir 每次请求现读（页面保存后即时生效），cordis patch 的 config 覆盖依然优先；
 *   - config.json 是运行时会被改写的本机文件，不入库；模板见 config.example.json。
 *
 * @module dsh-diary/paths
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** 插件根目录（config.json、assets/ 所在地）。 */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 随插件分发的日记模板（config.json 缺失时的 templatePath 兜底）。 */
export const BUNDLED_TEMPLATE = resolve(PLUGIN_ROOT, 'assets/diary-template.md');
/** 纸感信纸风 design tokens vendor 副本（由宿主仓库 assets/sync-tokens.mjs 生成并校验，
 *  生成头记录权威 sha256）。改风格改权威文件后同步，勿手改本文件；
 *  副本随仓库提交，插件在任一机器上都自包含。 */
export const PAPER_TOKENS_CSS = resolve(PLUGIN_ROOT, 'assets/tokens-paper.css');
export function loadPathVars() {
    let raw;
    try {
        raw = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'config.json'), 'utf8'));
    }
    catch {
        return {};
    }
    if (typeof raw !== 'object' || raw === null)
        return {};
    const record = raw;
    const out = {};
    if (typeof record.diaryDir === 'string' && record.diaryDir.trim().length > 0)
        out.diaryDir = absolutize(record.diaryDir);
    if (typeof record.templatePath === 'string' && record.templatePath.trim().length > 0) {
        out.templatePath = absolutize(record.templatePath);
    }
    return out;
}
/** `~` 展开为用户主目录；相对路径基于插件根目录。 */
export function absolutize(p) {
    if (p === '~')
        return homedir();
    if (p.startsWith('~/'))
        return resolve(homedir(), p.slice(2));
    return isAbsolute(p) ? p : resolve(PLUGIN_ROOT, p);
}
/** 日记目录解析优先级：cordis patch 覆盖 > config.json（页面设置卡维护）> 未配置（null）。空串视为未设置。 */
export function resolveDirValue(configured, fileValue) {
    const override = configured !== undefined && configured.length > 0 ? configured : undefined;
    const fromFile = fileValue !== undefined && fileValue.length > 0 ? fileValue : undefined;
    return override ?? fromFile ?? null;
}
/**
 * 把 patch 合并进插件根 config.json：read-modify-write 保留未知键，原子落盘（tmp+rename）。
 * targetPath 仅供测试注入，生产调用走默认值。
 */
export async function savePathVars(patch, targetPath = resolve(PLUGIN_ROOT, 'config.json')) {
    let table = {};
    try {
        const raw = JSON.parse(readFileSync(targetPath, 'utf8'));
        if (typeof raw === 'object' && raw !== null)
            table = raw;
    }
    catch {
        // 首写或旧文件不可解析 → 重建（丢的只是同样读不出来的旧值）
    }
    for (const key of Object.keys(patch)) {
        const value = patch[key];
        if (value !== undefined)
            table[key] = value;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    const tmp = `${targetPath}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
    await rename(tmp, targetPath);
}
