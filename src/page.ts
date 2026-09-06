/**
 * 自包含 web UI（零构建）：一个 HTML 字符串，vanilla JS。
 * 页面职责五件事：展示半年热力图板、展示今日状态、收集原文、选择评注模型、提交并展示总结结果。
 * 热力图的帧窗口数学在 core.framesFor（服务端算好随 /api/dates 下发），页面只做切帧与四态渲染。
 *
 * 视觉语言为「纸感信纸风」：颜色/字体/圆角来自随仓库分发的 vendor 副本
 * PAPER_TOKENS_CSS（运行时读取内联，与 palette/lessons 同源，经 sync-tokens
 * 同步与校验）；本文件 :root 只留别名层，裸值仅存在于 diary 专属项与 dark 覆写块。
 *
 * @module dsh-diary/page
 */
import { readFileSync } from 'node:fs'
import { PAPER_TOKENS_CSS } from './paths.ts'

let paperTokensCss: string | undefined

/** 读取 tokens 副本（进程内缓存一次）。副本随仓库提交，缺失说明仓库不完整。 */
function paperTokens(): string {
  paperTokensCss ??= readFileSync(PAPER_TOKENS_CSS, 'utf8')
  return paperTokensCss
}

/** 渲染日记页。apiPath 为插件 API 前缀（如 /diary）。 */
export function renderPage(apiPath: string): string {
  return PAGE.replaceAll('__API__', apiPath)
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>今日日记</title>
<style>
  ${paperTokens()}
  /* ── diary 别名层：本地命名 → 权威 token；裸值只剩 diary 专属项 ── */
  :root {
    color-scheme: light dark;
    --font: var(--font-serif);
    --page-bg: var(--desk);
    --text-strong: var(--ink);
    --text-body: var(--ink-body);
    --text-muted: var(--ink-muted);
    --panel-bg: var(--paper);
    --panel-border: 2px solid var(--ink);
    --panel-shadow: var(--shadow-float);
    --input-bg: var(--card-bg);
    --input-border: var(--rule);
    --input-focus-border: var(--accent);
    --primary: var(--accent);
    --primary-hover: var(--accent-hover);
    --primary-ink: var(--accent-ink);
    --primary-soft: var(--accent-soft);
    --primary-line: color-mix(in srgb, var(--accent) 45%, transparent);
    --chip-text: var(--ink-body);
    --chip-border: var(--rule);
    --heat-future: color-mix(in srgb, var(--ink-muted) 65%, var(--paper));
    --heat-blank: var(--chip-bg);
    --heat-written: var(--ok);
    --heat-ring: var(--accent);
    --kw-bg: #f4ede4;    /* diary 专属：关键词标签的棕黄纸感 */
    --kw-text: #8a5a28;
    --kw-border: #e0d2bc;
    --err-bg: var(--accent-soft);
    --err-text: var(--accent-hover);
    --err-border: color-mix(in srgb, var(--accent) 45%, transparent);
    --radius-input: var(--radius-btn);
    --radius-btn: var(--radius-sm);
    --radius-card: var(--radius-sm);
    --radius-panel: var(--radius);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page-bg: #0c0f15;
      --text-strong: #fff;
      --text-body: #e2e8f0;
      --text-muted: #7d8aa5;
      --panel-bg: #12161e;
      --panel-border: 1px solid rgba(99, 116, 152, 0.35);
      --panel-shadow: 0 24px 80px rgba(2, 6, 23, 0.6), 0 0 40px rgba(176, 65, 62, 0.06);
      --rule: rgba(51, 65, 85, 0.7);  /* 暗色下仅覆写边框色（线型/宽度在用法处） */
      --input-bg: #141924;
      --input-border: rgba(51, 65, 85, 0.9);
      --primary-hover: #c85653;
      --primary-soft: rgba(176, 65, 62, 0.18);
      --chip-bg: rgba(30, 41, 59, 0.6);
      --chip-text: #94a3b8;
      --chip-border: rgba(51, 65, 85, 0.5);
      --chip-hover-bg: rgba(51, 65, 85, 0.7);
      --kw-bg: rgba(176, 65, 62, 0.16);
      --kw-text: #e0a494;
      --kw-border: rgba(176, 65, 62, 0.4);
      --err-bg: rgba(176, 65, 62, 0.14);
      --err-text: #e8a9a4;
      --heat-future: color-mix(in srgb, var(--ink-muted) 55%, var(--panel-bg));
      --heat-written: #4f9e63;  /* 暗色下提亮 --ok，保证格子可辨 */
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: var(--font); color: var(--text-body);
    background: var(--page-bg); min-height: 100vh;
    display: flex; justify-content: center; align-items: flex-start;
    padding: 48px 16px 40px;
  }
  main { width: 100%; max-width: 720px; }

  .panel {
    background: var(--panel-bg);
    border: var(--panel-border);
    border-radius: var(--radius-panel);
    box-shadow: var(--panel-shadow);
    overflow: hidden;
  }

  header { padding: 26px 32px 18px; border-bottom: 1px solid var(--rule); }
  .brandRow { display: flex; align-items: center; gap: 12px; }
  .brandIcon {
    width: 40px; height: 40px; flex: none; border-radius: var(--radius-btn);
    display: flex; align-items: center; justify-content: center;
    color: var(--primary-ink); background: var(--primary); font-size: 20px;
  }
  h1 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.01em; color: var(--text-strong); }
  .subtitle { margin: 2px 0 0; font-size: 12px; color: var(--text-muted); }
  .meta {
    margin-top: 14px; padding: 7px 12px; font-size: 12px; color: var(--text-muted);
    background: var(--chip-bg); border: 1px solid var(--chip-border); border-radius: var(--radius-btn);
  }

  .headActions { margin-left: auto; display: flex; gap: 6px; }
  a.hbtn { text-decoration: none; }

  /* ── 设置卡：未配置时的首屏，配置后由 ⚙ 唤出 ── */
  .setup { display: none; margin-bottom: 28px; padding: 22px 32px 24px; }
  .setup.show { display: block; }
  .setup h2 { margin: 0 0 8px; font-size: 15px; font-weight: 700; color: var(--text-strong); }
  .setupHint { margin: 0 0 14px; font-size: 13px; line-height: 1.8; color: var(--text-muted); }
  .dirRow { display: flex; gap: 10px; }
  .dirRow input {
    flex: 1; min-width: 0; padding: 9px 12px; font: 13px var(--font); color: var(--text-strong);
    background: var(--input-bg); border: 1px solid var(--input-border); border-radius: var(--radius-input);
    outline: none; transition: border-color 0.15s ease;
  }
  .dirRow input:focus { border-color: var(--input-focus-border); }
  .dirNote { margin-top: 10px; font-size: 12px; color: var(--text-muted); min-height: 1.2em; }
  .dirNote.warn { color: var(--err-text); }
  .setupGuideLink { margin: 14px 0 0; font-size: 12px; color: var(--text-muted); }
  .setupGuideLink a { color: var(--text-body); }

  /* ── 热力图板（半年帧 · GitHub 式：27 列周网格）──
     格边长 20px 的由来：面板 720 − 边框 2 − heatBody 左右 padding 64 = 654px 内容宽，
     星期列 16 + 缝 6 + 27 格×20 + 26 缝×3 = 640 ≤ 654，最大化窗口下恰好铺满不出滚动条。 */
  .heat { margin-bottom: 28px; --cell: 20px; }
  .heatHead { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 32px 12px; }
  .heatTitle { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: var(--text-strong); }
  .heatNav { display: flex; align-items: center; gap: 6px; }
  .hbtn {
    position: relative;
    width: 26px; height: 26px; padding: 0; display: flex; align-items: center; justify-content: center;
    font: 600 15px/1 var(--font); color: var(--text-body);
    background: var(--chip-bg); border: 1px solid var(--chip-border);
    border-radius: var(--radius-btn); cursor: pointer;
  }
  .hbtn:hover:not(:disabled) { background: var(--chip-hover-bg); }
  .hbtn:disabled { opacity: 0.35; cursor: default; }
  .hlabel { font-size: 12px; color: var(--text-muted); min-width: 10em; text-align: center; }
  .heatBody { padding: 4px 32px 24px; overflow-x: auto; }
  .hmonths {
    display: grid; grid-template-columns: repeat(27, var(--cell)); gap: 3px;
    margin: 0 0 4px 22px; font-size: 12px; color: var(--text-muted);
  }
  .hmonths div { white-space: nowrap; }
  .hwrap { display: flex; gap: 6px; }
  .hweek { display: grid; grid-template-rows: repeat(7, var(--cell)); gap: 3px; width: 16px; font-size: 12px; color: var(--text-muted); }
  .hweek span { display: flex; align-items: center; }
  .hgrid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, var(--cell)); grid-auto-columns: var(--cell); gap: 3px; }
  .cell { width: var(--cell); height: var(--cell); border-radius: 3px; }
  .c-fut { background: var(--heat-future); }
  .c-blank { background: var(--heat-blank); }
  .c-written { background: var(--heat-written); }
  .c-emoji { display: flex; align-items: center; justify-content: center; font: 15px/1 var(--font); }
  .c-ring { box-shadow: inset 0 0 0 1.5px var(--heat-ring); }

  .body { padding: 24px 32px; }
  textarea {
    width: 100%; min-height: 150px; padding: 14px 16px;
    font: 15px/1.9 var(--font); color: var(--text-strong);
    background: var(--input-bg); border: 1px solid var(--input-border);
    border-radius: var(--radius-input); resize: vertical; outline: none;
    transition: border-color 0.15s ease;
  }
  textarea::placeholder { color: var(--text-muted); opacity: 0.8; }
  textarea:focus { border-color: var(--input-focus-border); }

  .controls { display: flex; gap: 10px; align-items: flex-end; margin-top: 18px; flex-wrap: wrap; }
  .field { display: flex; flex-direction: column; gap: 4px; margin-right: auto; }
  label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--text-muted); }
  select {
    min-width: 220px; max-width: 320px; padding: 8px 12px;
    font: 13px var(--font); color: var(--text-strong);
    background: var(--input-bg); border: 1px solid var(--input-border);
    border-radius: var(--radius-input); outline: none; cursor: pointer;
    transition: border-color 0.15s ease;
  }
  select:focus { border-color: var(--input-focus-border); }

  /* 模型选择器 + 📝 prompt 入口同行；pdot 是「已自定义」小圆点 */
  .modelRow { display: flex; gap: 6px; align-items: center; }
  .modelRow select { flex: 1; min-width: 0; }
  .pdot {
    position: absolute; top: -3px; right: -3px; width: 7px; height: 7px;
    border-radius: 50%; background: var(--primary); border: 1.5px solid var(--panel-bg);
  }
  .btn {
    padding: 9px 20px; font: 600 13px var(--font); border-radius: var(--radius-btn);
    cursor: pointer; border: 1px solid transparent; transition: background 0.15s ease, color 0.15s ease;
  }
  .btn:disabled { opacity: 0.55; cursor: default; }
  #go { color: var(--primary-ink); background: var(--primary); }
  #go:hover:not(:disabled) { background: var(--primary-hover); }
  #retry { display: none; color: var(--text-body); background: var(--chip-bg); border-color: var(--chip-border); }
  #retry:hover:not(:disabled) { background: var(--chip-hover-bg); }
  #status { width: 100%; font-size: 12px; color: var(--text-muted); min-height: 1em; }

  /* ── 评注 prompt 卡：📝 唤出，只读 pre →「编辑」textarea（ADR-0001）── */
  .pcard {
    margin-top: 18px; padding: 14px 16px;
    background: var(--input-bg); border: 1px solid var(--input-border); border-radius: var(--radius-card);
  }
  .phead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .ptitle { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--text-strong); }
  .pbadge {
    padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
    color: var(--kw-text); background: var(--kw-bg); border: 1px solid var(--kw-border);
  }
  .pnote { margin: 10px 0 0; font-size: 12px; color: var(--err-text); }
  .phint { margin: 8px 0 0; font-size: 12px; color: var(--text-muted); }
  .pview {
    margin: 10px 0 0; padding: 12px 14px; max-height: 260px; overflow: auto;
    font: 12.5px/1.8 var(--font-mono, monospace); color: var(--text-body);
    background: var(--panel-bg); border: 1px solid var(--input-border); border-radius: var(--radius-input);
    white-space: pre-wrap; word-break: break-word;
  }
  .pbtns { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  .btn.ghost { color: var(--text-body); background: var(--chip-bg); border-color: var(--chip-border); }
  .btn.ghost:hover:not(:disabled) { background: var(--chip-hover-bg); }
  .pmsg { font-size: 12px; color: var(--err-text); min-height: 1.2em; }

  .err {
    display: none; margin-top: 16px; padding: 12px 14px;
    background: var(--err-bg); color: var(--err-text); border: 1px solid var(--err-border);
    border-radius: var(--radius-card); font-size: 13px; line-height: 1.7; white-space: pre-wrap;
  }

  .result { display: none; margin-top: 24px; padding: 20px 24px; }
  .kw {
    display: inline-block; padding: 3px 12px; border-radius: 999px;
    font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
    color: var(--kw-text); background: var(--kw-bg); border: 1px solid var(--kw-border);
  }
  .oneline { margin: 12px 0 14px; padding-bottom: 14px; border-bottom: 1px solid var(--rule);
             font-size: 16px; font-weight: 600; color: var(--text-strong); line-height: 1.7; }
  .commentTitle { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; color: var(--text-muted); margin-bottom: 6px; }
  .comment { white-space: pre-wrap; line-height: 1.95; font-size: 14px; }
  .path { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--rule); font-size: 12px; color: var(--text-muted); word-break: break-all; }

  footer {
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
    padding: 12px 32px; border-top: 1px solid var(--rule); font-size: 11px; color: var(--text-muted);
  }
  @media (max-width: 640px) {
    body { padding: 20px 10px 28px; }
    header, .body { padding-left: 20px; padding-right: 20px; }
    .heatHead { padding-left: 20px; padding-right: 20px; }
    .heatBody { padding-left: 20px; padding-right: 20px; }
    footer { padding-left: 20px; padding-right: 20px; }
    .field, select { width: 100%; max-width: none; }
    .modelRow { flex-wrap: wrap; }
    .dirRow { flex-wrap: wrap; }
    .dirRow input { flex: 1 1 100%; }
  }
</style>
</head>
<body>
<main>
  <div class="panel setup" id="setupPanel">
    <h2>日记存储路径</h2>
    <p class="setupHint">日记以 YYYY-MM-DD.md 存在你指定的目录（不存在会自动创建）；热力图 emoji 存在目录内的隐藏文件夹 .diary-meta/。保存即写入插件 config.json，立即生效、无需重启。</p>
    <div class="dirRow">
      <input id="dirInput" type="text" placeholder="如 ~/Documents/日记（~ 会展开为主目录）" spellcheck="false" autocomplete="off">
      <button class="btn" id="dirSave" type="button">保存</button>
    </div>
    <div class="dirNote" id="dirNote"></div>
    <p class="setupGuideLink"><a href="__API__/guide" target="_blank" rel="noopener">使用指南 ↗</a>：三步开始、30 小时制、热力图语义、备份与迁移</p>
  </div>
  <div class="panel heat" id="heatPanel">
    <div class="heatHead">
      <div class="heatTitle">日记热力图</div>
      <div class="heatNav">
        <button class="hbtn" id="hPrev" type="button" title="上一帧">‹</button>
        <span class="hlabel" id="hLabel">加载中…</span>
        <button class="hbtn" id="hNext" type="button" title="下一帧">›</button>
      </div>
    </div>
    <div class="heatBody"><div id="hBoard"></div></div>
  </div>
  <div class="panel">
    <header>
      <div class="brandRow">
        <div class="brandIcon">📖</div>
        <div>
          <h1>今日日记</h1>
          <p class="subtitle">写下来，剩下的交给总结</p>
        </div>
        <div class="headActions">
          <button class="hbtn" id="setupBtn" type="button" title="设置">⚙</button>
          <a class="hbtn" href="__API__/guide" target="_blank" rel="noopener" title="使用指南">?</a>
        </div>
      </div>
      <div class="meta" id="meta">加载中…</div>
    </header>
    <div class="body" id="writeBody">
      <textarea id="box" placeholder="今天怎么样都可以写……"></textarea>
      <div class="controls">
        <div class="field">
          <label for="model">AI 评注模型</label>
          <div class="modelRow">
            <select id="model"><option value="">加载模型列表…</option></select>
            <button class="hbtn" id="promptBtn" type="button" title="评注 prompt">📝<span class="pdot" id="promptDot" hidden></span></button>
          </div>
        </div>
        <button class="btn" id="go">保存并生成总结</button>
        <button class="btn" id="retry">仅重试总结</button>
        <span id="status"></span>
      </div>
      <div class="err" id="err"></div>
      <div class="pcard" id="promptCard" hidden>
        <div class="phead">
          <div class="ptitle">评注 prompt <span class="pbadge" id="pBadge" hidden>已自定义</span></div>
          <button class="hbtn" id="pEdit" type="button" title="编辑">✎</button>
        </div>
        <div class="pnote" id="pWarn" hidden></div>
        <p class="phint">修改只影响之后的总结，已写入日记的评注块不会变。三个必需标记（【今日关键词】【一句话总结】【评注】）不能删。</p>
        <pre class="pview" id="pView"></pre>
        <div class="pedit" id="pEditBox" hidden>
          <textarea id="pText" spellcheck="false"></textarea>
          <div class="pbtns">
            <button class="btn" id="pSave" type="button">保存</button>
            <button class="btn ghost" id="pReset" type="button">恢复默认</button>
            <button class="btn ghost" id="pCancel" type="button">取消</button>
            <span class="pmsg" id="pMsg"></span>
          </div>
        </div>
      </div>
    </div>
    <div class="panel result" id="card">
      <span class="kw" id="kw"></span>
      <div class="oneline" id="ol"></div>
      <div class="commentTitle">AI 评注</div>
      <div class="comment" id="cm"></div>
      <div class="path" id="pt"></div>
    </div>
    <footer>
      <span>原文先落盘，总结失败不丢稿</span>
      <span id="modelNote"></span>
    </footer>
  </div>
</main>
<script>
(function () {
  var API = '__API__';
  var box = document.getElementById('box');
  var meta = document.getElementById('meta');
  var go = document.getElementById('go');
  var retry = document.getElementById('retry');
  var statusEl = document.getElementById('status');
  var err = document.getElementById('err');
  var card = document.getElementById('card');
  var kw = document.getElementById('kw');
  var ol = document.getElementById('ol');
  var cm = document.getElementById('cm');
  var pt = document.getElementById('pt');
  var modelSel = document.getElementById('model');
  var modelNote = document.getElementById('modelNote');
  var draftKey = '';
  var chosen = null; // { provider, model }

  // ── 设置卡：未配置时的首屏；⚙ 唤出；保存写 config.json 成功后整页刷新 ──
  var heatPanel = document.getElementById('heatPanel');
  var writeBody = document.getElementById('writeBody');
  var setupPanel = document.getElementById('setupPanel');
  var setupBtn = document.getElementById('setupBtn');
  var dirInput = document.getElementById('dirInput');
  var dirSave = document.getElementById('dirSave');
  var dirNote = document.getElementById('dirNote');

  setupBtn.addEventListener('click', function () {
    var opening = !setupPanel.classList.contains('show');
    setupPanel.classList.toggle('show', opening);
    if (opening) { dirInput.focus(); dirInput.select(); }
  });

  function settingsFail(msg) {
    dirSave.disabled = false;
    dirNote.className = 'dirNote warn';
    dirNote.textContent = msg;
  }

  dirSave.addEventListener('click', function () {
    var v = dirInput.value.trim();
    if (!v) { settingsFail('路径不能为空'); return; }
    dirSave.disabled = true;
    dirNote.className = 'dirNote';
    dirNote.textContent = '保存中…';
    fetch(API + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ diaryDir: v }) })
      .then(parseJson)
      .then(function (j) {
        if (j.ok) location.reload();
        else settingsFail(j.error || '保存失败');
      })
      .catch(function (e) { settingsFail('保存失败：' + String(e)); });
  });

  function parseJson(r) {
    return r.text().then(function (txt) { try { return JSON.parse(txt); } catch (e) { throw new Error('HTTP ' + r.status); } });
  }

  // ── 评注 prompt 卡（ADR-0001）：📝 唤出 → 只读 pre；「✎」进 textarea；保存/取消/恢复默认 ──
  var promptBtn = document.getElementById('promptBtn');
  var promptDot = document.getElementById('promptDot');
  var promptCard = document.getElementById('promptCard');
  var pBadge = document.getElementById('pBadge');
  var pWarn = document.getElementById('pWarn');
  var pView = document.getElementById('pView');
  var pEdit = document.getElementById('pEdit');
  var pEditBox = document.getElementById('pEditBox');
  var pText = document.getElementById('pText');
  var pSave = document.getElementById('pSave');
  var pReset = document.getElementById('pReset');
  var pCancel = document.getElementById('pCancel');
  var pMsg = document.getElementById('pMsg');
  var promptCurrent = ''; // 最近拉到的生效 prompt，编辑框预填用它

  promptBtn.addEventListener('click', function () {
    var opening = promptCard.hidden;
    promptCard.hidden = !opening;
    if (opening) loadPrompt();
  });

  function promptViewMode() {
    pEditBox.hidden = true;
    pView.hidden = false;
    pMsg.textContent = '';
  }

  // prompt 是用户文本：一律 textContent，绝不经 innerHTML
  function loadPrompt() {
    fetch(API + '/api/prompt')
      .then(parseJson)
      .then(function (j) {
        promptCurrent = j.prompt || '';
        pView.textContent = promptCurrent;
        pBadge.hidden = !j.customized;
        promptDot.hidden = !j.customized;
        if (j.overridden) {
          pWarn.hidden = false;
          pWarn.textContent = '当前评注 prompt 由 profile/patch 配置覆盖，这里修改不会生效';
        } else {
          pWarn.hidden = true;
        }
        promptViewMode();
      })
      .catch(function () {
        pWarn.hidden = false;
        pWarn.textContent = '（prompt 接口不可达）';
      });
  }

  pEdit.addEventListener('click', function () {
    pText.value = promptCurrent;
    pView.hidden = true;
    pEditBox.hidden = false;
    pMsg.textContent = '';
    pText.focus();
  });

  pCancel.addEventListener('click', promptViewMode);

  function promptPost(body, failLabel, done) {
    pSave.disabled = true;
    pReset.disabled = true;
    fetch(API + '/api/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(parseJson)
      .then(done, function (e) { done({ ok: false, error: failLabel + '：' + String(e) }); })
      .then(function () { pSave.disabled = false; pReset.disabled = false; });
  }

  pSave.addEventListener('click', function () {
    pMsg.textContent = '';
    promptPost({ prompt: pText.value }, '保存失败', function (j) {
      if (j.ok) loadPrompt();
      else pMsg.textContent = j.error || '保存失败';
    });
  });

  pReset.addEventListener('click', function () {
    if (!window.confirm('恢复内置默认评注 prompt？')) return;
    pMsg.textContent = '';
    promptPost({ reset: true }, '恢复失败', function (j) {
      if (j.ok) loadPrompt();
      else pMsg.textContent = j.error || '恢复失败';
    });
  });

  // ── 热力图板：/api/dates 拉数据（帧窗口由服务端 core.framesFor 算好），纯客户端切帧 ──
  var hPrev = document.getElementById('hPrev');
  var hNext = document.getElementById('hNext');
  var hLabel = document.getElementById('hLabel');
  var hBoard = document.getElementById('hBoard');
  var heat = { frames: [], days: {}, today: '', i: 0 };

  function z2(n) { return (n < 10 ? '0' : '') + n; }

  // 日期键 +n 天：UTC 钟面做纯算术，避开本地时区的夏令时坑
  function dayKeyAdd(key, n) {
    var p = key.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.getUTCFullYear() + '-' + z2(d.getUTCMonth() + 1) + '-' + z2(d.getUTCDate());
  }

  // 格子四态（与 core.cellState 同规则；今日已写画 emoji，未写空白加描边）
  function heatState(day, written) {
    if (written) return 'written';
    if (day > heat.today) return 'future';
    if (day === heat.today) return 'today';
    return 'blank';
  }

  function heatRender() {
    var f = heat.frames[heat.i];
    if (!f) { hBoard.innerHTML = ''; return; }
    hPrev.disabled = heat.i === 0;
    hNext.disabled = heat.i === heat.frames.length - 1;
    hLabel.textContent = f.label + ' · ' + f.count + '/' + f.halfDays + ' 篇';
    var html = ['<div class="hmonths">'];
    var prevM = -1;
    for (var c = 0; c < 27; c++) {
      var m = +dayKeyAdd(f.start, c * 7).slice(5, 7);
      if (m !== prevM) { html.push('<div style="grid-column:' + (c + 1) + '">' + m + '月</div>'); prevM = m; }
    }
    html.push('</div><div class="hwrap"><div class="hweek"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div><div class="hgrid">');
    for (var i = 0; i < 189; i++) {
      var day = dayKeyAdd(f.start, i);
      var rec = heat.days[day];
      var st = heatState(day, !!rec);
      var cls = st === 'written' ? (rec.emoji ? 'c-emoji' : 'c-written') : (st === 'future' ? 'c-fut' : 'c-blank');
      if (day === heat.today) cls += ' c-ring';
      var tip = day + ' · ' + (st === 'written' ? (rec.emoji ? rec.emoji + ' 已写' : '已写') : st === 'today' ? '今日 · 还没写' : st === 'future' ? '未到' : '未写');
      html.push('<div class="cell ' + cls + '" title="' + tip + '">' + (st === 'written' && rec.emoji ? rec.emoji : '') + '</div>');
    }
    html.push('</div></div>');
    hBoard.innerHTML = html.join('');
  }

  function heatLoad() {
    fetch(API + '/api/dates')
      .then(function (r) { return r.text().then(function (txt) { try { return JSON.parse(txt); } catch (e) { throw new Error('HTTP ' + r.status); } }); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || 'dates 接口异常');
        heat.frames = j.frames || [];
        heat.days = j.days || {};
        heat.today = j.today;
        heat.i = heat.frames.length - 1;
        heatRender();
      })
      .catch(function () { hLabel.textContent = '（热力图数据不可达）'; });
  }

  hPrev.addEventListener('click', function () { if (heat.i > 0) { heat.i--; heatRender(); } });
  hNext.addEventListener('click', function () { if (heat.i < heat.frames.length - 1) { heat.i++; heatRender(); } });

  function selectedModel() {
    var v = modelSel.value;
    if (!v) return {};
    var i = v.indexOf('|');
    return { provider: v.slice(0, i), model: v.slice(i + 1) };
  }

  function post(path, body, ondone) {
    statusEl.textContent = '保存并生成总结中…';
    go.disabled = true;
    retry.disabled = true;
    var payload = body || {};
    var m = selectedModel();
    if (m.provider) { payload.provider = m.provider; payload.model = m.model; }
    fetch(API + path, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload) })
      .then(function (r) {
        return r.text().then(function (txt) {
          var j;
          try { j = JSON.parse(txt); }
          catch (e) { j = { ok:false, error:'服务端返回了非 JSON 响应（HTTP ' + r.status + '），请查看 dsh 日志' }; }
          return { s:r.status, j:j };
        });
      })
      .then(function (x) { ondone(x.s, x.j); })
      .catch(function (e) { ondone(0, { ok:false, error:String(e) }); });
  }

  function settle() { statusEl.textContent = ''; go.disabled = false; retry.disabled = false; }

  function showResult(j) {
    settle();
    kw.textContent = '今日关键词：' + j.keyword;
    ol.textContent = j.oneLine;
    cm.textContent = j.comment;
    pt.textContent = '已写入 ' + j.path + '（' + j.clock + '）';
    card.style.display = 'block';
    retry.style.display = 'none';
    if (draftKey) localStorage.removeItem(draftKey);
    box.value = '';
    heatLoad(); // 今日格子可能从空白变 emoji，重新拉一次数据
  }

  function showError(s, j) {
    settle();
    err.style.display = 'block';
    err.textContent = (j && j.error ? j.error : 'HTTP ' + s) + (j && j.hint ? '\\n' + j.hint : '');
    if (j && j.stage === 'summary') retry.style.display = 'inline-block';
  }

  go.addEventListener('click', function () {
    var text = box.value.trim();
    if (!text) { alert('还没写内容'); return; }
    err.style.display = 'none'; card.style.display = 'none'; retry.style.display = 'none';
    post('/api/submit', { text: text }, function (s, j) {
      if (j && j.ok) showResult(j); else showError(s, j);
    });
  });

  retry.addEventListener('click', function () {
    err.style.display = 'none'; card.style.display = 'none';
    post('/api/retry-summary', {}, function (s, j) {
      if (j && j.ok) showResult(j); else showError(s, j);
    });
  });

  box.addEventListener('input', function () {
    if (draftKey) localStorage.setItem(draftKey, box.value);
  });

  modelSel.addEventListener('change', function () {
    var m = selectedModel();
    if (m.provider) {
      localStorage.setItem('diary-llm', modelSel.value);
      modelNote.textContent = m.provider + ' / ' + m.model;
    } else {
      localStorage.removeItem('diary-llm');
      modelNote.textContent = '';
    }
  });

  function loadModels() {
    // 模型列表：provider|model 作为值，optgroup 按 provider 分组
    fetch(API + '/api/models')
      .then(parseJson)
      .then(function (j) {
        var groups = j.providers || [];
        if (!groups.length) { modelSel.innerHTML = '<option value="">（无可选模型，用默认配置）</option>'; return; }
        modelSel.innerHTML = '';
        var saved = localStorage.getItem('diary-llm');
        var cur = j.current || {};
        var preselect = saved || (cur.provider ? cur.provider + '|' + cur.model : '');
        var hit = false;
        var def = document.createElement('option');
        def.value = '';
        def.textContent = '跟随插件配置（默认）';
        modelSel.appendChild(def);
        groups.forEach(function (g) {
          if (!g.models || !g.models.length) return;
          var og = document.createElement('optgroup');
          og.label = g.name || g.provider;
          g.models.forEach(function (m) {
            var v = g.provider + '|' + m.id;
            var o = document.createElement('option');
            o.value = v;
            o.textContent = m.name || m.id;
            if (v === preselect) { o.selected = true; hit = true; }
            og.appendChild(o);
          });
          modelSel.appendChild(og);
        });
        if (!hit) def.selected = true;
        var m = selectedModel();
        if (m.provider) modelNote.textContent = m.provider + ' / ' + m.model;
      })
      .catch(function () { modelSel.innerHTML = '<option value="">（模型列表不可达，用默认配置）</option>'; });
  }

  function loadToday() {
    fetch(API + '/api/today')
      .then(function (r) { return r.text().then(function (txt) { try { return JSON.parse(txt); } catch (e) { throw new Error('today 接口返回非 JSON（HTTP ' + r.status + '）'); } }); })
      .then(function (j) {
        meta.textContent = j.date + ' · 现在 ' + j.clock +
          (j.exists ? ' · 今天已有记录，再提交会追加并重新生成总结' : ' · 还没有今天的记录');
        draftKey = 'diary-draft-' + j.date;
        box.value = localStorage.getItem(draftKey) || '';
        box.focus();
      })
      .catch(function () { meta.textContent = '无法连接插件服务（today 接口不可达）'; });
  }

  // 启动：先问设置——未配置进设置模式（热力图/写作区隐藏），已配置再拉模型/今日/热力图
  fetch(API + '/api/settings')
    .then(parseJson)
    .then(function (j) {
      if (!(j && j.configured)) {
        setupPanel.classList.add('show');
        heatPanel.hidden = true;
        writeBody.hidden = true;
        meta.textContent = '尚未配置日记目录——填好路径保存后即可开始写';
        dirInput.focus();
        return;
      }
      if (j.overridden) {
        dirNote.className = 'dirNote warn';
        dirNote.textContent = '当前目录由 profile/patch 配置覆盖，这里修改不会生效';
      } else {
        dirInput.value = j.diaryDir || '';
      }
      loadModels();
      loadToday();
      heatLoad();
    })
    .catch(function () { meta.textContent = '无法连接插件服务（settings 接口不可达）'; });
})();
</script>
</body>
</html>
`
