/** saveConfigVars / loadConfigVars / resolveDirValue：设置卡与 prompt 卡后端的纯逻辑（写盘走临时目录，不碰真实 config.json）。 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { PLUGIN_ROOT, loadConfigVars, resolveDirValue, saveConfigVars } from '../src/paths.ts'

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

describe('saveConfigVars：config.json 合并写入', () => {
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
    await saveConfigVars({ diaryDir: '/tmp/x' }, { targetPath: target })
    await expect(readFile(target, 'utf8')).resolves.toBe(`${JSON.stringify({ diaryDir: '/tmp/x' }, null, 2)}\n`)
  })

  it('read-modify-write：只覆盖传入键，保留其它键', async () => {
    const target = join(await tmpDir(), 'config.json')
    const before = { diaryDir: '/old', templatePath: 'assets/diary-template.md', summaryPrompt: '旧 prompt', custom: 1 }
    await writeFile(target, `${JSON.stringify(before, null, 2)}\n`, 'utf8')
    await saveConfigVars({ diaryDir: '/new' }, { targetPath: target })
    await expect(readFile(target, 'utf8')).resolves.toBe(
      `${JSON.stringify({ diaryDir: '/new', templatePath: 'assets/diary-template.md', summaryPrompt: '旧 prompt', custom: 1 }, null, 2)}\n`,
    )
  })

  it('旧文件不可解析 → 重建为新表（丢的只是同样读不出来的旧值）', async () => {
    const target = join(await tmpDir(), 'config.json')
    await writeFile(target, '{broken', 'utf8')
    await saveConfigVars({ diaryDir: '/new' }, { targetPath: target })
    await expect(readFile(target, 'utf8')).resolves.toBe(`${JSON.stringify({ diaryDir: '/new' }, null, 2)}\n`)
  })

  it('目标目录不存在时先建再写', async () => {
    const target = join(await tmpDir(), 'nested', 'config.json')
    await saveConfigVars({ diaryDir: '/x' }, { targetPath: target })
    await expect(readFile(target, 'utf8')).resolves.toBe(`${JSON.stringify({ diaryDir: '/x' }, null, 2)}\n`)
  })

  it('值为 undefined 的字段不落盘', async () => {
    const target = join(await tmpDir(), 'config.json')
    await saveConfigVars({ diaryDir: undefined, templatePath: '/t' }, { targetPath: target })
    await expect(readFile(target, 'utf8')).resolves.toBe(`${JSON.stringify({ templatePath: '/t' }, null, 2)}\n`)
  })

  it('deletes 删除指定键、保留其它键（prompt 卡「恢复默认」的后端）', async () => {
    const target = join(await tmpDir(), 'config.json')
    await writeFile(target, `${JSON.stringify({ diaryDir: '/d', summaryPrompt: '自定义' }, null, 2)}\n`, 'utf8')
    await saveConfigVars({}, { targetPath: target, deletes: ['summaryPrompt'] })
    await expect(readFile(target, 'utf8')).resolves.toBe(`${JSON.stringify({ diaryDir: '/d' }, null, 2)}\n`)
  })
})

describe('loadConfigVars：config.json 读取', () => {
  const dirs: string[] = []

  async function tmpConfig(content: string): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), 'diary-load-'))
    dirs.push(d)
    const target = join(d, 'config.json')
    await writeFile(target, content, 'utf8')
    return target
  }

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  it('summaryPrompt 原样读取：不做 ~ 展开或路径解析（它不是路径）', async () => {
    const target = await tmpConfig(`${JSON.stringify({ summaryPrompt: '你是 diary 猫娘，含 【评注】 标记与 ~/x 字面量' }, null, 2)}\n`)
    expect((await loadConfigVars(target)).summaryPrompt).toBe('你是 diary 猫娘，含 【评注】 标记与 ~/x 字面量')
  })

  it('空串/纯空白/非字符串视为未配置（与 diaryDir 同款语义）', async () => {
    const target = await tmpConfig(`${JSON.stringify({ summaryPrompt: '', templatePath: '  ' }, null, 2)}\n`)
    const vars = await loadConfigVars(target)
    expect(vars.summaryPrompt).toBeUndefined()
    expect(vars.templatePath).toBeUndefined()
  })

  it('diaryDir/templatePath 仍走 absolutize：~ 展开为主目录、相对路径基于插件根', async () => {
    const target = await tmpConfig(`${JSON.stringify({ diaryDir: '~/日记', templatePath: 'rel/tpl.md' }, null, 2)}\n`)
    const vars = await loadConfigVars(target)
    expect(vars.diaryDir).toBe(resolve(homedir(), '日记'))
    expect(vars.templatePath).toBe(resolve(PLUGIN_ROOT, 'rel/tpl.md'))
  })

  it('保存后回读 roundtrip：summaryPrompt 存什么读什么', async () => {
    const target = join(await mkdtemp(join(tmpdir(), 'diary-rt-')), 'config.json')
    dirs.push(join(target, '..'))
    const prompt = ['你是用户的私人日记总结助手。', '【今日关键词】', '【一句话总结】', '【评注】'].join('\n')
    await saveConfigVars({ summaryPrompt: prompt }, { targetPath: target })
    expect(loadConfigVars(target)).toEqual({ summaryPrompt: prompt })
  })
})
