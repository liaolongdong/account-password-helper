/** @vitest-environment jsdom */

/**
 * 内联填充面板的键盘导航回归测试
 *
 * 钉住三层口径：
 *
 * 1. 输入法合成期间放行按键。面板曾无条件接管 Esc / ↑ / ↓ / Enter，而中文（日文）输入法
 *    合成期间这些按键的语义是「选词」——Enter 上屏候选、↑↓ 候选翻页、Esc 取消合成。于是
 *    「输入 alice 后按回车确认候选词」被读成「回车确认选择」，用户还没打完字密码就进了页面。
 *    修复口径：合成期间（`KeyboardEvent.isComposing`）整段放行给浏览器。
 *
 * 2. 状态改变的按键只能来自面板内部。keydown 挂在 `document` 捕获阶段时，宿主页面一句
 *    `dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))` 就能路过面板监听；
 *    叠加「打开即默认高亮首条」，页面脚本可把首条凭据（含密码）敲进页面输入框。
 *    修复口径：导航与填充的监听绑在 **closed** shadow root 上——页面拿不到这个 root，
 *    也无法把事件派发到 root 内的节点（真实按键的目标只能是已聚焦的面板内元素）；
 *    document 上只留 Esc 兜底（锁定卡片没有可聚焦的检索框，焦点仍在页面登录框上，
 *    此时按键路径不经过 shadow root），且兜底只会关闭面板，不产生任何填充。
 *
 * 3. 「目标只能是面板内元素」的另一面：面板内除检索框还有原生可聚焦按钮（页脚「密码管理」、
 *    尾部「还有 N 条」、TOTP 填充、空态动作）。Tab 停在它们身上时 Enter 的主人是那个按钮；
 *    而 `activeIndex` 默认高亮首条之后，无条件接管会把「打开管理页」变成「把排序第一条的
 *    账号密码敲进页面」，`preventDefault` 还顺带吞掉按钮自己的激活。
 *    修复口径：Enter 仅在目标不是可聚焦动作节点（或目标就是检索框）时接管；↑↓ 无原生冲突，不随之收窄。
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

/**
 * 构造 keydown 事件
 *
 * `composed: true` 与浏览器真实按键一致（keydown 本就是 composed 事件），这样从面板内派发的
 * Esc 也会路过 document 兜底监听——两层监听同时命中时的「只处理一次」才是真实场景。
 *
 * jsdom 的 `KeyboardEventInit` 不接受 `isComposing`，故用 defineProperty 覆写只读属性，
 * 与真实浏览器里「合成期间 isComposing 为 true」的可观察面一致。
 */
const keydown = (key: string, options: { composing?: boolean } = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
  if (options.composing) {
    Object.defineProperty(event, 'isComposing', { value: true });
  }
  return event;
};

/** 只读取断言所需的消息字段（sendMessage 的 message 参数在 @types/chrome 里是宽松类型） */
interface SentMessage {
  type?: string;
  data?: { id?: string };
}

/** 载入时的原生实现（jsdom 下为 undefined，afterEach 原样还原） */
const originalScrollIntoView = Element.prototype.scrollIntoView;
const noopScrollIntoView = (): void => {};

describe('InlineFillDropdown 键盘导航', () => {
  let dropdown: InlineFillDropdown;
  let input: HTMLInputElement;
  let root: ShadowRoot | null;
  let attachShadowSpy: ReturnType<typeof vi.spyOn>;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  /** 让 select() 的 await 链跑完 */
  const flush = (): Promise<unknown> => new Promise(resolve => setTimeout(resolve, 0));

  /** 打开面板（mock GET_MATCHING_ACCOUNTS 的下发数据；`totalMatched` 大于条数时渲染尾部读数） */
  const openWith = async (accounts: MatchingAccountMeta[], totalMatched?: number): Promise<void> => {
    sendSpy.mockResolvedValue({ success: true, data: { locked: false, accounts, totalMatched } } as never);
    expect(await dropdown.openPanelFor(input)).toBe(true);
  };

  /** 已渲染行的 data-index 列表 */
  const rowIndexes = (): string[] =>
    [...root!.querySelectorAll<HTMLElement>('.aph-row')].map(row => row.dataset.index!);

  /** 当前高亮行索引（无高亮返回 -1） */
  const activeRowIndex = (): number =>
    [...root!.querySelectorAll<HTMLElement>('.aph-row')].findIndex(row => row.classList.contains('active'));

  /** 面板内检索框（真实按键的落点：它才是聚焦元素） */
  const searchInput = (): HTMLInputElement => root!.querySelector<HTMLInputElement>('.aph-search input')!;

  /** 面板内的原生可聚焦动作按钮（页脚「密码管理」恒在；尾部读数按钮随 hiddenRows 出现） */
  const panelButton = (selector: string): HTMLElement | null => root!.querySelector<HTMLElement>(selector);

  /** 已发出的消息（按调用顺序） */
  const sentMessages = (): SentMessage[] => sendSpy.mock.calls.map((call: unknown[]) => call[0] as SentMessage);

  /** 最近一条 FILL_BY_ID 携带的条目 id（无则 undefined） */
  const filledId = (): string | undefined =>
    sentMessages()
      .filter(message => message.type === MessageType.FILL_BY_ID)
      .pop()?.data?.id;

  /** 面板是否仍处于展开态 */
  const panelVisible = (): boolean => !!root!.querySelector('.aph-panel.visible');

  /**
   * 在面板内部按下一个键（用户真实按键的路径：目标必然是 shadow root 内的聚焦元素）
   * @returns 派发出去的事件，供断言 `preventDefault`
   */
  const press = (key: string, options: { composing?: boolean } = {}): KeyboardEvent => {
    const event = keydown(key, options);
    searchInput().dispatchEvent(event);
    return event;
  };

  /**
   * 以宿主页面脚本的身份按下一个键
   *
   * 页面能触碰的最外层节点只有 document 和 shadow 宿主本身（宿主挂在 body 下、可被选择器命中），
   * 这两处正是攻击面：`target` 落在 shadow root 之外，面板内部监听不该收到。
   */
  const pressFromPage = (key: string, onHost = false): KeyboardEvent => {
    const event = keydown(key);
    const target: EventTarget = onHost ? root!.host : document.body;
    target.dispatchEvent(event);
    return event;
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

    // jsdom 未实现 scrollIntoView（`Element.prototype` 上根本没有这个方法，
    // 故不能用 vi.spyOn），而 updateActive 会滚动到高亮行
    Element.prototype.scrollIntoView = noopScrollIntoView;

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

  describe('输入法合成期间放行按键', () => {
    it('合成中按 Enter 不触发填充，面板保持打开', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);

      press('Enter', { composing: true });
      await flush();

      expect(filledId()).toBeUndefined();
      expect(root!.querySelector('.aph-panel')).not.toBeNull();
      expect(rowIndexes()).toEqual(['0', '1']);
    });

    it('合成中按 ↑↓ 不移动高亮，候选翻页留给输入法', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);
      const before = activeRowIndex();

      press('ArrowDown', { composing: true });
      press('ArrowUp', { composing: true });

      expect(activeRowIndex()).toBe(before);
    });

    it('合成中按 Esc 不关闭面板（Esc 属于取消合成）', async () => {
      await openWith([account()]);

      press('Escape', { composing: true });

      expect(panelVisible()).toBe(true);
      expect(rowIndexes()).toEqual(['0']);
    });

    it('合成中的 Esc 即使落在页面登录框上也不关闭（兜底监听同样先让位给输入法）', async () => {
      await openWith([account()]);

      const event = keydown('Escape', { composing: true });
      input.dispatchEvent(event);

      expect(panelVisible()).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    });

    it('合成期间不调用 preventDefault，按键完全交还浏览器', async () => {
      await openWith([account()]);
      const event = press('Enter', { composing: true });

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('非合成态按键行为保持不变', () => {
    it('回车填充「当前高亮的那一行」对应的条目', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);

      press('ArrowDown');
      // 按「高亮行 → 条目」的对应关系断言，不锁死首帧高亮位置（那是默认选中策略的口径）
      const expectedId = ['a1', 'a2'][activeRowIndex()];
      expect(expectedId).toBeDefined();

      press('Enter');
      await flush();

      expect(filledId()).toBe(expectedId);
    });

    it('↑ 到顶后停在首条，不进入无高亮态', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);

      press('ArrowUp');
      expect(activeRowIndex()).toBe(0);
      press('ArrowUp');
      expect(activeRowIndex()).toBe(0);
    });

    it('面板内按 Esc 关闭面板', async () => {
      await openWith([account()]);

      press('Escape');

      expect(panelVisible()).toBe(false);
    });

    it('焦点还在页面登录框时（锁定卡片无检索框）Esc 依然关得掉面板', async () => {
      sendSpy.mockResolvedValue({ success: true, data: { locked: true, accounts: [] } } as never);
      expect(await dropdown.openPanelFor(input)).toBe(true);
      expect(root!.querySelector('.aph-locked')).not.toBeNull();

      const event = keydown('Escape');
      input.dispatchEvent(event);

      expect(panelVisible()).toBe(false);
      expect(event.defaultPrevented).toBe(true);
    });

    it('两层监听不重复处理：一次 Esc 只关闭一次', async () => {
      await openWith([account()]);
      const hideSpy = vi.spyOn(dropdown, 'hide');

      press('Escape');

      expect(hideSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('焦点落在面板内按钮上时，Enter 归那个按钮', () => {
    it('焦点在「密码管理」按钮上按 Enter，不填充高亮条目、也不吞掉按钮激活', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);

      const event = keydown('Enter');
      panelButton('.aph-manage')!.dispatchEvent(event);
      await flush();

      expect(filledId()).toBeUndefined();
      // preventDefault 会连带取消 button 的原生激活，等于「密码管理」在键盘下点不开
      expect(event.defaultPrevented).toBe(false);
      expect(panelVisible()).toBe(true);
    });

    it('焦点在尾部「还有 N 条」按钮上按 Enter，不把排序首条的账号填进页面', async () => {
      // 下发 2 条但声明命中 5 条 → 渲染尾部读数按钮，它可聚焦且与「已高亮首条」同时存在
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })], 5);
      // 高亮停在第 0 条，而用户指向的是尾部按钮：填充必须跟随按钮，不是跟随高亮
      expect(activeRowIndex()).toBe(0);
      expect(panelButton('.aph-more-btn')).not.toBeNull();

      const event = keydown('Enter');
      panelButton('.aph-more-btn')!.dispatchEvent(event);
      await flush();

      expect(filledId()).toBeUndefined();
      expect(event.defaultPrevented).toBe(false);
    });

    it('同一条 Enter 若目标仍是检索框，照常填充高亮条目（放行只针对可聚焦动作节点）', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);

      press('Enter');
      await flush();

      expect(filledId()).toBeDefined();
    });

    it('↑↓ 不受这条放行影响：焦点在按钮上时高亮照常移动', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);
      const before = activeRowIndex();

      const event = keydown('ArrowDown');
      panelButton('.aph-manage')!.dispatchEvent(event);

      expect(activeRowIndex()).not.toBe(before);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('宿主页面伪造的按键不能驱动填充', () => {
    it('页面在 body 上派发的 Enter 不触发填充，面板保持打开', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);

      // 面板打开即默认高亮首条，旧口径下单个合成 Enter 就足以把首条凭据敲进页面输入框
      pressFromPage('Enter');
      await flush();

      expect(filledId()).toBeUndefined();
      expect(panelVisible()).toBe(true);
    });

    it('页面把事件派发到 shadow 宿主上也不触发填充（宿主可被选择器命中）', async () => {
      await openWith([account({ id: 'a1' })]);

      pressFromPage('Enter', true);
      await flush();

      expect(filledId()).toBeUndefined();
      expect(panelVisible()).toBe(true);
    });

    it('页面伪造的 ↑↓ 不移动高亮，也不 preventDefault', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);
      const before = activeRowIndex();

      const down = pressFromPage('ArrowDown');
      const up = pressFromPage('ArrowUp', true);

      expect(down.defaultPrevented).toBe(false);
      expect(up.defaultPrevented).toBe(false);
      expect(activeRowIndex()).toBe(before);
    });

    it('页面伪造的 Esc 只关闭面板，不产生填充（关闭是失效安全方向，保留兜底能力）', async () => {
      await openWith([account({ id: 'a1' })]);

      pressFromPage('Escape');
      await flush();

      expect(panelVisible()).toBe(false);
      expect(filledId()).toBeUndefined();
    });

    it('同一串真实按键照常工作（闸门不收窄导航范围）', async () => {
      await openWith([account({ id: 'a1' }), account({ id: 'a2', username: 'bob' })]);

      press('ArrowDown');
      const expectedId = ['a1', 'a2'][activeRowIndex()];
      press('Enter');
      await flush();

      expect(filledId()).toBe(expectedId);
    });
  });
});
