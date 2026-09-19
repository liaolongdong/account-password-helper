/**
 * 填充失败就地引导（F1-C）
 *
 * 当 fillPasswordWithResult 因未检测到任何登录字段而失败（reason='no_form'）时，
 * 在页面右下角弹出一个轻量气泡，引导用户「为此站点指定选择器」——点击后经 Background
 * 打开密码管理页的站点规则弹窗并预填当前域名，复用已可用的 Options 规则编辑器，
 * 避免在宿主页面内重建一套选择器表单。
 *
 * 隔离约束（对齐内容脚本规范）：
 * - 使用独立的 closed shadow DOM 宿主（追加到 documentElement），不污染宿主页面样式/DOM；
 * - 不依赖 ElMessage 等 Vue/Element Plus 运行时（内容脚本无该上下文）；
 * - 单例：同一页面仅存在一个气泡，动作完成或关闭即销毁。
 */
import { MessageType } from '@/utils/types';
import { logger } from '@/utils/logger';
import { tl } from '@/utils/i18n-lite';
import { applyThemeTokensToHost, DEFAULT_THEME, getStoredTheme } from '@/utils/theme';

let hostEl: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .aph-ffp {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2147483647;
    max-width: 320px;
    padding: 14px 16px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #303133;
    background: #fff;
    border: 1px solid #ebeef5;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 15%);
  }
  .aph-ffp__title {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 6px;
    font-weight: 600;
  }
  .aph-ffp__desc {
    margin: 0 0 12px;
    color: #606266;
  }
  .aph-ffp__actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .aph-ffp__btn {
    padding: 6px 14px;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    border: 1px solid transparent;
    border-radius: 6px;
  }
  .aph-ffp__btn--primary {
    color: #fff;
    background: var(--aph-primary, #409eff);
  }
  .aph-ffp__btn--primary:hover { background: var(--aph-primary-hover, #66b3ff); }
  .aph-ffp__btn--ghost {
    color: #606266;
    background: #fff;
    border-color: #dcdfe6;
  }
  .aph-ffp__btn--ghost:hover {
    color: var(--aph-primary, #409eff);
    border-color: var(--aph-primary-border, #d9ecff);
  }
  @media (prefers-reduced-motion: reduce) {
    .aph-ffp { transition: none; }
  }
`;

/** 确保 shadow 宿主已就绪 */
function ensureHost(): void {
  if (hostEl && shadowRoot) return;
  hostEl = document.createElement('div');
  hostEl.setAttribute('data-aph', 'fill-failure-prompt');
  // 主题令牌内联写入宿主：自定义属性可穿透 shadow 边界，供内部 var(--aph-*) 解析。
  // 先落默认主题保证首帧无闪烁，再异步读取用户主题覆盖（与 SavePasswordPrompt 一致）。
  applyThemeTokensToHost(hostEl, DEFAULT_THEME);
  shadowRoot = hostEl.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = STYLE;
  shadowRoot.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'aph-ffp-root';
  shadowRoot.appendChild(wrap);

  document.documentElement.appendChild(hostEl);

  void getStoredTheme().then(theme => {
    if (hostEl) applyThemeTokensToHost(hostEl, theme);
  });
}

/** 隐藏并清空气泡内容（保留宿主以便复用） */
export function hideFillFailurePrompt(): void {
  if (shadowRoot) {
    const root = shadowRoot.getElementById('aph-ffp-root');
    if (root) root.replaceChildren();
  }
}

/**
 * 显示填充失败引导气泡
 * @param domain 当前站点域名，用于跳转 Options 站点规则弹窗时预填
 */
export function showFillFailurePrompt(domain: string): void {
  if (typeof document === 'undefined') return;
  ensureHost();
  const root = shadowRoot?.getElementById('aph-ffp-root');
  if (!root) return;
  root.replaceChildren();

  const bubble = document.createElement('div');
  bubble.className = 'aph-ffp';
  bubble.setAttribute('role', 'status');

  const title = document.createElement('div');
  title.className = 'aph-ffp__title';
  title.textContent = tl('cs.fd.failurePromptText');

  const desc = document.createElement('p');
  desc.className = 'aph-ffp__desc';
  desc.textContent = tl('cs.fd.failurePromptGuide');

  const actions = document.createElement('div');
  actions.className = 'aph-ffp__actions';

  const laterBtn = document.createElement('button');
  laterBtn.type = 'button';
  laterBtn.className = 'aph-ffp__btn aph-ffp__btn--ghost';
  laterBtn.textContent = tl('cs.fd.failurePromptLater');
  laterBtn.addEventListener('click', hideFillFailurePrompt);

  const specifyBtn = document.createElement('button');
  specifyBtn.type = 'button';
  specifyBtn.className = 'aph-ffp__btn aph-ffp__btn--primary';
  specifyBtn.textContent = tl('cs.fd.failurePromptSpecify');
  specifyBtn.addEventListener('click', () => {
    try {
      void chrome.runtime
        .sendMessage({ type: MessageType.OPEN_OPTIONS_AND_SITE_RULES, data: { domain } })
        .catch(err => logger.debug('FillFailurePrompt: 打开站点规则指令发送失败:', err));
    } catch (err) {
      // 扩展上下文可能失效（页面残留旧 content script），静默降级不打扰用户
      logger.debug('FillFailurePrompt: 扩展上下文不可用:', err);
    }
    hideFillFailurePrompt();
  });

  actions.appendChild(laterBtn);
  actions.appendChild(specifyBtn);
  bubble.appendChild(title);
  bubble.appendChild(desc);
  bubble.appendChild(actions);
  root.appendChild(bubble);
}
