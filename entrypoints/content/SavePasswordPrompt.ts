/**
 * Chrome 风格的保存密码确认弹窗
 *
 * 在页面右上角显示一个卡片式弹窗，让用户确认是否保存账号密码。
 * 纯 DOM 操作，无需 Shadow DOM，复用 NativeNotification 的视觉风格。
 */

import { lockIcon } from '@/entrypoints/content/floatingButtons/icons';
import type { SavePromptData, SavePromptControls, SavePromptEditedData } from '@/entrypoints/content/types';
import { getStoredTheme, THEME_SHADOW_TOKENS, DEFAULT_THEME } from '@/utils/theme';
import { tl } from '@/utils/i18n-lite';
import { isWeakPassword } from '@/utils/passwordStrengthCore';
import type { SaveRiskHint } from '@/utils/types';

/** 弹窗 DOM 容器 class 名 */
const PROMPT_CLASS = 'aph-save-password-prompt';

/**
 * 主色（主题令牌 + 晴空蓝回退）
 *
 * 本弹窗直接挂到页面 body（非 Shadow DOM），无法继承扩展页 :root 上的令牌，
 * 因此在 overlay 元素上内联写入 --aph-primary（后代继承），并异步解析当前主题。
 */
const THEME_BLUE = 'var(--aph-primary, #409eff)';

/**
 * 风险提示条配色
 *
 * 背景与边框沿用 NativeNotification 的 warning 语义色，保持插件内警示视觉一致；
 * 正文取更深的琥珀色，因 12px 正文在浅黄底上需满足 WCAG AA 的 4.5:1 对比度
 *（直接用 #e6a23c 仅约 2:1，不达标）。
 */
const RISK_BAR_COLORS = {
  /** 背景色 */
  bg: '#fdf6ec',
  /** 边框色 */
  border: '#f0c78a',
  /** 正文色 */
  text: '#8a5a12',
} as const;

/**
 * 复用计数可信上限
 *
 * 超出此值的计数视为不可信数据（伪造或脏数据）而整个丢弃，
 * 宁可少提醒也不展示错误的账号数量。
 */
const MAX_TRUSTED_REUSED_COUNT = 9999;

/**
 * 显示保存密码确认弹窗
 *
 * 在页面右上角弹出 Chrome 风格的确认卡片，包含用户名和密码信息，
 * 以及可编辑的标签和备注字段，用户可选择「保存」、「暂不保存」或「不再提示」。
 *
 * 若 `data.risk` 命中弱密码或密码复用，则在密码行下方内联展示琥珀色警示条。
 * 警示是**非阻断**的：不加二次确认、不改变保存按钮流程与任何回调签名，
 * 与 Chrome 原生保存弹窗的克制风格保持一致。
 *
 * @param data - 待保存的账号密码数据（含标签、备注默认值与可选风险提示）
 * @param onSave - 用户点击「保存」时的回调，接收用户编辑后的标签和备注
 * @param onDismiss - 用户点击「暂不保存」时的回调
 * @param onNeverAsk - 用户点击「不再提示」时的回调（将域名加入屏蔽列表）
 */
export function showSavePasswordPrompt(
  data: SavePromptData,
  onSave: (editedData: SavePromptEditedData) => void,
  onDismiss: () => void,
  onNeverAsk: () => void,
): SavePromptControls {
  // 移除已有弹窗，避免重复
  dismissSavePasswordPrompt();

  // 展示模式：update 时用于区分「更新已有密码」与「保存新密码」的标题与按钮文案
  const isUpdate = data.mode === 'update';

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

  // 写入主题令牌（必须在 cssText 之后，否则会被整体覆盖）：先默认晴空蓝，
  // 后异步读取当前主题覆盖，供子元素 var(--aph-primary) 继承
  overlay.style.setProperty('--aph-primary', THEME_SHADOW_TOKENS[DEFAULT_THEME]['--aph-primary']);
  void getStoredTheme().then(theme => {
    overlay.style.setProperty('--aph-primary', THEME_SHADOW_TOKENS[theme]['--aph-primary']);
  });

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
  title.textContent = isUpdate ? tl('cs.save.titleUpdate') : tl('cs.save.titleSave');
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

  const { row: userRow, valueEl: usernameValueEl } = createInfoRow(tl('cs.save.username'), data.username, false);
  const { row: passRow, valueEl: passwordValueEl } = createInfoRow(tl('cs.save.password'), data.password, true);
  body.appendChild(userRow);
  body.appendChild(passRow);

  // 风险提示条：紧接密码行之后、标签行之前，贴近它所警示的字段
  const riskBar = createRiskBar();
  body.appendChild(riskBar);

  // background 评估风险时使用的密码：页面字段一旦偏离此值，后台结论即失效
  const riskBaselinePassword = data.password;
  const baselineRisk = sanitizeRiskHint(data.risk);
  renderRiskHints(riskBar, baselineRisk);

  // 可编辑字段：标签
  const { row: tagRow, input: tagInput } = createEditableRow(
    tl('cs.save.tag'),
    data.tag,
    tl('cs.save.tagPlaceholder'),
    false,
  );
  body.appendChild(tagRow);

  // 可编辑字段：备注
  const { row: remarkRow, input: remarkInput } = createEditableRow(
    tl('cs.save.remark'),
    data.remark,
    tl('cs.save.remarkPlaceholder'),
    true,
  );
  body.appendChild(remarkRow);

  // 追踪用户是否主动编辑过标签和备注输入框
  let tagEdited = false;
  let remarkEdited = false;
  tagInput.addEventListener('input', () => {
    tagEdited = true;
  });
  remarkInput.addEventListener('input', () => {
    remarkEdited = true;
  });

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
  neverAskBtn.textContent = tl('cs.save.neverAsk');
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

  const dismissBtn = createButton(tl('cs.save.dismiss'), '#f5f5f5', '#666', '#e8e8e8');
  dismissBtn.addEventListener('click', () => {
    dismissSavePasswordPrompt();
    onDismiss();
  });

  const saveBtn = createButton(isUpdate ? tl('cs.save.update') : tl('cs.save.save'), THEME_BLUE, '#fff', THEME_BLUE);
  saveBtn.addEventListener('click', () => {
    const editedTag = tagInput.value.trim();
    const editedRemark = remarkInput.value.trim();
    dismissSavePasswordPrompt();
    onSave({
      tag: editedTag,
      remark: editedRemark || tl('cs.save.autoSaveRemark'),
      tagEdited,
      remarkEdited,
    });
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

  return {
    updateUsername: (username: string) => {
      usernameValueEl.textContent = username;
    },
    updatePassword: (password: string) => {
      passwordValueEl.textContent = '•'.repeat(Math.min(password.length, 12));
      // 密码变化会同时改变强度与复用情况，警示条需随之刷新
      renderRiskHints(riskBar, resolveRiskHints(baselineRisk, riskBaselinePassword, password));
    },
  };
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
 * 校验并归一化 background 返回的风险提示（边界校验）
 *
 * iframe 委托场景下该数据经 `postMessage` 跨帧传入，属不可信输入：即使类型声明为
 * {@link SaveRiskHint}，运行时仍可能缺失、类型错乱或被伪造。此处逐字段收窄，
 * 非法值一律丢弃——宁可少提醒，也不展示错误的账号数量。
 *
 * @param raw 未经校验的原始值
 * @returns 归一化后的风险提示；无任何有效维度时返回 undefined
 */
function sanitizeRiskHint(raw: unknown): SaveRiskHint | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const source = raw as Record<string, unknown>;
  const hint: SaveRiskHint = {};

  // 仅接受严格布尔 true，其余（'true'、1、缺失）一律视为未命中
  if (source.weak === true) {
    hint.weak = true;
  }

  const reusedCount = source.reusedCount;
  if (
    typeof reusedCount === 'number' &&
    Number.isInteger(reusedCount) &&
    reusedCount > 0 &&
    reusedCount <= MAX_TRUSTED_REUSED_COUNT
  ) {
    hint.reusedCount = reusedCount;
  }

  return hint.weak || hint.reusedCount ? hint : undefined;
}

/**
 * 依据当前密码推导生效的风险提示
 *
 * 两个维度的可重算性不同，故失效边界也不同：
 * - **弱密码**是纯函数判定，密码改动后可就地重算，始终反映当前密码；
 * - **复用计数**依赖 background 的全量密码库，content script 本地无法重算，
 *   因此仅当密码与 background 评估时完全一致才沿用；用户一旦改动即撤下该行，
 *   避免展示陈旧的账号数量。
 *
 * @param baseline background 返回并已校验的风险提示
 * @param baselinePassword background 评估时使用的密码
 * @param currentPassword 页面密码字段的当前值
 * @returns 生效的风险提示；无风险时返回 undefined
 */
function resolveRiskHints(
  baseline: SaveRiskHint | undefined,
  baselinePassword: string,
  currentPassword: string,
): SaveRiskHint | undefined {
  const unchanged = currentPassword === baselinePassword;
  const hint: SaveRiskHint = {};

  if (unchanged ? baseline?.weak === true : isWeakPassword(currentPassword)) {
    hint.weak = true;
  }

  if (unchanged && baseline?.reusedCount) {
    hint.reusedCount = baseline.reusedCount;
  }

  return hint.weak || hint.reusedCount ? hint : undefined;
}

/**
 * 创建风险提示条容器（初始隐藏，由 {@link renderRiskHints} 决定显隐与内容）
 *
 * 使用 `role="status"` 使其成为 polite live region：弹窗挂载后，警示条随密码输入
 * 出现、消失或文案变化时，屏幕阅读器会主动播报，而不只是静默改变视觉。
 *
 * 已知边界：首帧渲染发生在弹窗挂载进 document 之前，此时本区域尚未进入可访问性树，
 * 因此「弹窗一打开就带着警示」这一帧不会被自动播报（文案仍在 DOM 中，可用虚拟光标
 * 浏览到）。补齐它需把首帧推迟到挂载后的独立任务，会改变警示条出现的视觉时序；
 * 本弹窗既有设计不含 `role="dialog"` 与焦点管理，故保持同步渲染，不引入异步时序。
 *
 * @returns 警示条容器元素
 */
function createRiskBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  bar.style.cssText = `
    display: none;
    flex-direction: column;
    gap: 4px;
    margin: 8px 0 2px;
    padding: 8px 10px;
    background: ${RISK_BAR_COLORS.bg};
    border: 1px solid ${RISK_BAR_COLORS.border};
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.5;
    color: ${RISK_BAR_COLORS.text};
  `;
  return bar;
}

/** 警示条上次渲染的文案行，用于跳过内容未变化的重绘（键为弱引用，随元素回收） */
const renderedRiskLines = new WeakMap<HTMLElement, string[]>();

/**
 * 按当前风险提示重绘警示条
 *
 * 文案全部经 `textContent` 写入，不使用 `innerHTML`；先收集待渲染行再决定显隐，
 * 避免 hint 存在但无有效维度时渲染出空的警示框。
 *
 * 内容未变化时直接跳过：`updatePassword` 会随页面密码框的每次 input 触发，而
 * `LoginAutoSave` 挂载后还会立即同步一次字段；清空重建相同文案既产生无谓的
 * DOM 抖动，也会让 live region 重复播报同一条警示。
 *
 * @param bar 警示条容器
 * @param hint 当前生效的风险提示，undefined 表示无风险，容器整体隐藏
 */
function renderRiskHints(bar: HTMLElement, hint: SaveRiskHint | undefined): void {
  const lines: string[] = [];
  if (hint?.weak) {
    lines.push(tl('cs.save.riskWeak'));
  }
  if (hint?.reusedCount) {
    lines.push(tl('cs.save.riskReused', { count: hint.reusedCount }));
  }

  const previous = renderedRiskLines.get(bar);
  if (previous && previous.length === lines.length && previous.every((line, i) => line === lines[i])) {
    return;
  }
  renderedRiskLines.set(bar, lines);

  bar.textContent = '';
  if (!lines.length) {
    bar.style.display = 'none';
    return;
  }

  for (const line of lines) {
    bar.appendChild(createRiskLine(line));
  }
  bar.style.display = 'flex';
}

/**
 * 创建单行警示文案（左侧 ! 图标 + 文本）
 *
 * @param text 警示文案
 * @returns 单行容器元素
 */
function createRiskLine(text: string): HTMLElement {
  const line = document.createElement('div');
  line.style.cssText = 'display: flex; align-items: flex-start; gap: 6px;';

  const iconEl = document.createElement('span');
  iconEl.textContent = '!';
  iconEl.style.cssText = 'flex-shrink: 0; font-weight: 700;';

  const textEl = document.createElement('span');
  textEl.textContent = text;
  textEl.style.cssText = 'flex: 1; min-width: 0;';

  line.appendChild(iconEl);
  line.appendChild(textEl);
  return line;
}

/**
 * 创建信息行（账号/密码）
 * @param label 标签文本
 * @param value 值
 * @param isPassword 是否为密码字段（密码用圆点遮挡）
 * @returns row 容器元素和 valueEl 值元素引用
 */
function createInfoRow(label: string, value: string, isPassword: boolean): { row: HTMLElement; valueEl: HTMLElement } {
  const row = document.createElement('div');
  row.style.cssText = `
    display: flex;
    align-items: center;
    padding: 6px 0;
    font-size: 13px;
    gap: 5px;
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
  return { row, valueEl };
}

/**
 * 创建可编辑信息行（标签/备注），包含 label 和 input/textarea
 * @param label 标签文本
 * @param defaultValue 默认值
 * @param placeholder 占位提示文本
 * @param isTextarea 是否使用 textarea（用于备注多行输入）
 * @returns row 容器元素和 input 输入框元素
 */
function createEditableRow(
  label: string,
  defaultValue: string,
  placeholder: string,
  isTextarea: boolean,
): { row: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const row = document.createElement('div');
  row.style.cssText = `
    display: flex;
    align-items: flex-start;
    padding: 6px 0;
    font-size: 13px;
    gap: 5px;
  `;

  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.cssText = 'color: #999; width: 40px; flex-shrink: 0; padding-top: 5px;';

  const inputStyle = `
    flex: 1;
    padding: 4px 8px;
    border: 1px solid #dcdfe6;
    border-radius: 4px;
    font-size: 12px;
    color: #333;
    outline: none;
    font-family: inherit;
    resize: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  `;

  let input: HTMLInputElement | HTMLTextAreaElement;
  if (isTextarea) {
    input = document.createElement('textarea');
    input.rows = 2;
    input.value = defaultValue;
    input.placeholder = placeholder;
    input.style.cssText = inputStyle;
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue;
    input.placeholder = placeholder;
    input.style.cssText = inputStyle;
  }

  // 聚焦时高亮边框
  input.addEventListener('focus', () => {
    input.style.borderColor = THEME_BLUE;
  });
  input.addEventListener('blur', () => {
    input.style.borderColor = '#dcdfe6';
  });

  row.appendChild(labelEl);
  row.appendChild(input);
  return { row, input };
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
