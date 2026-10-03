import { onScopeDispose, ref, watch, type Ref } from 'vue';

/**
 * 侧边栏密码列表的按需渲染窗口
 *
 * 存在的理由：列表行是 `v-for + v-memo` 的重组件（每行约 25 个 Element Plus 实例与
 * 4 个高亮分段计算），单行落定成本约 1.5～3 ms。此前分片渲染把窗口一路放开到**全量**，
 * 2000 条时落定态等于整库常驻 DOM（实测 71,253 个节点、约 190 MB 堆、13.2 s 主线程占用），
 * 而一次击键要重渲染整库行数——实测单个长任务 6.1 s，UI 在那 6 秒里完全不响应。
 * 问题定位、整改与前后读数见 `docs/reports/PERF_LARGE_VAULT_EVALUATION.md` §9.14。
 *
 * 本模块把「窗口」变成有界且**按需**的量，三条增长/回落路径各有归属：
 *
 * 1. 空闲放开：首帧只渲染 `INITIAL_RENDER_COUNT` 行，其后每帧 +`RENDER_BATCH_SIZE`，
 *    到 `IDLE_RENDER_LIMIT` 即停——落定态不再等于整库，首屏与内存因此有上界；
 * 2. 按需续放：滚动接近底部时再放开一批，**不受空闲上限约束**，所以任何一行都可达，
 *    不需要「显示更多」这类额外交互，也不改变列表语义（过滤/排序/搜索仍是全量）；
 * 3. 身份回落：过滤后列表长度变化时把窗口收回上限内。这一步是关键——上一次深滚
 *    留在 DOM 里的上千行不会参与本次补丁，否则「深滚后打一个字」仍是要重渲染整库。
 *
 * 越界防护沿用原实现：键盘导航选中行超出窗口时**同步**放开，保证调用方在
 * `nextTick` 里 `scrollIntoView` 时目标行已在 DOM 中。
 *
 * 行数闸门与内联下拉的 `INLINE_MAX_RESULT_ROWS` 同口径（两处「一次能给多少条」保持
 * 一致，由 `tests/architecture/sidepanelRenderWindowLimits.test.ts` 钉住）；
 * 差异只在截断对象：内联下拉截的是**下发条目**（消息体成本），这里截的是**渲染行数**。
 */

/** 首帧渲染条目数：覆盖常见可视区高度，超出部分交给后续动画帧 */
export const INITIAL_RENDER_COUNT = 30;

/** 每帧追加渲染的条目数 */
export const RENDER_BATCH_SIZE = 60;

/**
 * 空闲态渲染窗口上限：与内联下拉同口径的 100 行
 *
 * 侧边栏可视区约 9～15 行，100 行已是 6 屏以上的余量——用户不滚动时看不到边界，
 * 而落定态 DOM 从「整库」降到「100 行」，一次击键的重渲染成本随之有界。
 */
export const IDLE_RENDER_LIMIT = 100;

/** 距列表底部多少像素内视为「接近底部」，据此提前放开一批以降低触底空档 */
const VIEWPORT_PRELOAD_PX = 600;

/** 渲染窗口的响应式来源（取 getter 而非 ref，调用方可直接传 props 派生表达式） */
export interface ListRenderWindowSources {
  /** 过滤 + 排序后的列表长度 */
  totalLength: () => number;
  /** 键盘导航当前选中索引 */
  activeIndex: () => number;
}

/** 滚动容器的视口几何（由调用方在 rAF 里采样，避免在事件回调里强制布局） */
export interface ViewportMetrics {
  /** 已滚动距离 */
  scrollTop: number;
  /** 可滚动总高度 */
  scrollHeight: number;
  /** 可视区高度 */
  clientHeight: number;
}

/** 渲染窗口的对外接口 */
export interface ListRenderWindow {
  /** 当前渲染窗口大小（列表切片依据） */
  renderCount: Ref<number>;
  /** 采样滚动容器几何：接近底部且仍有未渲染条目时按需放开一批 */
  notifyViewport: (metrics: ViewportMetrics) => void;
}

/**
 * 建立侧边栏列表的按需渲染窗口
 *
 * 窗口参数直接取自本模块导出的三个常量：唯一的调用方（`SidepanelAuthView`）按默认策略
 * 建窗，没有需要覆盖的时间轴，所以不保留可注入参数的间接层——参数一旦无人传递，
 * 「常量即口径」就只由导出的那三个值负责（口径本身由架构守卫钉住）。
 *
 * @param sources 列表长度与选中索引的响应式来源
 * @returns 渲染窗口与滚动采样入口
 */
export function useListRenderWindow(sources: ListRenderWindowSources): ListRenderWindow {
  const renderCount = ref(INITIAL_RENDER_COUNT);

  /** 本轮希望渲染到的条目数（已按列表长度收窄后使用） */
  let target = 0;
  /** 分帧循环进行中标志（防止并发 rAF 叠加） */
  let stepping = false;
  /** 分帧循环的 rAF 句柄 */
  let rafId = 0;

  /** 收拢目标与列表长度的关系：目标永不越过实际条目数 */
  const goal = () => Math.min(target, sources.totalLength());

  /** 注册下一帧的扩容任务（已排队则零成本短路） */
  const schedule = () => {
    if (stepping) return;
    stepping = true;
    rafId = requestAnimationFrame(step);
  };

  /**
   * 每帧放开一批，达到目标即停
   *
   * `initialCount` 同时是**首帧地板**：挂载时列表若还是空的（认证态先落、密码后到），
   * 下面的长度回落会把窗口钳到 0——空列表无行可渲染，这是对的。但数据到达后不能从 0
   * 起跳一整个批次：侧边栏秒开 SLA 里唯一落在用户等待时间内的那一帧，成本会翻倍到
   * 60 行（按本模块开头每行 1.5～3 ms 的实测单价计，约 90～180 ms 的单个长任务）。
   * 所以不足 `initialCount` 时先补到 `initialCount`，
   * 之后每帧 +`RENDER_BATCH_SIZE`；两条路径的**总量**不变，只是第一帧的大小重新有界。
   */
  function step() {
    stepping = false;
    const limit = goal();
    if (renderCount.value >= limit) return;
    const next =
      renderCount.value < INITIAL_RENDER_COUNT ? INITIAL_RENDER_COUNT : renderCount.value + RENDER_BATCH_SIZE;
    renderCount.value = Math.min(limit, next);
    if (renderCount.value < limit) schedule();
  }

  /**
   * 列表长度变化：目标回到空闲上限，并把窗口收回上限内
   *
   * 回落必须与目标更新在同一个 tick 内完成（`watch` 默认 pre-flush，早于本次重渲染），
   * 这样本次 DOM 补丁只触碰 `min(新长度, IDLE_RENDER_LIMIT)` 行——深滚留下的上千行会被这次
   * 补丁一并卸载，而不是留在 DOM 里参与后续每一次击键。
   *
   * 触发量选的是**长度**而不是数组引用：`filteredPasswords` 是 computed，任何依赖变化都会
   * 产出新引用，按引用回落会在"内容与行数都没变"时也把窗口砍回 100，把用户正看着的那些行
   * 卸掉、滚动条跟着跳——那是新的可见行为，不属本窗口的承诺。代价是一条已知边界：
   * 深滚放开过之后若来一次**行数恰好不变**的过滤（例如关键词命中全部条目），本次击键
   * 仍要为那上千行打补丁。它只在"先深滚、再做长度守恒的过滤"这条窄路上出现，
   * 且下一次长度一变就回到上限内。
   */
  watch(
    () => sources.totalLength(),
    len => {
      target = Math.min(len, IDLE_RENDER_LIMIT);
      if (renderCount.value > target) renderCount.value = target;
      if (renderCount.value < target) schedule();
    },
    { immediate: true },
  );

  /**
   * 键盘导航越界防护：同步放开到选中行之后的缓冲批，不做分帧
   *
   * `nextTick` 之后调用方就要 `scrollIntoView` 目标行，异步扩容会让该行的 DOM 还不存在，
   * 表现为「按 ↓ 到第 101 条时高亮消失、回车填了上一条」。
   */
  watch(
    () => sources.activeIndex(),
    index => {
      const needed = Math.min(sources.totalLength(), index + RENDER_BATCH_SIZE);
      if (needed <= renderCount.value) return;
      target = Math.max(target, needed);
      renderCount.value = needed;
    },
  );

  const notifyViewport = (metrics: ViewportMetrics) => {
    const len = sources.totalLength();
    if (renderCount.value >= len) return;
    if (metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight > VIEWPORT_PRELOAD_PX) return;
    // 滚动按需续放：至少再放开一批，越过后一屏的提前量由调用方下次采样再决定
    target = Math.min(len, Math.max(target, renderCount.value + RENDER_BATCH_SIZE));
    schedule();
  };

  onScopeDispose(() => {
    if (rafId) cancelAnimationFrame(rafId);
    stepping = false;
  });

  return { renderCount, notifyViewport };
}
