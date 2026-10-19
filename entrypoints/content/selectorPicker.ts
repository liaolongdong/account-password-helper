import { logger } from '@/utils/logger';
import { tl } from '@/utils/i18n-lite';
import {
  MessageType,
  type SelectorPickField,
  type SelectorPickedData,
  type StartSelectorPickData,
} from '@/utils/types';

/**
 * 站点规则选择器拾取器
 *
 * 用户在 Options 的站点规则表单里点「拾取」后，Background 把消息路由到目标标签页；
 * 本模块在页面顶层渲染一个封闭 Shadow DOM 的高亮层，用户点击输入框后只把生成的
 * CSS 选择器回传——不读取、不记录、不传输任何输入值。
 *
 * 为什么用「document 级事件 + pointer-events:none 覆盖层」而不是在覆盖层上监听：
 * 覆盖层一旦接收指针事件，`event.target` 只会是覆盖层，拿不到页面元素；把宿主设为
 * pointer-events:none 后，页面元素仍是事件目标，同时覆盖层只负责画高亮与提示。
 */

interface ActivePicker {
  requestId: string;
  field: SelectorPickField;
  domain: string;
  host: HTMLDivElement;
  highlight: HTMLDivElement;
  tooltip: HTMLDivElement;
  lastTarget: HTMLElement | null;
  lastX: number;
  lastY: number;
  rafId: number;
  ttlTimer: ReturnType<typeof setTimeout> | null;
  cleanup: () => void;
}

/** 拾取器最长存活时间：Options 被关闭 / 失去响应时也不能让覆盖层永久吞掉页面事件 */
const SELECTOR_PICK_TTL_MS = 120_000;

let activePicker: ActivePicker | null = null;

const PICKABLE_EXCLUDED_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'checkbox',
  'radio',
  'file',
  'image',
  'reset',
  'range',
  'color',
  'date',
  'time',
  'datetime-local',
]);

/** CSS.escape 在测试环境可能缺失，保留一个只覆盖常见字符的降级实现 */
function escapeCssIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/([^\w-])/g, '\\$1');
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}

function isUniqueSelector(selector: string, root: ParentNode): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isPickableField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    if (PICKABLE_EXCLUDED_TYPES.has((el.type || 'text').toLowerCase())) return false;
    return !el.disabled && isVisible(el);
  }
  if (el instanceof HTMLTextAreaElement) return !el.disabled && isVisible(el);
  if (el instanceof HTMLSelectElement) return !el.disabled && isVisible(el);
  return false;
}

/**
 * 从事件路径里找出用户真正想指的输入框
 *
 * `composedPath()[0]` 会穿透 open Shadow DOM，因此 Web Components 登录页也能拾取；
 * 点 label 时优先取它关联的控件，点击输入框外围的标签文字也能得到同一个选择器。
 */
function findPickableTarget(event: Event): HTMLElement | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (isPickableField(node)) return node;
    if (node instanceof HTMLLabelElement) {
      const control = node.control;
      if (control && isPickableField(control)) return control;
    }
  }
  return null;
}

function getQueryRoot(el: Element): ParentNode {
  const root = el.getRootNode();
  return root instanceof Document || root instanceof ShadowRoot ? root : document;
}

/**
 * 生成一个在所在根内唯一、且尽量稳定的 CSS 选择器
 *
 * 优先级：唯一 id → 唯一 name → 逐级 tag/nth-of-type 路径。
 * 选择器只读取属性，不读取 input.value；shadow DOM 内生成的是相对 shadow root 的选择器，
 * 与 FormDetector 的 `collectShadowQueryRoots` 消费口径一致。
 */
export function buildUniqueSelector(el: Element, root?: ParentNode): string {
  const queryRoot = root ?? getQueryRoot(el);
  const id = el.getAttribute('id');
  if (id) {
    const idSelector = `#${escapeCssIdent(id)}`;
    if (isUniqueSelector(idSelector, queryRoot)) return idSelector;
  }

  const name = el.getAttribute('name');
  const tag = el.tagName.toLowerCase();
  if (name) {
    const nameSelector = `${tag}[name="${escapeAttrValue(name)}"]`;
    if (isUniqueSelector(nameSelector, queryRoot)) return nameSelector;
  }

  const parts: string[] = [];
  let current: Element | null = el;
  while (current && parts.length < 8) {
    const currentElement: Element = current;
    const currentTag = currentElement.tagName.toLowerCase();
    const parent: Element | null = currentElement.parentElement;
    const container: ParentNode = parent ?? (currentElement.getRootNode() as ParentNode);
    const children: Element[] = Array.from(container.children ?? []);
    const siblings = children.filter(child => child.tagName === currentElement.tagName);
    let part = currentTag;
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(currentElement) + 1})`;
    parts.unshift(part);

    const selector = parts.join(' > ');
    if (isUniqueSelector(selector, queryRoot)) return selector;

    if (parent) {
      const parentId = parent.getAttribute('id');
      if (parentId && isUniqueSelector(`#${escapeCssIdent(parentId)} ${selector}`, queryRoot)) {
        return `#${escapeCssIdent(parentId)} ${selector}`;
      }
    }
    current = parent;
  }
  return parts.join(' > ');
}

/** 选择器是否在指定根内唯一；Options 侧用它给出「可能不唯一」提示 */
export function isSelectorUnique(selector: string, root: ParentNode): boolean {
  return isUniqueSelector(selector, root);
}

function createOverlay(field: SelectorPickField): {
  host: HTMLDivElement;
  highlight: HTMLDivElement;
  tooltip: HTMLDivElement;
} {
  const initialTooltip = `${tl(field === 'username' ? 'cs.selectorPicker.usernameHint' : 'cs.selectorPicker.passwordHint')} · ${tl('cs.selectorPicker.keyboardHint')} · ${tl('cs.selectorPicker.cancelHint')}`;
  const host = document.createElement('div');
  host.setAttribute('data-aph-selector-picker', 'true');
  // 覆盖层内容在 closed shadow root 里，读屏拿不到；把同一句指令挂在宿主上作为可访问状态
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-label', initialTooltip);
  host.style.cssText =
    'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .highlight {
      position: fixed;
      display: none;
      box-sizing: border-box;
      pointer-events: none;
      background: rgba(78, 136, 255, 0.14);
      border: 2px solid #4e88ff;
      border-radius: 4px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85);
    }
    .tooltip {
      position: fixed;
      display: block;
      max-width: min(360px, calc(100vw - 16px));
      padding: 8px 10px;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #fff;
      word-break: break-word;
      pointer-events: none;
      background: #0f172a;
      border-radius: 6px;
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.28);
    }
  `;
  const highlight = document.createElement('div');
  highlight.className = 'highlight';
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.textContent = initialTooltip;
  shadow.append(style, highlight, tooltip);
  document.documentElement.appendChild(host);
  return { host, highlight, tooltip };
}

function positionTooltip(tooltip: HTMLElement, target: HTMLElement | null, x: number, y: number): void {
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';
  const tooltipRect = tooltip.getBoundingClientRect();
  const targetRect = target?.getBoundingClientRect();
  const desiredTop = targetRect ? targetRect.bottom + 8 : y + 16;
  const desiredLeft = targetRect ? targetRect.left : x + 16;
  const left = Math.min(Math.max(8, desiredLeft), Math.max(8, window.innerWidth - tooltipRect.width - 8));
  const top = Math.min(Math.max(8, desiredTop), Math.max(8, window.innerHeight - tooltipRect.height - 8));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

/**
 * 启动拾取模式
 *
 * 同一时间只保留一个拾取器；新请求会先清掉旧的高亮层。
 */
export function startSelectorPick(data: StartSelectorPickData): void {
  if (!data || (data.field !== 'username' && data.field !== 'password') || !data.requestId) return;
  stopSelectorPick();

  const { host, highlight, tooltip } = createOverlay(data.field);
  const picker: ActivePicker = {
    requestId: data.requestId,
    field: data.field,
    domain: data.domain,
    host,
    highlight,
    tooltip,
    lastTarget: null,
    lastX: window.innerWidth / 2,
    lastY: window.innerHeight / 2,
    rafId: 0,
    ttlTimer: null,
    cleanup: () => {},
  };
  activePicker = picker;

  const render = (): void => {
    picker.rafId = 0;
    const target = picker.lastTarget;
    if (!target || !target.isConnected) {
      highlight.style.display = 'none';
      tooltip.textContent = `${tl('cs.selectorPicker.invalidHint')} · ${tl('cs.selectorPicker.cancelHint')}`;
      positionTooltip(tooltip, null, picker.lastX, picker.lastY);
      return;
    }
    const rect = target.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    tooltip.textContent = `${tl(picker.field === 'username' ? 'cs.selectorPicker.usernameHint' : 'cs.selectorPicker.passwordHint')} · ${tl('cs.selectorPicker.keyboardHint')} · ${tl('cs.selectorPicker.cancelHint')}`;
    positionTooltip(tooltip, target, picker.lastX, picker.lastY);
  };

  const scheduleRender = (): void => {
    if (picker.rafId) return;
    picker.rafId = window.requestAnimationFrame(render);
  };

  const notifyCancelled = (requestId: string): void => {
    try {
      void chrome.runtime
        .sendMessage({ type: MessageType.SELECTOR_PICK_CANCELLED, data: { requestId } })
        .catch(error => logger.warn('选择器拾取取消回传失败:', error));
    } catch (error) {
      logger.warn('选择器拾取取消回传失败:', error);
    }
  };

  const pickTarget = (target: HTMLElement): void => {
    const root = getQueryRoot(target);
    const selector = buildUniqueSelector(target, root);
    const unique = isSelectorUnique(selector, root);
    const requestId = picker.requestId;
    const field = picker.field;
    const domain = picker.domain;
    stopSelectorPick();
    const payload: SelectorPickedData = { domain, field, requestId, selector, unique };
    try {
      void chrome.runtime.sendMessage({ type: MessageType.SELECTOR_PICKED, data: payload }).catch(error => {
        logger.warn('选择器拾取回传失败:', error);
      });
    } catch (error) {
      logger.warn('选择器拾取回传失败:', error);
    }
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (!activePicker || !event.isTrusted) return;
    // 焦点离开输入框时清掉候选，避免 Enter 误选上一次悬停/聚焦的字段
    picker.lastTarget = findPickableTarget(event);
    scheduleRender();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!activePicker) return;
    picker.lastX = event.clientX;
    picker.lastY = event.clientY;
    picker.lastTarget = findPickableTarget(event);
    scheduleRender();
  };

  const stopPageEvent = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const onPointerDown = (event: PointerEvent): void => {
    stopPageEvent(event);
  };

  const onMouseDown = (event: MouseEvent): void => {
    stopPageEvent(event);
  };

  const onClick = (event: MouseEvent): void => {
    // 页面脚本可以合成 click；只接受浏览器/用户手势产生的事件，避免替用户选中指定字段
    if (!event.isTrusted) {
      stopPageEvent(event);
      return;
    }
    stopPageEvent(event);
    if (!activePicker) return;
    const target = findPickableTarget(event);
    if (!target) {
      picker.lastTarget = null;
      picker.lastX = event.clientX;
      picker.lastY = event.clientY;
      scheduleRender();
      return;
    }
    pickTarget(target);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!event.isTrusted) {
      stopPageEvent(event);
      return;
    }
    // Tab / Shift+Tab 放行给浏览器做焦点遍历；focusin 会把高亮跟到目标字段
    if (event.key === 'Tab') return;
    stopPageEvent(event);
    if (!activePicker) return;
    if (event.key === 'Escape') {
      const requestId = picker.requestId;
      stopSelectorPick();
      notifyCancelled(requestId);
      return;
    }
    if (event.key === 'Enter' && picker.lastTarget?.isConnected) {
      pickTarget(picker.lastTarget);
    }
  };

  const onContextMenu = (event: MouseEvent): void => {
    stopPageEvent(event);
  };

  const onScrollOrResize = (): void => {
    scheduleRender();
  };

  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize, true);

  picker.cleanup = (): void => {
    if (picker.rafId) window.cancelAnimationFrame(picker.rafId);
    if (picker.ttlTimer) clearTimeout(picker.ttlTimer);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize, true);
    host.remove();
  };

  // 内容侧自超时：Options 被关闭 / 崩溃时，覆盖层也不能永久吞掉页面点击与按键
  picker.ttlTimer = setTimeout(() => {
    if (activePicker?.requestId !== picker.requestId) return;
    const requestId = picker.requestId;
    stopSelectorPick();
    notifyCancelled(requestId);
  }, SELECTOR_PICK_TTL_MS);

  scheduleRender();
}

/**
 * 退出拾取模式；幂等，可在页面卸载 / 扩展失效 / 新请求到来时重复调用
 *
 * 传入 requestId 时只停止匹配的那一个实例：上一请求的取消消息到达时，
 * 不能误停用户刚发起的新拾取。
 */
export function stopSelectorPick(requestId?: string): void {
  if (!activePicker) return;
  if (requestId && activePicker.requestId !== requestId) return;
  const current = activePicker;
  activePicker = null;
  current.cleanup();
}

/** 当前是否有拾取器在运行（供测试与内容脚本清理使用） */
export function isSelectorPickerActive(): boolean {
  return activePicker !== null;
}
