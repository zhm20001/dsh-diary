/**
 * 画像模块：存放与读写、近期概要提取、注入组装、更新 prompt 与规则文档。
 * 只测外部行为与纯函数输入输出（spec「Testing Decisions」），不测模型裁决质量。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COMMENT_HEADING } from '../src/core.ts'
import {
  MEMORY_WINDOW_DAYS,
  PROFILE_FILE_NAME,
  PROFILE_UPDATE_PROMPT,
  PROFILE_RULES,
  TUNING,
  buildSummaryUserMessage,
  buildUpdateInput,
  formatDigestLine,
  memoryWindow,
  parseDayDigest,
  profileExists,
  profilePathOf,
  readProfileText,
  writeProfileText,
} from '../src/profile.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diary-profile-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** 一份结构合法的画像 fixture（三分区骨架 + 行内元数据），测试只断言结构不依赖真实内容。 */
const SEED_LIKE = [
  '# 用户画像',
  '',
  '> 落后快照，非定律。',
  '',
  '## 人格核心',
  '',
  '- 思考敏锐，能抓住主要矛盾（复现 9 次）',
  '',
  '## 阶段性状态',
  '',
  '## 近期事件',
  '',
  '- 在写一个插件（末次提及 2026-09-20）',
  '',
].join('\n')

/** 一篇带完整评注块的日记（buildCommentBlock 的输出形态）。 */
function diaryWithComment(date: string, keyword: string, oneLine: string, clock = '23:30'): string {
  return [
    '---',
    'categories: 日记',
    `date: ${date}`,
    '---',
    '',
    '今天写了很多东西。',
    '',
    COMMENT_HEADING,
    '',
    `**今日关键词**：${keyword}`,
    '',
    '一段评注正文。',
    '',
    '---',
    '',
    `${clock} | ${oneLine}`,
    '',
  ].join('\n')
}

describe('画像存放与读写', () => {
  it('空目录读回空态，且不顺带创建文件', async () => {
    expect(await readProfileText(dir)).toBe('')
    expect(await profileExists(dir)).toBe(false)
    expect(await readProfileText(dir)).toBe('')
    // 读不写的纪律：空态读取绝不在磁盘留下任何东西
    expect(await readFile(profilePathOf(dir), 'utf8').catch(() => null)).toBeNull()
  })

  it('空文件同样读回空态（空态不是错误）', async () => {
    await mkdir(join(dir, '.diary-meta'), { recursive: true })
    await writeFile(profilePathOf(dir), '', 'utf8')
    expect(await readProfileText(dir)).toBe('')
  })

  it('写后读回非空且三分区正确；文件就在 .diary-meta/profile.md', async () => {
    await writeProfileText(dir, SEED_LIKE)
    const back = await readProfileText(dir)
    expect(back).toContain('# 用户画像')
    expect(back).toContain('## 人格核心')
    expect(back).toContain('## 阶段性状态')
    expect(back).toContain('## 近期事件')
    expect(back).toContain('（复现 9 次）')
    expect(back).toContain('（末次提及 2026-09-20）')
    expect(profilePathOf(dir).endsWith(`.diary-meta/${PROFILE_FILE_NAME}`)).toBe(true)
    expect(await profileExists(dir)).toBe(true)
  })

  it('内容损坏（乱文本）按原文读回，不崩溃、不改写', async () => {
    await mkdir(join(dir, '.diary-meta'), { recursive: true })
    await writeFile(profilePathOf(dir), '乱文本\x00\x01不是画像也没有分区', 'utf8')
    expect(await readProfileText(dir)).toBe('乱文本\x00\x01不是画像也没有分区')
  })
})

describe('parseDayDigest：从日记尾部评注块提取（零 LLM 成本，坏文件降级）', () => {
  it('完整评注块 → 关键词 + 一句话总结', () => {
    expect(parseDayDigest(diaryWithComment('2026-09-18', '折腾', '折腾了一整天'))).toEqual({
      keyword: '折腾',
      oneLine: '折腾了一整天',
    })
  })

  it('没有评注块 → null（该日不进概要，不影响其余）', () => {
    expect(parseDayDigest('---\ndate: 2026-09-18\n---\n\n随便写点。')).toBeNull()
  })

  it('字段缺失 → null：缺关键词行 / 缺收尾一句话 / 只有标题', () => {
    const noKw = diaryWithComment('2026-09-18', '折腾', '一句话').replace('**今日关键词**：折腾\n', '')
    expect(parseDayDigest(noKw)).toBeNull()
    const noOl = diaryWithComment('2026-09-18', '折腾', '一句话').replace('23:30 | 一句话', '23:30')
    expect(parseDayDigest(noOl)).toBeNull()
    expect(parseDayDigest(`${COMMENT_HEADING}\n`)).toBeNull()
  })

  it('同日重提交只保留最后一版评注：取最后一次出现的评注块', () => {
    const first = diaryWithComment('2026-09-18', '旧词', '旧的一句话')
    const second = diaryWithComment('2026-09-18', '新词', '新的一句话')
    expect(parseDayDigest(`${first}\n${second}`)).toEqual({ keyword: '新词', oneLine: '新的一句话' })
  })

  it('评注正文里的「9:00 | 起床」式行不劫持当日一句话（收尾行取块内最后一条）', () => {
    const withNoise = diaryWithComment('2026-09-18', '折腾', '真正的一句话').replace('一段评注正文。', '9:00 | 起床\n\n一段评注正文。')
    expect(parseDayDigest(withNoise)).toEqual({ keyword: '折腾', oneLine: '真正的一句话' })
  })
})

describe('formatDigestLine', () => {
  it('`- MM-DD【关键词】一句话`，emoji 可选', () => {
    expect(formatDigestLine('2026-09-18', { keyword: '折腾', oneLine: '折腾了一天' })).toBe('- 09-18【折腾】折腾了一天')
    expect(formatDigestLine('2026-09-18', { keyword: '折腾', oneLine: '折腾了一天' }, '😄')).toBe('- 09-18【折腾】折腾了一天 😄')
    expect(formatDigestLine('2026-09-18', { keyword: '折腾', oneLine: '折腾了一天' }, '')).toBe('- 09-18【折腾】折腾了一天')
  })
})

describe('memoryWindow：今天及前 6 个记录日（非记录日跳过）', () => {
  it('有今天时取今天 + 前 6 个记录日，返回里不含今天', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-05', '2026-09-08', '2026-09-10', '2026-09-14', '2026-09-15', '2026-09-20']
    expect(memoryWindow(dates, '2026-09-20')).toEqual(['2026-09-02', '2026-09-05', '2026-09-08', '2026-09-10', '2026-09-14', '2026-09-15'])
  })

  it('今天不在记录日里（今天文件还没建）仍只取前 6 个', () => {
    const dates = ['2026-09-01', '2026-09-05', '2026-09-08', '2026-09-10', '2026-09-14', '2026-09-15', '2026-09-18']
    expect(memoryWindow(dates, '2026-09-20')).toEqual(['2026-09-05', '2026-09-08', '2026-09-10', '2026-09-14', '2026-09-15', '2026-09-18'])
  })

  it('只有今天 / 空目录 → 空窗口；未来日期的文件被忽略', () => {
    expect(memoryWindow(['2026-09-20'], '2026-09-20')).toEqual([])
    expect(memoryWindow([], '2026-09-20')).toEqual([])
    expect(memoryWindow(['2026-09-25'], '2026-09-20')).toEqual([])
  })

  it('窗口大小是内置常量 7（今天 + 前 6 个记录日）', () => {
    expect(MEMORY_WINDOW_DAYS).toBe(7)
  })
})

describe('buildSummaryUserMessage：注入组装（数据不是契约）', () => {
  const memory = { profileText: '# 用户画像\n\n## 人格核心\n\n- 条目（复现 3 次）', digestLines: ['- 09-18【折腾】折腾了一天'] }

  it('画像非空：三节顺序 画像 → 近期概要 → 今天全文，末尾层级说明', () => {
    const msg = buildSummaryUserMessage('今天全文', memory)
    const iProfile = msg.indexOf('【用户画像】')
    const iDigest = msg.indexOf('【近期日记概要】')
    const iToday = msg.indexOf('【今天的日记全文】')
    expect(iProfile).toBeGreaterThanOrEqual(0)
    expect(iDigest).toBeGreaterThan(iProfile)
    expect(iToday).toBeGreaterThan(iDigest)
    expect(msg.endsWith('今天的日记是唯一主体，画像与概要仅作参考。')).toBe(true)
    expect(msg).toContain('今天全文')
    expect(msg).toContain('- 09-18【折腾】折腾了一天')
  })

  it('画像为空 → 整节省略，退化为「今天全文 + 概要」', () => {
    const msg = buildSummaryUserMessage('今天全文', { profileText: '   ', digestLines: memory.digestLines })
    expect(msg).not.toContain('【用户画像】')
    expect(msg).toContain('【近期日记概要】')
    expect(msg).toContain('【今天的日记全文】')
  })

  it('无概要行 → 概要节也省略，只剩今天全文 + 层级说明', () => {
    const msg = buildSummaryUserMessage('今天全文', { profileText: memory.profileText, digestLines: [] })
    expect(msg).toContain('【用户画像】')
    expect(msg).not.toContain('【近期日记概要】')
    expect(msg).toContain('【今天的日记全文】')
  })
})

describe('更新 prompt 与规则文档（内置固定）', () => {
  it('更新 prompt 内含规则文档原文与三分区标题用字', () => {
    expect(PROFILE_UPDATE_PROMPT).toContain(PROFILE_RULES)
    for (const heading of ['## 人格核心', '## 阶段性状态', '## 近期事件']) {
      expect(PROFILE_UPDATE_PROMPT).toContain(heading)
    }
    expect(PROFILE_UPDATE_PROMPT).toContain('不是 diff')
    expect(PROFILE_UPDATE_PROMPT).toContain('从 `# 用户画像` 一级标题开始')
  })

  it('三个数值旋钮是集中一处的占位常量，规则文档按它们生成', () => {
    expect(typeof TUNING.recentRetentionDays).toBe('number')
    expect(typeof TUNING.reproduceThreshold).toBe('number')
    expect(typeof TUNING.maxProfileChars).toBe('number')
    expect(PROFILE_RULES).toContain(`超保留期（${TUNING.recentRetentionDays} 天）`)
    expect(PROFILE_RULES).toContain(`≥${TUNING.reproduceThreshold} 次`)
    expect(PROFILE_RULES).toContain(`硬上限（${TUNING.maxProfileChars} 字符）`)
  })
})

describe('buildUpdateInput', () => {
  it('旧画像为空时给显式空态标记，今天全文原样进第二节', () => {
    const input = buildUpdateInput('', '今天的日记')
    expect(input).toContain('【旧画像】\n（空，尚无画像）')
    expect(input).toContain('【今天的日记】\n今天的日记')
  })

  it('旧画像非空时全文进第一节', () => {
    const input = buildUpdateInput('# 旧画像全文', '今天的日记')
    expect(input).toContain('【旧画像】\n# 旧画像全文')
  })
})
