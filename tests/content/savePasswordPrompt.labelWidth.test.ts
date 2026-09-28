/** @vitest-environment jsdom */
/**
 * 保存密码弹窗的标签列宽与样式隔离回归测试
 *
 * 背景一（列宽）：标签列原本写死 `width: 40px`（按中文两字「账号」「密码」的高度定的），
 * 英文环境下 `Username` / `Password` 放不下会被断词换行——实测在英文站点上
 * 渲染成 `Usern` + `ame`、`Passw` + `ord`，看起来像渲染故障。
 * 修复后四行共用「当前语言里最长标签量出来的宽度」，中文仍取 40px 下限（版式不变）。
 *
 * 背景二（隔离）：弹窗曾是 light DOM 直挂 `document.body`，宿主页面向（`* { font }`、
 * `button { ... }`、`@keyframes aphSlideIn` 重名等）都能命中它。现与仓内其他注入式
 * UI 对齐为 Closed Shadow DOM 一档，故本文件同时锁定隔离边界：
 * 宿主挂 `documentElement` 且带 `data-aph` 凭据、影子树内首条规则为 `:host{all:initial}`、
 * 关键帧不再写入 `document.head`、关闭时整宿主被摘除。
 *
 * jsdom 没有真实布局、`offsetWidth` 恒为 0，因此这里把 `offsetWidth` 桩成
 * 「字符数 × 7px」，让「按最长标签定宽」这一决策可被断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 当前语言（供下方 mock 的 tl 读取），测试内可切换 */
let locale: 'zh-CN' | 'en' = 'zh-CN';

vi.mock('@/utils/i18n-lite', async () => {
  const actual = await vi.importActual<typeof import('@/utils/i18n-lite')>('@/utils/i18n-lite');
  return {
    ...actual,
    tl: (key: string) => actual.LITE_MESSAGES[locale][key] ?? key,
  };
});

vi.mock('@/utils/theme', async () => {
  const actual = await vi.importActual<typeof import('@/utils/theme')>('@/utils/theme');
  // 必须回真实默认主题名（不是字面量 'default'）：弹窗会拿它去查 THEME_SHADOW_TOKENS
  return { ...actual, getStoredTheme: vi.fn(async () => actual.DEFAULT_THEME) };
});

import { dismissSavePasswordPrompt, showSavePasswordPrompt } from '@/entrypoints/content/SavePasswordPrompt';

/** 弹窗宿主属性选择器（closed 影子树外部定位节点的唯一凭据） */
const HOST_SELECTOR = '[data-aph="save-password-prompt"]';

/** 弹窗里出现过的全部标签文本（中英各一套） */
const LABEL_TEXTS = ['账号', '密码', '标签', '备注', 'Username', 'Password', 'Tags', 'Notes'];

/** 桩：每个字符 7px，用来模拟「量具量出最长标签的真实宽度」 */
const CHAR_WIDTH = 7;

/** 中文两字量出来不足下限，英文 `Password`（8 字符 × 7 + 2）= 58 */
const ZH_WIDTH = 40;
const EN_WIDTH = 58;

/** closed 影子树不挂在 `host.shadowRoot` 上，只能从 attachShadow 的返回值截获 */
const originalAttachShadow = Element.prototype.attachShadow;
let lastShadow: ShadowRoot | null = null;

const trackAttachShadow = (): void => {
  lastShadow = null;
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = originalAttachShadow.call(this, init);
    lastShadow = root;
    return root;
  });
};

describe('保存密码弹窗', () => {
  let originalOffsetWidth: PropertyDescriptor | undefined;

  beforeEach(() => {
    locale = 'zh-CN';
    trackAttachShadow();
    originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return (this.textContent || '').length * CHAR_WIDTH;
      },
    });
  });

  afterEach(() => {
    dismissSavePasswordPrompt();
    document.body.innerHTML = '';
    document.documentElement.querySelectorAll(HOST_SELECTOR).forEach(node => node.remove());
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    }
    vi.restoreAllMocks();
  });

  const openPrompt = (): void => {
    showSavePasswordPrompt(
      {
        username: 'demo@example.com',
        password: 'Demo!Pass2026',
        url: 'https://example.com',
        tag: 'Example',
        remark: 'auto saved',
      },
      () => {},
      () => {},
      () => {},
    );
  };

  /** 取出四个标签元素上的列宽与换行设置 */
  const readLabels = (): { text: string; width: string; whiteSpace: string }[] =>
    [...(lastShadow?.querySelectorAll<HTMLSpanElement>('span') ?? [])]
      .filter(el => LABEL_TEXTS.includes((el.textContent || '').trim()))
      .map(el => ({
        text: (el.textContent || '').trim(),
        width: el.style.width,
        whiteSpace: el.style.whiteSpace,
      }));

  describe('标签列宽', () => {
    it('中文四行共用 40px 下限，版式与此前一致', () => {
      openPrompt();
      const labels = readLabels();

      expect(labels.map(l => l.text).sort()).toEqual(['备注', '密码', '标签', '账号']);
      expect(new Set(labels.map(l => l.width)).size).toBe(1);
      expect(labels[0]!.width).toBe(`${ZH_WIDTH}px`);
      expect(labels.every(l => l.whiteSpace === 'nowrap')).toBe(true);
    });

    it('英文按最长标签（Password）定宽，不再断词', () => {
      locale = 'en';
      openPrompt();
      const labels = readLabels();

      expect(labels.map(l => l.text).sort()).toEqual(['Notes', 'Password', 'Tags', 'Username']);
      expect(new Set(labels.map(l => l.width)).size).toBe(1);
      expect(labels[0]!.width).toBe(`${EN_WIDTH}px`);
      // 关键回归点：宽度必须超出中文下限，否则 Username / Password 仍会被拆行
      expect(EN_WIDTH).toBeGreaterThan(ZH_WIDTH);
      expect(labels.every(l => l.whiteSpace === 'nowrap')).toBe(true);
    });
  });

  describe('Closed Shadow DOM 隔离', () => {
    it('宿主挂在 documentElement 上，卡片与量具都在影子树内，页面主树不留节点', () => {
      openPrompt();

      const hosts = document.documentElement.querySelectorAll(HOST_SELECTOR);
      expect(hosts).toHaveLength(1);
      expect(hosts[0]?.parentElement).toBe(document.documentElement);
      // 宿主是 closed：外部拿不到 shadowRoot，也无法从主树查询卡片节点
      expect((hosts[0] as HTMLElement).shadowRoot).toBeNull();
      expect(document.body.innerHTML).toBe('');
      // 量具测完即摘，影子树内只保留 <style> + 卡片
      const shadow = lastShadow;
      expect(shadow?.querySelectorAll('style')).toHaveLength(1);
      expect(shadow?.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0);
    });

    it('影子树首条规则重置继承链，关键帧不再注入 document.head', () => {
      const headStyleCountBefore = document.head.querySelectorAll('style').length;

      openPrompt();

      const styleText = lastShadow?.querySelector('style')?.textContent ?? '';
      expect(styleText).toContain(':host { all: initial; }');
      expect(styleText).toContain('@keyframes aphSlideIn');
      // 弹窗自身的动画样式随影子树局部化，不再污染宿主页全局作用域
      expect(document.head.querySelectorAll('style')).toHaveLength(headStyleCountBefore);
    });

    it('主题令牌内联写在宿主（自定义属性可穿透 shadow 边界）', async () => {
      openPrompt();
      await Promise.resolve();

      const host = document.documentElement.querySelector(HOST_SELECTOR) as HTMLElement | null;
      expect(host?.style.getPropertyValue('--aph-primary')).toBe('#409eff');
    });

    it('关闭弹窗时整宿主被摘除，不残留节点', () => {
      openPrompt();
      expect(document.documentElement.querySelectorAll(HOST_SELECTOR)).toHaveLength(1);

      dismissSavePasswordPrompt();

      expect(document.documentElement.querySelectorAll(HOST_SELECTOR)).toHaveLength(0);
    });

    it('重复弹出只保留一个宿主（旧卡片随宿主一并移除）', () => {
      openPrompt();
      openPrompt();

      expect(document.documentElement.querySelectorAll(HOST_SELECTOR)).toHaveLength(1);
    });
  });
});
