import { onScopeDispose, watch, type Ref } from 'vue';

/**
 * 模态焦点陷阱 Composable
 *
 * 组件只要声明了 `aria-modal="true"`，就必须真的把 Tab 关在面板里，并在关闭时把焦点
 * 还给唤起方——否则读屏与键盘用户要么走到背后的页面上（模态语义与视觉不一致），
 * 要么在关闭后被丢回 `body`，每次重开都得重新找焦点。
 *
 * 这里只负责「Tab 圈定 + 焦点归还原主」这一件事；↑↓ / Enter / Esc 这类语义导航
 * 仍由调用方（或其父级 composable）处理，避免两条链互相抢键盘事件。
 */

/**
 * 容器内可聚焦元素选择集
 *
 * 活动项本身不在其中：列表用 `aria-activedescendant` 由输入框代表焦点，
 * 条目元素不挂 `tabindex`，否则 Tab 会把每一项都念一遍。
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * 收集容器内的焦点候选
 *
 * 两道筛选各有分工：
 * - 选择集负责排除「压根不可聚焦」的（无 href 的 `a`、禁用表单控件、无 tabindex 的容器）；
 * - `tabIndex >= 0` 负责排除「只能被脚本聚焦」的——原生控件即使带 `tabindex="-1"`
 *   仍会命中 `button:not([disabled])`，把它算进候选集会形成"按 Tab 走进一个再也走不出来的
 *   元素"，读屏用户直接被吞掉。
 *
 * 刻意不再按可见性筛：候选集要能被稳定测试，而 `offsetParent` 与 `getClientRects()`
 * 这类布局判定在无布局的环境（jsdom、尚未完成首帧的覆盖层）里会把候选误杀成 0 个，
 * 让陷阱静默失效——静默失效正是模态最糟的失败方式。若日后加入按需隐藏的控件，
 * 请用 `v-if` 卸载，不要只靠 `display: none` 留在 DOM 里。
 *
 * @param container 陷阱作用域根节点
 * @returns 按文档顺序排列的可聚焦元素
 */
export function collectFocusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(el => el.tabIndex >= 0);
}

/**
 * 为模态容器绑定 Tab 焦点陷阱，并在关闭时归还原主焦点
 *
 * @param container 面板根节点引用（随 `v-if` / Teleport 变化时会自动重新绑定）
 * @param enabled 面板是否可见；由真变假时把焦点还给打开前的元素
 */
export function useFocusTrap(container: Ref<HTMLElement | null | undefined>, enabled: Ref<boolean>): void {
  /** 打开面板时焦点所在的元素，关闭后原样还回去 */
  let openerEl: HTMLElement | null = null;
  /** 当前已挂载监听的节点，保证重复触发只注册一次监听 */
  let boundEl: HTMLElement | null = null;

  /** 把 Tab 圈在容器内：首尾互相回环，焦点已逃出容器时拉回边界 */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !boundEl) return;

    const focusables = collectFocusables(boundEl);
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const forward = !event.shiftKey;

    // 焦点已不在候选集里（或落在不可聚焦的容器上）：拉回边界，不放它继续走出模态层
    if (!active || !focusables.includes(active)) {
      event.preventDefault();
      (forward ? first : last).focus();
      return;
    }

    if ((forward && active === last) || (!forward && active === first)) {
      event.preventDefault();
      (forward ? first : last).focus();
    }
  }

  /**
   * 记录 / 归还原主焦点
   *
   * 只在可见性翻转时执行，容器节点更换不会重复记录（否则原主会被输入框自己覆盖）。
   * 带 `immediate` 是为了覆盖"组件挂载时面板已经打开"的顺序。
   * 调用方的自动聚焦必须放到 `nextTick` 之后：本回调与调用方回调同批同步执行，
   * 而焦点要到下一微任务才移动，这里读到的才是"打开前"的焦点。
   */
  watch(
    enabled,
    isVisible => {
      if (isVisible) {
        openerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        return;
      }
      const opener = openerEl;
      openerEl = null;
      // 面板经 Teleport 挂到 body，关闭即销毁；唤起方在此期间被卸载时不该硬聚焦
      if (opener?.isConnected) opener.focus();
    },
    { immediate: true },
  );

  watch(
    [enabled, container],
    ([isVisible, el]) => {
      const target = isVisible ? (el ?? null) : null;
      if (target === boundEl) return;
      boundEl?.removeEventListener('keydown', handleKeydown);
      boundEl = target;
      boundEl?.addEventListener('keydown', handleKeydown);
    },
    { immediate: true, flush: 'post' },
  );

  onScopeDispose(() => {
    boundEl?.removeEventListener('keydown', handleKeydown);
    boundEl = null;
    openerEl = null;
  });
}
