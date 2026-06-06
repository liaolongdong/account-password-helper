/**
 * Chrome 风格的保存密码确认弹窗
 *
 * 在页面右上角显示一个卡片式弹窗，让用户确认是否保存账号密码。
 * 纯 DOM 操作，无需 Shadow DOM，复用 NativeNotification 的视觉风格。
 */

import { lockIcon } from '@/entrypoints/content/floatingButtons/icons';

/** 弹窗 DOM 容器 class 名 */
const PROMPT_CLASS = 'aph-save-password-prompt';

/** Element Plus 主题蓝 */
const THEME_BLUE = '#409eff';

/**
 * 保存确认弹窗所需的数据
 */
export interface SavePromptData {
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
  /** 网站域名 */
  url: string;
}

/**
 * 显示保存密码确认弹窗
 *
 * 在页面右上角弹出 Chrome 风格的确认卡片，包含用户名和密码信息，
 * 用户可选择「保存」、「暂不保存」或「不再提示」。
 *
 * @param data - 待保存的账号密码数据
 * @param onSave - 用户点击「保存」时的回调
 * @param onDismiss - 用户点击「暂不保存」时的回调
 * @param onNeverAsk - 用户点击「不再提示」时的回调（将域名加入屏蔽列表）
 */
export function showSavePasswordPrompt(
  data: SavePromptData,
  onSave: () => void,
  onDismiss: () => void,
  onNeverAsk: () => void,
): void {
  // 移除已有弹窗，避免重复
  dismissSavePasswordPrompt();

  const overlay = document.createElement('div');
  overlay.className = PROMPT_CLASS;
  overlay.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    width: 320px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15), 0 1px 4px rgba(0, 0, 0, 0.08);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
    animation: aphSlideIn 0.25s ease-out;
  `;

  // 注入动画样式（仅一次）
  injectAnimationStyle();

  // ── 头部 ──
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 16px 16px 12px;
    border-bottom: 1px solid #f0f0f0;
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  // 锁形图标
  const icon = document.createElement('span');
  icon.innerHTML = lockIcon;
  icon.style.cssText = `display: flex; align-items: center; color: ${THEME_BLUE}; flex-shrink: 0;`;

  const headerText = document.createElement('div');
  headerText.style.cssText = 'flex: 1; min-width: 0;';

  const title = document.createElement('div');
  title.textContent = '自动保存账号密码到密码列表？';
  title.style.cssText = 'font-size: 14px; font-weight: 600; color: #1a1a1a;';

  const subtitle = document.createElement('div');
  subtitle.textContent = data.url;
  subtitle.style.cssText = `
    font-size: 12px;
    color: #999;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `;

  headerText.appendChild(title);
  headerText.appendChild(subtitle);
  header.appendChild(icon);
  header.appendChild(headerText);

  // ── 主体 ──
  const body = document.createElement('div');
  body.style.cssText = 'padding: 12px 16px;';

  const userRow = createInfoRow('账号', data.username, false);
  const passRow = createInfoRow('密码', data.password, true);
  body.appendChild(userRow);
  body.appendChild(passRow);

  // ── 底部按钮 ──
  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 12px 16px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;

  // 左侧：「不再提示」文字链接按钮
  const neverAskBtn = document.createElement('button');
  neverAskBtn.textContent = '不再提示';
  neverAskBtn.style.cssText = `
    font-size: 12px;
    color: #999;
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    padding: 6px 0;
    outline: none;
    line-height: 1.4;
  `;
  neverAskBtn.addEventListener('mouseenter', () => {
    neverAskBtn.style.color = '#666';
  });
  neverAskBtn.addEventListener('mouseleave', () => {
    neverAskBtn.style.color = '#999';
  });
  neverAskBtn.addEventListener('click', () => {
    dismissSavePasswordPrompt();
    onNeverAsk();
  });

  // 右侧：「暂不保存」+「保存」按钮组
  const rightBtns = document.createElement('div');
  rightBtns.style.cssText = 'display: flex; gap: 8px;';

  const dismissBtn = createButton('暂不保存', '#f5f5f5', '#666', '#e8e8e8');
  dismissBtn.addEventListener('click', () => {
    dismissSavePasswordPrompt();
    onDismiss();
  });

  const saveBtn = createButton('保存', THEME_BLUE, '#fff', THEME_BLUE);
  saveBtn.addEventListener('click', () => {
    dismissSavePasswordPrompt();
    onSave();
  });

  rightBtns.appendChild(dismissBtn);
  rightBtns.appendChild(saveBtn);

  footer.appendChild(neverAskBtn);
  footer.appendChild(rightBtns);

  // 组装
  overlay.appendChild(header);
  overlay.appendChild(body);
  overlay.appendChild(footer);

  document.body.appendChild(overlay);
}

/**
 * 关闭并移除保存确认弹窗
 */
export function dismissSavePasswordPrompt(): void {
  const existing = document.querySelector('.' + PROMPT_CLASS) as HTMLElement | null;
  if (existing) {
    existing.remove();
  }
}

// ── 内部工具函数 ──

/**
 * 创建信息行（账号/密码）
 * @param label 标签文本
 * @param value 值
 * @param isPassword 是否为密码字段（密码用圆点遮挡）
 */
function createInfoRow(label: string, value: string, isPassword: boolean): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = `
    display: flex;
    align-items: center;
    padding: 6px 0;
    font-size: 13px;
  `;

  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.cssText = 'color: #999; width: 40px; flex-shrink: 0;';

  const valueEl = document.createElement('span');
  valueEl.textContent = isPassword ? '•'.repeat(Math.min(value.length, 12)) : value;
  valueEl.style.cssText = `
    color: #333;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `;

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

/**
 * 创建按钮元素
 * @param text 按钮文本
 * @param bgColor 背景色
 * @param textColor 文字色
 * @param borderColor 边框色
 */
function createButton(text: string, bgColor: string, textColor: string, borderColor: string): HTMLElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    padding: 6px 16px;
    border-radius: 4px;
    border: 1px solid ${borderColor};
    background: ${bgColor};
    color: ${textColor};
    font-size: 13px;
    cursor: pointer;
    outline: none;
    transition: opacity 0.15s;
    line-height: 1.4;
  `;
  btn.addEventListener('mouseenter', () => {
    btn.style.opacity = '0.85';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.opacity = '1';
  });
  return btn;
}

/** 动画样式是否已注入 */
let animationStyleInjected = false;

/**
 * 注入弹窗滑入动画样式（仅注入一次）
 */
function injectAnimationStyle(): void {
  if (animationStyleInjected) return;
  animationStyleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes aphSlideIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}
