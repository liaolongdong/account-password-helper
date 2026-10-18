/**
 * 身份库召唤提示（页面侧）
 *
 * 用户聚焦到一个「语义上属于个人信息」的字段时，在字段下方出现一枚轻量气泡，
 * 告诉用户「这个框要的是姓名 / 证件号 / 邮编」，并提供一个动作：打开管理页的身份库
 * （照旧过复验门槛）由用户自己取值。本模块**不填充、不比对库内数据**；跨入口只流一个
 * 可选的搜索词，取值按角色分两条通道（见 {@link pickSearchKeyword}）：其余角色带同一表单里
 * 用户已经打好的本人姓名，编号族带**这一格叫什么**（字段标签文本，它的落点是库里的自定义字段）。
 * 两者都只在用户点下「从身份库选择」那一刻才读（判据与边界见 `piiClassifier` 那两个取值函数）。
 * 库内密文与明文始终不离开管理页。
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
 * - 键盘出口：`Esc` 收起；`Alt+↓` 把焦点送进气泡的动作行——宿主是挂在 `documentElement`
 *   末尾的 fixed 浮层，普通 `Tab` 会在到达按钮之前先触发字段失焦而把气泡收掉，
 *   所以键盘用户需要一条显式入口（否则提示读得到、按不到）；
 * - 动作按钮 `mousedown/pointerdown`  preventDefault，保持焦点留在页面字段上
 *   （否则点击即触发 blur，气泡在 click 落地前就被收掉）。
 *
 * @module entrypoints/content/IdentityHint
 */
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { onLiteLocaleChanged, tl } from '@/utils/i18n-lite';
import { type ThemeName, applyThemeTokensToHost, DEFAULT_THEME, getStoredTheme } from '@/utils/theme';
import { CUSTOM_FIELD_LANDING_ROLES, type IdentityHintRole } from '@/utils/identity/hintRoles';
import { attachHostEventIsolation } from './inlineDropdown/eventIsolation';
import { hintFieldKeyword, selfNameValueNear } from './piiClassifier';

let hostEl: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;

/** 当前气泡绑定的字段（用于「同一字段重复聚焦不重建」与失焦收起判定） */
let boundInput: HTMLElement | null = null;
/** 当前是否处于「需要核对」形态，语言切换重绘时要带上 */
let boundNeedsVerify = false;
/** 当前气泡的角色，同上 */
let boundRole: IdentityHintRole | null = null;
/** 气泡生命周期内的监听清理（blur / scroll / resize / Escape / Alt+↓ / 语言订阅） */
let cleanups: (() => void)[] = [];
/**
 * 滚动/缩放重定位的 rAF 句柄
 *
 * `position()` 先读 `getBoundingClientRect` 与 `offsetHeight/Width` 再写 `style.top/left`，
 * 每个 scroll 事件都跑一遍就是「读几何→写样式」逐帧交错强制回流（口径同 `FillAckChip`）。
 */
let repositionRaf: number | null = null;

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
    /* 强调靠字重而不是颜色：六套皮肤的 --aph-primary 在白底上只有 2.4~3.2:1，
       13px 文字直接达不到 WCAG 1.4.3；主色留给按钮、边框与焦点环这些非文字载体。 */
    color: inherit;
    font-weight: 700;
  }
  .aph-idh__verify {
    margin: 4px 0 0;
    /* 原 #e6a23c 在白底仅 2.19:1；压深到同族琥珀（5.9:1）才读得清，警示语义靠文字本身而非颜色 */
    color: #8a5a00;
    font-size: 12px;
  }
  .aph-idh__custom {
    margin: 4px 0 0;
    /* 取 tokens.css 里 --aph-text-secondary 的同值（原 #909399 仅 3.08:1）；
       影子根拿不到页面继承，中性色要用得先进 theme.ts 的 SHADOW_NEUTRAL_TOKENS 内联镜像，
       这一行按既有口径写字面色值，shadowTokenCoverage 守卫只管 var(--aph-*) 形态的引用 */
    color: #6b7280;
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

/**
 * 换肤时重放主题令牌
 *
 * 影子根里只有**内联写进宿主**的自定义属性可解析，而 `ensureHost` 是常驻复用的（收起只清
 * 内容、不拆宿主），所以管理页把主题拨走后，这枚气泡会一直用旧主色渲染到页面刷新为止。
 * 由 `FormDetector` 的配置变更监听转调，与眼睛图标、内联下拉、接力胶囊同一批回调。
 *
 * @param theme 当前主题
 */
export function setIdentityHintTheme(theme: ThemeName): void {
  if (hostEl) applyThemeTokensToHost(hostEl, theme);
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
  if (repositionRaf !== null) {
    cancelAnimationFrame(repositionRaf);
    repositionRaf = null;
  }
}

/**
 * 隐藏并清空气泡内容（保留宿主以便复用）
 *
 * 收起路径有五条：字段失焦、Esc、用户点动作按钮、调用方显式收起、以及总闸在别的上下文里
 * 被拨到关（管理页/侧边栏的偏好设置弹窗写这份配置，由 `FormDetector` 的存储监听转调这里）。
 * 五条都走这里，保证监听与语言订阅不累积。
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

  // 播报范围只罩住文字行：整枚气泡挂 `role=status` 会把两个动作按钮一起包进活动区域，
  // 焦点每动一次就重播一遍「收起 / 从身份库选择」，而按钮本就该靠自身标签被读到。
  const body = document.createElement('div');
  body.className = 'aph-idh__body';
  body.setAttribute('role', 'status');

  const title = document.createElement('div');
  title.className = 'aph-idh__title';
  // 不传 params 取模板原文，按 `{role}` 切成两段再夹入高亮节点：中英文语序不同也不需各写一套拼接。
  // 角色词由本模块词典给出（非页面内容），两段均为文本节点，不经过 innerHTML。
  const [head, tail = ''] = tl('cs.identity.hintTitle').split(ROLE_PLACEHOLDER);
  const roleSpan = document.createElement('span');
  roleSpan.className = 'aph-idh__role';
  roleSpan.textContent = tl(`cs.identity.role.${role}`);
  title.append(head, roleSpan, tail);

  body.appendChild(title);

  if (needsVerify) {
    const verify = document.createElement('p');
    verify.className = 'aph-idh__verify';
    verify.textContent = tl('cs.identity.hintVerify');
    body.appendChild(verify);
  }

  // 库里没有这一格的角色（编号族、以及由机构证照闸门改判进来的那一族）必须自己说清「存哪儿」，
  // 否则用户按提示去库里找「编号」那一格会落空——这一行只在这几档出现，其余角色的落点是库里的内置字段。
  if (CUSTOM_FIELD_LANDING_ROLES.includes(role)) {
    const custom = document.createElement('p');
    custom.className = 'aph-idh__custom';
    custom.textContent = tl('cs.identity.hintCustomField');
    body.appendChild(custom);
  }

  bubble.appendChild(body);

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
  // 搜索词在点击这一刻才取：聚焦期间不缓存任何字段值，明文的存活时间等于这一次消息的在途时间
  pick.addEventListener('click', () => {
    openIdentityVault(pickSearchKeyword());
    hideIdentityHint();
  });

  actions.appendChild(dismiss);
  actions.appendChild(pick);
  bubble.appendChild(actions);
  return bubble;
}

/**
 * 点击「从身份库选择」时该带哪个搜索词
 *
 * 两条通道按角色分派，各自只在被点中的那一次求值（判据与边界见
 * `piiClassifier` 里 `selfNameValueNear` / `hintFieldKeyword` 两个函数的注释）：
 * - 自定义字段档（{@link CUSTOM_FIELD_LANDING_ROLES}，即 `serialNumber`：编号族 + 由机构证照
 *   闸门改判进来的那一族）：库里没有那一格，用户在身份里存的是自拟的**自定义字段**，
 *   其标签参与检索，所以带「这一格叫什么」过去才命中；
 * - 其余角色：带同一表单里已经打好的本人姓名，把列表筛到那一个人。
 *
 * 取不到就是空串，由 `openIdentityVault` 把整包载荷收掉。
 */
function pickSearchKeyword(): string {
  if (!boundInput) return '';
  const landedOnCustomField = boundRole !== null && CUSTOM_FIELD_LANDING_ROLES.includes(boundRole);
  return landedOnCustomField ? hintFieldKeyword(boundInput) : selfNameValueNear(boundInput);
}

/**
 * 通知后台打开管理页身份库
 *
 * 出口只有一个标签：一条搜索词。它的来源按角色分两条通道（{@link pickSearchKeyword}）——
 * 库里存着这一格的角色取同一表单里已打好的**本人姓名**，把列表筛到那一个人；以自定义字段为落点的那一档
 * （编号族、以及机构证照号）取**这一格叫什么**，把列表筛到用户自拟的那条自定义字段。不含其它字段值、不含页面 URL、
 * 不含任何库内数据，长度在后台与选项页各收口一次。
 *
 * 页面角色**刻意不跨入口**：它只服务气泡上那句「这是「证件号」字段」。曾经把它透给选项页
 * 去预选类别档位，但一条身份条目同时携带证件号、手机号等多个值，先按角色筛类别会把该命中的
 * 条目筛出视野，因此深链恒落在「全部」档（改判理由见 `tests/architecture/identityHintWiring.test.ts`）。
 * 取不到姓名时整包载荷缺席，而不是写出 `keyword: ''`——否则选项页会把「筛成空」和「不筛」
 * 读成同一件事。扩展上下文失效（页面残留旧 content script）时静默降级，不打扰用户。
 */
function openIdentityVault(keyword: string): void {
  try {
    void chrome.runtime
      .sendMessage({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: keyword ? { keyword } : undefined })
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
 * @param needsVerify 是否属于「需核对」档（证件号、卡号 / 户名 / 开户行，或他人歧义）
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
  const pickBtn = bubble.querySelector<HTMLButtonElement>('.aph-idh__btn--primary');

  // 重定位走 rAF 节流：position() 先读 getBoundingClientRect/offset 再写 style.top/left，
  // 每个 scroll 事件同步跑一遍就是逐帧「读几何→写样式」强制回流（口径同 FillAckChip）。
  const onScrollOrResize = (): void => {
    if (repositionRaf !== null) return;
    repositionRaf = requestAnimationFrame(() => {
      repositionRaf = null;
      if (boundInput !== input) return;
      position(bubble);
    });
  };
  const onBlur = (event: FocusEvent): void => {
    // 焦点只是移进气泡自己的按钮——不能收，否则键盘永远进不了动作行
    if (shadowRoot?.activeElement) return;
    if (event.target === input) hideIdentityHint();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      hideIdentityHint();
      return;
    }
    // Alt+↓：把焦点送进气泡动作行。宿主挂在 documentElement 末尾且 fixed，
    // 普通 Tab 会先触发字段 focusout 而把气泡收掉，键盘用户因此没有到达按钮的自然路径
    //（WCAG 2.1.1）。用不与页面常见导航抢占的 Alt 组合键开一条显式入口。
    if (event.altKey && event.key === 'ArrowDown' && pickBtn) {
      event.preventDefault();
      pickBtn.focus();
    }
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
