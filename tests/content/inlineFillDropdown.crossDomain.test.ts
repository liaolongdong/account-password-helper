/** @vitest-environment jsdom */

/**
 * 内联填充面板的跨子域呈现回归测试
 *
 * 锁定两条对外契约（档位判定全在 background，内容脚本只消费结论）：
 * 1. 来源标识：`tier` 1~3（通配 / 主域 / 兄弟子域）的行在副信息槽带一枚「跨子域」chip，
 *    `tier` 0（精确）与 4（空 URL 通用条目）不带——后者在任何档位下都一直可见；
 * 2. 空态深链：本站无账号但 `crossDomainCount > 0` 时渲染引导按钮，点击发
 *    `OPEN_OPTIONS_AND_DOMAIN_MATCH`，且不带任何自报参数。
 *
 * 面板宿主是 closed Shadow DOM，故经 `attachShadow` 桩取回 root 做查询；jsdom 无布局，
 * `getBoundingClientRect` 桩成视口内的非零 rect，否则 `positionPanel` 会按「锚点滚出视口」关闭面板。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineFillDropdown } from '@/entrypoints/content/inlineDropdown/InlineFillDropdown';
import { MessageType, type MatchingAccountMeta, type MatchingAccountsResponse } from '@/utils/types';
import { LITE_MESSAGES } from '@/utils/i18n-lite';

const account = (overrides: Partial<MatchingAccountMeta> = {}): MatchingAccountMeta => ({
  id: 'ok-1',
  username: 'alice',
  tag: '',
  remark: '',
  url: 'mail.qq.com',
  favorite: false,
  hasTotp: false,
  favicon: '',
  tier: 0,
  ...overrides,
});

describe('InlineFillDropdown 跨子域呈现', () => {
  let dropdown: InlineFillDropdown;
  let input: HTMLInputElement;
  let root: ShadowRoot | null;
  let attachShadowSpy: ReturnType<typeof vi.spyOn>;
  let sendMessage: ReturnType<typeof vi.spyOn>;

  /** 打开面板并下发给定的响应载荷 */
  const openWith = async (data: MatchingAccountsResponse): Promise<void> => {
    // as never：@types/chrome 把无回调的 sendMessage 推成 `Promise<void>`，
    // 而这里要下发的正是响应信封，只能在 mock 边界一次性收窄
    sendMessage.mockResolvedValue({ success: true, data } as never);
    expect(await dropdown.openPanelFor(input)).toBe(true);
  };

  /** 第 index 行的来源 chip 文本；无 chip 返回 null */
  const chipTextOfRow = (index: number): string | null =>
    root?.querySelectorAll<HTMLDivElement>('.aph-row')[index]?.querySelector('.aph-scope-chip')?.textContent ?? null;

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

    sendMessage = vi.spyOn(chrome.runtime, 'sendMessage');
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

  it('通配 / 主域 / 兄弟子域三档层级各带一枚来源 chip，精确与通用条目不带', async () => {
    await openWith({
      locked: false,
      accounts: [
        account({ id: 'exact', tier: 0 }),
        account({ id: 'wild', tier: 1 }),
        account({ id: 'apex', tier: 2 }),
        account({ id: 'sibling', tier: 3 }),
        account({ id: 'generic', tier: 4, url: '' }),
      ],
      crossDomainCount: 0,
    });

    const chip = LITE_MESSAGES['zh-CN']['cs.inline.scopeCrossSubdomain'];
    // 缺 key 时 tl() 会原样返回 key 本身，故这里断言的是「取到了译文」而非「取到了值」
    expect(chip).toBeTruthy();
    expect(chipTextOfRow(0)).toBeNull();
    expect([chipTextOfRow(1), chipTextOfRow(2), chipTextOfRow(3)]).toEqual([chip, chip, chip]);
    expect(chipTextOfRow(4)).toBeNull();
  });

  it('本站无账号但同主域有条目时渲染深链，点击发送无载荷的档位设置消息', async () => {
    await openWith({ locked: false, accounts: [], crossDomainCount: 2 });

    const hint = root!.querySelector<HTMLButtonElement>('[data-action="domain-match"]');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('2');
    expect(hint!.textContent).not.toContain('cs.inline');

    sendMessage.mockClear();
    hint!.click();

    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.OPEN_OPTIONS_AND_DOMAIN_MATCH });
  });

  it('计数缺省或为 0（含精确档位）时不渲染深链，空态与改动前一致', async () => {
    await openWith({ locked: false, accounts: [] });
    expect(root!.querySelector('[data-action="domain-match"]')).toBeNull();
    expect(root!.querySelector('.aph-empty')).not.toBeNull();

    await openWith({ locked: false, accounts: [], crossDomainCount: 0 });
    expect(root!.querySelector('[data-action="domain-match"]')).toBeNull();
  });

  it('本站已有账号、只是搜索关键字无结果时不抢戏提示跨子域', async () => {
    // 深链只服务「本站确实没有账号」的空态：本站有账号时用户已经在看到列表了
    await openWith({ locked: false, accounts: [account()], crossDomainCount: 3 });

    const search = root?.querySelector<HTMLInputElement>('.aph-search input');
    if (!search) throw new Error('面板未渲染搜索框');
    search.value = 'zzz-nomatch';
    search.dispatchEvent(new Event('input'));

    expect(root!.querySelector('.aph-empty')).not.toBeNull();
    expect(root!.querySelector('[data-action="domain-match"]')).toBeNull();
  });
});
