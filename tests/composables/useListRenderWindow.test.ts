/**
 * 侧边栏渲染窗口单测（useListRenderWindow）
 *
 * 这条窗口是评审缺陷 C-1 的唯一开关。2000 条落定态原本是「整库常驻 DOM」：
 * 71,253 个节点、约 190 MB 堆、13.2 s 主线程占用，且一次击键要重渲染 2000 行
 * （实测单个长任务 6.1 s）。以下六组断言各自对应一个真实故障形状：
 *
 * 1. 空闲不铺满 —— 缺了这条，首屏之后的分帧循环会一路放开到全量（旧行为）；
 *    同一条里还钉「首帧地板」：冷启动时列表后到，窗口从 0 起跳也要停在 initialCount；
 * 2. 长度变化回落 —— 缺了这条，深滚留下的上千行会参与后续每一次击键的补丁；
 * 3. 滚动按需续放且**可达全量** —— 窗口有界不等于把条目藏起来，越滚必须越放开；
 * 4. 提前量之外不空转 —— 否则每次滚动都白排一帧；
 * 5. 键盘导航同步放开 —— 异步扩容会让调用方 `nextTick` 里的 `scrollIntoView` 找不到目标行；
 * 6. 作用域销毁后不再写回 —— 面板卸载后的 ref 写入是泄漏与告警的来源。
 *
 * rAF 在本仓 vitest 的 node 环境里不存在，用可手动泵动的时钟替身：
 * 断言「第 N 帧之后是什么样」比依赖真实帧率确定得多，也能量出排队是否单飞。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import {
  IDLE_RENDER_LIMIT,
  INITIAL_RENDER_COUNT,
  RENDER_BATCH_SIZE,
  useListRenderWindow,
  type ListRenderWindow,
  type ViewportMetrics,
} from '@/composables/useListRenderWindow';

/** 一帧的待执行任务 */
type FrameTask = { id: number; run: () => void };

/**
 * 可手动泵动的 rAF 时钟替身
 *
 * `tick()` 执行当前排队的全部门任务并等一次 Vue flush；任务里再次排队的回调留到下一帧，
 * 与浏览器的「一帧一次」语义一致——这是断言「每帧只放开一批」的前提。
 */
function createRafClock() {
  let queue: FrameTask[] = [];
  let seq = 0;

  const request = (callback: FrameRequestCallback): number => {
    const id = ++seq;
    queue.push({ id, run: () => callback(performance.now()) });
    return id;
  };
  const cancel = (id: number): void => {
    queue = queue.filter(task => task.id !== id);
  };
  const tick = async (): Promise<void> => {
    const batch = queue;
    queue = [];
    batch.forEach(task => task.run());
    await nextTick();
  };

  return {
    request,
    cancel,
    tick,
    /** 当前排队任务数（用于证明单飞：同一帧内重复调度不该叠加） */
    pending: () => queue.length,
    /** 清空跨用例残留的排队任务，避免上一条用例的失败污染下一条的读数 */
    reset: () => {
      queue = [];
    },
    installed: () => {
      vi.stubGlobal('requestAnimationFrame', request);
      vi.stubGlobal('cancelAnimationFrame', cancel);
    },
  };
}

const raf = createRafClock();

/** 造一个「距底部 distance 像素」的视口读数（行高无关，窗口只看差值） */
const viewportAtDistance = (distance: number): ViewportMetrics => ({
  scrollTop: 1000,
  scrollHeight: 1000 + 700 + distance,
  clientHeight: 700,
});

/** 在独立 effect scope 里挂载窗口，避免 watcher 与 rAF 跨用例泄漏 */
let scope: EffectScope | undefined;

function mount(total: number) {
  const totalLength = ref(total);
  const activeIndex = ref(0);
  scope = effectScope();
  const view: ListRenderWindow = scope.run(() =>
    useListRenderWindow({ totalLength: () => totalLength.value, activeIndex: () => activeIndex.value }),
  )!;
  return { view, totalLength, activeIndex };
}

/** 泵 n 帧 */
const pump = async (frames: number) => {
  for (let i = 0; i < frames; i += 1) await raf.tick();
};

beforeEach(() => {
  raf.reset();
  raf.installed();
});

afterEach(() => {
  scope?.stop();
  scope = undefined;
  vi.unstubAllGlobals();
});

describe('useListRenderWindow 空闲放开', () => {
  it('首帧停在 initialCount，逐帧放开到空闲上限即停，不铺满整库', async () => {
    const { view } = mount(2000);
    expect(view.renderCount.value).toBe(INITIAL_RENDER_COUNT);

    // 一帧一批：30 → 90 → 100（最后一批被上限截断，不越过 idleLimit）
    await pump(1);
    expect(view.renderCount.value).toBe(INITIAL_RENDER_COUNT + RENDER_BATCH_SIZE);
    await pump(1);
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT);

    // 继续泵 40 帧仍停在 100：C-1 的回归钉——落定态不再等于 2000 行
    await pump(40);
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT);
    expect(raf.pending(), '达到目标后不该继续排帧').toBe(0);
  });

  it('列表本就短于上限时一次放开到底，不留二次分片闪烁', async () => {
    const { view } = mount(50);
    await pump(1);
    expect(view.renderCount.value).toBe(50);
    await pump(3);
    expect(view.renderCount.value).toBe(50);
    expect(raf.pending()).toBe(0);
  });

  /**
   * 冷启动的真实挂载顺序：认证态先落、密码后到
   *
   * `useSidepanelData.ts:506-507` 是 `isAuthenticated.value = true; await loadPasswords(true);`，
   * 而 `SidepanelAuthView` 以 `v-else`（`!isAuthenticated`）挂载 —— 于是窗口在**列表还是空的**
   * 那一刻建立：immediate 回落按 `min(len, 上限)` 把首帧计数钳到 0（空列表本就无行可渲染，正确）。
   * 真正要钉的是**数据到达后的第一帧**：它必须仍是 `INITIAL_RENDER_COUNT` 行，而不是
   * 「从 0 起跳一整个 `RENDER_BATCH_SIZE`」。首帧是侧边栏秒开 SLA 里唯一落在用户等待时间内的
   * 一帧，行数翻倍就是那一帧的长任务翻倍——本条钉的正是「首帧只渲染 initialCount 行」这句承诺。
   */
  it('挂载时列表为空、数据后到时，首帧仍停在 initialCount 而不是跳一整个批次', async () => {
    const { view, totalLength } = mount(0);
    expect(view.renderCount.value, '空列表没有可渲染的行').toBe(0);

    totalLength.value = 2000;
    await nextTick();
    await pump(1);
    expect(view.renderCount.value, '冷路径首帧不得超过 INITIAL_RENDER_COUNT').toBe(INITIAL_RENDER_COUNT);

    await pump(1);
    expect(view.renderCount.value).toBe(INITIAL_RENDER_COUNT + RENDER_BATCH_SIZE);
    await pump(1);
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT);
  });
});

describe('useListRenderWindow 列表长度变化', () => {
  it('深滚留下的窗口在长度变化时回落到上限内，本次补丁不再触碰上千行', async () => {
    const { view, totalLength } = mount(2000);
    // 模拟深滚：一路按需放开到 1200 行
    for (let i = 0; i < 20; i += 1) {
      view.notifyViewport(viewportAtDistance(0));
      await pump(2);
    }
    expect(view.renderCount.value).toBeGreaterThan(1000);

    // 打一个字：过滤后剩 1500 条，窗口必须收回上限内
    totalLength.value = 1500;
    await nextTick();
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT);

    // 剩 20 条时直接等于列表长度，不排空帧
    totalLength.value = 20;
    await nextTick();
    expect(view.renderCount.value).toBe(20);
  });

  /**
   * 钉住实现注释里写明的那条已知边界，而不是把它藏起来
   *
   * 回落只由**长度**变化触发（按数组引用回落会在内容与行数都没变时也把窗口砍回 100，
   * 卸载用户正看着的行、滚动条跟着跳）。于是"深滚放开过 → 一次行数恰好守恒的过滤"
   * 这一格，本次击键仍要为上千行打补丁——本条断言的就是这个不回落的事实：
   * 若哪天有人把触发量换成引用、或让回落不再依赖长度，这条会红，届时须连边界一起重议。
   * 后半句钉的是"它是自愈的"：长度一旦变化就回到上限内，不会永久停在深滚态。
   */
  it('行数恰好守恒的过滤不触发回落，但下一次长度一变即回到上限内', async () => {
    const { view, totalLength } = mount(2000);
    for (let i = 0; i < 20; i += 1) {
      view.notifyViewport(viewportAtDistance(0));
      await pump(2);
    }
    const deepRows = view.renderCount.value;
    expect(deepRows).toBeGreaterThan(1000);

    // 关键词命中全部条目：列表换了一批对象、条数没变 —— 窗口保持原位
    totalLength.value = 2000;
    await nextTick();
    await pump(1);
    expect(view.renderCount.value, '长度未变即不回落，这是有意选定的触发量').toBe(deepRows);

    // 下一条长度一变就收回上限内
    totalLength.value = 1999;
    await nextTick();
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT);
  });

  it('长度增长只把目标抬到上限，超出部分等滚动再放', async () => {
    const { view, totalLength } = mount(10);
    await pump(1);
    expect(view.renderCount.value).toBe(10);

    totalLength.value = 2000;
    await nextTick();
    await pump(60);
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT);
  });
});

describe('useListRenderWindow 滚动按需续放', () => {
  it('接近底部时逐批放开，一路可达全库任意一行', async () => {
    const { view } = mount(2000);
    await pump(2);
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT);

    view.notifyViewport(viewportAtDistance(100));
    await pump(1);
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT + RENDER_BATCH_SIZE);

    // 继续滚到底：放开量不越过实际条目数
    for (let i = 0; i < 60; i += 1) {
      view.notifyViewport(viewportAtDistance(0));
      await pump(1);
    }
    expect(view.renderCount.value).toBe(2000);
    expect(raf.pending()).toBe(0);
  });

  it('距底部还有提前量之外时不排帧、不放开', async () => {
    const { view } = mount(2000);
    await pump(2);
    const before = view.renderCount.value;

    view.notifyViewport(viewportAtDistance(5000));
    expect(view.renderCount.value).toBe(before);
    expect(raf.pending(), '远未触底的滚动不该排帧').toBe(0);
  });

  it('已放开到全量后重复采样为空操作（不产生永续帧循环）', async () => {
    const { view } = mount(20);
    await pump(1);
    expect(view.renderCount.value).toBe(20);

    view.notifyViewport(viewportAtDistance(0));
    view.notifyViewport(viewportAtDistance(0));
    expect(view.renderCount.value).toBe(20);
    expect(raf.pending()).toBe(0);
  });

  it('同一帧内多次触发只排一个任务（单飞）', async () => {
    const { view } = mount(2000);
    await pump(2);
    view.notifyViewport(viewportAtDistance(0));
    view.notifyViewport(viewportAtDistance(0));
    view.notifyViewport(viewportAtDistance(0));
    expect(raf.pending(), '并发调度必须合并成一帧一批').toBe(1);
    await pump(1);
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT + RENDER_BATCH_SIZE);
  });
});

describe('useListRenderWindow 键盘导航越界', () => {
  it('选中行超出窗口时同步放开，不等下一帧', async () => {
    const { view, activeIndex } = mount(2000);
    await pump(2);
    expect(view.renderCount.value).toBe(IDLE_RENDER_LIMIT);

    activeIndex.value = 180;
    await nextTick();
    // 同步生效：调用方紧接着的 nextTick 里目标行已在 DOM
    expect(view.renderCount.value).toBe(180 + RENDER_BATCH_SIZE);
  });

  it('放开量不越过实际条目数，选中行在窗口内时零开销', async () => {
    const { view, activeIndex, totalLength } = mount(5);
    await pump(1);
    expect(view.renderCount.value).toBe(5);

    activeIndex.value = 4;
    await nextTick();
    expect(view.renderCount.value).toBe(5);

    totalLength.value = 3;
    activeIndex.value = 2;
    await nextTick();
    expect(view.renderCount.value).toBe(3);
  });
});

describe('useListRenderWindow 生命周期', () => {
  it('作用域销毁后取消在排的任务，不再写回已停用的窗口', async () => {
    const { view } = mount(2000);
    await pump(1);
    const atDispose = view.renderCount.value;

    scope?.stop();
    scope = undefined;
    await pump(3);
    expect(view.renderCount.value, '卸载后的帧不得继续改窗口').toBe(atDispose);
    expect(raf.pending()).toBe(0);
  });
});
