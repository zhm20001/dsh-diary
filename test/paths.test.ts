/** savePathVars / resolveDirValue：设置卡后端的纯逻辑（写盘走临时目录，不碰真实 config.json）。 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDirValue, savePathVars } from '../src/paths.ts'

describe('resolveDirValue：目录解析优先级', () => {
  it('cordis 覆盖 > config.json > 未配置；空串视为未设置（schemastery 用 default("") 表达可选）', () => {
    expect(resolveDirValue('/patch', '/file')).toBe('/patch')
    expect(resolveDirValue(undefined, '/file')).toBe('/file')
    expect(resolveDirValue('/patch', undefined)).toBe('/patch')
    expect(resolveDirValue(undefined, undefined)).toBe(null)
    expect(resolveDirValue('', '/file')).toBe('/file')
    expect(resolveDirValue('', '')).toBe(null)
  })
})

describe('savePathVars：config.json 合并写入', () => {
  const dirs: string[] = []

  async function tmpDir(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'diary-paths-'))
    dirs.push(d)
    return d
  }

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  it('首写创建文件：2 空格缩进 + 尾换行（与手写 config.json 同构）', async () => {
    const target = join(await tmpDir(), 'config.json')
    await savePathVars({ diaryDir: '/tmp/x' }, target)
    await expect(readFile(target, 'utf8')).resolves.toBe(`${JSON.stringify({ diaryDir: '/tmp/x' }, null, 2)}\n`)
  })

  it('read-modify-write：只覆盖传入键，保留其它键', async () => {
    const target = join(await tmpDir(), 'config.json')
    const before = { diaryDir: '/old', templatePath: 'assets/diary-template.md', custom: 1 }
    await writeFile(target, `${JSON.stringify(before, null, 2)}\n`, 'utf8')
    await savePathVars({ diaryDir: '/new' }, target)
    await expect(readFile(target, 'utf8')).resolves.toBe(
      `${JSON.stringify({ diaryDir: '/new', templatePath: 'assets/diary-template.md', custom: 1 }, null, 2)}\n`,
    )
  })

  it('旧文件不可解析 → 重建为新表（丢的只是同样读不出来的旧值）', async () => {
    const target = join(await tmpDir(), 'config.json')
    await writeFile(target, '{broken', 'utf8')
    await savePathVars({ diaryDir: '/new' }, target)
    await expect(readFile(target, 'utf8')).resolves.toBe(`${JSON.stringify({ diaryDir: '/new' }, null, 2)}\n`)
  })

  it('目标目录不存在时先建再写', async () => {
    const target = join(await tmpDir(), 'nested', 'config.json')
    await savePathVars({ diaryDir: '/x' }, target)
    await expect(readFile(target, 'utf8')).resolves.toBe(`${JSON.stringify({ diaryDir: '/x' }, null, 2)}\n`)
  })

  it('值为 undefined 的字段不落盘', async () => {
    const target = join(await tmpDir(), 'config.json')
    await savePathVars({ diaryDir: undefined, templatePath: '/t' }, target)
    await expect(readFile(target, 'utf8')).resolves.toBe(`${JSON.stringify({ templatePath: '/t' }, null, 2)}\n`)
  })
})
