/**
 * 表格「截断全文浮层」必须对指针透明
 *
 * Element Plus 的 `show-overflow-tooltip` 浮层由内部 `createTablePopper()` 现建：
 * `placement="top"` + `offset: 0` + 默认参与指针命中，而行高（实测 63～64 像素）小于两行浮层的高度，
 * 于是**下一行**截断单元格的浮层正好压在**上一行**那排控件上。真机实测（Chrome for Testing、
 * 1280×720 视口、两条条目、悬浮下一行的备注单元格）：浮层 1280×52 像素，上一行的行首勾选框、显示密码、
 * 站点链接、查看详情、创建副本、编辑、收藏、删除**八处**几何中心全部落进浮层，
 * `elementFromPoint(中心)` 返回浮层里的节点——这八处一次点击都收不到（在未绑定的构建上逐条量得）。
 * 同一构建下 URL 浮层只有 520×32、差 1 像素没压住任何控件，用户名列根本没截断——
 * 可达性随列宽与文本长度而变，所以本守卫按「凡是截断浮层一律透明」覆盖，而不是只覆盖量到的那一列。
 * 用户侧表现为「指针明明停在删除键上，点了没反应」。
 *
 * 唯一能落到这条浮层上的口子是 `el-table` 的 `tooltip-options`（它被原样展开成内部 `el-tooltip`
 * 的 props）：浮层 `appendTo: tableWrapper`，scoped 样式管不到；它也没有可区分的类名
 * （与下拉菜单同为 `.el-popper.is-dark.el-tooltip`），全局 CSS 无法只命中它而不牵连必须可点的下拉浮层。
 *
 * 因此机械扫描每个 `<el-table>…</el-table>` 块：声明了 `show-overflow-tooltip` 列的表格，
 * 开标签必须绑定 `:tooltip-options="TABLE_OVERFLOW_TOOLTIP_OPTIONS"`，且该文件必须真的导入它
 * （模板里引用未导入的变量只会静默得到 `undefined`，等于守卫空跑）。
 * 同时钉住抽取数量与常量本体，防止正则失配或常量被悄悄改成别的形状。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { TABLE_OVERFLOW_TOOLTIP_OPTIONS } from '@/utils/tableOverflowTooltip';

const ROOT = path.resolve(__dirname, '../..');

/** 递归收集 Vue 组件文件（与 `uploadLimitRequiresExceedHandler.test.ts` 同一口径） */
const collectVueFiles = (dir: string): string[] => {
  const entries = readdirSync(path.join(ROOT, dir), { withFileTypes: true });
  return entries.flatMap(entry => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectVueFiles(relative);
    return entry.name.endsWith('.vue') ? [relative] : [];
  });
};

const SOURCES = [...collectVueFiles('components'), ...collectVueFiles('entrypoints')];

/**
 * 取出 `<el-table>` 开标签与其完整块
 *
 * `(?![\w-])` 是必须的：`\b` 在 `el-table` 与 `-column` 之间同样成立，
 * 少了它会把手里每一个 `<el-table-column>` 都当成一张表。
 */
const tableBlocks = (src: string): string[] =>
  [...src.matchAll(/<el-table(?![\w-])[\s\S]*?<\/el-table>/g)].map(m => m[0]);

/**
 * 截出 `<el-table …>` 的开标签
 *
 * 不能用 `indexOf('>')`：属性值里就可能出现 `>`（`v-if="trashList.length > 0 || loading"`
 * 实测把开标签截到 `length >` 就断了，守卫于是拿一段不含任何属性的文本去比对）。
 * 这里按「引号外第一个 `>`」收口。
 */
const openingTagOf = (block: string): string => {
  let quote: string | null = null;
  for (let i = 0; i < block.length; i += 1) {
    const char = block[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return block.slice(0, i + 1);
  }
  return block;
};

describe('表格截断浮层对指针透明', () => {
  const overflowTables: Array<{ file: string; openingTag: string; hasImport: boolean }> = [];

  for (const file of SOURCES) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    for (const block of tableBlocks(src)) {
      if (!/show-overflow-tooltip/.test(block)) continue;
      overflowTables.push({
        file,
        openingTag: openingTagOf(block),
        hasImport: src.includes("import { TABLE_OVERFLOW_TOOLTIP_OPTIONS } from '@/utils/tableOverflowTooltip';"),
      });
    }
  }

  it('扫描到了带截断浮层的表格（抽取为空意味着守卫空跑）', () => {
    expect(overflowTables.length).toBe(5);
  });

  it('每一张带 show-overflow-tooltip 的表格都绑定了共享 tooltip-options', () => {
    const silent = overflowTables
      .filter(({ openingTag }) => !openingTag.includes(':tooltip-options="TABLE_OVERFLOW_TOOLTIP_OPTIONS"'))
      .map(({ file }) => file);
    expect(silent, `以下表格的截断浮层会吃掉上一行控件的点击：${silent.join(', ')}`).toEqual([]);
  });

  it('绑定处都真的导入了常量（模板引用未导入的变量只会静默拿到 undefined）', () => {
    const missing = overflowTables.filter(({ hasImport }) => !hasImport).map(({ file }) => file);
    expect(missing, `以下文件绑定了 tooltip-options 却没有导入常量：${missing.join(', ')}`).toEqual([]);
  });

  it('常量本体只改指针命中这一件事，且对象身份稳定', () => {
    expect(TABLE_OVERFLOW_TOOLTIP_OPTIONS).toStrictEqual({ popperStyle: { pointerEvents: 'none' } });
    expect(Object.isFrozen(TABLE_OVERFLOW_TOOLTIP_OPTIONS)).toBe(true);
    expect(Object.isFrozen(TABLE_OVERFLOW_TOOLTIP_OPTIONS.popperStyle)).toBe(true);
  });
});
