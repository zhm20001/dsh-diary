import { describe, expect, it } from 'vitest'
import {
  BUILTIN_TEMPLATE,
  buildCommentBlock,
  cellState,
  diaryPathFor,
  extractRecordDate,
  fillTemplate,
  framesFor,
  joinBlock,
  thirtyHour,
  withoutTrailingCommentBlock,
} from '../src/core.ts'
import { parseSummary } from '../src/summary.ts'

/** 构造本地时区日期（getHours 语义一致）。 */
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi)

describe('thirtyHour', () => {
  it('凌晨归前一天并加 24 小时显示', () => {
    expect(thirtyHour(at(2026, 8, 23, 2, 30))).toEqual({ date: '2026-08-22', clock: '26:30' })
    expect(thirtyHour(at(2026, 8, 23, 0, 5))).toEqual({ date: '2026-08-22', clock: '24:05' })
  })

  it('cutoff 边界：5:59 归前一天，6:00 整点起算当天', () => {
    expect(thirtyHour(at(2026, 8, 23, 5, 59))).toEqual({ date: '2026-08-22', clock: '29:59' })
    expect(thirtyHour(at(2026, 8, 23, 6, 0))).toEqual({ date: '2026-08-23', clock: '06:00' })
  })

  it('白天与月末跨月', () => {
    expect(thirtyHour(at(2026, 8, 22, 23, 59))).toEqual({ date: '2026-08-22', clock: '23:59' })
    expect(thirtyHour(at(2026, 9, 1, 1, 0))).toEqual({ date: '2026-08-31', clock: '25:00' })
  })
})

describe('diaryPathFor / fillTemplate', () => {
  it('路径拼接并吞掉尾部斜杠', () => {
    expect(diaryPathFor('/a/日记', '2026-08-22')).toBe('/a/日记/2026-08-22.md')
    expect(diaryPathFor('/a/日记///', '2026-08-22')).toBe('/a/日记/2026-08-22.md')
  })

  it('模板：{{date}} 占位、空 date: 字段、无占位、null 兜底', () => {
    expect(fillTemplate('# {{date}}\n', '2026-08-22')).toBe('# 2026-08-22\n')
    expect(fillTemplate('---\ndate:\n---\n', '2026-08-22')).toBe('---\ndate: 2026-08-22\n---\n')
    expect(fillTemplate('无占位', '2026-08-22')).toBe('无占位')
    expect(fillTemplate(null, '2026-08-22')).toBe(BUILTIN_TEMPLATE.replaceAll('{{date}}', '2026-08-22'))
  })
})

describe('joinBlock', () => {
  const b = '正文'

  it('空文件直接落块', () => {
    expect(joinBlock('', b)).toBe('正文\n')
  })

  it('结尾单换行 → 补成空行分隔', () => {
    expect(joinBlock('前文\n', b)).toBe('前文\n\n正文\n')
  })

  it('结尾无换行 → 补两个换行', () => {
    expect(joinBlock('前文', b)).toBe('前文\n\n正文\n')
  })

  it('已空两行则原样衔接', () => {
    expect(joinBlock('前文\n\n', b)).toBe('前文\n\n正文\n')
  })
})

describe('buildCommentBlock', () => {
  it('与 v1 skill 评注格式逐行一致', () => {
    const block = buildCommentBlock({ keyword: '测试', oneLine: '一句话', comment: '评注第一行。\n第二行。', clock: '26:30' })
    expect(block).toBe('## AI评注\n\n**今日关键词**：测试\n\n评注第一行。\n第二行。\n\n---\n\n26:30 | 一句话')
  })

  it('剥掉模型误带的代码围栏', () => {
    const block = buildCommentBlock({ keyword: '测试', oneLine: '一句话', comment: '```markdown\n正文\n```', clock: '16:00' })
    expect(block).toContain('\n\n正文\n\n---')
  })
})

describe('withoutTrailingCommentBlock', () => {
  const tail = '\n\n## AI评注\n\n**今日关键词**：测试\n\n评注\n\n---\n\n16:00 | 一句话'

  it('摘掉尾部评注块，保留其上内容', () => {
    expect(withoutTrailingCommentBlock('front matter\n\n今天写了东西。' + tail)).toBe('front matter\n\n今天写了东西。')
  })

  it('没有评注块返回 null；文件以标题开头返回空串', () => {
    expect(withoutTrailingCommentBlock('只有正文')).toBeNull()
    expect(withoutTrailingCommentBlock('## AI评注\n\nx')).toBe('')
  })
})

describe('extractRecordDate', () => {
  it('标准文件名与带后缀的手工文件都算记录日', () => {
    expect(extractRecordDate('2026-08-21.md')).toBe('2026-08-21')
    expect(extractRecordDate('2026-04-28-测试日记.md')).toBe('2026-04-28')
  })

  it('子目录与无关文件不匹配', () => {
    expect(extractRecordDate('实习历险记')).toBeNull()
    expect(extractRecordDate('.diary-meta')).toBeNull()
    expect(extractRecordDate('notes.md')).toBeNull()
    expect(extractRecordDate('2026-08-21.md.bak')).toBeNull()
  })

  it('不存在的日历日拒绝（防 Date 分量滚动）', () => {
    expect(extractRecordDate('2026-13-01.md')).toBeNull()
    expect(extractRecordDate('2026-02-30.md')).toBeNull()
  })
})

describe('cellState', () => {
  const today = '2026-09-03'

  it('格子四态基本分类', () => {
    expect(cellState('2026-09-04', today, false)).toBe('future')
    expect(cellState('2026-09-02', today, false)).toBe('blank')
    expect(cellState('2026-09-02', today, true)).toBe('written')
    expect(cellState(today, today, true)).toBe('written')
    expect(cellState(today, today, false)).toBe('today')
  })

  it('记录优先：手工建的未来日期文件按已写画', () => {
    expect(cellState('2027-01-01', today, true)).toBe('written')
  })
})

describe('framesFor', () => {
  it('从最早记录所在半年到当前半年，逐帧给出标签/网格起点/半年天数', () => {
    const frames = framesFor(['2026-08-30', '2025-07-02', '2026-01-02', '2026-08-21'], '2026-09-03')
    expect(frames.map((f) => f.id)).toEqual(['2025H2', '2026H1', '2026H2'])
    const [h25b, h26a, h26b] = frames
    expect(h25b).toMatchObject({ label: '2025 下', start: '2025-06-30', halfStart: '2025-07-01', halfEnd: '2025-12-31', halfDays: 184 })
    expect(h26a).toMatchObject({ label: '2026 上', start: '2025-12-29', halfStart: '2026-01-01', halfEnd: '2026-06-30', halfDays: 181 })
    expect(h26b).toMatchObject({ label: '2026 下', start: '2026-06-29', halfDays: 184 })
  })

  it('统计只算半年内日期：落在冗余周的边日归属邻帧', () => {
    // 2026-01-04 同时出现在 2025H2 网格的末列冗余里，但它是 2026H1 的记录
    const frames = framesFor(['2026-01-04'], '2026-06-15')
    expect(frames.map((f) => f.id)).toEqual(['2026H1'])
    expect(frames[0].count).toBe(1)
  })

  it('每帧统计各自半年内的记录数', () => {
    const frames = framesFor(['2025-07-02', '2025-12-31', '2026-01-01', '2026-06-30', '2026-07-01'], '2026-09-03')
    expect(frames.map((f) => f.count)).toEqual([2, 2, 1])
  })

  it('无记录时只给当前帧；跨年/闰年上半年天数正确', () => {
    expect(framesFor([], '2026-09-03').map((f) => f.id)).toEqual(['2026H2'])
    const leap = framesFor([], '2028-03-01')
    expect(leap[0].halfDays).toBe(182)
    expect(leap[0].start).toBe('2027-12-27') // 2028-01-01 是周六
  })
})

describe('parseSummary 当日 emoji', () => {
  const base = '【今日关键词】x\n【一句话总结】y\n【评注】\n正文'

  it('解析第四契约字段：恰好一枚 emoji', () => {
    expect(parseSummary('【今日关键词】x\n【一句话总结】y\n【当日 emoji】🌱\n【评注】\n正文').emoji).toBe('🌱')
  })

  it('行内夹文字只取第一枚 emoji', () => {
    expect(parseSummary('【今日关键词】x\n【一句话总结】y\n【当日 emoji】🌱 长势很好\n【评注】\n正文').emoji).toBe('🌱')
    expect(parseSummary('【今日关键词】x\n【一句话总结】y\n【当日 emoji】🌱🌱\n【评注】\n正文').emoji).toBe('🌱')
  })

  it('缺字段或无 emoji → undefined（渲染降级绿块），不拖垮总结', () => {
    expect(parseSummary(base).emoji).toBeUndefined()
    expect(parseSummary(base.replace('y\n', 'y\n【当日 emoji】今天不错\n')).emoji).toBeUndefined()
  })

  it('ZWJ 序列整枚保留（如 🧑‍💻）', () => {
    expect(parseSummary('【今日关键词】x\n【一句话总结】y\n【当日 emoji】🧑‍💻\n【评注】\n正文').emoji).toBe('🧑‍💻')
  })
})

describe('parseSummary', () => {
  it('解析标准契约输出', () => {
    const out = parseSummary('【今日关键词】重启日记\n【一句话总结】心态放平。\n【评注】\n第一段。\n第二段。')
    expect(out).toEqual({ keyword: '重启日记', oneLine: '心态放平。', comment: '第一段。\n第二段。' })
  })

  it('容忍字段行首尾空白', () => {
    const out = parseSummary('【今日关键词】  测试 \n【一句话总结】 总结 \n【评注】\n正文')
    expect(out.keyword).toBe('测试')
    expect(out.oneLine).toBe('总结')
  })

  it('缺字段抛错且报出缺哪些', () => {
    expect(() => parseSummary('【今日关键词】x\n只有一行')).toThrow(/缺少字段/)
  })

  it('容忍【评注】同行正文（模型不换行的退化形态）', () => {
    const out = parseSummary('【今日关键词】x\n【一句话总结】y\n【评注】同行开头\n第二行。')
    expect(out.comment).toBe('同行开头\n第二行。')
  })

  it('评注前有空行也能解析（宽松）', () => {
    const out = parseSummary('【今日关键词】x\n【一句话总结】y\n【评注】\n\n正文开始')
    expect(out.comment).toBe('正文开始')
  })
})
