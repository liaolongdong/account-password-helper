/** @vitest-environment jsdom */

/**
 * 内联下拉的 combobox 语义与默认选中回归测试（方案 C + G）
 *
 * 两块行为一起钉住：
 * - C 默认选中首条：面板首帧与每次过滤之后，高亮落在第一行（列表已由 background 按
 *   「匹配层级 → 收藏 → 侧边栏排序配置」排好，首行即最优候选），空列表不选中；
 * - G combobox 语义：焦点始终留在输入框，读屏靠 `aria-expanded` 判断弹层有无内容、
 *   靠 `aria-activedescendant` 播报当前高亮行，选项自身带 `role="option"` 与 `aria-selected`。
 *
 * 另守卫一处结构约束：空态文案与「添加此网站账号」等按钮必须留在列表框之外，
 * 否则它们会作为非 option 节点混进 combobox 的可选项里被逐条念出。
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
  data?: { id?: string };
}

describe('InlineFillDropdown 的 combobox 语义与默认选中', () => {
  let dropdown: InlineFillDropdown;
  let input: HTMLInputElement;
  let root: ShadowRoot | null;
  let attachShadowSpy: ReturnType<typeof vi.spyOn>;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  const originalScrollIntoView = Element.prototype.scrollIntoView;

  /** 让 select() 的 await 链跑完 */
  const flush = (): Promise<unknown> => new Promise(resolve => setTimeout(resolve, 0));

  /** 打开面板（mock GET_MATCHING_ACCOUNTS 的下发数据） */
  const openWith = async (accounts: MatchingAccountMeta[]): Promise<void> => {
    sendSpy.mockResolvedValue({ success: true, data: { locked: false, accounts } } as never);
    expect(await dropdown.openPanelFor(input)).toBe(true);
  };

  const searchInput = (): HTMLInputElement => root!.querySelector<HTMLInputElement>('.aph-search input')!;
  const listbox = (): HTMLElement => root!.querySelector<HTMLElement>('.aph-options')!;
  const rows = (): HTMLElement[] => [...root!.querySelectorAll<HTMLElement>('.aph-row')];
  const activeIndexes = (): number[] =>
    rows().reduce<number[]>((acc, row, index) => (row.classList.contains('active') ? [...acc, index] : acc), []);
  const selectedOptionIndexes = (): number[] =>
    rows().reduce<number[]>(
      (acc, row, index) => (row.getAttribute('aria-selected') === 'true' ? [...acc, index] : acc),
      [],
    );
  /** 输入框 aria-activedescendant 指向的行序号（未指向返回 null） */
  const activeDescendantIndex = (): number | null => {
    const id = searchInput().getAttribute('aria-activedescendant');
    if (!id) return null;
    const match = /^aph-inline-option-(\d+)$/.exec(id);
    return match ? Number(match[1]) : Number.NaN;
  };

  /**
   * 按下导航键
   *
   * 面板的键盘导航绑在 shadow root 上（页面上的合成事件进不来），真实按键的目标就是
   * 面板里聚焦的检索框，故断言从它派发。
   */
  const keydown = (key: string): void => {
    searchInput().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }));
  };

  /** 在搜索框输入关键词（真实计时器：不推进防抖窗口，只观察本地渲染） */
  const type = (keyword: string): void => {
    const search = searchInput();
    search.value = keyword;
    search.dispatchEvent(new Event('input'));
  };

  const filledId = (): string | undefined =>
    sendSpy.mock.calls
      .map((call: unknown[]) => call[0] as SentMessage)
      .filter((message: SentMessage) => message.type === MessageType.FILL_BY_ID)
      .pop()?.data?.id;

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

    // jsdom 未实现 scrollIntoView，而 updateActive 会滚动到高亮行
    Element.prototype.scrollIntoView = (): void => {};

    sendSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    input = document.createElement('input');
    document.body.appendChild(input);
    dropdown = new InlineFillDropdown();
  });

  afterEach(() => {
    dropdown.destroy();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    attachShadowSpy.mockRestore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('默认选中首条', () => {
    it('首帧即高亮第一行，无需先按一下 ↓', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);

      expect(activeIndexes()).toEqual([0]);
      expect(rows()[0]!.dataset.index).toBe('0');
    });

    it('不做任何导航直接回车，填充的是首条', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);

      keydown('Enter');
      await flush();

      expect(filledId()).toBe('a1');
    });

    it('每次过滤之后高亮回到首条（列表已重排，旧序号对应的已不是同一条）', async () => {
      await openWith([account({ id: 'a1', username: 'alice' }), account({ id: 'a2', username: 'bob' })]);
      keydown('ArrowDown');
      expect(activeIndexes()).toEqual([1]);

      type('ali');

      expect(rows()).toHaveLength(1);
      expect(activeIndexes()).toEqual([0]);
    });

    it('无结果时不选中任何行，回车保持空操作', async () => {
      await openWith([account({ id: 'a1' })]);

      type('zzz-无匹配');

      expect(rows()).toHaveLength(0);
      expect(activeIndexes()).toEqual([]);
      keydown('Enter');
      await flush();
      expect(filledId()).toBeUndefined();
    });
  });

  describe('combobox ARIA 语义', () => {
    it('搜索框是 combobox，指向列表框且展开态随结果变化', async () => {
      await openWith([account({ id: 'a1' })]);
      expect(searchInput().getAttribute('role')).toBe('combobox');
      expect(searchInput().getAttribute('aria-autocomplete')).toBe('list');
      expect(searchInput().getAttribute('aria-controls')).toBe('aph-inline-list');
      expect(searchInput().getAttribute('aria-expanded')).toBe('true');
      expect(listbox().getAttribute('role')).toBe('listbox');
      expect(listbox().id).toBe(searchInput().getAttribute('aria-controls'));

      type('zzz-无匹配');
      expect(searchInput().getAttribute('aria-expanded')).toBe('false');
      expect(searchInput().hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('每行都是 option，可访问名取自行内容（不额外设 aria-label 盖掉标签与备注）', async () => {
      await openWith([
        account({ id: 'a1', username: 'alice' }),
        account({ id: 'a2', username: 'bob', remark: '生产环境' }),
      ]);

      expect(rows().every(row => row.getAttribute('role') === 'option')).toBe(true);
      expect(rows().map(row => row.id)).toEqual(['aph-inline-option-0', 'aph-inline-option-1']);
      expect(rows()[1]!.hasAttribute('aria-label')).toBe(false);
      expect(rows()[1]!.textContent).toContain('生产环境');
    });

    it('↑↓ 同步 aria-selected 与 aria-activedescendant，任一时刻至多一行选中', async () => {
      await openWith([
        account({ id: 'a1' }),
        account({ id: 'a2', username: 'bob' }),
        account({ id: 'a3', username: 'carol' }),
      ]);

      expect(selectedOptionIndexes()).toEqual([0]);
      expect(activeDescendantIndex()).toBe(0);

      keydown('ArrowDown');
      expect(selectedOptionIndexes()).toEqual([1]);
      expect(activeDescendantIndex()).toBe(1);

      keydown('ArrowUp');
      keydown('ArrowUp');
      expect(selectedOptionIndexes()).toEqual([0]);
      expect(activeDescendantIndex()).toBe(0);
    });

    it('空态不落在列表框内：列表框只有 option，引导按钮在框外', async () => {
      await openWith([]);

      expect(listbox().children).toHaveLength(0);
      const empty = root!.querySelector('.aph-empty');
      expect(empty).not.toBeNull();
      expect(listbox().contains(empty)).toBe(false);
      expect(root!.querySelector('.aph-empty-slot')!.contains(empty)).toBe(true);
      expect(searchInput().getAttribute('aria-expanded')).toBe('false');
    });
  });
});
