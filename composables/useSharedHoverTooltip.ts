import { getCurrentScope, onScopeDispose, ref } from 'vue';

/**
 * 共享悬浮提示的展示上下文
 */
export interface SharedHoverTooltipContext {
  /** 本次要成为虚拟触发点的元素 */
  element: HTMLElement;
  /** 提示文案（取自元素的 `data-*`） */
  content: string;
  /** 原始 mouseenter 事件，可透传给 `el-tooltip` 的 `onOpen` 作为触发原因 */
  event?: MouseEvent;
}

/**
 * `useSharedHoverTooltip` 的可选配置
 */
export interface SharedHoverTooltipOptions {
  /** 承载提示文案的 dataset 键，默认 `tip`（对应模板里的 `data-tip`） */
  tipDataKey?: string;
  /** 悬停多久后展示，默认 400 毫秒，必须与被替换掉的 `el-tooltip :show-after` 保持一致 */
  showAfter?: number;
  /** 到点展示回调：由调用方切换 `el-tooltip` 的虚拟触发点并打开它 */
  present: (context: SharedHoverTooltipContext) => void;
}

/**
 * 单实例共享 tooltip 的显示排程器
 *
 * 用途：大列表里把「每行 N 个 `el-tooltip`」收敛成全表一个 `virtual-triggering` 实例。
 * Element Plus 的隐藏（`hide-after`）、移入浮层保持显示（`enterable`）、
 * `aria-describedby` 标注都仍由它自己负责——这些行为逐字沿用原实现，本模块不重写。
 *
 * 本模块只补 EP 无法自己做的半件事：虚拟触发点是在 `mouseenter` **之后**才被改写的，
 * EP 绑在新元素上的 `mouseenter` 这一帧不会再触发，所以首次悬停的显示延迟必须由调用方计时。
 * 而**再次**悬停同一颗元素时 EP 那份监听器已经在了，会按 `el-tooltip` 自己的 `show-after` 打开——
 * 因此 `showAfter` 必须与实例上的 `show-after` 取同一个值，且 `present` 里打开时要显式传 0 延迟，
 * 否则二次悬停会提前弹出并显示上一次缓存的文案。
 *
 * 两条等价性要害（由 `tests/composables/useSharedHoverTooltip.test.ts` 钉住）：
 * - 到点前不改 `triggerEl` / `content`：提前改会让仍在显示的旧浮层跳到新按钮上换文案，
 *   而原实现的观感是「旧的 200 毫秒后关、新的 400 毫秒后开」，中间有一段空白；
 * - 不做「已显示过就跳过」的短路：重复悬停同一元素必须照常排程，
 *   「200 毫秒内回到同一元素不闪烁」靠的是 EP 自己的计时器取消。
 *
 * @param options - 属性名、延迟与展示回调
 * @returns 虚拟触发点与文案（供模板绑定）、排程入口 `arm` 与取消入口 `cancel`
 */
export function useSharedHoverTooltip(options: SharedHoverTooltipOptions) {
  const { tipDataKey = 'tip', showAfter = 400, present } = options;

  /** 当前虚拟触发点（交给 `el-tooltip` 的 `virtual-ref`） */
  const triggerEl = ref<HTMLElement>();
  /** 当前提示文案（交给 `el-tooltip` 的 `content`） */
  const content = ref('');

  /** 挂起中的展示定时器 */
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** 取消挂起的展示（离开元素、主动关闭、作用域销毁时调用） */
  const cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  /**
   * 登记一次悬停
   *
   * 元素与文案都在这一帧同步读取：`event.currentTarget` 在派发结束后会被置空，
   * 定时器回调里再取就拿不到触发者了。
   *
   * @param event - `mouseenter` 事件，其 `currentTarget` 为携带 `data-*` 的触发元素
   */
  const arm = (event: MouseEvent) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const text = target.dataset[tipDataKey]?.trim();
    if (!text) return;

    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      triggerEl.value = target;
      content.value = text;
      present({ element: target, content: text, event });
    }, showAfter);
  };

  if (getCurrentScope()) {
    onScopeDispose(cancel);
  }

  return { triggerEl, content, arm, cancel };
}
