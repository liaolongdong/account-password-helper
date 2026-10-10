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
 *   docs/reports/PERF_LARGE_VAULT_EVALUATION.md §3 第 4 条）；这条对标签下拉同样成立；
 * - 标签 / 站点两条候选行的计数或 `title` 少挂一处 → 截断的那条读不出原文，
 *   而 `title` 是唯一不新增常驻组件的兜底（`el-tooltip` 会按候选数实例化）；
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

/**
 * 取出某个 `el-select-v2` 的模板块
 *
 * 按该下拉独有的属性文本定位（`v-if` 条件），再向前找开标签、向后找最近的闭合标签——
 * 块内断言比全文匹配更贴契约：「两个下拉各自的属性」这类要求用全文 `toHaveLength(2)`
 * 会被「一处写两遍」糊过去，也会因 prettier 换行而脆断。
 *
 * @param source 筛选栏源文本
 * @param uniqueAttr 该下拉独有的属性文本（如 `v-if="availableTagOptions.length > 0"`）
 * @returns 该下拉的开标签到闭合标签之间的文本
 */
function selectBlock(source: string, uniqueAttr: string): string {
  const attrIndex = source.indexOf(uniqueAttr);
  expect(attrIndex, `筛选栏找不到 \`${uniqueAttr}\``).toBeGreaterThan(-1);
  const start = source.lastIndexOf('<el-select-v2', attrIndex);
  expect(start, `\`${uniqueAttr}\` 不在 el-select-v2 内：换回普通 el-select 会让候选常驻`).not.toBe(-1);
  const end = source.indexOf('</el-select-v2>', attrIndex);
  expect(end, `\`${uniqueAttr}\` 所在的 el-select-v2 未闭合`).toBeGreaterThan(attrIndex);
  return source.slice(start, end);
}

describe('筛选栏候选行的共同形状（标签计数与截断兜底）', () => {
  /** 标签 / 站点两个下拉的块本体，块内断言与 popper-class 断言共用 */
  const tagBlock = selectBlock(BAR_SRC, 'v-if="availableTagOptions.length > 0"');
  const siteBlock = selectBlock(BAR_SRC, 'v-if="availableSites.length > 0"');

  /** 两个下拉的块本体、独有属性与字段名，逐项同构 */
  const DROPDOWNS = [
    { name: '标签', field: 'tag', block: tagBlock },
    { name: '站点', field: 'site', block: siteBlock },
  ] as const;

  it('两个下拉都是虚拟列表多选，筛选栏不再有普通 el-select', () => {
    expect(BAR_SRC, '筛选栏出现普通 el-select：候选会常驻 DOM 并重演 O(T²)').not.toMatch(/<el-select(?!-v2)/);
    // 牙齿：把任一下拉换回普通 el-select，上一条必须抓到
    expect(/<el-select(?!-v2)/.test(BAR_SRC.replace('<el-select-v2', '<el-select'))).toBe(true);

    for (const { name, block } of DROPDOWNS) {
      expect(block, `${name}下拉不再是多选`).toMatch(/\n\s+multiple\b/);
      expect(block, `${name}下拉不能键入过滤，长候选集只能靠滚动找`).toMatch(/\n\s+filterable\b/);
      // `(?![-\w])` 是必须的：`\b` 会同样放过下一行的 `collapse-tags-tooltip`
      expect(block, `${name}下拉的选中态会撑开筛选栏`).toMatch(/\n\s+collapse-tags(?![-\w])/);
      expect(block, `${name}下拉不再上抛展开/收起，选中清空的延迟策略会分叉`).toMatch(
        /@visible-change="\$emit\('filterDropdownVisibleChange', \$event\)"/,
      );
      // 牙齿：删掉这一块里的 filterable / collapse-tags，只应打到这一块
      expect(
        /\n\s+filterable\b/.test(block.replace(/\n\s+filterable\b/, '')),
        `${name}的 filterable 判据没有牙齿`,
      ).toBe(false);
      expect(
        /\n\s+collapse-tags(?![-\w])/.test(block.replace(/\n\s+collapse-tags\b/, '')),
        `${name}的 collapse-tags 判据没有牙齿`,
      ).toBe(false);
    }
    expect(tagBlock, '标签下拉不再绑计数候选集').toMatch(/:options="availableTagOptions"/);
    expect(siteBlock, '站点下拉不再绑候选集').toMatch(/:options="availableSites"/);
  });

  it('两条候选行共用同一份行结构，计数与 title 各挂一处', () => {
    for (const { name, field, block } of DROPDOWNS) {
      // 属性逐行写（prettier singleAttributePerLine），因此分别断言类名与 title，而不是比一整行
      expect(block, `${name}候选行不再用共用结构`).toMatch(/<div\b[\s\S]*?class="facet-option"/);
      expect(block, `${name}候选行缺整行 title：截断后读不出原文`).toMatch(new RegExp(`:title="item\\.${field}"`));
      expect(block, `${name}候选行缺文本列`).toMatch(/class="facet-option__text"/);
      expect(block, `${name}候选行缺计数列`).toMatch(/class="facet-option__count"/);
      // 牙齿：删掉这一行的 title 绑定，上一条必须抓到
      const noTitle = block.replace(new RegExp(`\\n\\s*:title="item\\.${field}"`), '');
      expect(new RegExp(`:title="item\\.${field}"`).test(noTitle), `${name}下拉的 title 判据没有牙齿`).toBe(false);
    }
    // 行结构只能有一份：两处各起一个类名，样式就会分叉
    expect(BAR_SRC.match(/class="facet-option"/g), '候选行结构不再是同一份').toHaveLength(2);
    expect(BAR_SRC, '站点候选行没并进共用结构').not.toMatch(/class="site-option/);
  });

  it('两个下拉各自带 popper-class，且共用同一份展开期延迟清空', () => {
    expect(BAR_SRC.match(/popper-class="[a-z-]+-filter-popper"/g), '下拉面板缺少各自的 popper-class').toHaveLength(2);
    // e2e 靠 popper-class 收窄面板：共用一个类名会把另一个下拉的残留面板当成目标
    expect(tagBlock).toMatch(/popper-class="tag-filter-popper"/);
    expect(siteBlock).toMatch(/popper-class="site-filter-popper"/);
    expect(BAR_SRC.match(/@visible-change="\$emit\('filterDropdownVisibleChange', \$event\)"/g)).toHaveLength(2);
  });

  it('标签候选的两个视图同源：一次遍历派生计数版与弹窗版', () => {
    expect(MANAGER_SRC, '标签候选仍在调独立的聚合函数：两处遍历会分叉').not.toMatch(/collectAllTags/);
    expect(MANAGER_SRC).toMatch(/const tagCounts = computed\(\(\) => countTags\(passwords\.value\)\)/);
    expect(MANAGER_SRC, '弹窗候选不再是首次出现顺序（表单与批量弹窗的顺序会跟着变）').toMatch(
      /const availableTags = computed<string\[\]>\(\(\) => \[\.\.\.tagCounts\.value\.keys\(\)\]/,
    );
    // 牙齿：把弹窗版候选改成走计数视图的同一份顺序，上一条必须抓到
    expect(
      /const availableTags = computed<string\[\]>\(\(\) => \[\.\.\.tagCounts\.value\.keys\(\)\]/.test(
        MANAGER_SRC.replace('tagCounts.value.keys()', 'buildTagOptions(tagCounts.value).map(o => o.tag)'),
      ),
      'availableTags 的判据没有牙齿',
    ).toBe(false);
  });

  it('availableTagOptions 接到 App.vue 与筛选栏，且弹窗仍吃不带计数的 availableTags', () => {
    const exportBlock = MANAGER_SRC.match(/\n {2}return \{([\s\S]*?)\n {2}\};/);
    expect(exportBlock, '未找到 usePasswordManagement 的 return 块').toBeTruthy();
    expect(exportBlock![1], 'usePasswordManagement 不再导出 availableTagOptions').toContain(
      '\n    availableTagOptions,',
    );

    const destructured = APP_SRC.match(/const \{([\s\S]*?)\} = usePasswordManagement\(/);
    expect(destructured, '未找到 App.vue 的 usePasswordManagement 解构块').toBeTruthy();
    expect(destructured![1], 'App.vue 未解构 availableTagOptions').toContain('\n  availableTagOptions,');

    const bar = APP_SRC.match(/<SearchFilterBar\b[\s\S]*?\/>/);
    expect(bar, '未找到 SearchFilterBar 的用法').toBeTruthy();
    expect(bar![0], '筛选栏还在吃不带计数的标签候选').toContain(':available-tag-options="availableTagOptions"');
    expect(bar![0], '筛选栏仍被传裸标签数组').not.toContain(':available-tags=');

    // 新增表单与批量标签弹窗的候选口径不变（仍是 string[]，顺序也不随计数漂）
    expect(APP_SRC.match(/:available-tags="availableTags"/g), '弹窗标签候选被顺手改成了计数版本').toHaveLength(2);
  });
});
