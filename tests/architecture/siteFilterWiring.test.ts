/**
 * 站点筛选的接线守卫（composable → App.vue → SearchFilterBar 三处契约）
 *
 * 本仓的 `pnpm typecheck` 是 `tsc --noEmit`，**看不见 `.vue` 的 `<script setup>` 块**：
 * props / emits / 解构名三边一旦改名或漏接，typecheck、lint、build 全绿，
 * 坏掉的是运行时（下拉不出现、筛选不生效或选中集不再收口）。
 * 因此按本仓既有惯例（见 `vaultPageSizeWiring.test.ts`、`crossSubdomainTierWiring.test.ts`）
 * 做源码扫描，钉住四类会静默失守的契约：
 *
 * - 筛选链漏一段 → 站点条件不参与过滤，或改了筛选却不复位页码（停在第 7 页读空白）；
 * - 两个下拉各建一套「展开期延迟清空」标记 → 批量按钮在交互中途消失引起布局跳动；
 * - 候选站点退回普通 `el-select` + `el-option` 渲染 → 大库下候选数可达条目数，
 *   `persistent` 默认 true 让上千个 option 常驻并重演 O(T²)（见
 *   docs/reports/PERF_LARGE_VAULT_EVALUATION.md §3 第 4 条）；
 * - 深链带关键词进来时只清标签不清站点 → 「到全库找」这个入口显示成空表。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const MANAGER_SRC = read('composables/usePasswordManagement.ts');
const APP_SRC = read('entrypoints/options/App.vue');
const BAR_SRC = read('components/options/SearchFilterBar.vue');
const SITE_SRC = read('utils/siteUtils.ts');

describe('站点筛选接线', () => {
  it('站点条件真的进了过滤链与页码复位信号', () => {
    expect(SITE_SRC, 'siteUtils 未导出 matchesSiteFilter').toMatch(/export const matchesSiteFilter/);
    expect(MANAGER_SRC).toMatch(/import\s*\{[^}]*matchesSiteFilter[^}]*\}\s*from\s*'@\/utils\/siteUtils'/);

    // 过滤链那一段：非空才参与，避免未选中时也走一遍 O(N) 归一
    expect(MANAGER_SRC, 'filterSites 不再参与 filteredPasswords 过滤').toMatch(
      /if \(filterSites\.value\.length > 0\) \{\s*result = result\.filter\(p => matchesSiteFilter\(p\.url, filterSites\.value\)\);/,
    );
    // 复位信号：口径变了必须回第 1 页
    expect(MANAGER_SRC, 'filterSites 不再进 listFilterSignature，换筛选会停在原页码').toMatch(
      /filterTags\.value\.join\(','\),\s*filterSites\.value\.join\(','\),/,
    );
  });

  it('两个筛选下拉共用一份「展开期延迟清空」标记', () => {
    // 按形状计数而不是按变量名：新增一份同类布尔标记往往就叫别的名字，
    // 只数 `filterDropdownVisible` 会放过「两个下拉各自维护可见态」的分叉。
    // 已知盲区：改名到不含 visible 的布尔（如 `siteDropdownOpen`）文本扫描抓不到，
    // 那由同一段的「两个 watch 指向同一回调」与筛选栏的「两条 visible-change 上抛同一事件」兜住。
    expect(
      MANAGER_SRC.match(/let\s+\w*[Vv]isible\w*\s*=\s*false/g),
      '展开了第二份下拉可见态标记：两处清空策略会分叉',
    ).toHaveLength(1);
    expect(MANAGER_SRC).toMatch(/watch\(filterTags, clearSelectionUnlessDropdownOpen\)/);
    expect(MANAGER_SRC).toMatch(/watch\(filterSites, clearSelectionUnlessDropdownOpen\)/);
    expect(MANAGER_SRC, '标签侧旧的专用处理器没有被收敛，两处清空策略会分叉').not.toMatch(
      /handleTagFilterVisibleChange/,
    );
  });

  it('候选站点用虚拟列表渲染，且失效站点会被剔除', () => {
    expect(BAR_SRC, '站点下拉退回普通 el-select：大库下上千 option 会常驻').toMatch(/<el-select-v2\b/);
    expect(BAR_SRC).toMatch(/:options="availableSites"/);
    // 候选集变化后剔除已失效站点，否则留下看不见的空过滤
    expect(MANAGER_SRC, 'availableSites 变化时不再收口 filterSites').toMatch(
      /watch\(availableSites, options => \{[\s\S]*?filterSites\.value = filterSites\.value\.filter/,
    );
  });

  it('composable 的三个新出口都接到了 App.vue 与筛选栏', () => {
    // 定位 return 块本体再逐项核对，不用 `return \{[\s\S]*name,` 这类跨全文的贪婪匹配——
    // 那种写法在文件里出现第二个 `return {` 后就与「是否真的导出」脱钩。
    const exportBlock = MANAGER_SRC.match(/\n {2}return \{([\s\S]*?)\n {2}\};/);
    expect(exportBlock, '未找到 usePasswordManagement 的 return 块').toBeTruthy();
    for (const name of ['filterSites', 'availableSites', 'handleFilterDropdownVisibleChange']) {
      expect(exportBlock![1], `usePasswordManagement 不再导出 ${name}`).toContain(`\n    ${name},`);
    }

    // App.vue 的解构块（`const { ... } = usePasswordManagement(`）必须逐项跟上，漏一项就是运行时 undefined
    const destructured = APP_SRC.match(/const \{([\s\S]*?)\} = usePasswordManagement\(/);
    expect(destructured, '未找到 App.vue 的 usePasswordManagement 解构块').toBeTruthy();
    for (const name of ['filterSites', 'availableSites', 'handleFilterDropdownVisibleChange']) {
      expect(destructured![1], `App.vue 未解构 ${name}`).toContain(`\n  ${name},`);
    }

    const bar = APP_SRC.match(/<SearchFilterBar\b[\s\S]*?\/>/);
    expect(bar, '未找到 SearchFilterBar 的用法').toBeTruthy();
    expect(bar![0]).toContain('v-model:filter-sites="filterSites"');
    expect(bar![0]).toContain(':available-sites="availableSites"');
    expect(bar![0]).toContain('@filter-dropdown-visible-change="handleFilterDropdownVisibleChange"');
    // 标签与站点两条 visible-change 在筛选栏内部必须落到同一个上抛事件名
    expect(BAR_SRC.match(/@visible-change="\$emit\('filterDropdownVisibleChange', \$event\)"/g)).toHaveLength(2);
    expect(BAR_SRC, '标签下拉还在上抛旧事件名，收起时会丢一次待清空').not.toMatch(/tagFilterVisibleChange/);
  });

  it('深链带关键词进来时同时清掉标签与站点筛选', () => {
    const reset = APP_SRC.match(/const applySearchKeyword = \(keyword: string\): void => \{([\s\S]*?)\n\};/);
    expect(reset, '未找到 applySearchKeyword').toBeTruthy();
    expect(reset![1]).toContain('filterTags.value = []');
    expect(reset![1], '站点筛选未随深链清空，叠加关系下会显示成空表').toContain('filterSites.value = []');
  });
});
