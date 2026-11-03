/** @vitest-environment jsdom */
/**
 * 两个「正在输密码时弹出」界面的键盘出口回归测试（对应评估报告 A-2）
 *
 * 钉住三层口径：
 *
 * 1. **Esc 有出口**。保存确认卡与填充失败气泡都出现在用户敲密码的中途，此前 0 个 `keydown`，
 *    只能用鼠标点掉；键盘用户唯一的退路是把整页 Tab 走完（宿主追加在 `<html>` 末尾，
 *    卡片控件在 DOM 序最后）。修复口径：Esc 等价于「暂不保存 / 稍后再说」，
 *    监听挂 `document` 捕获阶段——焦点此刻仍留在页面登录框上，按键路径不经过影子树，
 *    绑在影子树内会让这条在最常见情形下失效（同内联下拉的 `handleGlobalEscape`）。
 *
 * 2. **合成期间让位**。输入法合成中的 Esc 语义是「取消候选词」，接管它会让用户选词途中
 *    弹窗凭空消失（同 `inlineFillDropdown.keyboard` 已钉住的第一层）。
 *
 * 3. **监听随界面回收**。保存卡每次展示新建宿主、气泡宿主常驻复用，两者的 Esc 监听都挂在
 *    document 上，不会「随子树一起消失」，必须在关闭处显式解绑；否则重复展示会累积监听，
 *    一次 Esc 触发多份回调。
 *
 * 刻意**不做**的两件事，同样被断言钉住（改它们要先回答「用户此刻还要不要在页面里打字」）：
 * - 不 autofocus：气泡是 `role="status"` 的礼貌提示，保存卡是非阻断确认，抢走焦点会让
 *   「提交后紧接着填短信验证码」这类流程的按键落空；
 * - 不 `preventDefault` / 不 `stopPropagation`：Esc 关掉自己的界面，不替宿主页面决定它要不要响应。
 *
 * 焦点可见性（WCAG 2.4.7）另有一层：控件内联的 `outline: none` 已全部摘掉（内联优先级高于
 * 影子样式表，留着就再也恢复不了轮廓），轮廓改由影子表里的 `:focus-visible` 规则提供。
 *
 * closed 影子树不挂在 `host.shadowRoot` 上，经 `attachShadow` 桩取回 root 查询。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 当前语言（供下方 mock 的 tl 读取），本文件只用到中文一套 */
let locale: 'zh-CN' | 'en' = 'zh-CN';

vi.mock('@/utils/i18n-lite', async () => {
  const actual = await vi.importActual<typeof import('@/utils/i18n-lite')>('@/utils/i18n-lite');
  return {
    ...actual,
    tl: (key: string, params?: Record<string, string | number>): string => {
      const template = actual.LITE_MESSAGES[locale][key] ?? key;
      if (!params) return template;
      return Object.entries(params).reduce(
        (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
        template,
      );
    },
  };
});

vi.mock('@/utils/theme', async () => {
  const actual = await vi.importActual<typeof import('@/utils/theme')>('@/utils/theme');
  // 必须回真实默认主题名（不是字面量 'default'）：两个界面都拿它去查影子令牌
  return { ...actual, getStoredTheme: vi.fn(async () => actual.DEFAULT_THEME) };
});

import type { Mock } from 'vitest';
import { dismissSavePasswordPrompt, showSavePasswordPrompt } from '@/entrypoints/content/SavePasswordPrompt';
import { hideFillFailurePrompt, showFillFailurePrompt } from '@/entrypoints/content/FillFailurePrompt';
import { MessageType } from '@/utils/types';
import type { SavePromptData, SavePromptEditedData } from '@/entrypoints/content/types';

/** 保存卡宿主凭据 */
const SAVE_HOST = '[data-aph="save-password-prompt"]';

/** closed 影子树截获点（最后一次 `attachShadow` 的返回值即当前界面的 root） */
const originalAttachShadow = Element.prototype.attachShadow;
let lastShadow: ShadowRoot | null = null;
/**
 * 气泡的 root
 *
 * `ensureHost` 会复用同一个 closed root（宿主常驻），所以它只在该宿主首次创建时经
 * `attachShadow` 暴露一次；后续用例若把宿主摘掉，模块内的引用并不会跟着消失，
 * 于是 root 再也截获不到。这里按宿主凭据单独登记，全文件共用一份。
 */
let ffpShadow: ShadowRoot | null = null;

/** 把 attachShadow 桩成截获点，并按宿主凭据分流两个界面 */
const trackAttachShadow = (): void => {
  lastShadow = null;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const created = originalAttachShadow.call(this, init);
    lastShadow = created;
    if (this.getAttribute('data-aph') === 'fill-failure-prompt') ffpShadow = created;
    return created;
  });
};

/**
 * 构造 keydown 事件
 *
 * `bubbles` + `composed` 与浏览器真实按键一致：派发点在页面输入框时事件要路过 document 捕获，
 * 派发点在卡片内部时要能穿出 shadow 边界。
 *
 * jsdom 的 `KeyboardEventInit` 不接受 `isComposing`，故用 defineProperty 覆写只读属性，
 * 与真实浏览器「合成期间 isComposing 为 true」的可观察面一致。
 */
const keydown = (key: string, options: { composing?: boolean } = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
  if (options.composing) {
    Object.defineProperty(event, 'isComposing', { value: true });
  }
  return event;
};

/** 弹窗数据（不含任何真实凭据形态，纯夹具） */
const promptData = (overrides: Partial<SavePromptData> = {}): SavePromptData => ({
  username: 'alice',
  password: 'Demo!Pass2026',
  url: 'example.com',
  tag: '',
  remark: '',
  ...overrides,
});

/** 焦点轮廓是否被内联声明抹掉 */
const outlineSuppressed = (el: HTMLElement): boolean => /outline\s*:\s*none/i.test(el.style.cssText);

describe('保存确认卡的键盘出口', () => {
  /** 三个回调：保存 / 暂不保存 / 不再提示（显式带签名，否则 `vi.fn()` 的宽类型进不了形参位置） */
  let onSave: Mock<(editedData: SavePromptEditedData) => void>;
  let onDismiss: Mock<() => void>;
  let onNeverAsk: Mock<() => void>;
  /** 页面里正被聚焦的登录框（Esc 的真实落点） */
  let pageInput: HTMLInputElement;

  /** 打开一张卡，并回收本次影子树 */
  const open = (overrides: Partial<SavePromptData> = {}): void => {
    lastShadow = null;
    showSavePasswordPrompt(promptData(overrides), onSave, onDismiss, onNeverAsk);
  };

  /** 卡片是否仍在页面上 */
  const cardPresent = (): boolean => document.documentElement.querySelectorAll(SAVE_HOST).length > 0;

  /** 卡片内三个按钮（页脚 DOM 序：不再提示 → 暂不保存 → 保存） */
  const buttons = (): HTMLButtonElement[] => [...lastShadow!.querySelectorAll<HTMLButtonElement>('button')];

  beforeEach(() => {
    locale = 'zh-CN';
    lastShadow = null;
    onSave = vi.fn<(editedData: SavePromptEditedData) => void>();
    onDismiss = vi.fn<() => void>();
    onNeverAsk = vi.fn<() => void>();

    trackAttachShadow();

    pageInput = document.createElement('input');
    pageInput.type = 'password';
    document.body.appendChild(pageInput);
    pageInput.focus();
  });

  afterEach(() => {
    dismissSavePasswordPrompt();
    document.documentElement.querySelectorAll(SAVE_HOST).forEach(node => node.remove());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('Esc 等价于「暂不保存」：卡片摘除，且只触发 onDismiss', () => {
    open();

    pageInput.dispatchEvent(keydown('Escape'));

    expect(cardPresent()).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onNeverAsk).not.toHaveBeenCalled();
  });

  it('焦点已在卡片内时，Esc 同样关闭（事件穿出 shadow 边界）', () => {
    open();
    const saveBtn = buttons()[2];
    saveBtn.focus();

    saveBtn.dispatchEvent(keydown('Escape'));

    expect(cardPresent()).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Esc 只做「暂不保存」这一件事，不顺手把用户没确认的内容存下去
    expect(onSave).not.toHaveBeenCalled();
  });

  it('输入法合成中的 Esc 让位给候选词，卡片保持', () => {
    open();

    pageInput.dispatchEvent(keydown('Escape', { composing: true }));

    expect(cardPresent()).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Enter 与其它键不关闭卡片（回车仍归页面表单，按钮仍由原生激活接管）', () => {
    open();

    pageInput.dispatchEvent(keydown('Enter'));
    pageInput.dispatchEvent(keydown('a'));

    expect(cardPresent()).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('重复展示不累积监听：一次 Esc 只回调当前那张卡的 onDismiss', () => {
    const firstDismiss = onDismiss;
    open();
    const secondDismiss = vi.fn<() => void>();
    onDismiss = secondDismiss;
    showSavePasswordPrompt(promptData(), onSave, secondDismiss, onNeverAsk);

    pageInput.dispatchEvent(keydown('Escape'));

    expect(secondDismiss).toHaveBeenCalledTimes(1);
    expect(firstDismiss).not.toHaveBeenCalled();
    expect(cardPresent()).toBe(false);
  });

  it('点「保存」后监听即回收：此后的 Esc 不再触发任何回调', () => {
    open();
    expect(buttons()).toHaveLength(3);

    buttons()[2].click();
    expect(onSave).toHaveBeenCalledTimes(1);

    pageInput.dispatchEvent(keydown('Escape'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('刻意不抢焦点：卡片出现前后，聚焦元素仍是页面登录框', () => {
    open();

    expect(document.activeElement).toBe(pageInput);
    pageInput.dispatchEvent(keydown('Escape'));
    expect(document.activeElement).toBe(pageInput);
  });

  it('控件不再内联抹掉轮廓，改由影子表的 :focus-visible 提供', () => {
    open();

    const styleText = lastShadow!.querySelector('style')!.textContent!;
    expect(styleText).toContain(':focus-visible');
    expect(styleText).toMatch(/outline:\s*2px solid/);

    const focusables = [...lastShadow!.querySelectorAll<HTMLElement>('button, input, textarea')];
    expect(focusables.length).toBeGreaterThan(0);
    for (const el of focusables) {
      expect(outlineSuppressed(el), `控件内联仍写着 outline:none：${el.tagName}`).toBe(false);
    }

    // 自检：判据本身要有牙——真写上 outline:none 时必须被抓到
    const probe = document.createElement('button');
    probe.style.outline = 'none';
    expect(outlineSuppressed(probe)).toBe(true);
  });
});

describe('填充失败气泡的键盘出口', () => {
  let pageInput: HTMLInputElement;

  /** 气泡是否仍在（宿主常驻，判据只看内容根下有没有气泡节点） */
  const bubblePresent = (): boolean => !!ffpShadow?.querySelector('.aph-ffp');

  const openBubble = (): void => {
    showFillFailurePrompt('example.com');
    expect(ffpShadow, '气泡影子树未截获到（宿主被摘除后无法再复用）').not.toBeNull();
  };

  beforeEach(() => {
    locale = 'zh-CN';
    trackAttachShadow();
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    pageInput = document.createElement('input');
    document.body.appendChild(pageInput);
    pageInput.focus();
  });

  afterEach(() => {
    // 只清空内容：宿主与 root 留给下一个用例复用
    hideFillFailurePrompt();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('Esc 收起气泡，且不发「打开站点规则」的消息（与「稍后再说」同义）', () => {
    openBubble();
    expect(bubblePresent()).toBe(true);

    pageInput.dispatchEvent(keydown('Escape'));

    expect(bubblePresent()).toBe(false);
    const types = vi.mocked(chrome.runtime.sendMessage).mock.calls.map(call => (call[0] as { type?: string }).type);
    expect(types).not.toContain(MessageType.OPEN_OPTIONS_AND_SITE_RULES);
  });

  it('输入法合成中的 Esc 不收起气泡', () => {
    openBubble();

    pageInput.dispatchEvent(keydown('Escape', { composing: true }));

    expect(bubblePresent()).toBe(true);
  });

  it('宿主常驻复用，所以收起必须显式解绑 keydown', () => {
    openBubble();
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    hideFillFailurePrompt();

    expect(removeSpy.mock.calls.filter(call => call[0] === 'keydown')).toHaveLength(1);
  });

  it('重复展示不累积监听：一次 Esc 收起，且解绑只发生一次', () => {
    openBubble();
    openBubble();
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    pageInput.dispatchEvent(keydown('Escape'));

    expect(bubblePresent()).toBe(false);
    expect(removeSpy.mock.calls.filter(call => call[0] === 'keydown')).toHaveLength(1);
  });

  it('刻意不抢焦点：气泡出现前后，聚焦元素仍是页面输入框', () => {
    openBubble();

    expect(document.activeElement).toBe(pageInput);
    pageInput.dispatchEvent(keydown('Escape'));
    expect(document.activeElement).toBe(pageInput);
  });

  it('气泡按钮有 :focus-visible 轮廓规则', () => {
    openBubble();

    const styleText = ffpShadow!.querySelector('style')!.textContent!;
    expect(styleText).toMatch(/\.aph-ffp__btn:focus-visible/);
    expect(styleText).toMatch(/outline:\s*2px solid/);
  });
});
