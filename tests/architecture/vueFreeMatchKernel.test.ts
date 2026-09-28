/**
 * 搜索匹配内核的「零 Vue」守卫
 *
 * 背景：拼音/关键词匹配要同时服务 Vue 侧入口（侧边栏、options）与 Background
 * （Service Worker）。Vite 打包按依赖图分 chunk——只要匹配内核里出现一行
 * `import { shallowRef } from 'vue'`，Vue 与 vue-i18n（实测约 131KB 的
 * `i18n-*.js` 共享 chunk）就会被拉进 SW 产物，破坏「background.js 不含 Vue」的
 * 包体积与首屏口径；而把匹配逻辑复制一份给 SW，又会让内联下拉与侧边栏的搜索口径
 * 各自演化（正是本次改造要切断的漂移）。
 *
 * 因此拆成「无 Vue 内核 + 响应式外壳」，并把边界固化在这里：
 * 1. 内核（`utils/searchMatch/core.ts`、`utils/keywordMatch.ts`）连同其**传递依赖**
 *    不得出现 `vue` / `vue-i18n` 的运行时导入——被 Background 与 content script
 *    复用是它们的定位（`import type` 编译期即擦除，不进产物，故不计）；
 * 2. 外壳（`utils/searchMatch.ts`）必须仍然持有响应式：既导入 `vue`，
 *    也订阅内核的就绪事件。防止后人把 ref「顺手搬回」内核，或让外壳退化成
 *    无人导入的死文件（那样预热完成后再没有响应式重算，拼音命中要等下一次输入）。
 */
import { describe, it, expect } from 'vitest';
import { computeImportClosure, extractSpecifiers, readSource } from '@/tests/helpers/architectureScan';

/** 被禁止出现在内核传递依赖里的运行时模块 */
const FORBIDDEN_MODULES = new Set(['vue', 'vue-i18n']);

/** 内核入口：Background / content script 允许复用的匹配模块 */
const KERNEL_ENTRIES = ['utils/searchMatch/core.ts', 'utils/keywordMatch.ts'];

/** 收集闭包内所有指向被禁模块的运行时导入 */
function forbiddenImportsIn(closure: Set<string>): string[] {
  const hits: string[] = [];
  for (const file of closure) {
    for (const { spec, typeOnly } of extractSpecifiers(readSource(file))) {
      const forbidden = FORBIDDEN_MODULES.has(spec) || spec.startsWith('vue/');
      if (forbidden && !typeOnly) hits.push(`${file} → ${spec}`);
    }
  }
  return hits;
}

describe('搜索匹配内核零 Vue 依赖', () => {
  const closure = computeImportClosure(KERNEL_ENTRIES);

  it('内核入口存在且闭包已展开到文件', () => {
    for (const entry of KERNEL_ENTRIES) {
      expect(closure.has(entry), `缺少内核文件 ${entry}`).toBe(true);
    }
    expect(closure.size).toBeGreaterThanOrEqual(KERNEL_ENTRIES.length);
  });

  it('内核及其传递依赖均无 vue / vue-i18n 运行时导入', () => {
    expect(forbiddenImportsIn(closure)).toEqual([]);
  });

  it('响应式外壳仍在，且同时持有 vue 与内核就绪订阅', () => {
    const shell = readSource('utils/searchMatch.ts');
    expect(shell).toMatch(/from ['"]vue['"]/);
    expect(shell).toMatch(/from ['"]@\/utils\/searchMatch\/core['"]/);
    expect(shell).toContain('onPinyinMatcherReady');
    expect(shell).toContain('pinyinMatcherReady');
  });

  /**
   * 被外壳包裹的内核必须待在 `utils/` 下一层
   *
   * WXT 按**导出名**扫描 `utils/`（及 `composables/`）顶层文件注册全局自动导入，且不递归子目录。
   * 外壳刻意沿用内核的函数名（`(text, keyword)` 旧签名），两层一旦同为顶层文件，unimport 会判为
   * 重名并静默保留内核——任何裸调用都绕过响应式 ref，拼音预热完成后不再重算，构建日志同时刷
   * `Duplicated imports` 告警。内核下沉一层即可让只有外壳的名字进入该命名空间。
   */
  it('被包裹的内核不在自动导入扫描面上（utils/ 顶层）', () => {
    const wrappedKernel = KERNEL_ENTRIES.find(entry => entry.startsWith('utils/searchMatch/'));
    expect(wrappedKernel, '内核入口清单已漂移：找不到被外壳包裹的内核文件').toBeTruthy();
    expect(wrappedKernel, `${wrappedKernel} 不得回到 utils/ 顶层，否则与外壳同名冲突`).toMatch(
      /^utils\/[^/]+\/.+\.ts$/,
    );
  });

  /**
   * 共享抽取器仍在为两个守卫服务
   *
   * 依赖图解析一旦失真（别名改了、`import type` 判据失效），本文件的断言会跟着一起变绿或变红，
   * 看不出是「内核干净」还是「抽取空跑」。故这里直接对抽取器本身做一次正反对照：
   * 一个必然含 Vue 的模块要能被查出 Vue，内核模块查不出——证明牙齿还在。
   */
  it('抽取器对 Vue 依赖有牙：外壳可查出、内核查不出', () => {
    const shellHits = forbiddenImportsIn(computeImportClosure(['utils/searchMatch.ts']));
    expect(
      shellHits.some(hit => hit.endsWith('→ vue')),
      `响应式外壳应被检出 vue 运行时导入，抽取器已失效`,
    ).toBe(true);
    expect(forbiddenImportsIn(computeImportClosure(KERNEL_ENTRIES))).toEqual([]);
  });
});
