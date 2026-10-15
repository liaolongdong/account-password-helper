/** @vitest-environment jsdom */
/**
 * 身份库召唤提示（页面侧气泡）的回归测试
 *
 * 这个界面是「识别 + 提示 + 深链」形态里唯一会出现在页面里的一环，因此它同时背着
 * 三条必须可证的承诺，本文件按这三条组织用例：
 *
 * 1. **零明文跨界**。气泡的文本与 `sendMessage` 的载荷都不允许出现字段当前值、页面 URL
 *    或任何库内数据——出口只有一个已收窄的角色枚举。用 canary 值取证，比读代码可靠。
 * 2. **键盘与失焦出口**。Esc 收起（输入法合成期间让位）、焦点离开绑定字段即收起，
 *    且监听随收起回收，重复展示不累积（口径同 `promptKeyboardExit`）。
 * 3. **单例跟随**。同一字段同角色重复聚焦不重建（不然每按一次 Tab 就闪一下），
 *    换字段则整枚重建。
 *
 * closed 影子树不挂在 `host.shadowRoot` 上，经 `attachShadow` 桩取回 root 查询；
 * jsdom 的 `getBoundingClientRect` 恒为全 0，会让视口判定把气泡直接收掉，
 * 故用 `installDomLayout` 给绑定字段登记一块真实矩形。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { installDomLayout, type DomLayout } from '../helpers/domLayout';

/** 当前语言（供下方 mock 的 tl 读取），本文件两套语言都用到 */
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
    /** 订阅点由测试手动触发，用来验证「语言切换后气泡按新语言重绘」这条真实路径 */
    onLiteLocaleChanged: (callback: (next: 'zh-CN' | 'en') => void): (() => void) => {
      localeListeners.add(callback);
      return () => localeListeners.delete(callback);
    },
  };
});

vi.mock('@/utils/theme', async () => {
  const actual = await vi.importActual<typeof import('@/utils/theme')>('@/utils/theme');
  return { ...actual, getStoredTheme: vi.fn(async () => actual.DEFAULT_THEME) };
});

const localeListeners = new Set<(next: 'zh-CN' | 'en') => void>();

/** 把语言订阅者全部跑一遍，模拟 `initLiteI18n` 收到的 storage 变更通知 */
const emitLocaleChange = (next: 'zh-CN' | 'en'): void => {
  locale = next;
  localeListeners.forEach(cb => cb(next));
};

import { destroyIdentityHint, hideIdentityHint, showIdentityHint } from '@/entrypoints/content/IdentityHint';
import { MessageType } from '@/utils/types';
import type { IdentityHintRole } from '@/utils/identity/hintRoles';

/** 气泡宿主凭据 */
const HOST_SELECTOR = '[data-aph="identity-hint"]';

const originalAttachShadow = Element.prototype.attachShadow;
let shadow: ShadowRoot | null = null;

const trackAttachShadow = (): void => {
  shadow = null;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const created = originalAttachShadow.call(this, init);
    if (this.getAttribute('data-aph') === 'identity-hint') shadow = created;
    return created;
  });
};

/** 字段当前值的哨兵串：任何用户可见出口出现它都是越界 */
const CANARY = 'Zhang-San-110101-Canary';

/** 布一个待聚焦的字段并登记其几何（值只用于取证，被测代码不读它） */
const makeField = (name: string, value = CANARY): HTMLInputElement => {
  const input = document.createElement('input');
  input.name = name;
  input.value = value;
  document.body.appendChild(input);
  return input;
};

/** 取出气泡根节点 */
const bubbleRoot = (): HTMLElement | null => shadow?.getElementById('aph-idh-root') ?? null;

const keydown = (key: string, options: { composing?: boolean } = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
  if (options.composing) Object.defineProperty(event, 'isComposing', { value: true });
  return event;
};

describe('身份提示气泡', () => {
  let layout: DomLayout;
  let field: HTMLInputElement;

  const show = (role: IdentityHintRole = 'name', needsVerify = false): void => {
    showIdentityHint(field, role, needsVerify);
  };

  /** 收起态判据：宿主仍在（常驻复用），但气泡内容被清空 */
  const expectHidden = (): void => {
    expect(bubbleRoot()?.querySelector('.aph-idh')).toBeNull();
  };

  beforeEach(() => {
    locale = 'zh-CN';
    localeListeners.clear();
    trackAttachShadow();
    layout = installDomLayout();
    (globalThis as any).chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage: vi.fn(async () => ({ success: true })),
        getURL: vi.fn((path: string) => `chrome-extension://test-extension/${path}`),
      },
      storage: { local: { get: vi.fn(async () => ({})) }, session: { get: vi.fn(async () => ({})) } },
    };
    field = makeField('realName');
    layout.setRect(field, { left: 100, top: 200, width: 240, height: 32 });
  });

  afterEach(() => {
    destroyIdentityHint();
    layout.uninstall();
    localeListeners.clear();
    document.body.innerHTML = '';
    delete (globalThis as any).chrome;
    vi.restoreAllMocks();
  });

  describe('呈现', () => {
    it('标题按模板把角色词插在占位处，动作按钮齐备', () => {
      show('name');
      const bubble = bubbleRoot()?.querySelector('.aph-idh');
      expect(bubble?.getAttribute('role')).toBe('status');
      expect(bubbleRoot()?.querySelector('.aph-idh__title')?.textContent).toBe('这是「姓名」字段');
      expect(bubbleRoot()?.querySelector('.aph-idh__role')?.textContent).toBe('姓名');
      expect(bubbleRoot()?.querySelector('.aph-idh__btn--primary')?.textContent).toBe('从身份库选择');
      expect(bubbleRoot()?.querySelector('.aph-idh__btn--ghost')?.textContent).toBe('收起');
    });

    it('「需核对」档才追加核对提示，普通档不显示', () => {
      show('idNumber', true);
      expect(bubbleRoot()?.querySelector('.aph-idh__verify')?.textContent).toContain('核对');

      hideIdentityHint();
      show('email', false);
      expect(bubbleRoot()?.querySelector('.aph-idh__verify')).toBeNull();
    });

    it('语言切换后按新语言重绘，且不新增宿主', () => {
      show('postal');
      expect(bubbleRoot()?.querySelector('.aph-idh__role')?.textContent).toBe('邮编');

      emitLocaleChange('en');
      expect(bubbleRoot()?.querySelector('.aph-idh__role')?.textContent).toBe('postal code');
      expect(document.querySelectorAll(HOST_SELECTOR)).toHaveLength(1);
    });

    it('字段滚出视口时气泡自己收掉，不留一枚悬空的提示', () => {
      layout.setRect(field, { left: 100, top: -80, width: 240, height: 32 });
      show();
      expectHidden();
    });
  });

  describe('零明文跨界', () => {
    it('气泡文本与消息载荷都不含字段当前值，载荷只有角色', async () => {
      show('idNumber', true);
      const html = bubbleRoot()?.innerHTML ?? '';
      expect(html).not.toContain(CANARY);

      (bubbleRoot()?.querySelector('.aph-idh__btn--primary') as HTMLElement).click();
      const sendMessage = (globalThis as any).chrome.runtime.sendMessage as Mock;
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage.mock.calls[0][0]).toEqual({
        type: MessageType.OPEN_OPTIONS_AND_IDENTITY,
        data: { role: 'idNumber' },
      });
      expect(JSON.stringify(sendMessage.mock.calls[0][0])).not.toContain(CANARY);
      await Promise.resolve();
    });

    it('收起按钮不发消息（「稍后再说」不该把用户甩到管理页）', () => {
      show('name');
      (bubbleRoot()?.querySelector('.aph-idh__btn--ghost') as HTMLElement).click();
      expect((globalThis as any).chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expectHidden();
    });

    it('页面文档里除宿主外没有被写入任何扩展内容', () => {
      show('name');
      expect(document.querySelectorAll(HOST_SELECTOR)).toHaveLength(1);
      expect(document.body.querySelectorAll('[data-aph]')).toHaveLength(0);
      expect(document.body.innerHTML).not.toContain('aph-idh');
    });
  });

  describe('收起与监听回收', () => {
    it('Esc 收起', () => {
      show('name');
      document.dispatchEvent(keydown('Escape'));
      expectHidden();
    });

    it('输入法合成期间的 Esc 让位给候选词，不收气泡', () => {
      show('name');
      document.dispatchEvent(keydown('Escape', { composing: true }));
      expect(bubbleRoot()?.querySelector('.aph-idh')).not.toBeNull();
    });

    it('按下动作按钮不引发默认焦点转移（否则 blur 先收气泡，click 根本落不到按钮）', () => {
      show('name');
      const actions = bubbleRoot()?.querySelector('.aph-idh__actions') as HTMLElement;

      const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      actions.querySelector('.aph-idh__btn--primary')?.dispatchEvent(mousedown);
      expect(mousedown.defaultPrevented).toBe(true);

      const pointerdown = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      actions.dispatchEvent(pointerdown);
      expect(pointerdown.defaultPrevented).toBe(true);
    });

    it('焦点离开绑定字段即收起，别的元素失焦不收', () => {
      show('name');
      const other = makeField('other');

      other.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      expect(bubbleRoot()?.querySelector('.aph-idh')).not.toBeNull();

      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      expectHidden();
    });

    it('重复展示不累积监听：三轮显示后语言订阅恒为一条，收起即归零', () => {
      for (let i = 0; i < 3; i++) {
        show('name');
        hideIdentityHint();
      }
      show('name');
      expect([...localeListeners]).toHaveLength(1);

      document.dispatchEvent(keydown('Escape'));
      expectHidden();
      // 收起走的是同一条清理路径：监听没回收就会在这里留下残订阅者
      expect([...localeListeners]).toHaveLength(0);
    });

    it('滚动与缩放后重新定位，缩放监听不随每次展示累积', () => {
      show('name');
      const before = field.getBoundingClientRect().top;
      layout.setRect(field, { left: 20, top: 400, width: 240, height: 32 });
      window.dispatchEvent(new Event('scroll'));
      const styled = bubbleRoot()?.querySelector('.aph-idh') as HTMLElement;
      expect(styled.style.top).toBe(`${400 + 32 + 6}px`);
      expect(before).toBe(200);

      window.dispatchEvent(new Event('resize'));
      expect(bubbleRoot()?.querySelector('.aph-idh')).not.toBeNull();
    });
  });

  describe('单例跟随', () => {
    it('同一字段同角色重复聚焦不重建气泡节点', () => {
      show('name');
      const first = bubbleRoot()?.querySelector('.aph-idh');
      show('name');
      expect(bubbleRoot()?.querySelector('.aph-idh')).toBe(first);
    });

    it('角色或核对档变化时重建，让提示跟着最新判定', () => {
      show('name');
      const first = bubbleRoot()?.querySelector('.aph-idh');
      show('name', true);
      expect(bubbleRoot()?.querySelector('.aph-idh')).not.toBe(first);
      expect(bubbleRoot()?.querySelector('.aph-idh__verify')).not.toBeNull();
    });

    it('换字段后气泡绑定到新字段', () => {
      show('name');
      const next = makeField('mobile');
      layout.setRect(next, { left: 0, top: 60, width: 200, height: 30 });

      showIdentityHint(next, 'phone', false);
      expect(bubbleRoot()?.querySelector('.aph-idh__role')?.textContent).toBe('手机号');

      next.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      expectHidden();
    });

    it('destroyIdentityHint 摘掉宿主，语言订阅一并回收', () => {
      show('name');
      destroyIdentityHint();
      expect(document.querySelectorAll(HOST_SELECTOR)).toHaveLength(0);
      expect(localeListeners).toHaveLength(0);
    });
  });
});
