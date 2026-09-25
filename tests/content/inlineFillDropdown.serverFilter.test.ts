/** @vitest-environment jsdom */

/**
 * 内联下拉「后台代跑拼音检索」的回归测试（方案 B）
 *
 * 内容脚本世界不能 `import('pinyin-match')`（扩展未声明 web_accessible_resources，
 * 页面上下文加载扩展 chunk 必然失败），因此内联的检索能力拆成两层：
 * 本地子串过滤立即生效（不受消息往返影响），同一关键词的拼音结果由 SW 通过
 * `GET_MATCHING_ACCOUNTS { keyword }` 异步下发并替换列表——拼音结果是子串结果的超集。
 *
 * 这里钉住的是这条异步路径最容易出问题的几处：
 * - 防抖：一次输入过程只发一次请求，避免每个字符一趟 runtime 往返；
 * - 丢弃：在途回包遇到「关键词已变 / 面板已关 / 序号被更新」时只放弃结果，
 *   绝不把 `panelOpen` 置回 false（否则旧回包会与新请求互相判死，表现为面板永久打不开）；
 * - 兜底：请求失败即停在本地子串结果，不出现空面板；
 * - 不抢渲染：同序同 id 的回包跳过重渲染，不打断用户此刻的 ↑↓ 导航；
 * - 关闭收尾：面板收起只摘 `.visible`，因此关闭时必须清掉渲染出的账号文本与关键词。
 *
 * 面板宿主是 closed Shadow DOM，经 `attachShadow` 桩取回 root 查询；
 * jsdom 无布局，`getBoundingClientRect` 桩成视口内非零 rect，否则面板自关。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineFillDropdown } from '@/entrypoints/content/inlineDropdown/InlineFillDropdown';
import { MAX_SEARCH_KEYWORD_LENGTH } from '@/utils/keywordMatch';
import { MessageType, type MatchingAccountMeta } from '@/utils/types';

/** 面板下发的展示元数据（与 background 下发结构一致） */
const account = (overrides: Partial<MatchingAccountMeta> = {}): MatchingAccountMeta => ({
  id: 'a1',
  username: 'alice',
  tag: '',
  remark: '',
  url: 'example.com',
  favorite: false,
  hasTotp: false,
  favicon: '',
  tier: 0,
  ...overrides,
});

/** 全量条目：中文用户名与备注只能被拼音命中，英文用户名可被子串命中 */
const ALL: MatchingAccountMeta[] = [
  account({ id: 'zhang', username: '张三', tag: '工作' }),
  account({ id: 'li', username: '李四', remark: '生产环境只读' }),
  account({ id: 'alice', username: 'alice' }),
];

/** 只读取断言所需的消息字段（sendMessage 的 message 参数在 @types/chrome 里是宽松类型） */
interface SentMessage {
  type?: string;
  data?: { keyword?: string };
}

/** 可控的 Promise（模拟在途请求） */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** 载入时的原生实现（jsdom 下为 undefined，afterEach 原样还原） */
const originalScrollIntoView = Element.prototype.scrollIntoView;
const noopScrollIntoView = (): void => {};

describe('InlineFillDropdown 的后台代跑检索', () => {
  let dropdown: InlineFillDropdown;
  let input: HTMLInputElement;
  let root: ShadowRoot | null;
  let attachShadowSpy: ReturnType<typeof vi.spyOn>;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  /** 微任务冲刷：让 sendMessage 的 await 续段跑完（假定时器下不能用 setTimeout 冲刷） */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  /** 打开面板，并让「无关键词」的载入请求返回全量 */
  const openWith = async (accounts: MatchingAccountMeta[]): Promise<void> => {
    sendSpy.mockImplementation((message: unknown) => {
      const sent = message as SentMessage;
      if (sent.type === MessageType.GET_MATCHING_ACCOUNTS && sent.data?.keyword === undefined) {
        return Promise.resolve({ success: true, data: { locked: false, accounts } } as never);
      }
      return Promise.resolve(undefined as never);
    });
    expect(await dropdown.openPanelFor(input)).toBe(true);
  };

  /** 已渲染行的 data-index 列表（空态时无行） */
  const rowIndexes = (): string[] =>
    [...root!.querySelectorAll<HTMLElement>('.aph-row')].map(row => row.dataset.index!);

  /** 当前高亮行索引（无高亮返回 -1） */
  const activeRowIndex = (): number =>
    [...root!.querySelectorAll<HTMLElement>('.aph-row')].findIndex(row => row.classList.contains('active'));

  /** 当前渲染出的账号文本（按行序，`data-index` 是过滤后位置而非全库位置） */
  const rowAccounts = (): string[] =>
    [...root!.querySelectorAll<HTMLElement>('.aph-row-account-text')].map(el => el.textContent ?? '');

  /** 在搜索框输入关键词（只触发本地过滤与防抖排期，不等回包） */
  const type = (keyword: string): void => {
    const search = root?.querySelector<HTMLInputElement>('.aph-search input');
    if (!search) throw new Error('面板未渲染搜索框');
    search.value = keyword;
    search.dispatchEvent(new Event('input'));
  };

  /** 已发出的带关键词检索请求 */
  const searchRequests = (): SentMessage[] =>
    sendSpy.mock.calls
      .map((call: unknown[]) => call[0] as SentMessage)
      .filter(
        (message: SentMessage) =>
          message.type === MessageType.GET_MATCHING_ACCOUNTS && message.data?.keyword !== undefined,
      );

  /** 让检索请求由可控的 deferred 应答 */
  const routeSearchTo = (next: (keyword: string) => Promise<unknown>): void => {
    sendSpy.mockImplementation((message: unknown) => {
      const sent = message as SentMessage;
      if (sent.type !== MessageType.GET_MATCHING_ACCOUNTS) return Promise.resolve(undefined as never);
      if (sent.data?.keyword === undefined) {
        return Promise.resolve({ success: true, data: { locked: false, accounts: ALL } } as never);
      }
      return next(sent.data.keyword) as never;
    });
  };

  /** 推进到防抖窗口之后，等回包续段执行完 */
  const runSearch = async (ms = 120): Promise<void> => {
    vi.advanceTimersByTime(ms);
    await flush();
  };

  /** 构造 keydown 事件 */
  const keydown = (key: string): KeyboardEvent =>
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });

  /** 面板内检索框 */
  const searchBox = (): HTMLInputElement => root!.querySelector<HTMLInputElement>('.aph-search input')!;

  /**
   * 从面板内按下一个键
   *
   * 导航与填充的监听绑在 shadow root 上，真实按键的目标只能是面板里的聚焦元素（检索框），
   * 因此按键类断言必须从检索框派发；Esc 另有 document 兜底，故意保留 document 派发以覆盖那条路径。
   */
  const press = (key: string): void => {
    searchBox().dispatchEvent(keydown(key));
  };

  beforeEach(async () => {
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

    // jsdom 未实现 scrollIntoView（`Element.prototype` 上根本没有这个方法，
    // 故不能用 vi.spyOn），而 updateActive 会滚动到高亮行
    Element.prototype.scrollIntoView = noopScrollIntoView;

    sendSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(undefined as never);

    input = document.createElement('input');
    document.body.appendChild(input);
    dropdown = new InlineFillDropdown();

    // 载入走真实计时器（面板首开路径上有图标/布局跟随的定时任务），
    // 防抖计时器在打开之后再交给假时钟，避免把无关计时器一起冻住。
    await openWith(ALL);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    dropdown.destroy();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    attachShadowSpy.mockRestore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('防抖与本地优先', () => {
    it('本地子串结果即时生效，不等消息往返', () => {
      type('ali');

      expect(rowAccounts()).toEqual(['alice']); // 中文条目落在本地子串口径之外
      expect(searchRequests()).toHaveLength(0); // 防抖窗口内不发请求
    });

    it('连续输入只在静默窗口结束后发一次请求，且带最后一次关键词', async () => {
      routeSearchTo(() => Promise.resolve({ success: true, data: { locked: false, accounts: [] } }));

      type('z');
      await runSearch(60);
      type('zh');
      await runSearch(60);
      type('zha');
      await runSearch(120);

      expect(searchRequests().map(m => m.data?.keyword)).toEqual(['zha']);
    });

    it('回包是超集：拼音命中替换本地子串结果', async () => {
      routeSearchTo(() => Promise.resolve({ success: true, data: { locked: false, accounts: [ALL[0]] } }));

      type('zs');
      expect(rowAccounts()).toEqual([]); // 子串档命中不了「张三」

      await runSearch();
      expect(rowAccounts()).toEqual(['张三']);
    });

    it('同一关键词重复输入不重复请求（权威结果已就位即短路）', async () => {
      routeSearchTo(() => Promise.resolve({ success: true, data: { locked: false, accounts: [ALL[0]] } }));

      type('zs');
      await runSearch();
      expect(searchRequests()).toHaveLength(1);

      type('zs'); // 输入框值被外部改回同一串：已有权威结果，不再打一趟 runtime
      await runSearch(200);

      expect(searchRequests()).toHaveLength(1);
      expect(rowIndexes()).toEqual(['0']);

      type(''); // 清空作废权威结果
      type('zs');
      await runSearch(200);
      expect(searchRequests()).toHaveLength(2);
    });
  });

  describe('在途回包的丢弃与关闭收尾', () => {
    it('关键词已清空：旧回包作废，列表回到全量且不作废面板', async () => {
      const pending = deferred<{ success: boolean; data: { locked: boolean; accounts: MatchingAccountMeta[] } }>();
      routeSearchTo(() => pending.promise);

      type('zs');
      await runSearch();
      expect(searchRequests()).toHaveLength(1);

      type('');
      expect(rowIndexes()).toEqual(['0', '1', '2']); // 清空即时恢复全量

      pending.resolve({ success: true, data: { locked: false, accounts: [ALL[0]!] } });
      await flush();
      expect(rowIndexes()).toEqual(['0', '1', '2']); // 迟到的拼音结果不得覆盖无关键词视图
    });

    it('面板已关闭：回包只丢弃，下一次打开看到的是新会话的全量列表', async () => {
      const pending = deferred<unknown>();
      routeSearchTo(() => pending.promise);

      type('zs');
      await runSearch();

      document.dispatchEvent(keydown('Escape'));
      pending.resolve({ success: true, data: { locked: false, accounts: [ALL[0]!] } });
      await flush();
      expect(root!.querySelector('.aph-panel.visible')).toBeNull();

      vi.useRealTimers();
      await openWith(ALL);
      expect(root!.querySelector('.aph-panel.visible')).not.toBeNull();
      expect(rowIndexes()).toEqual(['0', '1', '2']); // 上一站的检索结果没有串进来
      vi.useFakeTimers();
    });

    it('更新的请求已在途：旧序号的回包被丢弃', async () => {
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      let call = 0;
      routeSearchTo(() => (++call === 1 ? first.promise : second.promise));

      type('zs');
      await runSearch();
      type('zsan');
      await runSearch();
      expect(searchRequests()).toHaveLength(2);

      first.resolve({ success: true, data: { locked: false, accounts: [ALL[0]!] } });
      await flush();
      expect(rowIndexes()).toEqual([]); // 旧关键词的结果没有生效

      second.resolve({ success: true, data: { locked: false, accounts: [ALL[0]!, ALL[1]!] } });
      await flush();
      expect(rowIndexes()).toEqual(['0', '1']);
    });

    it('关闭面板即清空渲染：账号文本、空态与关键词都不留在页面 DOM 里', async () => {
      type('ali');
      await runSearch();
      expect(rowAccounts()).toEqual(['alice']);
      expect(root!.querySelector<HTMLInputElement>('.aph-search input')!.value).toBe('ali');

      document.dispatchEvent(keydown('Escape'));

      // closePanel 只摘 .visible，节点仍挂在宿主页面；不清的话收起状态下的 DOM 里
      // 还兜着用户名、标签、备注全文与刚输入的关键词
      expect(rowAccounts()).toEqual([]);
      expect(root!.querySelector('.aph-empty')).toBeNull();
      expect(root!.querySelector<HTMLInputElement>('.aph-search input')!.value).toBe('');
    });
  });

  describe('失败兜底与渲染稳定性', () => {
    it('请求失败：停在本地子串结果，面板不被判定为关闭', async () => {
      routeSearchTo(() => Promise.reject(new Error('message port closed')));

      type('ali');
      await runSearch();

      expect(rowAccounts()).toEqual(['alice']);
      expect(root!.querySelector('.aph-panel.visible')).not.toBeNull();
    });

    it('同序同 id 的回包跳过重渲染，不打断当前键盘导航', async () => {
      routeSearchTo(() =>
        Promise.resolve({
          success: true,
          data: { locked: false, accounts: [account({ id: 'alice', remark: '后台补的备注' })] },
        }),
      );

      type('ali');
      const rowBefore = root!.querySelector('.aph-row');
      press('ArrowDown');
      expect(activeRowIndex()).toBe(0);

      await runSearch();

      expect(activeRowIndex()).toBe(0); // 跳过重渲染 → 行节点与高亮都原地不动
      expect(root!.querySelector('.aph-row')).toBe(rowBefore); // 节点同一性才是"没重渲染"的证据
    });

    it('响应缺字段或标记失败时同样只丢弃，不改列表', async () => {
      routeSearchTo(() => Promise.resolve({ success: false }));
      type('zs');
      await runSearch();
      expect(rowIndexes()).toEqual([]);

      routeSearchTo(() => Promise.resolve({ success: true }));
      type('zs2');
      await runSearch();
      expect(searchRequests()).toHaveLength(2);
      expect(root!.querySelector('.aph-panel.visible')).not.toBeNull();
    });
  });

  describe('检索途中会话状态变化', () => {
    it('回包告知已锁定：切到解锁卡片，不被读成「本关键词无匹配」', async () => {
      // 后台在「启动重锁 / 未设主密码 / 会话失效 / 缓存丢失」四路都回 locked + 空数组；
      // 空数组与「过滤后没命中」同形，只看 success/accounts 就会把锁误渲成空态。
      routeSearchTo(() => Promise.resolve({ success: true, data: { locked: true, accounts: [] } }));

      type('zs');
      await runSearch();

      expect(root!.querySelector('.aph-locked')).not.toBeNull();
      expect(root!.querySelector('.aph-empty')).toBeNull();
      expect(root!.querySelector('.aph-panel.visible')).not.toBeNull();
    });

    it('回包告知未设置主密码：切到设置引导卡片，与锁定卡片分路', async () => {
      routeSearchTo(() =>
        Promise.resolve({ success: true, data: { locked: true, noMasterPassword: true, accounts: [] } }),
      );

      type('zs');
      await runSearch();

      expect(root!.querySelector('.aph-no-master')).not.toBeNull();
      expect(root!.querySelector('.aph-locked')).toBeNull();
      expect(root!.querySelector('.aph-empty')).toBeNull();
    });

    it('切卡片就地清渲染：账号文本与关键词都不留在收起前的面板里', async () => {
      routeSearchTo(() => Promise.resolve({ success: true, data: { locked: true, accounts: [] } }));

      type('zs');
      await runSearch();

      // 锁定卡片替换整段 innerHTML，检索框随之消失——用户刚敲的关键词不该以
      // `display:none` 的形态继续兜在宿主 DOM 里（与 closePanel 的清理口径同一件事）
      expect(rowAccounts()).toEqual([]);
      expect(root!.querySelector('.aph-search input')).toBeNull();
    });
  });

  describe('超长关键词的两侧口径', () => {
    it('送进后台的关键词已按边界截断，与本地过滤用的是同一个串', async () => {
      // 本地按全串过滤、后台按 `normalizeSearchKeyword` 截到 64 字符过滤，
      // 两侧口径分叉时回包会比输入框里的文本更宽，渲染出与输入不匹配的行。
      const long = 'a'.repeat(MAX_SEARCH_KEYWORD_LENGTH) + 'b';

      routeSearchTo(() => Promise.resolve({ success: true, data: { locked: false, accounts: [] } }));
      type(long);
      await runSearch();

      expect(searchRequests()[0]?.data?.keyword).toBe('a'.repeat(MAX_SEARCH_KEYWORD_LENGTH));
    });
  });

  describe('超集回包不抢键盘导航', () => {
    it('拼音超集替换后，高亮跟着同一条账号走而不是弹回首行', async () => {
      // 本地子串只命中 alice；回包补进拼音命中的张三，alice 从第 1 行挪到第 3 行。
      // 此刻用户的高亮应留在 alice 上，而不是被 applyFilter 复位到第 1 行（张三）。
      routeSearchTo(() => Promise.resolve({ success: true, data: { locked: false, accounts: [ALL[0]!, ALL[2]!] } }));

      type('ali');
      expect(rowAccounts()).toEqual(['alice']);
      const activeTextBefore = rowAccounts()[activeRowIndex()];

      await runSearch();

      expect(rowAccounts()).toEqual(['张三', 'alice']);
      expect(activeTextBefore).toBe('alice');
      expect(rowAccounts()[activeRowIndex()]).toBe('alice');
    });

    it('输入新关键词仍然归零（与侧边栏 handleSearch 同一口径）', async () => {
      routeSearchTo(() => Promise.resolve({ success: true, data: { locked: false, accounts: ALL } }));

      type('e'); // url 里含 e：本地命中多条
      expect(rowAccounts().length).toBeGreaterThan(1);
      press('ArrowDown');
      const moved = activeRowIndex();
      expect(moved).toBeGreaterThan(0);

      type('alice'); // 改关键词：高亮归零，不跟着旧行号走
      expect(activeRowIndex()).toBe(0);
    });

    it('被超集顶到可视区之外的高亮行，重新滚到可见', async () => {
      // 高亮跟到第 3 行还不够：列表是可滚动的，用户看不见的行 = 回车会填进行号未知的条目
      routeSearchTo(() =>
        Promise.resolve({ success: true, data: { locked: false, accounts: [ALL[0]!, ALL[1]!, ALL[2]!] } }),
      );

      const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
      type('ali');
      scrollSpy.mockClear(); // 只观察回包这一次替换的滚动行为

      await runSearch();

      expect(activeRowIndex()).toBe(2);
      expect(scrollSpy).toHaveBeenCalled();
    });
  });

  /**
   * 本站匹配集被 `INLINE_MAX_RESULT_ROWS` 截断时的尾部读数
   *
   * 上界砍在后台，用户看到的是「列表到此为止」，因此「下面没有更多了、但库里还有」必须由
   * 响应里的 `totalMatched` 说出来。三个容易走偏的点：读数只能跟随**权威结果**
   * （本地乐观子集是截断集的子集，两个上界叠着算会虚报）；跳失时机与空态深链一致
   * （带关键词进管理页检索、不带关键词进列表）；面板收起时这一行必须一并清掉。
   */
  describe('匹配集被上界截断时的尾部读数', () => {
    /** 尾部按钮（未渲染时 null） */
    const moreBtn = (): HTMLElement | null => root!.querySelector<HTMLElement>('.aph-more-btn');

    /** 按类型取已发出的消息 */
    const sentOf = (type: MessageType): SentMessage[] =>
      sendSpy.mock.calls
        .map((call: unknown[]) => call[0] as SentMessage)
        .filter((message: SentMessage) => message.type === type);

    /**
     * 让载入与检索两条路径都声明「后台命中 totalMatched 条」
     *
     * @param loadTotal 无关键词载入时的命中总数（本地下发 `ALL`，即 3 条）
     * @param searchTotal 带关键词检索时的命中总数（本地下发子串命中的 alice 1 条）
     */
    const routeWithTotals = (loadTotal: number, searchTotal: number): void => {
      sendSpy.mockImplementation((message: unknown) => {
        const sent = message as SentMessage;
        if (sent.type !== MessageType.GET_MATCHING_ACCOUNTS) return Promise.resolve(undefined as never);
        const data =
          sent.data?.keyword === undefined
            ? { accounts: ALL, totalMatched: loadTotal }
            : { accounts: [ALL[2]!], totalMatched: searchTotal };
        return Promise.resolve({ success: true, data: { locked: false, ...data } } as never);
      });
    };

    /** 收起再重开面板，让载入响应走到 `routeWithTotals` 这一支 */
    const reopen = async (): Promise<void> => {
      document.dispatchEvent(keydown('Escape'));
      vi.useRealTimers();
      expect(await dropdown.openPanelFor(input)).toBe(true);
      vi.useFakeTimers();
    };

    it('触顶：尾部给出「还有 N 条」，N 是总数减去真正渲染的行数', async () => {
      routeWithTotals(103, 0);
      await reopen();

      expect(moreBtn()).not.toBeNull();
      expect(moreBtn()!.textContent).toContain('100'); // 103 - 3 条
      // 占位符必须被替换掉：i18n 词条漏填 params 时按钮会念出字面量 {count}
      expect(moreBtn()!.textContent).not.toContain('{count}');
    });

    it('未触顶：不显示读数（总数等于下发条数即没有隐藏项）', async () => {
      routeWithTotals(ALL.length, 0);
      await reopen();

      expect(rowAccounts()).toEqual(['张三', '李四', 'alice']);
      expect(moreBtn()).toBeNull();
    });

    it('读数只跟随权威结果：本地子集阶段与回包后各算各的', async () => {
      routeWithTotals(103, 102);
      await reopen();
      expect(moreBtn()!.textContent).toContain('100');

      type('ali'); // 本地子串先出结果，此刻还没有权威总数
      expect(rowAccounts()).toEqual(['alice']);
      expect(moreBtn()).toBeNull();

      await runSearch(); // SW 回包：命中 102 条、只下发 1 条
      expect(moreBtn()!.textContent).toContain('101');
    });

    it('点击去向与空态深链同一套：不带关键词进管理页列表', async () => {
      routeWithTotals(103, 102);
      await reopen();

      moreBtn()!.click();

      // hide() 即关面板：这一支只验去向消息，不复用同一次打开继续检索
      expect(sentOf(MessageType.OPEN_OPTIONS_PAGE)).toHaveLength(1);
      expect(sentOf(MessageType.OPEN_OPTIONS_AND_SEARCH)).toHaveLength(0);
    });

    it('带关键词时去向是把关键词带进管理页做全库检索', async () => {
      routeWithTotals(103, 102);
      await reopen();

      type('ali');
      await runSearch();
      moreBtn()!.click();

      expect(sentOf(MessageType.OPEN_OPTIONS_PAGE)).toHaveLength(0);
      expect(sentOf(MessageType.OPEN_OPTIONS_AND_SEARCH)[0]?.data).toEqual({ keyword: 'ali' });
    });

    it('关闭面板连带清掉尾部读数', async () => {
      routeWithTotals(103, 0);
      await reopen();
      expect(moreBtn()).not.toBeNull();

      document.dispatchEvent(keydown('Escape'));
      // closePanel 只摘 .visible，节点常驻宿主页面：这一行的全文（含命中总数）同样不该留着
      expect(moreBtn()).toBeNull();
      expect(root!.querySelector('.aph-more-slot')!.innerHTML).toBe('');
    });
  });
});
