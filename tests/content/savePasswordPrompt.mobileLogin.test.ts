/** @vitest-environment jsdom */
/**
 * 保存弹窗对「手机号 + 短信验证码」凭证的诚实展示
 *
 * 这一形态下没有口令可展示，而密码行是按 `isPassword` 渲染成 `'•'.repeat(value.length)` 的：
 * 空串渲染出一段**什么都没有的空白**（`SavePasswordPrompt.ts:671`）。用户看到的是
 * 「密码：␣␣␣」这样一行，读不出这是正常形态还是扩展没抓到口令——很可能当成缺陷去关开关。
 * 因此 `mobileLogin` 为真时该行改说一句「验证码不保存」，且不做掩码。
 *
 * 掩码路径本身必须照常：这是弹窗唯一的密码展示出口，改成明文就是往宿主页面右上角贴口令。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 当前语言（供下方 mock 的 tl 读取），测试内可切换 */
let locale: 'zh-CN' | 'en' = 'zh-CN';

vi.mock('@/utils/i18n-lite', async () => {
  const actual = await vi.importActual<typeof import('@/utils/i18n-lite')>('@/utils/i18n-lite');
  return {
    ...actual,
    // 真实 tl 的语言来自 storage，这里按测试内的 locale 取词，并做同一套 {param} 替换
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
  return { ...actual, getStoredTheme: vi.fn(async () => actual.DEFAULT_THEME) };
});

import { dismissSavePasswordPrompt, showSavePasswordPrompt } from '@/entrypoints/content/SavePasswordPrompt';
import type { SavePromptData } from '@/entrypoints/content/types';

/** 弹窗宿主属性选择器（closed 影子树外部定位节点的唯一凭据） */
const HOST_SELECTOR = '[data-aph="save-password-prompt"]';

/** closed 影子树不挂在 `host.shadowRoot` 上，只能从 attachShadow 的返回值截获 */
const originalAttachShadow = Element.prototype.attachShadow;
let lastShadow: ShadowRoot | null = null;

const promptData = (overrides: Partial<SavePromptData> = {}): SavePromptData => ({
  username: '13800000000',
  password: '',
  url: 'passport.example.com',
  tag: '',
  remark: '自动保存',
  mode: 'save',
  ...overrides,
});

/** 按标签文本取那一行的值侧文本；找不到行时返回 null */
const rowValue = (label: string): string | null => {
  const rows = Array.from(lastShadow?.querySelectorAll('div') ?? []).filter(
    row => row.firstElementChild?.textContent === label,
  );
  if (rows.length === 0) return null;
  return rows[0].children[1]?.textContent ?? '';
};

describe('保存弹窗的手机号登录形态', () => {
  beforeEach(() => {
    locale = 'zh-CN';
    lastShadow = null;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
      lastShadow = originalAttachShadow.call(this, init);
      return lastShadow;
    });
  });

  afterEach(() => {
    dismissSavePasswordPrompt();
    document.documentElement.querySelectorAll(HOST_SELECTOR).forEach(node => node.remove());
    vi.restoreAllMocks();
  });

  it('密码那一行改说「验证码不保存」，而不是渲染一行看不见的空掩码', () => {
    showSavePasswordPrompt(
      promptData({ mobileLogin: true }),
      () => {},
      () => {},
      () => {},
    );

    const value = rowValue('密码');
    expect(value).not.toBeNull();
    expect(value).toBe('验证码不保存');
  });

  it('英文态同样给出可读说明（该行不得留空，也不得只剩一个冒号）', () => {
    locale = 'en';
    showSavePasswordPrompt(
      promptData({ mobileLogin: true }),
      () => {},
      () => {},
      () => {},
    );

    expect(rowValue('Password')).toBe('One-time code not saved');
  });

  it('普通密码登录仍走掩码：口令不许以明文出现在宿主页面右上角', () => {
    showSavePasswordPrompt(
      promptData({ username: 'alice', password: 'S3cr3t!Passw0rd' }),
      () => {},
      () => {},
      () => {},
    );

    expect(rowValue('密码')).toBe('•'.repeat(12));
  });

  it('没声明 mobileLogin 的空口令不套用它：那是脏数据，不该被说成手机号登录', () => {
    showSavePasswordPrompt(
      promptData(),
      () => {},
      () => {},
      () => {},
    );

    expect(rowValue('密码')).toBe('');
  });
});
