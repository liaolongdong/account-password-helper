/**
 * 侧边栏渲染窗口的口径与接线守卫
 *
 * 三件事各自对应一种「测试写了一堆却抓不到」的失效形状：
 *
 * 1. **口径**：窗口上限「与内联下拉同口径」是写进注释和评审报告的事实主张。两处闸门
 *    一旦分叉（侧边栏 100、下拉 200），同一个「一次能给多少条」的承诺在两个界面上就是
 *    两个数，用户和文档都会拿到不一致的读数；而 inline 侧的常量住在 background，
 *    没有任何调用方会因为它变大而报错。
 * 2. **帧预算**：每帧放开的行数由「单帧预估成本不得越过长任务定义线」反推而来（报告 §9.15
 *    量到批次为 60 时首屏窗口内 195～255 ms 的单个长任务）。这条推导一旦断开，窗口行为**完全不变**、
 *    单测一条都不会红——`useListRenderWindow` 的帧数断言是按 `RENDER_BATCH_SIZE` 自己算期望值的，
 *    它只保证「每帧一批」，不保证「一批不过预算」。于是失效形状是：有人为了「铺满更快」把批次
 *    改回常量 60，或者把行成本改成乐观值，长任务原地复发而测试全绿。
 * 3. **接线**：本仓 vitest 管线没有 `@vitejs/plugin-vue`，`.vue` 无法被 import；
 *    `pnpm typecheck` / `pnpm lint` 也看不到 `<script setup>` 块（既有结论）。于是
 *    「窗口真的生效」这件事只剩源码扫描这一道门：把 `v-for` 的源改回
 *    `filteredPasswords`、或摘掉列表容器的 `@scroll` 绑定，都不会让任何单测变红——
 *    前者是 2000 条落定态整库常驻 DOM（评审缺陷 C-1 的原始故障形状）原地复发，
 *    后者更隐蔽：窗口停在 100，第 101 条以后**永远渲染不出来**，滚动到底列表就那么些行，
 *    读起来像「条目丢了」。
 *
 * 窗口策略本身的行为（空闲放开 / 按需续放 / 身份回落 / 键盘同步放开）由
 * `tests/composables/useListRenderWindow.test.ts` 承担，本文件只钉跨文件契约与口径推导。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  IDLE_RENDER_LIMIT,
  INITIAL_RENDER_COUNT,
  RENDER_BATCH_SIZE,
  SCROLL_EXTEND_ROWS,
} from '@/composables/useListRenderWindow';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

const VIEW_SRC = read('components/sidepanel/SidepanelAuthView.vue');
const WINDOW_SRC = read('composables/useListRenderWindow.ts');

/** 从 background 源码里取内联下拉的行闸门字面量（不 import，避免拽进 chrome 依赖） */
const inlineRowGate = (): number => {
  const match = read('entrypoints/background/passwordCache.ts').match(/export const INLINE_MAX_RESULT_ROWS = (\d+)/);
  expect(match, '内联下拉的行闸门常量改名或换写法，请同步本守卫').toBeTruthy();
  return Number(match![1]);
};

/** 取窗口模块里某个模块级常量的字面量（有些只用于换算或只作口径锚点，没有消费者，故不导出） */
const windowConst = (name: string): number => {
  const match = WINDOW_SRC.match(new RegExp(`^(?:export )?const ${name} = ([\\d.]+);`, 'm'));
  expect(match, `窗口模块的 ${name} 字面量缺失或换写法，请同步本守卫`).toBeTruthy();
  return Number(match![1]);
};

/**
 * 实测的单行落定成本上界（ms）：255 ms ÷ 60 行
 *
 * 报告 §9.15 的同窗口读数——批次为 60 时首屏窗口内量到最长 255 ms 的单个长任务。
 * 写在这里而不是引用实现里的值，是为了让「把行成本改成乐观值」这一步必须过本守卫这一关。
 */
const MEASURED_ROW_COST_CEILING_MS = 255 / 60;

describe('渲染窗口与内联下拉同口径', () => {
  it('空闲上限就是内联下拉的那道行闸门', () => {
    expect(IDLE_RENDER_LIMIT).toBe(inlineRowGate());
  });

  it('首帧小于空闲上限，且每批为正数（否则窗口要么一步铺满要么永不放开）', () => {
    expect(INITIAL_RENDER_COUNT).toBeGreaterThan(0);
    expect(INITIAL_RENDER_COUNT).toBeLessThan(IDLE_RENDER_LIMIT);
    expect(RENDER_BATCH_SIZE).toBeGreaterThan(0);
  });
});

describe('每帧批次受单帧预算约束', () => {
  const longTaskMs = windowConst('LONG_TASK_MS');
  const rowCostMs = windowConst('ROW_RENDER_COST_MS');

  /** 长任务定义线是规范给的 50 ms，不是可调参数：把它抬高等于把「无卡顿」的判据改掉 */
  it('长任务定义线仍是 50 ms', () => {
    expect(longTaskMs).toBe(50);
  });

  /** 行成本必须不低于实测上界：改成乐观值会让批次虚高，长任务原地复发 */
  it('每行成本取的是实测上界，不是估算的乐观值', () => {
    expect(rowCostMs).toBeGreaterThanOrEqual(MEASURED_ROW_COST_CEILING_MS);
  });

  /** 一个预算内的批次，加上再多一行就该越线——钉子同时拦住「改回 60」和「随手调小」 */
  it('批次是预算内能放下的最大行数，且是推导出来的而不是写死的字面量', () => {
    expect(WINDOW_SRC, '批次不再由预算反推，多半是被改回常量了（§9.15 那条 195～255 ms 长任务的来源）').toMatch(
      /export const RENDER_BATCH_SIZE = Math\.max\(1, Math\.floor\(LONG_TASK_MS \/ ROW_RENDER_COST_MS\)\);/,
    );
    expect(RENDER_BATCH_SIZE * rowCostMs, '单帧预估成本越过长任务定义线').toBeLessThanOrEqual(longTaskMs);
    expect((RENDER_BATCH_SIZE + 1) * rowCostMs, '批次小于预算允许的极大值，铺满窗口的墙钟被白拉开').toBeGreaterThan(
      longTaskMs,
    );
  });

  /**
   * 可达性的承诺量与流畅度的批次是两个数
   *
   * 两条各管一头：正则钉住 `notifyViewport` 用的是可达性常量而不是批次（改回跟批次走就红）；
   * 数值上要求**严格大于**——两者相等即退化成「调一个同时动另一件事」，
   * §9.14 ⑤ 那条「约 32 次触底可取到第 2000 行」会随帧预算一起被改写，而这正是本波拆常量要防的。
   * 行为侧的对应证据在 `useListRenderWindow.test.ts` 的解耦用例（它数的是触发次数）。
   */
  it('触底续放的承诺量独立于每帧批次，且严格大于批次', () => {
    expect(SCROLL_EXTEND_ROWS, '触底承诺量退化成一批，可达性就被帧预算带走了').toBeGreaterThan(RENDER_BATCH_SIZE);
    expect(WINDOW_SRC, '触底续放改成了跟着批次走，可达性口径会被帧预算带走').toMatch(
      /renderCount\.value \+ SCROLL_EXTEND_ROWS/,
    );
  });
});

describe('渲染窗口接线', () => {
  it('窗口只经 composable 建立，组件内不重复实现一遍计数', () => {
    expect(VIEW_SRC).toMatch(/import \{ useListRenderWindow \} from '@\/composables\/useListRenderWindow'/);
    // 旧实现把常量和 `_expanding` 状态机写在组件里；留第二份计数 = 两份口径早晚分叉
    expect(VIEW_SRC).not.toMatch(/const (INITIAL_RENDER_COUNT|RENDER_BATCH_SIZE)\s*=/);
    expect(VIEW_SRC, '窗口不得再被直接铺到过滤后的全量长度').not.toMatch(
      /renderCount\.value = props\.filteredPasswords\.length/,
    );
  });

  it('v-for 遍历窗口切片而不是过滤后的全量列表', () => {
    const rowBlock = VIEW_SRC.match(/<PasswordListItem[\s\S]*?\/>/);
    expect(rowBlock, '未找到列表行的 v-for 块（模板结构变化需同步更新本守卫）').toBeTruthy();
    expect(rowBlock![0], '行循环源不再走窗口切片，落定态会退回整库常驻 DOM').toMatch(
      /v-for="\([A-Za-z]\w*, index\) in visiblePasswords"/,
    );
  });

  it('切片确实按 renderCount 收窄，且窗口覆盖全量时复用原数组引用', () => {
    const slice = VIEW_SRC.match(/const visiblePasswords = computed\(\(\) =>[\s\S]*?\n\);/);
    expect(slice, '未找到 visiblePasswords 切片').toBeTruthy();
    expect(slice![0]).toContain('renderCount.value');
    expect(slice![0]).toContain('slice(0, renderCount.value)');
    // 全量已被窗口覆盖时返回原引用：换档/收尾不该让整表 vnode 白做一次 diff
    expect(slice![0]).toContain('props.filteredPasswords');
  });

  it('窗口的两个来源都接到本组件的 props 上', () => {
    const call = VIEW_SRC.match(/useListRenderWindow\(\{[\s\S]*?\}\)/);
    expect(call, '未找到 useListRenderWindow 调用').toBeTruthy();
    expect(call![0], '长度来源不是过滤后的列表，窗口会对着错误的总量放开').toContain(
      'totalLength: () => props.filteredPasswords.length',
    );
    expect(call![0], '选中索引来源缺失，键盘导航越过窗口时目标行会不在 DOM 里').toContain(
      'activeIndex: () => props.activeIndex',
    );
  });

  it('滚动容器把几何采样接给窗口（超出空闲上限的行必须仍然可达）', () => {
    const list = VIEW_SRC.match(/<div[^>]*class="password-list"[\s\S]*?>/);
    expect(list, '未找到密码列表滚动容器').toBeTruthy();
    expect(list![0], '列表容器不再上报滚动几何，第 101 条以后将永远渲染不出').toMatch(
      /@scroll(\.passive)?="handleListScroll"/,
    );

    const handler = VIEW_SRC.match(/const handleListScroll = \(event: Event\) => \{[\s\S]*?\n\};/);
    expect(handler, '未找到 handleListScroll').toBeTruthy();
    expect(handler![0]).toContain('notifyViewport(');
    // currentTarget 在派发结束后会被复用，异步再读是 null——必须在调度前同步取到
    expect(handler![0].indexOf('event.currentTarget')).toBeLessThan(handler![0].indexOf('requestAnimationFrame('));
    expect(VIEW_SRC, '滚动采样的 rAF 未随组件卸载清理，会向已停用作用域写几何').toMatch(
      /onUnmounted\(\(\) => \{[\s\S]*?cancelAnimationFrame\(_scrollRafId\)/,
    );
  });
});
