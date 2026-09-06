/**
 * 使用指南静态页（自包含双语 HTML）：由 service 注册在 <pagePath>/guide（exact GET/HEAD）。
 * 仿 palette-board 的 guide：零外链、零依赖，唯一的脚本是语言切换；样式运行时
 * 内联 tokens-paper.css（与 page.ts 同源同机制），guide 专属样式用 --g-* 前缀。
 * 约定：本文件是 TS 模板字符串，内容里禁止出现反引号与 序列插值。
 *
 * @module dsh-diary/guide
 */
import { readFileSync } from 'node:fs';
import { PAPER_TOKENS_CSS } from "./paths.js";
let paperTokensCss;
function paperTokens() {
    paperTokensCss ??= readFileSync(PAPER_TOKENS_CSS, 'utf8');
    return paperTokensCss;
}
/** 渲染使用指南页。pagePath 为插件页面路由（如 /diary），用于返回链接与示例。 */
export function renderGuide(pagePath) {
    return GUIDE.replaceAll('__PAGE__', pagePath);
}
const GUIDE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-diary · 使用指南</title>
<style>
  ${paperTokens()}
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 16px 48px; color-scheme: light;
    font-family: var(--font-serif); color: var(--ink-body); background: var(--desk);
    display: flex; justify-content: center; align-items: flex-start;
  }
  main { width: 100%; max-width: 760px; }
  .gpanel {
    background: var(--paper); border: 2px solid var(--ink); border-radius: var(--radius);
    box-shadow: var(--shadow-float); padding: 34px 40px 38px;
  }
  h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; color: var(--ink); }
  .gsub { margin: 4px 0 0; font-size: 13px; color: var(--ink-muted); }
  .gbar { display: flex; align-items: center; gap: 10px; }
  .gbar .sp { margin-left: auto; display: flex; gap: 8px; }
  .gbtn {
    padding: 5px 13px; font: 600 12px/1 var(--font-serif); cursor: pointer;
    color: var(--ink-body); background: var(--card-bg); border: 1px solid var(--rule);
    border-radius: var(--radius-sm);
  }
  .gbtn:hover { background: var(--chip-hover-bg, var(--card-bg)); }
  a.gbtn { text-decoration: none; }
  h2 {
    margin: 30px 0 10px; font-size: 16px; color: var(--ink);
    padding-bottom: 6px; border-bottom: 1px solid var(--rule);
  }
  h2:first-of-type { margin-top: 26px; }
  p { margin: 8px 0; font-size: 14px; line-height: 1.95; }
  li { margin: 5px 0; font-size: 14px; line-height: 1.9; }
  ul, ol { margin: 8px 0; padding-left: 1.4em; }
  strong { color: var(--ink); }
  code {
    font-family: var(--font-mono, monospace); font-size: 12.5px;
    background: var(--card-bg); border: 1px solid var(--rule);
    border-radius: 4px; padding: 1px 5px;
  }
  pre {
    margin: 10px 0; padding: 13px 16px; overflow-x: auto;
    font-family: var(--font-mono, monospace); font-size: 12.5px; line-height: 1.75;
    background: var(--card-bg); border: 1px solid var(--rule); border-radius: var(--radius-sm);
  }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13px; }
  th, td { border: 1px solid var(--rule); padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: var(--card-bg); color: var(--ink); font-size: 12px; }
  .note {
    margin: 10px 0; padding: 10px 14px; font-size: 13px; line-height: 1.85;
    border-left: 3px solid var(--accent); background: var(--card-bg); border-radius: 0 6px 6px 0;
  }
  .gfoot {
    margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--rule);
    font-size: 12px; color: var(--ink-muted);
  }
  /* 双语切换：body[data-lang] 决定显示哪种语言的段落 */
  body[data-lang="zh"] [data-l="en"] { display: none; }
  body[data-lang="en"] [data-l="zh"] { display: none; }
  @media (max-width: 640px) { .gpanel { padding: 22px 20px 26px; } }
</style>
</head>
<body data-lang="zh">
<main>
  <div class="gpanel">
    <div class="gbar">
      <div>
        <h1>dsh-diary <span data-l="zh">使用指南</span><span data-l="en">Guide</span></h1>
        <p class="gsub" data-l="zh">写下来，剩下的交给总结。</p>
        <p class="gsub" data-l="en">Write it down; let the summary do the rest.</p>
      </div>
      <div class="sp">
        <a class="gbtn" href="__PAGE__" data-l="zh">← 日记页</a>
        <a class="gbtn" href="__PAGE__" data-l="en">← Diary</a>
        <button class="gbtn" id="langBtn" type="button">EN</button>
      </div>
    </div>

    <h2><span data-l="zh">这是什么</span><span data-l="en">What is this</span></h2>
    <p data-l="zh">一个 dsh 插件：在网页上写日记，<strong>原文先落盘、AI 评注后生成</strong>——总结失败绝不丢稿。每次提交由大模型产四样东西：<strong>今日关键词、一句话总结、当日 emoji、评注</strong>，追加在你日记文件的末尾。页面上还有一块 GitHub 风格的<strong>半年热力图</strong>，每天一格，写过日记的日子显示当日 emoji。</p>
    <p data-l="en">A dsh plugin: write your diary on a web page where <strong>the raw text is saved to disk first and the AI comment is generated after</strong> — a failed summary never loses your writing. Each submission asks an LLM for exactly four things: a <strong>keyword, a one-line summary, an emoji of the day, and a comment</strong>, appended to your diary file. The page also shows a GitHub-style <strong>half-year heatmap</strong> — one cell per day, emoji on days you wrote.</p>

    <h2><span data-l="zh">三步开始</span><span data-l="en">Get started in three steps</span></h2>
    <ol>
      <li data-l="zh"><strong>挂载插件</strong>（只需一次）：克隆本仓库后执行 <code>dsh plugin --profile web add /path/to/dsh-diary</code>，重启 dsh web。</li>
      <li data-l="en"><strong>Mount the plugin</strong> (once): clone this repo, run <code>dsh plugin --profile web add /path/to/dsh-diary</code>, then restart dsh web.</li>
      <li data-l="zh"><strong>设置日记目录</strong>：打开 <code>__PAGE__</code>，首次未配置时页面会显示设置卡——填一个目录（如 <code>~/Documents/日记</code>，<code>~</code> 会展开），保存即写入插件 config.json，立即生效，无需重启。</li>
      <li data-l="en"><strong>Set the diary directory</strong>: open <code>__PAGE__</code>. On first run the page shows a setup card — enter a directory (e.g. <code>~/Documents/Diary</code>; <code>~</code> expands to your home), save. It is written to the plugin's config.json and takes effect immediately, no restart.</li>
      <li data-l="zh"><strong>写第一篇</strong>：在文本框里写下今天，点「保存并生成总结」。可选：在「AI 评注模型」选择器里换 provider / model（仅采纳模型目录里存在的组合）。</li>
      <li data-l="en"><strong>Write your first entry</strong>: type today's entry and hit "Save &amp; summarize". Optionally pick another provider / model in the "Comment model" selector (only combinations present in the model catalog are honored).</li>
    </ol>

    <h2><span data-l="zh">页面导览</span><span data-l="en">Page tour</span></h2>
    <ul>
      <li data-l="zh"><strong>热力图板</strong>：当前半年一帧，‹ › 切换历史帧。格子四态：emoji=已写（当日 emoji）、绿=已写（无 emoji）、灰=未写、浅灰=未到；今天的格子带描边。悬停可见日期与状态。</li>
      <li data-l="en"><strong>Heatmap</strong>: one frame per half-year, switch with ‹ ›. Four cell states: emoji = written (emoji of the day), green = written (no emoji), grey = not written, light grey = future; today's cell has a ring. Hover for date and status.</li>
      <li data-l="zh"><strong>写作区</strong>：草稿自动存浏览器 localStorage，提交成功后清掉。</li>
      <li data-l="en"><strong>Editor</strong>: drafts autosave to browser localStorage and are cleared after a successful submit.</li>
      <li data-l="zh"><strong>结果卡</strong>：关键词、一句话总结、AI 评注与落盘路径；失败时错误卡上有「仅重试总结」按钮（原文已保存，不会重复追加）。</li>
      <li data-l="en"><strong>Result card</strong>: keyword, one-line summary, AI comment and the saved path. On failure the error card offers "Retry summary only" — your text is already saved and will not be appended twice.</li>
      <li data-l="zh"><strong>右上角</strong>：⚙ 打开设置卡（改日记目录）；? 打开本指南。</li>
      <li data-l="en"><strong>Top right</strong>: ⚙ opens the settings card (change the diary directory); ? opens this guide.</li>
    </ul>

    <h2><span data-l="zh">自定义评注 prompt</span><span data-l="en">Customizing the comment prompt</span></h2>
    <ul>
      <li data-l="zh"><strong>入口与读改</strong>：「AI 评注模型」选择器旁的 📝 打开 prompt 卡——先只读浏览，「✎」进入编辑，可保存、取消、恢复默认。标题旁的「已自定义」徽章与按钮上的小圆点提示当前在用自定义版。</li>
      <li data-l="en"><strong>Where and how</strong>: the 📝 button next to the "Comment model" selector opens the prompt card — read-only first, "✎" to edit, then save / cancel / reset to default. A "customized" badge and a small dot on the button indicate a custom prompt is in effect.</li>
      <li data-l="zh"><strong>只影响未来</strong>：保存后即时生效，只作用于之后的总结生成；已写入日记的评注块不会被改写。</li>
      <li data-l="en"><strong>Future-only</strong>: saves take effect immediately but only shape future summaries; comment blocks already written into diary files are never rewritten.</li>
      <li data-l="zh"><strong>契约标记不能删</strong>：保存时校验输出契约——【今日关键词】【一句话总结】【评注】三个标记必须保留（解析靠它们切字段）；【当日 emoji】行可删，删了当天热力图退为绿块。</li>
      <li data-l="en"><strong>Contract markers must stay</strong>: saving validates the output contract — the three markers 【今日关键词】 (keyword), 【一句话总结】 (one-line summary) and 【评注】 (comment) must remain, because the parser splits fields on them. The 【当日 emoji】 line is optional; without it that day's heatmap cell falls back to a green square.</li>
    </ul>

    <h2><span data-l="zh">核心语义</span><span data-l="en">Core semantics</span></h2>
    <ul>
      <li data-l="zh"><strong>30 小时制</strong>：凌晨 cutoff（默认 6 点）前写的内容算<strong>前一天</strong>的日记——熬夜写的稿不会劈成两天。可配 <code>nightCutoff</code>。</li>
      <li data-l="en"><strong>30-hour clock</strong>: anything written before the cutoff hour (default 6 am) counts as <strong>the previous day</strong> — late-night entries do not split across two files. Configurable via <code>nightCutoff</code>.</li>
      <li data-l="zh"><strong>同日再提交</strong> = 追加新内容并重新生成总结：旧的 AI 评注块被摘掉重写，其上的你写的内容原样保留。约定：不要手工编辑 AI 评注块以下的区域。</li>
      <li data-l="en"><strong>Resubmitting the same day</strong> appends the new text and regenerates the summary: the old AI comment block is stripped and rewritten; everything you wrote above it is preserved untouched. Convention: do not hand-edit below the AI comment block.</li>
      <li data-l="zh"><strong>「是否有日记」永远现场推导</strong>：热力图只看目录里有哪些 YYYY-MM-DD.md 文件——手工建、手工删、手工改名即时生效，没有任何缓存要对账。</li>
      <li data-l="en"><strong>"Has a diary" is always derived</strong>: the heatmap only looks at which YYYY-MM-DD.md files exist in the directory — manual creation, deletion or renaming takes effect immediately; there is no cache to reconcile.</li>
      <li data-l="zh"><strong>文件名带后缀也算</strong>：<code>2026-04-28-补.md</code> 记为 2026-04-28；同日多文件不重复计数。</li>
      <li data-l="en"><strong>Suffixed filenames count too</strong>: <code>2026-04-28-note.md</code> registers as 2026-04-28; multiple files on the same day are not double-counted.</li>
    </ul>

    <h2><span data-l="zh">配置参考</span><span data-l="en">Configuration</span></h2>
    <p data-l="zh">三层来源，优先级从高到低：</p>
    <p data-l="en">Three layers of configuration, highest priority first:</p>
    <table>
      <tr>
        <th data-l="zh">来源</th><th data-l="en">Source</th>
        <th data-l="zh">说明</th><th data-l="en">Notes</th>
      </tr>
      <tr>
        <td><span data-l="zh">cordis patch / profile config</span><span data-l="en">cordis patch / profile config</span></td>
        <td data-l="zh">装载时注入，最高优先；给了 <code>diaryDir</code> 时页面设置卡会提示「被覆盖，修改不生效」。</td>
        <td data-l="en">Injected at load time, highest priority; when <code>diaryDir</code> is set here the settings card warns "overridden — page edits have no effect".</td>
      </tr>
      <tr>
        <td>config.json<span data-l="zh">（插件根目录）</span><span data-l="en"> (plugin root)</span></td>
        <td data-l="zh">页面设置卡与 prompt 卡写的就是它；也可手改。字段：<code>diaryDir</code>、<code>templatePath</code>（支持 <code>~/</code>）、<code>summaryPrompt</code>（自定义评注 prompt）。改后即时生效（每次请求现读）。</td>
        <td data-l="en">What the settings card and the prompt card write; also hand-editable. Fields: <code>diaryDir</code>, <code>templatePath</code> (both accept <code>~/</code>), and <code>summaryPrompt</code> (custom comment prompt). Re-read on every request, so edits apply immediately.</td>
      </tr>
      <tr>
        <td><span data-l="zh">内置默认</span><span data-l="en">Built-in defaults</span></td>
        <td data-l="zh">模板兜底 <code>assets/diary-template.md</code>；未配置目录时页面进入设置模式。</td>
        <td data-l="en">Template falls back to <code>assets/diary-template.md</code>; with no directory configured the page enters setup mode.</td>
      </tr>
    </table>
    <p data-l="zh">其余插件配置（cordis patch 层）：<code>provider</code> / <code>model</code>（总结模型）、<code>temperature</code>、<code>timeoutMs</code>、<code>nightCutoff</code>、<code>pagePath</code>。</p>
    <p data-l="en">Remaining plugin options (cordis patch layer): <code>provider</code> / <code>model</code> (summary model), <code>temperature</code>, <code>timeoutMs</code>, <code>nightCutoff</code>, <code>pagePath</code>.</p>

    <h2><span data-l="zh">你的数据：备份、迁移、补救</span><span data-l="en">Your data: backup, migration, recovery</span></h2>
    <ul>
      <li data-l="zh"><strong>数据全在日记目录里</strong>：正文是 <code>YYYY-MM-DD.md</code>，热力图 emoji 在同目录的隐藏文件夹 <code>.diary-meta/</code>（一年一个 JSON）。备份 = 拷贝整个目录。</li>
      <li data-l="en"><strong>Everything lives in the diary directory</strong>: entries are <code>YYYY-MM-DD.md</code> files; heatmap emoji live in the hidden <code>.diary-meta/</code> folder inside the same directory (one JSON per year). Backup = copy the whole directory.</li>
      <li data-l="zh"><strong>更换目录</strong>：页面设置卡改路径后，把旧目录整体搬过去即可——别忘了隐藏的 <code>.diary-meta/</code>（访达里按 ⌘⇧. 显示隐藏项）。只拷 md 文件不拷 meta 的话，热力图会退化成无 emoji 的绿块（不报错）。</li>
      <li data-l="en"><strong>Changing the directory</strong>: update the path in the settings card, then move the whole directory — do not forget the hidden <code>.diary-meta/</code> (in Finder press ⌘⇧. to reveal hidden items). Copying only the .md files loses emoji silently (the heatmap degrades to plain green cells, no error).</li>
      <li data-l="zh"><strong>删除日记</strong>：直接删文件即可，热力图即时更新；meta 里残留的孤儿 emoji 会被忽略，无害。</li>
      <li data-l="en"><strong>Deleting an entry</strong>: just delete the file; the heatmap updates immediately. Orphaned emoji left in meta are ignored harmlessly.</li>
      <li data-l="zh"><strong>给往期日记补评注</strong>：推荐把插件 diaryDir 临时指到一个沙箱目录（cordis patch 覆盖），把往期内容当"今天"提交生成评注，再把生成的文件改名回原日期并修两处日期：文件内 frontmatter 的 <code>date:</code> 与评注块尾行的时间戳，最后把沙箱 meta 里当日的 emoji 键移回原日期。改完刷新页面看热力图对齐即无残留。</li>
      <li data-l="en"><strong>Backfilling a comment for an old entry</strong>: point diaryDir at a sandbox directory via a cordis patch override, submit the old text as "today", rename the generated file back to the original date, then fix the two other places a date appears — the frontmatter <code>date:</code> and the timestamp on the comment block's last line — and move that day's emoji key in the sandbox meta back to the original date. Refresh the page: if the heatmap lines up, nothing is left behind.</li>
    </ul>

    <h2><span data-l="zh">隐私</span><span data-l="en">Privacy</span></h2>
    <p data-l="zh">日记全文只落在<strong>你本机的目录</strong>里。唯一的外发是「生成总结」这一次调用：当日全文会发送给你配置（或当次选择）的 LLM provider 用于生成四段内容。热力图数据、元表、草稿都不离开本机（草稿在浏览器 localStorage）。</p>
    <p data-l="en">Your full diary text is stored only <strong>on your machine</strong>. The single outbound call is summary generation: the day's full text is sent to the configured (or selected) LLM provider to produce the four fields. Heatmap data, meta files and drafts never leave your machine (drafts live in browser localStorage).</p>

    <div class="gfoot">dsh-diary · MIT License</div>
  </div>
</main>
<script>
(function () {
  var KEY = 'diary-guide-lang';
  var btn = document.getElementById('langBtn');
  var lang = null;
  try { lang = localStorage.getItem(KEY); } catch (e) { lang = null; }
  if (lang !== 'zh' && lang !== 'en') {
    lang = String((navigator.language || 'zh')).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  }
  function apply(l) {
    lang = l;
    document.body.dataset.lang = l;
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
    btn.textContent = l === 'zh' ? 'EN' : '中文';
    try { localStorage.setItem(KEY, l); } catch (e) { /* 隐私模式无 localStorage */ }
  }
  apply(lang);
  btn.addEventListener('click', function () { apply(lang === 'zh' ? 'en' : 'zh'); });
})();
</script>
</body>
</html>
`;
