/**
 * 「快捷键一览」与命令面板入口的接线守卫
 *
 * 这一处补的是两个静默失败：
 *
 * 1. **应用内快捷键混进状态列**。`useShortcuts` 用 `chrome.commands.getAll()` 给每行标
 *    「已生效 / 未生效」，而命令面板的 ⌘K 是页面级监听、`getAll()` 永远读不到。它一旦被并进
 *    manifest 那张表，用户看到的是一条**永远亮着的「未生效」预警**——比不写更糟，因为它在
 *    教用户去浏览器管理页找一个根本不存在于那里的键。所以「应用内那一段里没有状态列」必须
 *    是可判定的，而不只是当时写得对。
 * 2. **footer 那颗按钮的 Enter 归属**。面板的 Enter 导航挂在 window 的冒泡监听上
 *    （`useCommandPalette`），按钮自己也要响应 Enter。少了 `.stop`，一次回车会同时
 *    「执行当前高亮命令」和「点开快捷键弹窗」；少了 `.prevent`，浏览器合成的 click 还会
 *    再补一次弹窗请求。这类双触发不报错、不红，只在用户按下回车时多跳一层。
 *
 * 键帽同样收口到共用组件：`ShortcutKeyCap` 已是全产品键帽的真源（等宽 + 边框 + 底部投影 +
 * `--aph-*` 令牌），面板 footer 曾自带一份 `.cp-kbd` 就是重复实现，这里挡住它长回来。
 */
import { describe, expect, it } from 'vitest';
import { readSource } from '../helpers/architectureScan';

const DIALOG = 'components/options/ShortcutSettingDialog.vue';
const PALETTE = 'components/options/CommandPalette.vue';
const APP = 'entrypoints/options/App.vue';

const dialog = readSource(DIALOG);
const palette = readSource(PALETTE);
const app = readSource(APP);

/** 取弹窗里「应用内快捷键」那一段模板（从容器开标签到紧随其后的 Firefox 注释） */
function inAppSection(source: string): string {
  const start = source.indexOf('<div class="shortcut-inapp">');
  if (start === -1) throw new Error('找不到应用内快捷键那段，弹窗结构变了');
  const end = source.indexOf('<!-- Firefox', start);
  if (end === -1) throw new Error('应用内那段之后找不到 Firefox 注释锚点');
  return source.slice(start, end);
}

/** 取 App.vue 里 footer 入口的处理函数 */
function paletteShortcutsHandler(source: string): string {
  const start = source.indexOf('const openShortcutsFromPalette');
  if (start === -1) throw new Error('找不到 openShortcutsFromPalette，App.vue 接线变了');
  return source.slice(start, source.indexOf('};', start));
}

describe('快捷键一览弹窗的应用内段落', () => {
  it('渲染 IN_APP_SHORTCUTS，且不给自己编一条生效状态', () => {
    const section = inAppSection(dialog);

    expect(section, '应用内那段没有消费 IN_APP_SHORTCUTS，⌘K 会重新变成无处可查').toContain('IN_APP_SHORTCUTS');
    expect(section).toContain('ShortcutKeyCap');
    // 状态列只属于 manifest 命令：页面级按键 getAll() 读不到，标任何状态都是假数据
    expect(section, '应用内段落出现了生效状态列 —— getAll() 读不到页面级按键，那是一条假预警').not.toMatch(
      /statusActive|statusInactive|assigned/,
    );

    // 牙齿：把状态列塞进那一段，判据必须读出来
    const polluted = section.replace('</ul>', "</ul><span>{{ t('options.shortcuts.statusInactive') }}</span>");
    expect(polluted, '塞进状态列之后守卫仍然绿 —— 说明它没在查这一段').toMatch(/statusInactive/);
  });

  it('弹窗整体仍把 manifest 那组交给 useShortcuts（两条清单没有互相吞并）', () => {
    expect(dialog).toContain('useShortcuts');
    expect(dialog).toContain('entry.assigned');
    expect(dialog, 'IN_APP_SHORTCUTS 被并进了 manifest 的 v-for，两条清单混成一套状态语义').not.toMatch(
      /v-for="entry in [^"]*IN_APP_SHORTCUTS[^"]*"[^>]*class="shortcut-item"\s*>\s*[\s\S]{0,400}entry\.assigned/,
    );
  });
});

describe('命令面板 footer 的快捷键入口', () => {
  it('按钮自己接管 Enter：不冒泡给 window，也不让浏览器再合成一次 click', () => {
    const button = palette.slice(palette.indexOf('class="cp-footer__action"'));
    const binding = button.slice(0, button.indexOf('>'));

    expect(binding, '缺少 @keydown.enter 绑定：回车会同时触发面板高亮命令与弹窗').toContain('@keydown.enter');
    expect(binding, '缺少 .stop：window 上的 Enter 导航仍会收到这一次按键').toContain('.stop');
    expect(binding, '缺少 .prevent：浏览器合成的 click 会再补一次弹窗请求').toContain('.prevent');
    expect(binding).toContain('@click');

    // 牙齿：摘掉 .stop 之后必须被读出来
    const unstopped = binding.replace('.stop.prevent', '.prevent');
    expect(unstopped, '变异没生效').not.toBe(binding);
    expect(unstopped, '摘掉 .stop 后守卫仍然绿 —— 它没真的查这个修饰符').not.toContain('.stop');
  });

  it('键帽复用共用组件，面板不再自带一份 .cp-kbd', () => {
    expect(palette).toContain("import ShortcutKeyCap from '@/components/ShortcutKeyCap.vue'");
    expect(palette, '面板又长出一份自己的键帽样式，全产品键帽语言开始分叉').not.toMatch(/\.cp-kbd\s*\{/);
  });

  it('App.vue 先收面板再开弹窗，且复用同一个弹窗 flag', () => {
    const handler = paletteShortcutsHandler(app);

    expect(handler.indexOf('paletteClose()'), '没有先收面板：遮罩会压在弹窗上面').toBeGreaterThan(-1);
    expect(handler.indexOf('showShortcutDialog.value = true'), '没有打开既有弹窗').toBeGreaterThan(-1);
    expect(handler.indexOf('paletteClose()'), '收尾顺序不对，应先收面板再开弹窗').toBeLessThan(
      handler.indexOf('showShortcutDialog.value = true'),
    );
    expect(app, '为 footer 入口另开了第二份弹窗状态').toMatch(/<ShortcutSettingDialog\s+v-model="showShortcutDialog"/);
  });
});
