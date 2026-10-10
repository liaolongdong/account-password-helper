/**
 * 滚动隔离的接线守卫（composable → App.vue → 筛选栏 popper-class 三处契约）
 *
 * 这一族修复的两个半边各自都有一个「改了就静默失效」的挂点，而 `tsc --noEmit` 看不见
 * `.vue` 的 `<script setup>`，ESLint 也不做类型检查（本仓惯例见 `vaultPageSizeWiring.test.ts`）：
 *
 * - composable 观察的是 Element Plus 写到 `body` 的那个锁滚类**字符串**，类名一写错，
 *   观察永远不触发，弹窗照样吞掉滚动位置，而且没有任何一处报错；
 * - 记账必须在「未锁」时做。实测时间线是文档先归零、锁滚类才落地（见
 *   `composables/useModalScrollRestoration.ts` 的注释），无守卫的记账会把归零后的 0
 *   当成用户的位置存下来，还原于是变成「滚回顶部」；
 * - 还原必须是**无条件**的，唯一例外是「弹窗期间本页面自己定位过一行」：保存链路里
 *   `revealRow` 在弹窗关闭**之前**就 `scrollIntoView`，锁滚拦不住程序化滚动（实测 0→1298），
 *   所以没有这颗标记时，还原会把用户要看的那行进视口的成果推回去。这颗标记的接线
 *   也归本文件钉 —— 它跨 `usePasswordManagement.ts` 与本模块，两边各自都能编译通过。
 * - `overscroll-behavior` 必须落在**全局样式块**，且目标必须是虚拟列表的滚动容器
 *   `.el-vl__window`。实测浮层由 Element Plus 挂到 `body` 下的裸 `div` 里，既不在
 *   `.options-page` 子树内，`.el-vl__window` 上也不带任何 `data-v-*`，所以搬进
 *   `scoped` 块等于静默撤销修复；
 * - 两条选择器用的类名来自筛选栏的 `popper-class`。守卫按 `SearchFilterBar.vue` 里的
 *   实际类名反查样式，任一侧改名都会变红。
 *
 * 行为侧的兜底是真机用例 `e2e/dialog-scroll-isolation.spec.ts`（弹窗关闭后位置还在 /
 * 候选面板滚到底不再推动列表 / 保存后高亮行确实进了视口）；这里钉的是「那条用例所依赖
 * 的接线没被拆掉」。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const APP_SRC = read('entrypoints/options/App.vue');
const BAR_SRC = read('components/options/SearchFilterBar.vue');
const COMPOSABLE_SRC = read('composables/useModalScrollRestoration.ts');

/**
 * App.vue 的两个样式块
 *
 * `<style scoped>` 编译后会给选择器末位补 `[data-v-*]`，跨不到 teleport 出去的浮层；
 * `<style>` 是全仓共享的全局块。按标签精确切分，别用「整份文件」当搜索面 —— 那样
 * 规则搬进 scoped 块这条守卫就永远抓不到。
 */
const SCOPED_STYLE = APP_SRC.match(/<style scoped>([\s\S]*?)<\/style>/)![1];
const GLOBAL_STYLE = APP_SRC.match(/<style>([\s\S]*?)<\/style>/)![1];

describe('弹窗滚动还原接线', () => {
  it('App.vue 在 setup 顶层调用 composable', () => {
    expect(APP_SRC, 'App.vue 未引入 useModalScrollRestoration').toMatch(
      /import \{ useModalScrollRestoration \} from '@\/composables\/useModalScrollRestoration';/,
    );
    // 锚定行首零缩进：挪进 onMounted / 条件分支后就不再覆盖「每一次开弹窗」这条路径
    expect(APP_SRC, 'useModalScrollRestoration() 不再位于 <script setup> 顶层').toMatch(
      /^useModalScrollRestoration\(\);$/m,
    );

    // 牙齿：把调用塞进条件分支，上一条必须抓到
    expect(
      /^useModalScrollRestoration\(\);$/m.test(
        APP_SRC.replace('\nuseModalScrollRestoration();', '\n  if (showAddDialog.value) useModalScrollRestoration();'),
      ),
      '顶层调用的判据没有牙齿：嵌进分支也算通过',
    ).toBe(false);
  });

  it('配对信号是 Element Plus 实写的锁滚类，观察范围收窄到 class', () => {
    expect(COMPOSABLE_SRC, '锁滚类名与 Element Plus 写到的不是同一个：还原永不触发').toMatch(
      /const BODY_LOCK_CLASS = 'el-popup-parent--hidden';/,
    );
    expect(COMPOSABLE_SRC).toMatch(/document\.body\.classList\.contains\(BODY_LOCK_CLASS\)/);
    expect(COMPOSABLE_SRC, '观察目标或过滤条件变了：body 以外的属性会白触发，class 变化可能漏').toMatch(
      /observer\.observe\(document\.body, \{ attributes: true, attributeFilter: \['class'\] \}\);/,
    );
    // 牙齿：类名少写一段连字符（最常见的手滑），上一条必须抓到
    expect(
      /const BODY_LOCK_CLASS = 'el-popup-parent--hidden';/.test(
        COMPOSABLE_SRC.replace('el-popup-parent--hidden', 'el-popup-parent-hidden'),
      ),
      '锁滚类名的判据没有牙齿：少一段连字符也算通过',
    ).toBe(false);
  });

  it('只在未锁时记账，解锁时无条件写回最后那次合法偏移', () => {
    const RECORD_PIN = /const record = \(\): void => \{\s*if \(!locked\) savedTop = window\.scrollY;/;
    expect(COMPOSABLE_SRC, '滚动记账不再受锁状态守卫：会把归零后的 0 存成用户的位置').toMatch(RECORD_PIN);

    // 还原是三分支的最后一支：锁 → 清标记，解锁且有标记 → 消费标记，其余 → 写回。
    // 这里连「存档值够不够大」这类静默开关一起钉死——用户在顶部时存档就是 0，
    // 那种情况下要做的恰恰是「写回 0」，加 `savedTop > 0` 会把该还的位置留在弹窗期间
    // 到达的地方，而且让唯一例外（主动定位）变成两个并列条件里次要的那个。
    const RESTORE_PIN =
      /if \(isLocked\) revealIntent = false;\n {4}else if \(revealIntent\) revealIntent = false;\n {4}else window\.scrollTo\(0, savedTop\);/;
    expect(COMPOSABLE_SRC, '解锁时不再写回存档偏移，或还原前多出了静默条件').toMatch(RESTORE_PIN);

    // 牙齿：摘掉记账守卫（等价于「谁滚都记」），主判据必须变红。
    // 必须全局替：这行在 onMounted 里还有一份同形状的，只替第一处会留下第二处，
    // 判据照样命中，牙齿就成假的。
    expect(
      RECORD_PIN.test(
        COMPOSABLE_SRC.replace(/if \(!locked\) savedTop = window\.scrollY;/g, 'savedTop = window.scrollY;'),
      ),
      '记账守卫的判据没有牙齿：无守卫的记账也算通过',
    ).toBe(false);
    // 牙齿：把还原退回「带 `savedTop > 0` 开关」的旧写法，RESTORE_PIN 必须抓到
    expect(
      RESTORE_PIN.test(
        COMPOSABLE_SRC.replace(
          'else window.scrollTo(0, savedTop);',
          'else if (savedTop > 0) window.scrollTo(0, savedTop);',
        ),
      ),
      '还原条件的判据没有牙齿：加回静默开关也算通过',
    ).toBe(false);
  });

  it('主动定位的标记由本模块定义、由保存链路打上', () => {
    expect(COMPOSABLE_SRC, 'noteRevealIntent 不再是那个模块级标记的唯一写入口').toMatch(
      /export const noteRevealIntent = \(\): void => \{\n {2}revealIntent = true;\n\};/,
    );

    const MGMT_SRC = read('composables/usePasswordManagement.ts');
    expect(MGMT_SRC, 'usePasswordManagement 未引入 noteRevealIntent').toMatch(
      /import \{ noteRevealIntent \} from '@\/composables\/useModalScrollRestoration';/,
    );

    const SCROLL_CALL = "row.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });";
    const scrollAt = MGMT_SRC.indexOf(SCROLL_CALL);
    const noteAt = MGMT_SRC.indexOf('noteRevealIntent();');
    expect(scrollAt, `定位入口的形状变了：守卫要跟着改（${SCROLL_CALL}）`).toBeGreaterThan(-1);
    expect(MGMT_SRC.lastIndexOf(SCROLL_CALL), '这条链路里出现了第二次定位，守卫的先后判定不再唯一').toBe(scrollAt);
    expect(noteAt, '定位之后没打标记：弹窗关闭的还原会把高亮行推出视口').toBeGreaterThan(scrollAt);

    // 牙齿：删掉那次调用（等价于「只定位、不告知」），上面那条先后判定就再无出处可寻
    expect(
      MGMT_SRC.replace('      noteRevealIntent();\n', '').indexOf('noteRevealIntent();'),
      '删掉调用后仍能找到第二处：本用例的判据面不止这一条链路',
    ).toBe(-1);
  });

  it('监听器与观察器在卸载时成对清理', () => {
    expect(COMPOSABLE_SRC).toMatch(/window\.addEventListener\('scroll', record, \{ passive: true \}\);/);
    expect(COMPOSABLE_SRC, 'scroll 监听没摘：App.vue 重新挂载会叠出第二份记账').toMatch(
      /window\.removeEventListener\('scroll', record\);/,
    );
    expect(COMPOSABLE_SRC, 'MutationObserver 没有 disconnect').toMatch(/observer\.disconnect\(\);/);
  });

  it('新手引导那份自己的存档没被合并掉', () => {
    // 引导把主内容 `display:none` 收起 → 文档 scrollTop 归零，但那条路径不经过 body 锁滚类，
    // composable 观察不到，只能靠它原本那份 save/restore。
    expect(APP_SRC, '进文档页前的存档没了：返回管理页会停在顶部').toMatch(/listScrollTop = window\.scrollY;/);
    expect(APP_SRC, '从文档页回来时的还原没了').toMatch(/window\.scrollTo\(0, listScrollTop\)/);
    expect(COMPOSABLE_SRC, 'composable 开始承担引导那条路径：两条还原会互踩').not.toMatch(/listScrollTop|guideActive/);
  });
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
    expect(GLOBAL_STYLE, '两个面板不再共用同一条 contain 声明').toMatch(
      /\.tag-filter-popper \.el-vl__window,\n\.site-filter-popper \.el-vl__window \{\n {2}overscroll-behavior: contain;\n\}/,
    );
    // 浮层不在本组件子树内（实测挂在 body 下的裸 div，节点不带 data-v-*），scoped 规则匹配不到
    expect(SCOPED_STYLE, 'contain 规则搬进了 scoped 块：对 teleport 出去的浮层静默失效').not.toContain(
      'overscroll-behavior',
    );
    // 牙齿：目标换成面板根节点（它不是滚动元素，contain 不起作用），上一条主判据必须抓到
    expect(
      /\.el-vl__window \{\n {2}overscroll-behavior: contain/.test(
        GLOBAL_STYLE.replace(/\.el-vl__window/g, '.el-select-dropdown'),
      ),
      '滚动容器选择的判据没有牙齿：挂到非滚动元素上也算通过',
    ).toBe(false);
  });
});
