/**
 * 插件根目录配置变量（config.json）：页面「设置」卡与 prompt 卡的读写后端。
 *
 * 约定：
 *   - 路径键（diaryDir/templatePath）相对路径基于插件根目录解析（src/ 与 lib/ 都恰在根下一层，
 *     tsx 直载与 tsc 产物共用），`~/` 开头按用户主目录展开；
 *   - 文本键（summaryPrompt）原样存取，不做任何路径化处理；
 *   - config.json 缺失/不可解析/字段为空 → 返回空对象，调用方按「未配置」处理；
 *   - 各键每次请求现读（页面保存后即时生效），cordis patch 的 config 覆盖依然优先；
 *   - config.json 是运行时会被改写的本机文件，不入库；模板见 config.example.json。
 *
 * @module dsh-diary/paths
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件根目录（config.json、assets/ 所在地）。 */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 随插件分发的日记模板（config.json 缺失时的 templatePath 兜底）。 */
export const BUNDLED_TEMPLATE = resolve(PLUGIN_ROOT, 'assets/diary-template.md')

/** 纸感信纸风 design tokens vendor 副本（由宿主仓库 assets/sync-tokens.mjs 生成并校验，
 *  生成头记录权威 sha256）。改风格改权威文件后同步，勿手改本文件；
 *  副本随仓库提交，插件在任一机器上都自包含。 */
export const PAPER_TOKENS_CSS = resolve(PLUGIN_ROOT, 'assets/tokens-paper.css')

export interface ConfigVars {
  diaryDir?: string
  templatePath?: string
  /** 自定义评注 prompt（页面 prompt 卡维护；缺省 = 用内置默认）。 */
  summaryPrompt?: string
}

/** 读取插件根 config.json；targetPath 仅供测试注入，生产调用走默认值。 */
export function loadConfigVars(targetPath = resolve(PLUGIN_ROOT, 'config.json')): ConfigVars {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(targetPath, 'utf8'))
  } catch {
    return {}
  }
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const out: ConfigVars = {}
  if (typeof record.diaryDir === 'string' && record.diaryDir.trim().length > 0) out.diaryDir = absolutize(record.diaryDir)
  if (typeof record.templatePath === 'string' && record.templatePath.trim().length > 0) {
    out.templatePath = absolutize(record.templatePath)
  }
  if (typeof record.summaryPrompt === 'string' && record.summaryPrompt.trim().length > 0) {
    out.summaryPrompt = record.summaryPrompt
  }
  return out
}

/** `~` 展开为用户主目录；相对路径基于插件根目录。 */
export function absolutize(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2))
  return isAbsolute(p) ? p : resolve(PLUGIN_ROOT, p)
}

/** 日记目录解析优先级：cordis patch 覆盖 > config.json（页面设置卡维护）> 未配置（null）。空串视为未设置。 */
export function resolveDirValue(configured: string | undefined, fileValue: string | undefined): string | null {
  const override = configured !== undefined && configured.length > 0 ? configured : undefined
  const fromFile = fileValue !== undefined && fileValue.length > 0 ? fileValue : undefined
  return override ?? fromFile ?? null
}

export interface SaveConfigOpts {
  /** 仅供测试注入的落盘路径；生产调用走默认值。 */
  targetPath?: string
  /** 从 config.json 删除的键（如 prompt 卡「恢复默认」删 summaryPrompt）。 */
  deletes?: (keyof ConfigVars)[]
}

/**
 * 把 patch 合并进插件根 config.json：read-modify-write 保留未知键，原子落盘（tmp+rename）。
 * deletes 在合并后删除指定键。
 */
export async function saveConfigVars(patch: Partial<ConfigVars>, opts: SaveConfigOpts = {}): Promise<void> {
  const targetPath = opts.targetPath ?? resolve(PLUGIN_ROOT, 'config.json')
  let table: Record<string, unknown> = {}
  try {
    const raw: unknown = JSON.parse(readFileSync(targetPath, 'utf8'))
    if (typeof raw === 'object' && raw !== null) table = raw as Record<string, unknown>
  } catch {
    // 首写或旧文件不可解析 → 重建（丢的只是同样读不出来的旧值）
  }
  for (const key of Object.keys(patch) as (keyof ConfigVars)[]) {
    const value = patch[key]
    if (value !== undefined) table[key] = value
  }
  for (const key of opts.deletes ?? []) delete table[key]
  await mkdir(dirname(targetPath), { recursive: true })
  const tmp = `${targetPath}.tmp-${process.pid}`
  await writeFile(tmp, `${JSON.stringify(table, null, 2)}\n`, 'utf8')
  await rename(tmp, targetPath)
}
