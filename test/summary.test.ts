/**
 * promptDefects：评注 prompt 保存校验（ADR-0001——输出契约靠保存时校验守护）。
 * 必需三标记来自 parseSummary 的硬依赖（emoji 标记可选，见 CONTEXT.md「输出契约」）。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SUMMARY_PROMPT, SUMMARY_PROMPT_MAX, promptDefects } from '../src/summary.ts'

/** 任意合法底稿：三必需标记齐、非空、未超限。各用例在其上做破坏。 */
const VALID = [
  '你是用户的私人日记总结助手。',
  '【今日关键词】2-4 个字',
  '【一句话总结】一句话',
  '【评注】',
  '给真实见解。',
].join('\n')

describe('promptDefects：必需标记', () => {
  it('三标记齐全的改写版合法', () => {
    expect(promptDefects(VALID)).toEqual([])
  })

  it('缺任一必需标记逐一点名（可同时缺多个）', () => {
    expect(promptDefects('你好')).toEqual([
      '缺少必需标记【今日关键词】',
      '缺少必需标记【一句话总结】',
      '缺少必需标记【评注】',
    ])
    expect(promptDefects(`${VALID.replace('【今日关键词】', '关键词')}`)).toEqual(['缺少必需标记【今日关键词】'])
  })

  it('【当日 emoji】不要求：删掉 emoji 行仍合法（热力图降级绿块是合法选择）', () => {
    expect(DEFAULT_SUMMARY_PROMPT.includes('【当日 emoji】')).toBe(true)
    expect(promptDefects(VALID)).toEqual([]) // VALID 本就不含 emoji 行
  })

  it('标记按“包含”匹配：不在行首、重复出现都合法（解析器取首个匹配，重复只是啰嗦）', () => {
    expect(promptDefects(`开头就写【评注】，随后\n${VALID}\n末尾再提【评注】`)).toEqual([])
  })
})

describe('promptDefects：空与长度', () => {
  it('空串 / 纯空白视为空', () => {
    expect(promptDefects('')).toContain('prompt 不能为空')
    expect(promptDefects(' \n\t ')).toContain('prompt 不能为空')
  })

  it('超长点名上限（按去首尾空白后计，恰好等于上限合法）', () => {
    const over = `${VALID}\n${'水'.repeat(SUMMARY_PROMPT_MAX)}`
    expect(promptDefects(over)).toEqual([expect.stringContaining('过长')])
    const exact = `${VALID}\n${'水'.repeat(SUMMARY_PROMPT_MAX - VALID.length - 1)}`
    expect(promptDefects(exact)).toEqual([])
  })
})

describe('内置默认 prompt 的不变量', () => {
  it('默认 prompt 自身必须通过校验（否则未配置用户直接掉进运行期报错）', () => {
    expect(promptDefects(DEFAULT_SUMMARY_PROMPT)).toEqual([])
  })
})
