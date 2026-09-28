/** @vitest-environment jsdom */
/**
 * 保存密码弹窗的「保存去向提示」行回归测试
 *
 * 自动保存的判重口径不因跨子域档位放宽（同名 + 父子域命中即更新），于是弹窗标题说的
 * 「更新」可能落在另一站的条目上；而跨子域档位下库里已有的同名条目又确实会新增为第二条。
 * 这一行把两种去向说清楚。本文件同时锁住跨帧委托场景的边界校验：`data` 经 `postMessage`
 * 传入，属不可信输入，未知 kind / 非字符串 url / 空 url 一律不渲染，绝不因脏数据渲染出
 * 语义相反或空白的一行。
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
import { PASSWORD_FIELD_LIMITS } from '@/utils/constants';
import type { SavePromptData } from '@/entrypoints/content/types';

/** 弹窗宿主属性选择器（closed 影子树外部定位节点的唯一凭据） */
const HOST_SELECTOR = '[data-aph="save-password-prompt"]';

/** closed 影子树不挂在 `host.shadowRoot` 上，只能从 attachShadow 的返回值截获 */
const originalAttachShadow = Element.prototype.attachShadow;
let lastShadow: ShadowRoot | null = null;

describe('保存弹窗的保存去向提示', () => {
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

  const openWith = (overrides: Partial<SavePromptData> = {}): void => {
    showSavePasswordPrompt(
      {
        username: 'demo',
        password: 'Demo!Pass2026',
        url: 'mail.qq.com',
        tag: '',
        remark: '',
        ...overrides,
      },
      () => {},
      () => {},
      () => {},
    );
  };

  /**
   * 取出提示行元素：只比对无子节点的 div，否则外层容器（其 textContent 汇总整张卡片）
   * 会在文档序里先于提示行命中关键字
   */
  const findNote = (): HTMLDivElement | null =>
    [...(lastShadow?.querySelectorAll<HTMLDivElement>('div') ?? [])].find(
      el => el.children.length === 0 && (el.textContent ?? '').includes('同名账号'),
    ) ?? null;

  it('updateOtherHost → 说明更新的是哪一条，并带在卡片末尾（备注行之后）', () => {
    openWith({ mode: 'update', targetNote: { kind: 'updateOtherHost', url: 'qq.com' } });

    const note = findNote();
    expect(note?.textContent).toBe('将更新 qq.com 的同名账号');
    expect(note?.parentElement?.lastElementChild).toBe(note);
  });

  it('willCreate → 说明库里已有同名条目、本次会新增一条', () => {
    openWith({ targetNote: { kind: 'willCreate', url: 'music.qq.com' } });
    expect(findNote()?.textContent).toBe('库中已有 music.qq.com 的同名账号，本次将新增一条');
  });

  it('英文两套文案均已注册（中英 key 集一致的可见面）', () => {
    locale = 'en';
    openWith({ mode: 'update', targetNote: { kind: 'updateOtherHost', url: 'qq.com' } });
    const enNote = [...(lastShadow?.querySelectorAll<HTMLDivElement>('div') ?? [])].find(
      el => el.children.length === 0 && (el.textContent ?? '').includes('account'),
    );
    expect(enNote?.textContent).toBe('This will update the same account saved for qq.com');
  });

  it('无 targetNote 时不渲染该行（既有版式不变）', () => {
    openWith();
    expect(findNote()).toBeNull();
  });

  it.each([
    ['未知 kind', { kind: 'deleteOther', url: 'qq.com' }],
    ['url 非字符串', { kind: 'willCreate', url: 123 }],
    ['url 为空白串', { kind: 'willCreate', url: '   ' }],
    ['整条为非对象', 'qq.com'],
    ['整条为 null', null],
  ])('脏数据（%s）不渲染提示行', (_case, raw) => {
    openWith({ targetNote: raw as unknown as SavePromptData['targetNote'] });
    expect(findNote()).toBeNull();
  });

  it('网址按条目容量截断，超长串不撑破卡片', () => {
    const longUrl = `${'a'.repeat(PASSWORD_FIELD_LIMITS.url)}${'b'.repeat(40)}.com`;
    openWith({ targetNote: { kind: 'willCreate', url: longUrl } });

    const text = findNote()?.textContent ?? '';
    expect(text).toContain('a'.repeat(PASSWORD_FIELD_LIMITS.url));
    expect(text).not.toContain('b'.repeat(40));
  });

  it('网址以纯文本写入，宿主页面不会被注入节点', () => {
    openWith({ targetNote: { kind: 'willCreate', url: '<img src=x>qq.com' } });

    const note = findNote();
    expect(note?.children).toHaveLength(0);
    expect(note?.innerHTML).toContain('&lt;img');
  });
});
