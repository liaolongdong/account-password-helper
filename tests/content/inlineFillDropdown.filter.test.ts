/** @vitest-environment jsdom */

/**
 * 内联填充面板的搜索筛选健壮性回归测试
 *
 * 回归背景：`applyFilter` 对 username/tag/remark/url 四个字段直接 `.toLowerCase()`，
 * 而条目来自 background 下发的匹配结果，历史或手工改过的存储里任一字段都可能缺失。
 * 一旦关键字非空，`undefined.toLowerCase()` 的 TypeError 抛在 `buildPanel` 末尾——
 * 此时 `panelOpen` 已置 true，面板停在半渲染状态，且后续对同一输入框的 `openPanelFor`
 * 会因「已打开」短路返回 true，用户表现为「内联面板永久打不开」，且异常在事件监听器里
 * 被 jsdom/浏览器吞掉，页面控制台之外没有任何反馈。
 *
 * 修复后四个字段一律经 `asText()` 收窄，因此断言的是可观察结果：输入关键字后列表
 * 必须按关键字重渲染（而不是停在旧的全量列表），并且面板仍可继续响应下一次输入。
 *
 * 面板宿主是 closed Shadow DOM（刻意不暴露给宿主页面），故经 `attachShadow` 桩取回
 * root 做查询；jsdom 无布局，`getBoundingClientRect` 桩成视口内的非零 rect，
 * 否则 `positionPanel` 会按「锚点滚出视口」关闭面板。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineFillDropdown } from '@/entrypoints/content/inlineDropdown/InlineFillDropdown';
import type { MatchingAccountMeta } from '@/utils/types';

/** 一条字段齐整的可信条目（与 background 下发结构一致） */
const healthy = (overrides: Partial<MatchingAccountMeta> = {}): MatchingAccountMeta => ({
  id: 'ok-1',
  title: 'alice',
  username: 'alice',
  tag: '工作',
  remark: '',
  url: 'example.com',
  favorite: false,
  hasTotp: false,
  favicon: '',
  ...overrides,
});

/** 展示字段整体缺失的历史条目：类型上是必填 string，运行时不可信 */
const legacy = (): MatchingAccountMeta =>
  ({
    id: 'legacy-1',
    title: 'legacy',
  }) as unknown as MatchingAccountMeta;

describe('InlineFillDropdown 搜索筛选的不可信数据兜底', () => {
  let dropdown: InlineFillDropdown;
  let input: HTMLInputElement;
  let root: ShadowRoot | null;
  let attachShadowSpy: ReturnType<typeof vi.spyOn>;

  /** 打开面板（mock GET_MATCHING_ACCOUNTS 的下发数据） */
  const openWith = async (accounts: MatchingAccountMeta[]): Promise<void> => {
    // as never：@types/chrome 把无回调的 sendMessage 推成 `Promise<void>`，
    // 而这里要下发的正是响应信封，只能在 mock 边界一次性收窄
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({
      success: true,
      data: { locked: false, accounts },
    } as never);
    expect(await dropdown.openPanelFor(input)).toBe(true);
  };

  /** 在搜索框输入关键字，返回渲染出的行索引 */
  const typeKeyword = (keyword: string): string[] => {
    const search = root?.querySelector<HTMLInputElement>('.aph-search input');
    if (!search) throw new Error('面板未渲染搜索框');
    search.value = keyword;
    search.dispatchEvent(new Event('input'));
    return [...root!.querySelectorAll('.aph-row')].map(row => row.getAttribute('data-index')!);
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    root = null;

    // 取回 closed shadow root：真实实现只把引用留在实例私有字段里
    const originalAttachShadow = Element.prototype.attachShadow;
    attachShadowSpy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      init: ShadowRootInit,
    ) {
      const created = originalAttachShadow.call(this, init);
      root = created;
      return created;
    });

    // 刻意不复用 tests/helpers/domLayout.ts：那套装置接管 Element.prototype 并让未登记
    // 元素一律返回零矩形，还会改写 getComputedStyle；本用例只需要「锚点非零、其余照旧」，
    // 换成登记制装置会连带改变面板自身尺寸与样式分支的取值，把断言范围放大到筛选之外。
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

  it('关键字命中时按关键字重渲染，缺失字段不再让列表停在旧数据', async () => {
    await openWith([healthy(), legacy()]);
    expect(root!.querySelectorAll('.aph-row')).toHaveLength(2);

    // legacy 条目的 username/tag/remark/url 全为 undefined：修复前 TypeError 抛在这里，
    // filtered 未赋值、renderList 未执行，DOM 停留在 2 行全量列表
    expect(typeKeyword('alice')).toEqual(['0']);
  });

  it('缺失字段只影响该行，其余字段的匹配口径不变', async () => {
    await openWith([healthy({ id: 'a', username: 'alice', tag: '', url: 'a.com' }), legacy()]);

    // 标签/备注为空串、用户名参与匹配：关键字命中 url 与命中 username 走同一条 asText 通道
    expect(typeKeyword('a.com')).toEqual(['0']);
    expect(typeKeyword('nomatch')).toEqual([]);
    // 关键字清空后列表恢复全量，证明面板实例没有被上一次异常打坏
    expect(typeKeyword('')).toEqual(['0', '1']);
  });

  it('无匹配时渲染空状态并可继续输入（面板未被半渲染卡死）', async () => {
    await openWith([healthy({ username: 'alice' }), legacy()]);

    expect(typeKeyword('zzz')).toEqual([]);
    expect(root!.querySelector('.aph-empty')).not.toBeNull();

    expect(typeKeyword('example')).toEqual(['0']);
  });
});
