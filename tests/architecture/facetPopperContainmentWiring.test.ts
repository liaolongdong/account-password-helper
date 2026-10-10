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
 * 行为侧的兜底是真机用例 `e2e/dialog-scroll-isolation.spec.ts` 的第 2 条（面板滚到底再滚，
 * 列表不动，并且那个节点上的计算样式确实是 `contain`）。
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
    // 正面钉住「这条声明是全局块里唯一的 overscroll」：多一处就说明有人把它挂到了别的（非滚动）节点上
    expect(
      (GLOBAL_STYLE.match(/overscroll-behavior/g) || []).length,
      '全局块里出现了第二条 overscroll-behavior：规则被复制/搬到了别的选择器上',
    ).toBe(1);
  });
});
