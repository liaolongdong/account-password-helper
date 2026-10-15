/**
 * 身份库召唤提示（页面侧）
 *
 * 用户聚焦到一个「语义上属于个人信息」的字段时，在字段下方出现一枚轻量气泡，
 * 告诉用户「这个框要的是姓名 / 证件号 / 邮编」，并提供一个动作：打开管理页的身份库
 * （照旧过复验门槛）由用户自己取值。本模块**不填充、不取值、不比对库内数据**——
 * 页侧从未接触过密文与明文，跨入口只流动「角色」这一个枚举标签。
 *
 * 为什么做成提示而不是自动填充：身份明文只在管理页文档内存在（见
 * `docs/ARCHITECTURE.md`「27. 身份信息库」），把它送进页面需要同时放宽存储边界、
 * 复验语义与剪贴板白名单三处既有约定；提示 + 深链把「选择哪条身份」的决定权留在
 * 用户手里，与三档复验策略（默认每会话一次）也不冲突。
 *
 * 隔离约束（对齐内容脚本规范，口径同 `FillFailurePrompt.ts`）：
 * - 独立 closed shadow DOM 宿主挂在 `documentElement` 上，内部 `all: initial` +
 *   主题令牌内联写入，不污染宿主页面样式，也不被宿主页面样式污染；
 * - 宿主冒泡阶段做事件隔离，避免页内弹窗把气泡的点击当成「点击外部」而误关；
 * - 单例：同一时刻最多一枚气泡，跟随当前聚焦字段重建；
 * - 键盘出口：Esc 收起；动作按钮 `mousedown/pointerdown`  preventDefault，
 *   保持焦点留在页面字段上（否则点击即触发 blur，气泡在click落地前就被收掉）。
 *
 * @module entrypoints/content/IdentityHint
 */
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { onLiteLocaleChanged, tl } from '@/utils/i18n-lite';
import { applyThemeTokensToHost, DEFAULT_THEME, getStoredTheme } from '@/utils/theme';
import type { IdentityHintRole } from '@/utils/identity/hintRoles';
import { attachHostEventIsolation } from './inlineDropdown/eventIsolation';

let hostEl: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;

/** 当前气泡绑定的字段（用于「同一字段重复聚焦不重建」与失焦收起判定） */
let boundInput: HTMLElement | null = null;
/** 当前是否处于「需要核对」形态，语言切换重绘时要带上 */
let boundNeedsVerify = false;
/** 当前气泡的角色，同上 */
let boundRole: IdentityHintRole | null = null;
/** 气泡生命周期内的监听清理（blur / scroll / resize / Escape / 语言订阅） */
let cleanups: (() => void)[] = [];

/** 气泡与字段的间距 */
const GAP = 6;
/** 视口安全边距，避免贴边与溢出 */
const EDGE = 8;
/** `cs.identity.hintTitle` 模板里的角色占位符 */
const ROLE_PLACEHOLDER = '{role}';

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .aph-idh {
    position: fixed;
    z-index: 2147483647;
    max-width: 300px;
    padding: 10px 12px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #303133;
    background: #fff;
    border: 1px solid #ebeef5;
    border-radius: 10px;
    box-shadow: 0 6px 18px rgb(0 0 0 / 12%);
  }
  .aph-idh__title {
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-weight: 600;
  }
  .aph-idh__role {
    color: var(--aph-primary, #409eff);
  }
  .aph-idh__verify {
    margin: 4px 0 0;
    color: #e6a23c;
    font-size: 12px;
  }
  .aph-idh__actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 10px;
  }
  .aph-idh__btn {
    padding: 5px 12px;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    border: 1px solid transparent;
    border-radius: 6px;
  }
  .aph-idh__btn--primary {
    color: #fff;
    background: var(--aph-primary, #409eff);
  }
  .aph-idh__btn--primary:hover { background: var(--aph-primary-hover, #66b3ff); }
  .aph-idh__btn--ghost {
    color: #606266;
    background: #fff;
    border-color: #dcdfe6;
  }
  .aph-idh__btn--ghost:hover {
    color: var(--aph-primary, #409eff);
    border-color: var(--aph-primary-border, #d9ecff);
  }
  .aph-idh__btn:focus-visible {
    outline: 2px solid var(--aph-primary, #409eff);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .aph-idh { transition: none; }
  }
`;

/** 确保 shadow 宿主已就绪（常驻复用，收起只清内容） */
function ensureHost(): void {
  if (hostEl && shadowRoot) return;
  hostEl = document.createElement('div');
  hostEl.setAttribute('data-aph', 'identity-hint');
  applyThemeTokensToHost(hostEl, DEFAULT_THEME);
  shadowRoot = hostEl.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = STYLE;
  shadowRoot.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'aph-idh-root';
  shadowRoot.appendChild(wrap);

  document.documentElement.appendChild(hostEl);
  attachHostEventIsolation(hostEl);

  void getStoredTheme().then(theme => {
    if (hostEl) applyThemeTokensToHost(hostEl, theme);
  });
}

/** 元素是否落在可视区内（字段被滚出视口时气泡没有意义） */
function isInViewport(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
}

/**
 * 把气泡锚定到字段下缘，下方放不下就翻到上方，左右夹在视口内
 *
 * 只读 `getBoundingClientRect`，不改宿主页面任何布局。
 */
function position(bubble: HTMLElement): void {
  if (!boundInput) return;
  const rect = boundInput.getBoundingClientRect();
  if (!isInViewport(rect)) {
    hideIdentityHint();
    return;
  }
  const height = bubble.offsetHeight;
  const width = bubble.offsetWidth;
  const below = rect.bottom + GAP;
  const top = below + height > window.innerHeight - EDGE ? Math.max(EDGE, rect.top - height - GAP) : below;
  const left = Math.min(Math.max(EDGE, rect.left), Math.max(EDGE, window.innerWidth - width - EDGE));
  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
}

/** 释放当前气泡的全部监听 */
function releaseCleanups(): void {
  cleanups.forEach(off => off());
  cleanups = [];
}

/**
 * 隐藏并清空气泡内容（保留宿主以便复用）
 *
 * 收起路径有四条：字段失焦、Esc、用户点动作按钮、以及调用方显式收起。
 * 四条都走这里，保证监听与语言订阅不累积。
 */
export function hideIdentityHint(): void {
  releaseCleanups();
  boundInput = null;
  boundRole = null;
  boundNeedsVerify = false;
  if (shadowRoot) {
    const root = shadowRoot.getElementById('aph-idh-root');
    if (root) root.replaceChildren();
  }
}

/** 彻底拆除宿主（content script 卸载时调用） */
export function destroyIdentityHint(): void {
  hideIdentityHint();
  hostEl?.remove();
  hostEl = null;
  shadowRoot = null;
}

/** 构造气泡内容节点（纯文本写入，绝不使用 innerHTML，字段值不进这里） */
function buildBubble(role: IdentityHintRole, needsVerify: boolean): HTMLElement {
  const bubble = document.createElement('div');
  bubble.className = 'aph-idh';
  bubble.setAttribute('role', 'status');

  const title = document.createElement('div');
  title.className = 'aph-idh__title';
  // 不传 params 取模板原文，按 `{role}` 切成两段再夹入高亮节点：中英文语序不同也不需各写一套拼接。
  // 角色词由本模块词典给出（非页面内容），两段均为文本节点，不经过 innerHTML。
  const [head, tail = ''] = tl('cs.identity.hintTitle').split(ROLE_PLACEHOLDER);
  const roleSpan = document.createElement('span');
  roleSpan.className = 'aph-idh__role';
  roleSpan.textContent = tl(`cs.identity.role.${role}`);
  title.append(head, roleSpan, tail);

  bubble.appendChild(title);

  if (needsVerify) {
    const verify = document.createElement('p');
    verify.className = 'aph-idh__verify';
    verify.textContent = tl('cs.identity.hintVerify');
    bubble.appendChild(verify);
  }

  const actions = document.createElement('div');
  actions.className = 'aph-idh__actions';
  // 按下不改变焦点：气泡会因 blur 收起，默认动作会让 click 根本落不到按钮上
  actions.addEventListener('mousedown', e => e.preventDefault());
  actions.addEventListener('pointerdown', e => e.preventDefault());

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'aph-idh__btn aph-idh__btn--ghost';
  dismiss.textContent = tl('cs.identity.hintDismiss');
  dismiss.addEventListener('click', hideIdentityHint);

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'aph-idh__btn aph-idh__btn--primary';
  pick.textContent = tl('cs.identity.hintPick');
  pick.addEventListener('click', () => {
    openIdentityVault(role);
    hideIdentityHint();
  });

  actions.appendChild(dismiss);
  actions.appendChild(pick);
  bubble.appendChild(actions);
  return bubble;
}

/**
 * 通知后台打开管理页身份库
 *
 * 载荷只有已收窄的角色枚举：不含字段值、不含页面 URL、不含任何库内数据。
 * 扩展上下文失效（页面残留旧 content script）时静默降级，不打扰用户。
 */
function openIdentityVault(role: IdentityHintRole): void {
  try {
    void chrome.runtime
      .sendMessage({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { role } })
      .catch(err => logger.debug('IdentityHint: 打开身份库指令发送失败:', err));
  } catch (err) {
    logger.debug('IdentityHint: 扩展上下文不可用:', err);
  }
}

/**
 * 为当前聚焦字段显示身份提示
 *
 * @param input 聚焦的字段（只取其几何位置与角色结论，不读值）
 * @param role 已收窄的语义角色
 * @param needsVerify 是否属于「需核对」档（证件号或他人歧义）
 */
export function showIdentityHint(input: HTMLElement, role: IdentityHintRole, needsVerify: boolean): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  // 同一字段重复聚焦（如 Tab 回来）不重建，避免每次按键都闪一下
  if (boundInput === input && boundRole === role && boundNeedsVerify === needsVerify) return;

  ensureHost();
  const root = shadowRoot?.getElementById('aph-idh-root');
  if (!root) return;

  releaseCleanups();
  boundInput = input;
  boundRole = role;
  boundNeedsVerify = needsVerify;

  const bubble = buildBubble(role, needsVerify);
  root.replaceChildren(bubble);
  position(bubble);

  const onScrollOrResize = (): void => position(bubble);
  const onBlur = (event: FocusEvent): void => {
    if (event.target === input) hideIdentityHint();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) return;
    hideIdentityHint();
  };
  const offLocale = onLiteLocaleChanged(() => {
    if (boundRole) {
      root.replaceChildren(buildBubble(boundRole, boundNeedsVerify));
      const next = root.firstElementChild;
      if (next instanceof HTMLElement) position(next);
    }
  });

  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
  // 焦点离开这个字段即收起：挂在 document 冒泡阶段，字段数量再多也只有一条监听
  document.addEventListener('focusout', onBlur);
  document.addEventListener('keydown', onKeyDown, true);
  cleanups = [
    () => window.removeEventListener('scroll', onScrollOrResize, true),
    () => window.removeEventListener('resize', onScrollOrResize),
    () => document.removeEventListener('focusout', onBlur),
    () => document.removeEventListener('keydown', onKeyDown, true),
    offLocale,
  ];
}
