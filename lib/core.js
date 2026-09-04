/**
 * 日记确定性核心（纯函数，无 IO）：30 小时制、模板填充、追加拼接、评注块组装。
 * IO 全部在 service 层；本文件被 vitest 直接覆盖。
 *
 * @module dsh-diary/core
 */
const pad2 = (n) => String(n).padStart(2, '0');
function fmtDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/**
 * 30 小时制：cutoff 点前视为前一天深夜（如 cutoff=6 时 02:30 → 前一天 26:30）。
 * 时间权威是调用方传入的本地系统时间（new Date()）。
 */
export function thirtyHour(now, cutoff = 6) {
    const hh = now.getHours();
    const mm = now.getMinutes();
    if (hh < cutoff) {
        return { date: fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)), clock: `${pad2(hh + 24)}:${pad2(mm)}` };
    }
    return { date: fmtDate(now), clock: `${pad2(hh)}:${pad2(mm)}` };
}
/** 当日日记文件绝对路径：`<diaryDir>/YYYY-MM-DD.md`。 */
export function diaryPathFor(diaryDir, date) {
    return `${diaryDir.replace(/\/+$/, '')}/${date}.md`;
}
const RECORD_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:-.*)?\.md$/;
/**
 * 从目录项名提取记录日（YYYY-MM-DD）：带后缀的手工文件（如 2026-04-28-测试日记.md）
 * 也算；子目录、无关文件、分量滚动的非法日期（2026-02-30）返回 null。
 */
export function extractRecordDate(name) {
    const m = RECORD_DATE_RE.exec(name);
    if (m === null)
        return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d)
        return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
}
/**
 * 格子四态（CONTEXT.md）。日期键一律字符串比较；"今天"由调用方按 30 小时制口径传入。
 * 记录优先：手工建的未来日期文件也按已写画——格子陈述"这 天有记录"的事实。
 */
export function cellState(dayKey, todayKey, written) {
    if (written)
        return 'written';
    if (dayKey > todayKey)
        return 'future';
    if (dayKey === todayKey)
        return 'today';
    return 'blank';
}
// ---------- 热力图板：半年帧窗口数学（CONTEXT.md「半年帧」） ----------
/** 半年帧标识，如 '2026H2'（字符串序即时间序）。输入须为合法日期键。 */
export function frameIdOf(dateKey) {
    return `${dateKey.slice(0, 4)}H${Number(dateKey.slice(5, 7)) > 6 ? 2 : 1}`;
}
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
function halfDates(id) {
    const year = id.slice(0, 4);
    return id.endsWith('H2')
        ? { halfStart: `${year}-07-01`, halfEnd: `${year}-12-31`, halfDays: 184 }
        : { halfStart: `${year}-01-01`, halfEnd: `${year}-06-30`, halfDays: isLeap(Number(year)) ? 182 : 181 };
}
/** 网格首日 = 半年首日回退到本周周一（固定 27 列 × 7 行；首末列残缺 = 相邻帧共享的冗余周）。 */
function gridStart(id) {
    const [y, m, d] = halfDates(id).halfStart.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return fmtDate(dt);
}
/**
 * 列出从最早记录所在半年到"今天"所在半年的所有帧（无记录时只有当前帧）。
 * dates 无需有序；未来日期的手工文件不改变帧范围（网格只按真实时间切帧）。
 */
export function framesFor(dates, today) {
    const lastId = frameIdOf(today);
    let earliest = today;
    for (const d of dates)
        if (d < earliest)
            earliest = d;
    const firstId = frameIdOf(earliest);
    const frames = [];
    for (let y = Number(firstId.slice(0, 4)); y <= Number(lastId.slice(0, 4)); y++) {
        for (const half of [1, 2]) {
            const id = `${y}H${half}`;
            if (id < firstId || id > lastId)
                continue;
            const { halfStart, halfEnd, halfDays } = halfDates(id);
            frames.push({
                id,
                label: `${y} ${half === 1 ? '上' : '下'}`,
                start: gridStart(id),
                halfStart,
                halfEnd,
                halfDays,
                count: dates.filter((d) => d >= halfStart && d <= halfEnd).length,
            });
        }
    }
    return frames;
}
export const BUILTIN_TEMPLATE = '---\ncategories: 日记\ndate: {{date}}\n---\n---\n';
/**
 * 模板填日期：`{{date}}` 占位优先；否则补空 `date:` 字段；两者都没有则原样返回。
 * template 为 null（文件缺失/读取失败）时用内置兜底模板。
 */
export function fillTemplate(template, date) {
    const tpl = template ?? BUILTIN_TEMPLATE;
    if (tpl.includes('{{date}}'))
        return tpl.replaceAll('{{date}}', date);
    return tpl.replace(/^(date:)[ \t]*$/m, '$1 ' + date);
}
/** 追加拼接：块与前文之间恰好空一个空行；文末恒以单个换行收束。 */
export function joinBlock(existing, block) {
    let head = existing;
    if (head.length > 0 && !head.endsWith('\n'))
        head += '\n';
    if (head.length > 0 && !head.endsWith('\n\n'))
        head += '\n';
    return head + block.trimEnd() + '\n';
}
export const COMMENT_HEADING = '## AI评注';
/** 组装 AI 评注收尾块——与 v1 skill 的评注格式逐行一致。 */
export function buildCommentBlock(input) {
    return [
        COMMENT_HEADING,
        '',
        `**今日关键词**：${input.keyword.trim()}`,
        '',
        stripFences(input.comment).trim(),
        '',
        '---',
        '',
        `${input.clock} | ${input.oneLine.trim()}`,
    ].join('\n');
}
/** 去掉模型输出首尾误带的 markdown 代码围栏行。 */
export function stripFences(s) {
    const lines = s.trim().split('\n');
    if (lines.length > 0 && lines[0].trimStart().startsWith('```'))
        lines.shift();
    if (lines.length > 0 && lines[lines.length - 1].trimStart().startsWith('```'))
        lines.pop();
    return lines.join('\n');
}
/**
 * 摘掉文件尾部由本插件生成的评注块（最后一次出现 {@link COMMENT_HEADING} 处到文末），
 * 返回剩余正文；没有旧评注块时返回 null。
 *
 * 用途：同一天再提交时重新生成总结——只裁掉我们自己写的尾部块，
 * 其上的用户内容原样保留。约定：不要手工编辑 AI评注块之下的区域。
 */
export function withoutTrailingCommentBlock(content) {
    const nl = content.lastIndexOf('\n' + COMMENT_HEADING);
    if (nl !== -1)
        return content.slice(0, nl + 1).trimEnd();
    if (content.startsWith(COMMENT_HEADING))
        return '';
    return null;
}
