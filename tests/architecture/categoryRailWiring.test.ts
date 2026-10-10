/**
 * 左侧分类栏的接线守卫（composable → App.vue → CategoryRail → CategoryRailSection 四处契约）
 *
 * 本仓的 `pnpm typecheck` 是 `tsc --noEmit`，**看不见 `.vue` 的 `<script setup>` 块**：
 * props / emits / 解构名三边一旦改名或漏接，typecheck、lint、build 全绿，
 * 坏掉的是运行时（左栏不出现、某一段永远是空的、或点了没有反应）。
 * 因此按本仓既有惯例（见 `vaultPageSizeWiring.test.ts`、`crossSubdomainTierWiring.test.ts`）
 * 做源码扫描，钉住七类会静默失守的契约：
 *
 * - 过滤链或页码复位信号漏一段 → 选了候选不生效，或换了口径停在第 7 页读空白；
 * - 筛选栏里又长出标签 / 站点下拉 → 同一维度两个入口，左栏与下拉的选中集会分叉；
 * - 下拉时代的「展开期延迟清空」机件残留 → 改筛选不再清空选中，批量操作作用到看不见的条目；
 * - 某一段候选变化后不收口已选值 → 左栏里看不见、列表却一直是空的（隐形空过滤）；
 * - 段组件不再把选中集交给视图 → 「展开、选中靠后的候选、收起」留下生效中却看不见的筛选；
 * - 两段候选各自造字段名 → 分类栏只渲染得出一段，另一段静默消失；
 * - 堆叠断点两处不同值，或堆叠态没收住宽高 → 只在某个窗口宽度区间才错位的布局（没有测试会红）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const MANAGER_SRC = read('composables/usePasswordManagement.ts');
const APP_SRC = read('entrypoints/options/App.vue');
const BAR_SRC = read('components/options/SearchFilterBar.vue');
const RAIL_SRC = read('components/options/CategoryRail.vue');
const SECTION_SRC = read('components/options/CategoryRailSection.vue');
const LAYOUT_SRC = read('entrypoints/options/styles.css');
const SITE_SRC = read('utils/siteUtils.ts');
const TAG_SRC = read('utils/tagUtils.ts');

describe('分类栏接线', () => {
  it('站点与标签两段条件真的进了过滤链与页码复位信号', () => {
    expect(SITE_SRC, 'siteUtils 未导出 matchesSiteFilter').toMatch(/export const matchesSiteFilter/);
    expect(MANAGER_SRC).toMatch(/import\s*\{[^}]*matchesSiteFilter[^}]*\}\s*from\s*'@\/utils\/siteUtils'/);

    // 过滤链那一段：非空才参与，避免未选中时也走一遍 O(N) 归一
    expect(MANAGER_SRC, 'filterSites 不再参与 filteredPasswords 过滤').toMatch(
      /if \(filterSites\.value\.length > 0\) \{\s*result = result\.filter\(p => matchesSiteFilter\(p\.url, filterSites\.value\)\);/,
    );
    // 复位信号：口径变了必须回第 1 页
    expect(MANAGER_SRC, '两段筛选不再进 listFilterSignature，换口径会停在原页码').toMatch(
      /filterTags\.value\.join\(','\),\s*filterSites\.value\.join\(','\),/,
    );
  });

  it('分类栏是两段候选的唯一入口，筛选栏不再长出下拉', () => {
    expect(BAR_SRC, '筛选栏里仍有下拉：与左栏同一维度两个入口，选中集会分叉').not.toMatch(/<el-select/);
    expect(BAR_SRC).not.toMatch(/filterTags|filterSites|availableSites|availableTags/);
    // 「全部条目」一行只在父栏出现，段组件不认识它
    expect(SECTION_SRC, '段组件里复制了一份「全部条目」行').not.toMatch(/options\.rail\.all/);
    expect((RAIL_SRC.match(/<CategoryRailSection\b/g) ?? []).length, '左栏段数不再是标签 + 站点两段').toBe(2);
  });

  it('下拉时代的延迟清空机件已整体退出，改筛选回到单一来源的即时清空', () => {
    expect(MANAGER_SRC, '延迟清空机件残留：改筛选会不清空选中，批量操作作用到看不见的条目').not.toMatch(
      /filterDropdownVisible|pendingSelectionClear|handleFilterDropdownVisibleChange|clearSelectionUnlessDropdownOpen/,
    );
    expect(RAIL_SRC).not.toMatch(/DropdownVisible/);
    expect(SECTION_SRC).not.toMatch(/DropdownVisible/);
    // 两段共用一个 watch：写成两个各自清空会在同一次交互里触发两轮列表重排
    expect(MANAGER_SRC, '标签 / 站点不再是同一个 watch 负责清空选中').toMatch(
      /watch\(\[filterTags, filterSites\], \(\) => \{\s*selectedIds\.value = \[\];\s*\}\)/,
    );
  });

  it('两段候选都会收口失效选中值，不留隐形空过滤', () => {
    const prunes = MANAGER_SRC.match(/\.value = filter(Tags|Sites)\.value\.filter/g) ?? [];
    expect(prunes, '某一段候选变化后不再剔除失效项').toHaveLength(2);
    for (const facet of ['tagOptions', 'availableSites']) {
      expect(MANAGER_SRC, `${facet} 变化时不再收口对应筛选条件`).toMatch(new RegExp(`watch\\(${facet}, options =>`));
    }
  });

  it('两段候选同形：都走 facet 内核产出 `{ value, count }`', () => {
    expect(TAG_SRC, '标签段不再复用 countFacet，两段排序会分叉').toMatch(/countFacet\(passwords\.flatMap/);
    expect(SITE_SRC, '站点段不再复用 countFacet，两段排序会分叉').toMatch(/countFacet\(entries\.map/);
    expect(MANAGER_SRC).toMatch(/const tagOptions = computed<FacetOption\[\]>\(\(\) => collectTagOptions/);
    expect(MANAGER_SRC).toMatch(/const availableSites = computed<FacetOption\[\]>\(\(\) => collectSiteOptions/);
    // 截断与搜索只在段组件里发生一次，两段共用同一份实现
    expect(SECTION_SRC, '段组件不再调用 resolveFacetView，可见上限失去单一真源').toMatch(
      /resolveFacetView\(props\.options, query\.value, expanded\.value, props\.modelValue\)/,
    );
    expect(RAIL_SRC.match(/resolveFacetView/g) ?? [], '父栏自己算视图会与段组件重复').toHaveLength(0);
  });

  it('composable 的分类栏出口都接到了 App.vue', () => {
    // 定位 return 块本体再逐项核对，不用 `return \{[\s\S]*name,` 这类跨全文的贪婪匹配——
    // 那种写法在文件里出现第二个 `return {` 后就与「是否真的导出」脱钩。
    const exportBlock = MANAGER_SRC.match(/\n {2}return \{([\s\S]*?)\n {2}\};/);
    expect(exportBlock, '未找到 usePasswordManagement 的 return 块').toBeTruthy();
    const destructured = APP_SRC.match(/const \{([\s\S]*?)\} = usePasswordManagement\(/);
    expect(destructured, '未找到 App.vue 的 usePasswordManagement 解构块').toBeTruthy();
    for (const name of ['filterTags', 'filterSites', 'tagOptions', 'availableSites']) {
      expect(exportBlock![1], `usePasswordManagement 不再导出 ${name}`).toContain(`\n    ${name},`);
      expect(destructured![1], `App.vue 未解构 ${name}`).toContain(`\n  ${name},`);
    }

    const rail = APP_SRC.match(/<CategoryRail\b[\s\S]*?\/>/);
    expect(rail, '未找到 CategoryRail 的用法').toBeTruthy();
    for (const binding of [
      'v-model:filter-tags="filterTags"',
      'v-model:filter-sites="filterSites"',
      ':tag-options="tagOptions"',
      ':site-options="availableSites"',
    ]) {
      expect(rail![0], `App.vue 漏接 ${binding}`).toContain(binding);
    }
  });

  it('深链带关键词进来时同时清掉标签与站点筛选', () => {
    const reset = APP_SRC.match(/const applySearchKeyword = \(keyword: string\): void => \{([\s\S]*?)\n\};/);
    expect(reset, '未找到 applySearchKeyword').toBeTruthy();
    expect(reset![1]).toContain('filterTags.value = []');
    expect(reset![1], '站点筛选未随深链清空，叠加关系下会显示成空表').toContain('filterSites.value = []');
  });

  it('两栏布局与左栏共用同一个堆叠断点，堆叠态同时收住宽度与高度', () => {
    // 断点写在两处：`.vault-layout` 改成纵向、`.category-rail` 从吸附退化成普通卡片。
    // 两处一旦不同值，就会出现「已经堆叠但左栏还带着 sticky + 一屏内滚动」
    // 或「两栏并排但左栏提前变成全宽卡片」——只在某个窗口宽度区间才看得见、且没有测试会红的错位。
    const breakpointOf = (src: string, file: string): string => {
      const match = src.match(/@media \(width <= (\d+)px\)/);
      expect(match, `${file} 里找不到堆叠断点`).toBeTruthy();
      return match![1];
    };
    const layoutBreakpoint = breakpointOf(LAYOUT_SRC, 'entrypoints/options/styles.css');
    expect(
      breakpointOf(RAIL_SRC, 'components/options/CategoryRail.vue'),
      '两处堆叠断点不同值：窄屏会出现半堆叠的错位布局',
    ).toBe(layoutBreakpoint);

    // 堆叠态必须同时钉宽度与高度：父级是 `align-items: flex-start`，不显式给宽度
    // 就只撑到内容宽（右侧一大片空白）；不收高度则几十行候选把表格整个推出首屏。
    const stacked = RAIL_SRC.match(/@media \(width <= \d+px\) \{\s*\.category-rail \{([\s\S]*?)\n {2}\}/);
    expect(stacked, '未找到窄屏下的 .category-rail 覆写').toBeTruthy();
    expect(stacked![1]).toMatch(/position: static;/);
    expect(stacked![1], '堆叠态没给宽度：左栏缩成内容宽，右侧留一大片空白').toMatch(/width: 100%;/);
    expect(stacked![1], '堆叠态没收高度：候选列表把表格推出首屏').toMatch(/max-height: \d+vh;/);
  });
});
