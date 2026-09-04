/**
 * dsh-diary 的浏览器半边（client bundle，直接以产物形态维护）。
 *
 * 格式约定：window.__ModuleLoader__.load handoff——同 harness
 * packages/client/tsdown.client.ts 产物的 banner/footer 包装；factory 内的
 * require 只允许模块表词（react / @deepseek-ai/dsh-client-ui-primitives）。
 * 本插件 client 面只有一个侧栏入口按钮，不值得为此引入 tsdown 构建链。
 *
 * 行为：向 `sidebar.footer.action` 插槽注册一个「日记」入口（侧栏底部、
 * 设置按钮上方），新标签页打开插件的 web UI。
 * 注意：href 与插件配置 pagePath 耦合（默认 /diary）；改 pagePath 时需同步改这里。
 */
window.__ModuleLoader__.load({
  id: 'dsh-diary',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const { IconEditOutline16, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives');

    // 一次性注入按钮样式；data-plugin 双标记与官方 loader 的插件样式约定一致
    // （卸载时按 data-plugin 摘除）。尺寸/配色对齐 ui-settings 触发行
    // （SettingsRoot.module.css 的 .trigger / .trigger.rail 节奏）。
    const CSS = [
      '.dsh-diary-entry{display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;',
      'margin:4px -4px 4px;padding:6px 2px 6px 10px;box-sizing:border-box;border-radius:12px;',
      'background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;',
      'font-size:14px;line-height:22px;text-decoration:none;cursor:pointer;overflow:hidden;}',
      '.dsh-diary-entry:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dsh-diary-entry .dsh-diary-entry-label{overflow:hidden;white-space:nowrap;}',
      '.dsh-diary-entry.rail{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%;}',
    ].join('');
    if (document.querySelector('style[data-plugin-css="dsh-diary/entry"]') === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-diary';
      tag.dataset.pluginCss = 'dsh-diary/entry';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** 侧栏底部的日记入口：wide = 34px 行，rail = 36px 圆形图标。 */
    // 入口文案按浏览器语言二选一（不依赖 slots 的 locale 服务，保持零依赖）。
    const zh = (typeof navigator !== 'undefined' ? navigator.language : 'zh').toLowerCase().startsWith('zh');
    const LABEL = zh ? '日记' : 'Diary';
    const ARIA = zh ? '打开日记' : 'Open diary';

    function DiaryEntry({ wide }) {
      const link = React.createElement(
        'a',
        {
          href: '/diary',
          target: '_blank',
          rel: 'noopener',
          className: wide ? 'dsh-diary-entry' : 'dsh-diary-entry rail',
          'aria-label': ARIA,
        },
        React.createElement(IconEditOutline16, { size: wide ? 14 : 18 }),
        wide ? React.createElement('span', { className: 'dsh-diary-entry-label' }, LABEL) : null,
      );
      // 展开态按钮自带文字，tooltip 只在 rail 上出现（同 SidebarRoot 的约定）。
      return wide ? link : React.createElement(Tooltip, { label: LABEL, delayMs: 500 }, link);
    }

    /** 只等 slots 服务；文案按 navigator.language 切换，无需 locale 服务。 */
    exports.inject = ['slots'];

    exports.apply = (ctx) => {
      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'dsh-diary-entry' },
              DiaryEntry,
            ),
          ),
        'dsh-diary: sidebar footer entry',
      );
    };

    return module.exports;
  },
});
