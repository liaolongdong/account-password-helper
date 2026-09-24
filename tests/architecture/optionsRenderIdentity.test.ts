/**
 * 管理页大列表渲染稳定性守卫（issue #89 止血项的结构化锁）
 *
 * 600 条真机测量得到的结论是：卡顿不来自数据层 JS（过滤/解密实测个位数毫秒），
 * 而来自「同一次 flush 内被更新的组件数」——Vue 的 flush 回调扫描与子组件更新判定
 * 都随行数线性乃至平方级放大。因此每一次整表重渲染的真实成本，取决于**有多少子组件
 * 被判定为需要更新**，而判定依据是 prop 是否发生值变化。
 *
 * 于是下面这几类写法是这台机器上的性能陷阱，而不是风格问题：
 * 1. 模板里现造样式/配置对象（`:style="{...}"`、`:popper-style="{...}"`、函数调用返回新对象）
 *    → 每次渲染都是新引用 → 该子组件必被更新；
 * 2. 模板里做解析（`parseTags(row.tag)`）→ 同上，且重复计算；
 * 3. 函数式 ref 写入响应式容器 → 引用集合随渲染次数累积，且每次写入都触发依赖更新；
 * 4. 把未防抖的搜索关键词传给表格 → 每次击键为上千个文本单元格重算分段并重排。
 * 5. 纯展示包装（tooltip）按「行 × 操作」创建 → 实例数成倍放大；实测同一份 DOM 下，
 *    仅去掉操作列那 5 个/行的实例包装就能让整表挂载耗时少四成，所以包装必须共享。
 *
 * 这些都能被一次「顺手」的模板改动重新引入，故用源码级守卫钉住，而不是只靠评审。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const TABLE_SRC = read('components/options/PasswordTable.vue');
const APP_SRC = read('entrypoints/options/App.vue');
const WATCHER_SRC = read('composables/useStorageWatcher.ts');
const SIDEPANEL_SRC = read('composables/useSidepanelData.ts');

/** 取出 SFC 的 `<template>` 段（守卫只约束模板里的渲染期写法） */
const templateOf = (src: string): string => {
  const matched = src.match(/<template>([\s\S]*)<\/template>/);
  expect(matched, '未找到 <template> 段（文件结构变化需同步更新本守卫）').toBeTruthy();
  return matched![1];
};

const TABLE_TPL = templateOf(TABLE_SRC);

describe('管理页表格的渲染期对象身份', () => {
  it('抽取到非空的模板段（防止守卫空跑）', () => {
    expect(TABLE_TPL.length).toBeGreaterThan(500);
    expect(TABLE_TPL).toContain('<el-table');
  });

  it('标签样式来自缓存记录，不在模板内解析或造色', () => {
    // 模板只允许经 `tagRecordsOf` 取缓存记录，取记录的实现必须是 tagUtils 的缓存构建
    expect(TABLE_TPL).toContain('tagRecordsOf(row)');
    expect(TABLE_SRC).toMatch(/const tagRecordsOf = .*buildTagPresentationRecords/);
    expect(TABLE_SRC).toContain('import { buildTagPresentationRecords');
    expect(TABLE_SRC).not.toMatch(/import \{[^}]*\bparseTags\b[^}]*\} from '@\/utils\/tagUtils'/);
    for (const forbidden of ['parseTags(', 'getTagFullStyle(', 'getTagColor(']) {
      expect(TABLE_TPL, `模板内出现 ${forbidden}：每次渲染都会重复解析/新建样式对象`).not.toContain(forbidden);
    }
  });

  it('tooltip 的 popper 样式使用提升后的常量而非对象字面量', () => {
    expect(TABLE_TPL).toContain(':popper-style="TAG_TOOLTIP_POPPER_STYLE"');
    expect(TABLE_TPL).not.toMatch(/:popper-style="\{\s*\w/);
  });

  it('行内事件不通过箭头函数捕获行/标签数据（改为读 data-* 与稳定 key）', () => {
    // 每个标签一个 `@mouseenter="(...)=>checkTagOverflow(e, tag)"` 闭包，等价于每帧重建上千个函数
    expect(TABLE_TPL).toContain('@mouseenter="checkTagOverflow"');
    expect(TABLE_TPL).not.toMatch(/@mouseenter="\(\s*e:\s*MouseEvent\s*\)\s*=>/);
    // 标签文本由元素自身携带：少了这条绑定，`dataset.tag` 恒为 undefined，
    // 溢出提示会静默失效（`?? null` 不报错），因此必须在守卫里钉住
    expect(TABLE_TPL).toContain(':data-tag="tag.name"');
    expect(read('composables/useTagOverflow.ts')).toContain('dataset.tag');
  });

  it('操作列只有一个小 tooltip 实例，逐行按钮只带文案与稳定引用的悬停入口', () => {
    // 首屏成本按**组件实例**计价：逐行 5 个 el-tooltip 在 600 行上就是 3000 个实例，
    // 实测占掉整表挂载耗时的四成（docs/PERF_LARGE_VAULT_EVALUATION.md 9.9）。
    // 模板里只允许出现「标签提示」和「共享操作提示」两处 el-tooltip 标签。
    expect([...TABLE_TPL.matchAll(/<el-tooltip/g)].length).toBe(2);
    expect(TABLE_TPL).toContain('virtual-triggering');
    // 不再需要逐行函数式 ref 收集实例
    expect(TABLE_TPL).not.toMatch(/:ref="\(/);
    expect(TABLE_SRC).not.toContain('collectTooltipRef');
    // 文案由按钮自带，且至少覆盖 5 个操作
    expect([...TABLE_TPL.matchAll(/:data-tip="/g)].length).toBeGreaterThanOrEqual(5);
    expect(TABLE_TPL).toContain('@mouseenter="armOperationTip"');
    // 逐行闭包会把刚省下的实例成本换成等量的函数与监听器成本
    expect(TABLE_TPL).not.toMatch(/@mouseenter="(?:\(\s*e|\(?e\)?\s*=>)/);
    // 两条打开路径必须同值：首次悬停由排程器计时（EP 还没把 mouseenter 绑到这颗元素上），
    // 再次悬停同一元素时 EP 自己那份监听器生效并读 `show-after`。EP 侧留 0 会让二次悬停
    // 变成即时弹出 + 上一次缓存的文案（真机回归用例见 e2e/operation-tooltip.spec.ts）。
    const sharedTipTpl = TABLE_TPL.match(/<el-tooltip[^>]*virtual-triggering[\s\S]*?\/>/)?.[0] ?? '';
    expect(sharedTipTpl, '未找到共享的 virtual-triggering 实例').toBeTruthy();
    const epShowAfter = Number(sharedTipTpl.match(/:show-after="(\d+)"/)?.[1]);
    const schedulerShowAfter = Number(TABLE_SRC.match(/showAfter: (\d+)/)?.[1]);
    expect(epShowAfter).toBeGreaterThan(0);
    expect(schedulerShowAfter).toBe(epShowAfter);
    // 隐藏时序与 enterable 必须留在 EP 里，不允许在 composable 内再造一套
    expect(TABLE_TPL).toContain(':hide-after="200"');
    expect(read('composables/useSharedHoverTooltip.ts')).not.toMatch(/hideAfter|hide\(/);
  });

  it('共享实例的打开动作排在重渲染之后（EP 的开与关共用一个计时器槽位）', () => {
    // 写 `triggerEl` / `content` 必然触发本组件重渲染，而重渲染会走 `onBeforeUpdate` 的兜底关闭；
    // `useTimeout.registerTimeout` 先取消槽位里的旧任务再登记新任务，所以若在同一帧里先开、
    // 后由兜底关闭登记 200 毫秒关，开启动作会被直接取消——真机表现为提示永远不出现。
    expect(TABLE_SRC).toMatch(
      /present: \(\{ event \}\) => \{\s*\n\s*void nextTick\(\(\) => operationTipRef\.value\?\.onOpen\(event, 0\)\);/,
    );
    const beforeUpdateBody = TABLE_SRC.match(/onBeforeUpdate\(\(\) => \{\s*\n([\s\S]*?)\n\}\);/)?.[1] ?? '';
    expect(beforeUpdateBody, 'onBeforeUpdate 里未调用 EP 的兜底关闭').toMatch(/operationTipRef\.value\?\.onClose\(\)/);
    // 兜底关闭只关"已打开的浮层"，不许顺手取消挂起中的悬停：本组件任何一次响应式写入都会走
    // 这个钩子，取消排程会让「刚 mouseenter、表格恰好重渲染」的提示永远不出现（真机回归过一次）。
    expect(beforeUpdateBody, 'onBeforeUpdate 取消了挂起中的悬停').not.toMatch(/cancel/);
    // 任何"响应式写入"都不许和 `onOpen` 同帧：真机回归过一次——把过渡名还原写在 `present` 里，
    // 那次写入排的重渲染走 `onBeforeUpdate` 兜底关闭，正好取消了刚登记的 0 毫秒开启动作。
    const presentBody = TABLE_SRC.match(/present: \(\{ event \}\) => \{\s*\n([\s\S]*?)\n {2}\},/)?.[1] ?? '';
    expect(presentBody, 'present 里出现了响应式写入，会与 onOpen 抢同一个计时器槽位').not.toMatch(/\.value\s*=/);
    expect(TABLE_SRC).toMatch(
      /const armOperationTip = \(event: MouseEvent\) => \{\s*\n\s*operationTipTransition\.value = undefined;\s*\n\s*armSharedTip\(event\);/,
    );
  });

  it('触发元素随行一起消失时同帧关闭并松开引用（对齐逐行实例随节点卸载即消失）', () => {
    // 共享实例只剩 `onBeforeUpdate` 那条 200 毫秒延迟关，而元素卸载后 `mouseleave` 永不再来，
    // 浮层会在原坐标悬停 200 毫秒；`hide()` 走 EP 自己的立即关闭，不额外造计时器。
    // `hide()` 前必须先切过渡名：`hide()` 只跳过 `hide-after` 的等待，浮层仍会淡出 300 毫秒，
    // 而这条路径同时清空了文案，淡出过程就是"原位悬着一个空气泡"（真机 e2e 钉住）。
    expect(TABLE_SRC).toMatch(
      /onUpdated\(\(\) => \{[\s\S]*?!trigger\.isConnected[\s\S]*?operationTipTransition\.value = TOOLTIP_NO_FADE;[\s\S]*?operationTipRef\.value\?\.hide\(\)[\s\S]*?operationTipTriggerEl\.value = undefined/,
    );
    // 无淡出档必须真的"没有对应 CSS"：这个类名在组件里只出现在常量赋值处一次，
    // 一旦有人为它补上过渡样式，同帧摘除浮层的前提就没了（那时需改用别的强制关闭手段）。
    expect([...TABLE_SRC.matchAll(/aph-tooltip-no-fade/g)].length).toBe(1);
    expect(TABLE_TPL).toContain(':transition="operationTipTransition"');
  });
});

describe('管理页搜索高亮与过滤同源', () => {
  it('表格的高亮关键词使用防抖副本', () => {
    const binding = APP_SRC.match(/<PasswordTable[\s\S]*?\/>/);
    expect(binding, '未找到 PasswordTable 用法块').toBeTruthy();
    expect(binding![0]).toContain(':search-keyword="debouncedSearchKeyword"');
    expect(binding![0]).not.toContain(':search-keyword="searchKeyword"');
  });
});

describe('管理页分页接线', () => {
  /** App.vue 里那段 PasswordTable 用法块（与上一条守卫同样的抓取口径） */
  const tableBinding = APP_SRC.match(/<PasswordTable[\s\S]*?\/>/);

  it('表格吃的是当前页切片，而不是完整命中集', () => {
    // 分页唯一真正省下渲染的就是这一行绑定：接回 `filteredPasswords` 等于分页形同不存在，
    // 2000 条照样整表挂载（实测 180 秒、首屏 33.6 秒）。
    expect(tableBinding, '未找到 PasswordTable 用法块').toBeTruthy();
    expect(tableBinding![0]).toContain(':data="pagedEntries"');
    expect(tableBinding![0]).not.toContain(':data="filteredPasswords"');
  });

  it('选择列开 reserve-selection，跨页选中才有承载', () => {
    // Element Plus 的 `setData` 在保留模式下跳过 clearSelection/cleanSelection，
    // 换页时选择集才不会随 data 换引用被抹掉（语义实测见 elTableReserveSelection.probe.test.ts）。
    expect(TABLE_TPL).toMatch(/type="selection"[\s\S]*?reserve-selection[\s\S]*?\/>/);
    expect(TABLE_SRC).toContain('row-key="id"');
  });

  it('列表一变就显式清空选中（补回被保留模式跳掉的那一下）', () => {
    // 少了这条，分页前的「改筛选 / 删条目即归零选择」语义会静默变成「选择集只增不减」，
    // 已删除条目的行对象还会永久滞留在 EP 的 selection 里。
    // 调的是 PasswordTable 自己暴露的意图方法，不再是 `.tableRef?.clearSelection()`——
    // 同一条守卫因此同时锁住「接线存在」和「不越过组件边界拿 EP 实例」。
    const clearWatch = APP_SRC.match(
      /watch\(filteredPasswords, \(\) => \{\s*\n\s*passwordTableRef\.value\?\.clearSelection\(\);\s*\n\}\)/,
    );
    expect(clearWatch, '未找到 filteredPasswords → clearSelection 的补偿接线').toBeTruthy();
    expect(APP_SRC, '父组件不应再直接触碰 EP 表格实例').not.toMatch(/passwordTableRef\.value[?.!]+tableRef/);
  });

  it('页大小档位封顶，不给「全部」留后门', () => {
    // 「全部」这一档等于把分页要解决的问题原样留给用户，因此档位必须保持有上限。
    const src = read('utils/vaultPagination.ts');
    const matched = src.match(/export const PAGE_SIZE_OPTIONS = \[([\d,\s]+)\]/);
    expect(matched, 'PAGE_SIZE_OPTIONS 写法变化需同步更新本守卫').toBeTruthy();
    const sizes = matched![1]
      .split(',')
      .map(Number)
      .filter(n => Number.isFinite(n));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(200);
  });
});

describe('本地操作守卫的解除接线', () => {
  it('storage watcher 在跳过重载时消费守卫标志', () => {
    expect(WATCHER_SRC).toContain('consumeSkip?.()');
    // 必须在「跳过」分支内、且先于 return 执行
    const skipBranch = WATCHER_SRC.match(/if \(skipIf\?\.value\) \{[\s\S]*?\n {6}\}/);
    expect(skipBranch, '跳过分支结构变化需同步更新本守卫').toBeTruthy();
    expect(skipBranch![0]).toContain('consumeSkip?.()');
  });

  it('Options 与 SidePanel 两条填充路径都接入解除回调', () => {
    const watcherCall = APP_SRC.match(/useStorageWatcher\(\{[\s\S]*?\n\}\)/);
    expect(watcherCall, 'Options 未找到 useStorageWatcher 调用块').toBeTruthy();
    expect(watcherCall![0]).toContain('skipIf: isLocalOperation');
    expect(watcherCall![0]).toContain('consumeSkip: consumeLocalOperation');

    const sidepanelSkip = SIDEPANEL_SRC.match(/if \(localOperationFlag\.value\) \{[\s\S]*?\n {6}\}/);
    expect(sidepanelSkip, 'SidePanel 跳过分支结构变化需同步更新本守卫').toBeTruthy();
    expect(sidepanelSkip![0]).toContain('consumeLocalFlag()');
  });

  it('守卫不再按固定宏任务解除标志', () => {
    const guardSrc = read('composables/useLocalOperationGuard.ts');
    expect(guardSrc).not.toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{?\s*isLocalOperation\.value = false/);
    expect(guardSrc).toContain('consumeLocalOperation');
  });
});
