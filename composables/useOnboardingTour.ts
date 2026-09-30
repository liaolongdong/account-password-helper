import { computed, nextTick, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { TourPlacement, TourSpot, TourStep } from '@/utils/onboardingTour';
import { CARD_WIDTH, TOUR_STEPS, expandToSpot, pickSteps, resolvePlacement } from '@/utils/onboardingTour';
import { StorageUtils } from '@/utils/storage';
import { isEditableEventTarget, scrollBehavior } from '@/utils/a11y';
import { logger } from '@/utils/logger';

/**
 * 聚光引导的响应式状态机
 *
 * 职责边界：本 composable 负责「DOM 测量 + 生命周期 + 落盘」这三类副作用，
 * 剧本与几何计算留在 `utils/onboardingTour.ts`（纯函数、可单测），
 * 界面留在 `components/options/OnboardingTour.vue`（只管渲染）。
 *
 * 引导只在 Options 认证态出现，因此这里的 `window` / `document` 访问都成立；
 * 卸载一律走 `onScopeDispose`，避免组件树复用后残留监听。
 */

/** 打开引导时的可选入参 */
export interface StartTourOptions {
  /**
   * 起始步骤标识
   *
   * 默认从头开始；未来若要「只讲某一步」的深链（如帮助文档里点某条）可直接复用本参数。
   */
  startId?: string;
}

/** 锚点选择器前缀：页面上以 `data-tour="add"` 这类属性声明可被聚光的元素 */
const ANCHOR_SELECTOR = 'data-tour';

/**
 * 查询锚点元素
 *
 * @param anchor 锚点键名
 * @returns 命中的元素；未命中返回 null
 */
function findAnchor(anchor: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${ANCHOR_SELECTOR}="${anchor}"]`);
}

export function useOnboardingTour() {
  /** 引导是否正在展示 */
  const isActive = ref(false);
  /** 开场时裁剪出的剧本快照（步内不再变动，避免索引错位） */
  const steps = shallowRef<TourStep[]>([]);
  /** 当前步骤在快照中的下标 */
  const stepIndex = ref(0);
  /** 当前聚光框；`null` 表示无锚点（欢迎步整屏居中） */
  const spot = ref<TourSpot | null>(null);
  /** 当前卡片落点 */
  const placement = ref<TourPlacement>({ side: 'center', top: 0, left: 0 });
  /** 卡片根节点（组件透传，供测量高度与聚焦） */
  const cardRef = ref<HTMLElement | null>(null);
  /** 卡片实测高度；未测量前用 0 触发一次即刻重算 */
  const cardHeight = ref(0);

  /** 当前步骤 */
  const currentStep = computed<TourStep | undefined>(() => steps.value[stepIndex.value]);

  /** 是否已到最后一步 */
  const isLast = computed(() => stepIndex.value >= steps.value.length - 1);

  /** 是否已是第一步 */
  const isFirst = computed(() => stepIndex.value === 0);

  /** 总步数 */
  const total = computed(() => steps.value.length);

  /** 进度百分比（供进度条与读屏播报共用同一个数） */
  const progress = computed(() => (total.value === 0 ? 0 : ((stepIndex.value + 1) / total.value) * 100));

  /**
   * 测量并更新聚光框与卡片落点
   *
   * 一次只做「读矩形 → 算落点」，不写回 DOM；调用时机由步骤切换、卡片尺寸变化、
   * 滚动与缩放共同决定。锚点在开场已确认存在，切换后若查不到（页面被回收重渲染）
   * 则退回居中，宁可丢一次聚光也不让卡片飘到未知位置。
   */
  function measure(): void {
    const step = currentStep.value;
    if (!step || !isActive.value) return;

    const element = step.anchor ? findAnchor(step.anchor) : null;
    if (step.anchor && !element) {
      spot.value = null;
      placement.value = { side: 'center', top: 0, left: 0 };
      return;
    }

    const nextSpot = element ? expandToSpot(element.getBoundingClientRect()) : null;
    spot.value = nextSpot;
    placement.value = resolvePlacement(
      nextSpot,
      { width: CARD_WIDTH, height: cardHeight.value || cardRef.value?.offsetHeight || 0 },
      { width: window.innerWidth, height: window.innerHeight },
      step.prefer,
    );
  }

  /**
   * 把锚点滚进视野
   *
   * 只负责发起滚动，不等待结束：`scrollBehavior()` 在要求减弱动效时返回 `auto`
   * （瞬时），否则平滑滚动期间会连续触发下面的 scroll 监听并重新测量，
   * 聚光框因此始终贴着锚点，不需要额外估时。
   */
  function revealAnchor(): void {
    const anchor = currentStep.value?.anchor;
    if (!anchor) return;
    findAnchor(anchor)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() });
  }

  /**
   * 切到指定步
   *
   * 越界由调用方（上一步 / 下一步 / 进度点）先行判定，这里只做夹取，
   * 免得键盘连按方向键时跑出剧本。
   */
  function goTo(index: number): void {
    if (!isActive.value || steps.value.length === 0) return;
    const next = Math.min(Math.max(index, 0), steps.value.length - 1);
    if (next === stepIndex.value) return;
    stepIndex.value = next;
    revealAnchor();
    nextTick(measure);
  }

  const next = () => goTo(stepIndex.value + 1);
  const prev = () => goTo(stepIndex.value - 1);

  /**
   * 结束引导并落盘
   *
   * 只有「走完」和「主动退出」两种结束方式会写存储，且写的全是标记位；
   * 失败不外抛（`saveOnboardingTourState` 内部已降级为告警），
   * 因为落盘失败最坏的后果只是下次再弹一次，不值得打断用户。
   */
  async function close(outcome: 'completed' | 'skipped'): Promise<void> {
    if (!isActive.value) return;
    isActive.value = false;
    steps.value = [];
    stepIndex.value = 0;
    spot.value = null;
    placement.value = { side: 'center', top: 0, left: 0 };
    await StorageUtils.saveOnboardingTourState({ seen: true, outcome, finishedAt: Date.now() });
  }

  /** 走完最后一步 */
  const finish = () => close('completed');

  /** 中途退出（跳过按钮 / Esc / 关闭） */
  const skip = () => close('skipped');

  /** 进度点跳转 */
  function goToStep(index: number): void {
    goTo(index);
  }

  /**
   * 打开引导
   *
   * 先按锚点存在性裁剪剧本，再定位起始步。首步是无锚点的欢迎步，`pickSteps` 恒保留它，
   * 因此以当前剧本而言这里总能打开（锚点全缺时退化成只讲欢迎步，仍给出退出入口），
   * 返回 false 只在剧本被清空这种异常形态下发生，不静默摆一个零步弹窗。
   *
   * @param options 起始步等可选入参
   * @returns 是否真的打开了
   */
  async function start(options: StartTourOptions = {}): Promise<boolean> {
    if (isActive.value) return true;

    const snapshot = pickSteps(TOUR_STEPS, anchor => findAnchor(anchor) !== null);
    if (snapshot.length === 0) {
      logger.debug('新手引导未打开：页面上没有任何可聚光的锚点');
      return false;
    }

    const wanted = options.startId ? snapshot.findIndex(step => step.id === options.startId) : -1;
    steps.value = snapshot;
    stepIndex.value = wanted >= 0 ? wanted : 0;
    isActive.value = true;

    revealAnchor();
    await nextTick();
    measure();
    // 卡片文案随步骤变化，首帧高度只有渲染后才知道；再测一次把落点校准
    await nextTick();
    measure();
    return true;
  }

  // ==================== 副作用装配 ====================

  /** 滚动与缩放共用一个 rAF 节流回调，避免长列表滚动时逐事件重排 */
  let frameId = 0;
  function scheduleMeasure(): void {
    if (frameId) return;
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      measure();
    });
  }

  /**
   * 键盘导航
   *
   * 只接管 Esc 与左右方向键；焦点落在可编辑元素上时整体让路，
   * 免得后续有人往卡片里加输入框时被这里吃掉原生行为。
   */
  function handleKeydown(event: KeyboardEvent): void {
    if (!isActive.value || isEditableEventTarget(event.target)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void skip();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      prev();
    }
  }

  /** 监听随开随关，避免引导关闭后仍在全局处理按键 */
  watch(isActive, active => {
    if (active) {
      window.addEventListener('keydown', handleKeydown);
      window.addEventListener('resize', scheduleMeasure);
      window.addEventListener('scroll', scheduleMeasure, true);
      return;
    }
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('resize', scheduleMeasure);
    window.removeEventListener('scroll', scheduleMeasure, true);
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
  });

  /**
   * 卡片高度变化时重新求解落点
   *
   * 中英文案行数不同、窄屏换行都会改变高度，而方位翻转的判据依赖高度。
   * 用 ResizeObserver 而不是每步 `nextTick` 估一次，是为了让「高度已知」
   * 这件事由布局自己回答；卡片在引导关闭时卸载，observer 自然断开。
   */
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      cardHeight.value = Math.round(entry.contentRect.height);
    }
    measure();
  });

  watch(cardRef, (element, previous) => {
    if (previous) resizeObserver.unobserve(previous);
    if (element) {
      resizeObserver.observe(element);
      cardHeight.value = Math.round(element.offsetHeight);
      // 模态必须真的把焦点接住：读屏与键盘用户否则仍停留在背后的页面上
      if (isActive.value) element.focus({ preventScroll: true });
      return;
    }
    cardHeight.value = 0;
  });

  onScopeDispose(() => {
    resizeObserver.disconnect();
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('resize', scheduleMeasure);
    window.removeEventListener('scroll', scheduleMeasure, true);
    if (frameId) cancelAnimationFrame(frameId);
  });

  /**
   * 接收展示组件的卡片节点
   *
   * 模板引用只能绑到组件自己的局部 ref，composable 拿不到，所以开一个显式入口。
   * 不让组件直接写 `tour.cardRef.value`：那是在跨边界改调用方持有的状态，
   * 语义上等同于改 props（`vue/no-mutating-props`），收成方法后写入点唯一。
   *
   * @param element 卡片根节点；组件卸载时为 null
   */
  function setCard(element: HTMLElement | null): void {
    cardRef.value = element;
  }

  return {
    isActive,
    steps,
    total,
    stepIndex,
    currentStep,
    spot,
    placement,
    setCard,
    progress,
    isFirst,
    isLast,
    start,
    next,
    prev,
    goToStep,
    finish,
    skip,
  };
}

/**
 * 引导状态机对外的契约
 *
 * 展示组件按此类型接收实例（由 Options 根组件持有并向下传递），
 * 从而把「谁拥有状态」固定在页面入口那一层，而不是藏在组件或模块级全局里。
 */
export type OnboardingTourApi = ReturnType<typeof useOnboardingTour>;
