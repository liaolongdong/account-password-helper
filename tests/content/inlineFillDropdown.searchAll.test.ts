/** @vitest-environment jsdom */

/**
 * 内联下拉空态「到全库找」深链回归测试（方案 F）
 *
 * 内联列表只覆盖「本站匹配集」，用户库里明明有、但不属于本站的账号在这里必然搜不到，
 * 而把外站条目塞进内联列表会造出一条「点了填不进当前页」的死路。
 * 因此这个空态的出口是带关键词跳到密码管理页做全库检索：
 * - 只在确有关键词时出现（无关键词的空态已有「添加此网站账号」，不该再堆第三层引导）；
 * - 按钮上回显截断后的关键词（面板宽度由锚点决定），消息里带的是完整值；
 * - 点击即收起面板，发送失败不抛错（无接收者时静默）。
 *
 * 面板宿主是 closed Shadow DOM，经 `attachShadow` 桩取回 root 查询；
 * jsdom 无布局，`getBoundingClientRect` 桩成视口内非零 rect，否则面板按「锚点滚出视口」自关。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineFillDropdown } from '@/entrypoints/content/inlineDropdown/InlineFillDropdown';
import { MessageType, type MatchingAccountMeta } from '@/utils/types';

/** 一条最小可信条目（与 background 下发结构一致） */
const account = (overrides: Partial<MatchingAccountMeta> = {}): MatchingAccountMeta => ({
  id: 'a1',
  username: 'alice',
  tag: '工作',
  remark: '',
  url: 'example.com',
  favorite: false,
  hasTotp: false,
  favicon: '',
  tier: 0,
  ...overrides,
});

/** 只读取断言所需的消息字段（sendMessage 的 message 参数在 @types/chrome 里是宽松类型） */
interface SentMessage {
  type?: string;
  data?: { keyword?: string };
}

describe('InlineFillDropdown 空态的「到全库找」深链', () => {
  let dropdown: InlineFillDropdown;
  let input: HTMLInputElement;
  let root: ShadowRoot | null;
  let attachShadowSpy: ReturnType<typeof vi.spyOn>;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  const searchAllBtn = (): HTMLButtonElement | null =>
    root!.querySelector<HTMLButtonElement>('[data-action="search-all"]');

  /** 打开面板（mock GET_MATCHING_ACCOUNTS 的下发数据） */
  const openWith = async (accounts: MatchingAccountMeta[]): Promise<void> => {
    sendSpy.mockResolvedValue({ success: true, data: { locked: false, accounts } } as never);
    expect(await dropdown.openPanelFor(input)).toBe(true);
  };

  /** 在搜索框输入关键词 */
  const type = (keyword: string): void => {
    const search = root!.querySelector<HTMLInputElement>('.aph-search input');
    if (!search) throw new Error('面板未渲染搜索框');
    search.value = keyword;
    search.dispatchEvent(new Event('input'));
  };

  const sentMessages = (): SentMessage[] => sendSpy.mock.calls.map((call: unknown[]) => call[0] as SentMessage);

  const searchAllMessages = (): SentMessage[] =>
    sentMessages().filter((message: SentMessage) => message.type === MessageType.OPEN_OPTIONS_AND_SEARCH);

  beforeEach(() => {
    document.body.innerHTML = '';
    root = null;

    const originalAttachShadow = Element.prototype.attachShadow;
    attachShadowSpy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      init: ShadowRootInit,
    ) {
      const created = originalAttachShadow.call(this, init);
      root = created;
      return created;
    });

    vi.spyOn(HTMLInputElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 100,
      left: 10,
      top: 100,
      right: 210,
      bottom: 120,
      width: 200,
      height: 20,
      toJSON: () => ({}),
    } as DOMRect);

    sendSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    input = document.createElement('input');
    document.body.appendChild(input);
    dropdown = new InlineFillDropdown();
  });

  afterEach(() => {
    dropdown.destroy();
    attachShadowSpy.mockRestore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('本站有账号但关键词打空：出现带关键词回显的全库检索入口', async () => {
    await openWith([account({ username: 'alice' })]);

    type('bob');

    expect(root!.querySelector('.aph-empty')).not.toBeNull();
    expect(searchAllBtn()!.textContent).toContain('bob');
  });

  it('无关键词的空态不带该入口，避免与「添加此网站账号」叠成三层引导', async () => {
    await openWith([]);

    expect(root!.querySelector('[data-action="add-site"]')).not.toBeNull();
    expect(searchAllBtn()).toBeNull();
  });

  it('关键词全是空白时同样不出入口', async () => {
    await openWith([account()]);

    type('   ');

    expect(searchAllBtn()).toBeNull();
  });

  it('点击后收起面板并带上完整关键词发送深链指令', async () => {
    await openWith([account({ username: 'alice' })]);
    const longKeyword = 'zhangsan.developer.account.2026';

    type(longKeyword);
    const label = searchAllBtn()!.textContent ?? '';
    // 面板宽度由锚点决定，长串只回显截断后的部分
    expect(label).toContain('…');
    expect(label).not.toContain(longKeyword);

    searchAllBtn()!.click();

    expect(root!.querySelector('.aph-panel.visible')).toBeNull();
    expect(searchAllMessages()).toHaveLength(1);
    expect(searchAllMessages()[0]!.data?.keyword).toBe(longKeyword);
    expect(searchAllBtn()).toBeNull(); // 关闭即清空渲染，不留残影
  });

  it('发送失败时静默降级，不让异常打断页面', async () => {
    await openWith([account({ username: 'alice' })]);
    type('bob');
    sendSpy.mockRejectedValue(new Error('message port closed'));

    expect(() => searchAllBtn()!.click()).not.toThrow();
    await Promise.resolve();
  });
});
