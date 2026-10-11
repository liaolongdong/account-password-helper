/**
 * 候选面板滚动链剪断的接线守卫（`popper-class` → 全局样式块 → 虚拟列表滚动容器）
 *
 * 这条修复只有一个「改了就静默失效」的挂点，而 `tsc --noEmit` 看不见 `.vue` 的 `<style>`，
 * Stylelint 也不管选择器能否命中（本仓惯例见 `vaultPageSizeWiring.test.ts`）：
 *
 * - `overscroll-behavior` 必须落在**全局样式块**，且目标必须是虚拟列表的滚动容器
 *   `.el-vl__window`。实测浮层由 Element Plus 挂到 `body` 下的裸 `div` 里，既不在
 *   `.options-page` 子树内，`.el-vl__window` 上也不带任何 `data-v-*`，所以搬进
 *   `scoped` 块等于静默撤销修复；
 * - 「搬进 `scoped`」有两条路，两条都得堵：直接写进 `<style scoped>`，以及写进那个块
 *   `@import` 的 [styles.css](../../entrypoints/options/styles.css)。后者看着像「一个普通
 *   全局 css」，但构建产物里它的规则带着作用域标记（`.options-page[data-v-c0b8941e]`，
 *   而全局块那条是 `.tag-filter-popper .el-vl__window,.site-filter-popper .el-vl__window
 *   {overscroll-behavior:contain}`、一个 `data-v-` 都没有），所以进去一样失效；
 * - 两条选择器用的类名来自筛选栏的 `popper-class`。守卫按 `SearchFilterBar.vue` 里的
 *   实际类名反查样式，任一侧改名都会变红。
 *
 * 全局块里现在共有两条剪链规则（见 `EXPECTED_CONTAIN_TARGETS`）：候选面板那条，以及
 * 遮罩 `.el-overlay-dialog` 那条。后者挂在 EP 内部类名上，组件侧没有可比对的真源，
 * 所以它的选择器能否命中只能由真机用例兜（本文件只钉「它在全局块、取值是 contain、
 * 没有第二条重复」这三件静态事实）。
 *
 * 行为侧的兜底是真机用例 `e2e/dialog-scroll-isolation.spec.ts`：第 2 条管候选面板
 * （面板滚到底再滚，列表不动，并且那个节点上的计算样式确实是 `contain`），
 * 第 5 条管遮罩（复验门槛弹窗开着，滚轮打在遮罩上，文档不动）。
 *
 * 曾经与本文件并列的「弹窗关掉后把列表滚动位置还回去」那半边已在实测中撤销：逐帧对照
 * 量下来，触发器可见时（真鼠标与自动化点击各测一遍）弹窗开关全程不动文档 scrollTop，
 * 只有触发器落在视口外时才会归零 —— 那是 Playwright 为把按钮滚进视口自己动的，用户走不到
 * 那条路。详见 `e2e/dialog-scroll-isolation.spec.ts` 文件头的记录。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const APP_SRC = read('entrypoints/options/App.vue');
const BAR_SRC = read('components/options/SearchFilterBar.vue');
const IMPORTED_CSS = read('entrypoints/options/styles.css');

/**
 * App.vue 的两个样式块
 *
 * `<style scoped>` 编译后会给选择器末位补 `[data-v-*]`，跨不到 teleport 出去的浮层；
 * `<style>` 是全仓共享的全局块。按标签精确切分，别用「整份文件」当搜索面 —— 那样
 * 规则搬进 scoped 块这条守卫就永远抓不到。
 */
const SCOPED_STYLE = APP_SRC.match(/<style scoped>([\s\S]*?)<\/style>/)![1];
const GLOBAL_STYLE = APP_SRC.match(/<style>([\s\S]*?)<\/style>/)![1];

/**
 * 主判据：两个面板共用同一条声明，且落在那个滚动容器上
 *
 * 抽成谓词是为了让「牙齿」跑的是**同一条**判断，而不是另一条恰好也含被替换串的表达式 ——
 * 后者删掉规则也照样「通过」，等于假牙（见下面两处变异自证）。
 */
const CONTAIN_RULE =
  /\.tag-filter-popper \.el-vl__window,\n\.site-filter-popper \.el-vl__window \{\n {2}overscroll-behavior: contain;\n\}/;

/**
 * 全局块去注释后的文本
 *
 * 注释里出现了 CSS 形状的片段（比如那条 `{overscroll-behavior:contain}` 的引用），
 * 按「选择器 + 声明」成对提取时必须先摘掉，否则注释会被当成选择器的一部分。
 */
const GLOBAL_CSS = GLOBAL_STYLE.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 全局块里「哪条规则剪断了滚动链」的唯一登记表
 *
 * 逐条写成 `选择器 → 取值`，是为了让重复与错挂都落进同一条判据：多一处（有人把规则复制
 * 到别的节点，或挂到根本不是滚动容器的节点上）就红，取值写成 `auto` 也红。
 * 新增剪链目标时，必须同时在这里登记并说明它的真机判据落在哪条 e2e 用例上。
 */
const EXPECTED_CONTAIN_TARGETS = [
  '.tag-filter-popper .el-vl__window,.site-filter-popper .el-vl__window → contain',
  '.el-overlay-dialog → contain',
];

/** 把 `选择器 { …overscroll-behavior: X… }` 成对读出来，选择器压成单行以便与登记表逐字比对 */
const containTargets = (css: string) =>
  [...css.matchAll(/([^{}]*)\{([^{}]*overscroll-behavior[^{}]*)\}/g)].map(([, selector, body]) => {
    const value = body.match(/overscroll-behavior:\s*([^;]+);/)![1].trim();
    return `${selector.replace(/\s+/g, ' ').trim().replace(/,\s*/g, ',')} → ${value}`;
  });

describe('候选面板的滚动链剪断接线', () => {
  /** 类名以筛选栏为真源，这样「组件改名 / 样式改名」任一侧都能在另一侧被查到 */
  const popperClasses = [...BAR_SRC.matchAll(/popper-class="([\w-]+)"/g)].map(m => m[1]);

  it('筛选栏正是两个候选面板，各挂一个 popper 类', () => {
    expect(popperClasses, 'popper-class 的数量或形状变了：守卫要跟着改').toEqual([
      'tag-filter-popper',
      'site-filter-popper',
    ]);
  });

  it('contain 规则挂在虚拟列表的滚动容器上，且位于全局样式块', () => {
    for (const cls of popperClasses) {
      expect(GLOBAL_STYLE, `全局块里没有「${cls}」的滚动链规则`).toContain(`.${cls} .el-vl__window`);
    }
    expect(GLOBAL_STYLE, '两个面板不再共用同一条 contain 声明').toMatch(CONTAIN_RULE);
    // 浮层不在本组件子树内（实测挂在 body 下的裸 div，节点不带 data-v-*），scoped 规则匹配不到。
    // 本仓的 `<style scoped>` 目前只有一句 `@import`，所以真正的失守面在它 import 的那个文件里。
    expect(SCOPED_STYLE, 'contain 规则搬进了 scoped 块：对 teleport 出去的浮层静默失效').not.toContain(
      'overscroll-behavior',
    );
    expect(IMPORTED_CSS, 'contain 规则搬进了 scoped 块 import 的样式表：那边编译后同样带 data-v-*').not.toContain(
      'overscroll-behavior',
    );

    // 牙齿：把声明改成 `auto`（等价于「规则还在、选择器也对，但不再剪断滚动链」），主判据必须抓到。
    // 变异串保留选择器原样，所以这条证的是「值」这一维；反过来拿被替换的类名去做变异，判据里
    // 本来就得写死那个类名，改成什么都会「通过」——那是假牙，本文件早先就是这么写的。
    expect(
      CONTAIN_RULE.test(GLOBAL_STYLE.replace('overscroll-behavior: contain;', 'overscroll-behavior: auto;')),
      'contain 取值的判据没有牙齿：改成 auto 也算通过',
    ).toBe(false);

    // 正面钉住「全局块里到底有哪些规则剪断了滚动链」：整份登记表逐字比对。
    // 数量比对（早期版本写的是 `overscroll-behavior` 出现 1 次）在第二条剪链规则落地后
    // 就失去了含义 —— 把它放宽成 2 等于「几处都行」，重复与错挂都不再红。
    expect(containTargets(GLOBAL_CSS), '全局块里的剪链规则与登记表不一致').toEqual(EXPECTED_CONTAIN_TARGETS);
    // 牙齿（选择器维）：把遮罩那条挂到非滚动容器 `.el-dialog` 上 —— `overflow: visible` 的节点
    // 接不住 `overscroll-behavior`，等同静默撤销修复。登记表比对必须抓到这次换挂。
    expect(
      containTargets(GLOBAL_CSS.replace('.el-overlay-dialog {', '.el-dialog {')),
      '把遮罩规则换挂到别的选择器上，登记表比对没有反应',
    ).not.toEqual(EXPECTED_CONTAIN_TARGETS);
    // 牙齿（重复维）：同一条规则复制一份，必须多出一条而不是被去重吞掉。
    expect(
      containTargets(`${GLOBAL_CSS}\n.el-overlay-dialog {\n  overscroll-behavior: contain;\n}`),
      '剪链规则被复制了一份，登记表比对没有反应',
    ).toHaveLength(EXPECTED_CONTAIN_TARGETS.length + 1);
    // 牙齿（取值维，走登记表这条判据本身）：两处都改成 auto，比对必须红。
    expect(
      containTargets(GLOBAL_CSS.replace(/overscroll-behavior: contain;/g, 'overscroll-behavior: auto;')),
      '两处剪链取值改成 auto，登记表比对没有反应',
    ).not.toEqual(EXPECTED_CONTAIN_TARGETS);
  });
});
