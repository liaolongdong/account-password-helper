/**
 * 输入法合成态按键守卫
 *
 * 「按键即执行动作」的入口都不该在 IME 合成期间接管按键：中文/日文输入里 Enter 是上屏候选、
 * ↑↓ 是候选翻页、Esc 是取消合成，接管会演变成「还没打完字就把密码填进页面」。
 * 这类回归不会报错、只是行为变得诡异，且只有真实输入法手测才复现，故在此钉住：
 * 每个处理函数体的**任何按键分支之前**必须先因 `isComposing` 早退。
 * 新增同类入口时，把它一起加进 HANDLERS。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

/** 参与守卫的键盘入口处理函数 */
const HANDLERS = [
  {
    // 面板内导航与填充（监听绑在 closed shadow root 上，页面伪造的按键进不来）
    file: 'entrypoints/content/inlineDropdown/InlineFillDropdown.ts',
    declaration: 'private handlePanelKeydown = (e: Event): void => {',
    firstAction: "case 'ArrowDown'",
  },
  {
    // 面板的 Esc 兜底（绑在 document 上，锁定态下焦点不在面板内也能收起）
    file: 'entrypoints/content/inlineDropdown/InlineFillDropdown.ts',
    declaration: 'private handleGlobalEscape = (e: KeyboardEvent): void => {',
    firstAction: "e.key !== 'Escape'",
  },
  {
    file: 'entrypoints/sidepanel/App.vue',
    declaration: 'const handleKeydown = (e: KeyboardEvent) => {',
    firstAction: "case 'ArrowDown'",
  },
  {
    // 全局命令面板：合成态回车会直接执行高亮命令（打开弹窗、导出…），比侧边栏「多填一次」更难撤回
    file: 'composables/useCommandPalette.ts',
    declaration: 'const handleKeydown = (event: PaletteKeyboardEvent) => {',
    firstAction: "case 'ArrowDown'",
  },
  {
    // 凭证捕获：密码框里为选候选词按 Enter 会把半截输入当成一次登录并提交捕获弹窗
    file: 'entrypoints/content/LoginAutoSave.ts',
    declaration: 'private handleKeyDown = (e: KeyboardEvent): void => {',
    firstAction: "e.key !== 'Enter'",
  },
];

/** 取出处理函数体（声明处到最近的 `};`） */
const handlerBody = (source: string, declaration: string): string => {
  const start = source.indexOf(declaration);
  expect(start, `未找到键盘处理函数（实现改名需同步本守卫）: ${declaration}`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + declaration.length);
  const end = rest.search(/^\s{0,2}\};/m);
  expect(end, '处理函数体未能定位结尾').toBeGreaterThan(0);
  return rest.slice(0, end);
};

describe('IME 合成期间的按键放行', () => {
  it.each(HANDLERS)('$file 的合成态早退先于任何按键分支', ({ file, declaration, firstAction }) => {
    const body = handlerBody(readFileSync(path.join(ROOT, file), 'utf8'), declaration);
    const guard = body.indexOf('isComposing');
    const action = body.indexOf(firstAction);

    expect(guard, `缺少 isComposing 守卫: ${file}`).toBeGreaterThanOrEqual(0);
    expect(action, `按键分支定位失败: ${firstAction}`).toBeGreaterThan(guard);
    // 守卫必须是「直接 return」，而不是把 isComposing 混进某个分支条件里
    expect(body.slice(guard).startsWith('isComposing) return;')).toBe(true);
  });
});
