/**
 * 页面内联脚本的漂移哨兵：page.ts 是零构建自包含 HTML，热力图的
 * cellState 规则与日期步进在浏览器侧各有一份内联副本（heatState /
 * dayKeyAdd），无法直接 import core.ts。本测试从 renderPage() 产物中
 * 提取这两个函数，断言它们与 core.cellState 同规则、日期算术与独立
 * 字面量一致——两份副本一旦漂移，这里先红。
 */
import { describe, expect, it } from 'vitest'
import { cellState } from '../src/core.ts'
import { renderPage } from '../src/page.ts'

function extractInline(name: string, args: string): string {
  const single = new RegExp(`function ${name}\\(${args}\\) \\{[^\\n]*\\}`)
  const multi = new RegExp(`function ${name}\\(${args}\\) \\{[\\s\\S]*?\\n  \\}`)
  const page = renderPage('/diary')
  const m = page.match(multi) ?? page.match(single)
  if (m === null) throw new Error(`页面内联函数 ${name} 提取失败（可能已改名/改写）`)
  return m[0]
}

/** 以注入的 heat 状态求值内联函数（heatState 闭包读 heat.today）。 */
function inlineClient(today: string): { dayKeyAdd: (key: string, n: number) => string; heatState: (day: string, written: boolean) => string } {
  const factory = new Function(
    'heat',
    `${extractInline('z2', 'n')}\n${extractInline('dayKeyAdd', 'key, n')}\n${extractInline('heatState', 'day, written')}\nreturn { dayKeyAdd: dayKeyAdd, heatState: heatState }`,
  ) as (heat: { today: string }) => { dayKeyAdd: (key: string, n: number) => string; heatState: (day: string, written: boolean) => string }
  return factory({ today })
}

describe('页面内联 heatState（core.cellState 的浏览器副本）', () => {
  it('与 cellState 同规则：今日前后各取数日 × 写/未写，四态逐一相等', () => {
    const client = inlineClient('2026-09-03')
    for (const day of ['2025-01-01', '2026-08-31', '2026-09-02', '2026-09-03', '2026-09-04', '2026-12-31', '2027-06-30']) {
      for (const written of [false, true]) {
        expect(client.heatState(day, written)).toBe(cellState(day, '2026-09-03', written))
      }
    }
  })
})

describe('页面内联 dayKeyAdd（日期键 +n 天的浏览器副本）', () => {
  it('年/月/闰年边界与独立字面量一致（UTC 钟面，无时区漂移）', () => {
    const client = inlineClient('2026-09-03')
    expect(client.dayKeyAdd('2026-12-31', 1)).toBe('2027-01-01')
    expect(client.dayKeyAdd('2026-01-01', -1)).toBe('2025-12-31')
    expect(client.dayKeyAdd('2028-02-28', 1)).toBe('2028-02-29') // 闰年
    expect(client.dayKeyAdd('2026-02-28', 1)).toBe('2026-03-01') // 平年
    expect(client.dayKeyAdd('2026-06-29', 188)).toBe('2027-01-03') // 2026H2 帧第 189 格（窗口末格）
  })
})
