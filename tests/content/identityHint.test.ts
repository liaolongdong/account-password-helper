/** @vitest-environment jsdom */
/**
 * 身份库召唤提示（页面侧气泡）的回归测试
 *
 * 这个界面是「识别 + 提示 + 深链」形态里唯一会出现在页面里的一环，因此它同时背着
 * 三条必须可证的承诺，本文件按这三条组织用例：
 *
 * 1. **跨入口只走一个标签**。气泡文本永远不允许出现字段当前值、页面 URL 或任何库内数据；
 *    消息载荷里只可能有一个「本人姓名」搜索词（取值规则见 `piiClassifier.selfNameValueNear`
 *    的用例），取不到时整包 `data` 缺席。角色只服务气泡文案，不再跨入口。用 canary 值取证，
 *    比读代码可靠。
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
import { MAX_SEARCH_KEYWORD_LENGTH } from '@/utils/keywordMatch';
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

/** 布一个待聚焦的字段并登记其几何（值只用于取证：出现它的位置必须是可列举的那一处） */
const makeField = (name: string, value = CANARY): HTMLInputElement => {
  const input = document.createElement('input');
  input.name = name;
  input.value = value;
  document.body.appendChild(input);
  return input;
};

/** 取出气泡根节点 */
const bubbleRoot = (): HTMLElement | null => shadow?.getElementById('aph-idh-root') ?? null;

const keydown = (key: string, options: { composing?: boolean; alt?: boolean } = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    altKey: !!options.alt,
  });
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
      // 播报只罩文字行：整枚气泡挂 role=status 会把两个动作按钮包进活动区域，
      // 焦点每动一次就重播一遍「收起 / 从身份库选择」
      expect(bubble?.getAttribute('role')).toBeNull();
      expect(bubble?.querySelector('.aph-idh__body')?.getAttribute('role')).toBe('status');
      expect(bubble?.querySelector('.aph-idh__actions')?.closest('.aph-idh__body')).toBeNull();
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

  describe('跨入口只有一个标签', () => {
    it('气泡文本永不含字段当前值；没有本人姓名框可取时，整包载荷缺席', async () => {
      // beforeEach 那枚 `realName` 框会 legitimate 地成为搜索词，本条要测的是「无姓名框」，
      // 所以现场只留一个证件号框——搜索词取不到，载荷必须整包缺席（角色不再跨入口）。
      document.body.innerHTML = '';
      const idEl = makeField('idNumber');
      layout.setRect(idEl, { left: 100, top: 200, width: 240, height: 32 });

      showIdentityHint(idEl, 'idNumber', true);
      const html = bubbleRoot()?.innerHTML ?? '';
      expect(html).not.toContain(CANARY);

      (bubbleRoot()?.querySelector('.aph-idh__btn--primary') as HTMLElement).click();
      const sendMessage = (globalThis as any).chrome.runtime.sendMessage as Mock;
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage.mock.calls[0][0]).toEqual({
        type: MessageType.OPEN_OPTIONS_AND_IDENTITY,
        data: undefined,
      });
      expect(JSON.stringify(sendMessage.mock.calls[0][0])).not.toContain(CANARY);
      await Promise.resolve();
    });

    it('聚焦框自己就是本人姓名框：它的值走搜索词这一条通道，但气泡文本里没有它', () => {
      // beforeEach 的 `field` 是 `realName` + CANARY 值。这条钉住新边界的形状：明文只从
      // 「已判定为本人姓名」的框出发，且只进消息载荷，不进任何页面可见的文本。
      show('name');
      expect(bubbleRoot()?.querySelector('.aph-idh')?.textContent).not.toContain(CANARY);
      (bubbleRoot()?.querySelector('.aph-idh__btn--primary') as HTMLElement).click();
      const sendMessage = (globalThis as any).chrome.runtime.sendMessage as Mock;
      expect(sendMessage.mock.calls[0][0]).toEqual({
        type: MessageType.OPEN_OPTIONS_AND_IDENTITY,
        data: { keyword: CANARY },
      });
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

  describe('搜索词通道（点击时惰性取本人姓名）', () => {
    /**
     * 布一个「姓名 + 证件号」同表单字段组
     *
     * 证件号框固定带 CANARY：这条通道开的是「姓名框的值」，那么**别的框**的值就必须一处都不出现在
     * 载荷里，CANARY 在这里就是那枚反证。姓名框的值由用例给定（含空串这一档）。
     */
    const pair = (nameValue: string): { nameEl: HTMLInputElement; idEl: HTMLInputElement } => {
      const form = document.createElement('form');
      document.body.appendChild(form);
      const mk = (label: string, name: string, value: string): HTMLInputElement => {
        const input = document.createElement('input');
        input.name = name;
        input.value = value;
        const wrap = document.createElement('label');
        wrap.textContent = label;
        wrap.appendChild(input);
        form.appendChild(wrap);
        layout.setRect(input, { left: 100, top: 100, width: 240, height: 32 });
        return input;
      };
      return { nameEl: mk('真实姓名', 'realname', nameValue), idEl: mk('证件号码', 'idNumber', CANARY) };
    };

    const sendMessage = (): Mock => (globalThis as any).chrome.runtime.sendMessage as Mock;

    /** 点「从身份库选择」并回读那条消息 */
    const clickPick = (): unknown => {
      (bubbleRoot()?.querySelector('.aph-idh__btn--primary') as HTMLElement).click();
      return sendMessage().mock.calls[0][0];
    };

    it('同表单里已填好的本人姓名，就是那条唯一出页面的搜索词', () => {
      const { idEl } = pair('张三');
      showIdentityHint(idEl, 'idNumber', true);
      expect(clickPick()).toEqual({
        type: MessageType.OPEN_OPTIONS_AND_IDENTITY,
        data: { keyword: '张三' },
      });
    });

    it('姓名框还空着就不带 keyword 键：整包载荷缺席，而不是写出空串', () => {
      const { idEl } = pair('');
      showIdentityHint(idEl, 'idNumber', true);
      expect(clickPick()).toEqual({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: undefined });
    });

    it('证件号框自己的值哪儿也没去：CANARY 不在载荷里', () => {
      const { idEl } = pair('张三');
      showIdentityHint(idEl, 'idNumber', true);
      const json = JSON.stringify(clickPick());
      expect(json, '字段值出现在了跨入口载荷里').not.toContain(CANARY);
      expect(json).toContain('张三');
    });

    it('取值发生在点击那一刻，不在气泡展示时（明文不多活一段时间）', () => {
      const { nameEl, idEl } = pair('');
      showIdentityHint(idEl, 'idNumber', true);
      // 气泡已经在屏幕上，用户回头把姓名补上——搜索词必须是补完之后的那一串
      nameEl.value = '张三';
      expect(clickPick()).toMatchObject({ data: { keyword: '张三' } });
    });
  });

  /**
   * 编号族的落点：身份库的自定义字段
   *
   * 这一档的角色词只说「编号」，不冒充证件号，因此用户看到的下一句必须是「存哪儿」——
   * 库里没有那一格，落点是自定义字段。搜索词因此换成**这一格叫什么**（标签文本），
   * 让用户存的字段名直接成为检索命中面；姓名通道（上一条 describe）在这几档保持原样。
   */
  describe('编号族：按字段名落到自定义字段', () => {
    const sendMessage = (): Mock => (globalThis as any).chrome.runtime.sendMessage as Mock;

    /** 点「从身份库选择」并回读那条消息 */
    const clickPick = (): unknown => {
      (bubbleRoot()?.querySelector('.aph-idh__btn--primary') as HTMLElement).click();
      return sendMessage().mock.calls[0][0];
    };

    /** 布一枚带中文标签的编号框（值给 CANARY：它是这一轮的反证——字段值不许出页面） */
    const serialField = (label: string): HTMLInputElement => {
      document.body.innerHTML = `<label>${label}<input id="s" name="certNo" type="text"></label>`;
      const input = document.getElementById('s') as HTMLInputElement;
      input.value = CANARY;
      layout.setRect(input, { left: 100, top: 200, width: 240, height: 32 });
      return input;
    };

    it('气泡多一行「存到自定义字段」的指引，其它角色不显示这一行', () => {
      show('serialNumber', true);
      expect(bubbleRoot()?.querySelector('.aph-idh__custom')?.textContent).toContain('自定义字段');
      expect(bubbleRoot()?.querySelector('.aph-idh__role')?.textContent).toBe('编号');

      hideIdentityHint();
      show('idNumber', true);
      expect(bubbleRoot()?.querySelector('.aph-idh__custom')).toBeNull();
    });

    it('英文语言下那一行同样存在，且角色词是英文的', () => {
      show('serialNumber', true);
      expect(bubbleRoot()?.querySelector('.aph-idh__custom')?.textContent).toBeTruthy();
      emitLocaleChange('en');
      expect(bubbleRoot()?.querySelector('.aph-idh__role')?.textContent).toBe('serial number');
      expect(bubbleRoot()?.querySelector('.aph-idh__custom')?.textContent).toContain('custom field');
    });

    it('搜索词是这一格的字段名，不是它自己的值', () => {
      const el = serialField('学历证书编号');
      showIdentityHint(el, 'serialNumber', true);
      const msg = clickPick();
      expect(msg).toEqual({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { keyword: '学历证书编号' } });
      expect(JSON.stringify(msg), '字段值出现在了跨入口载荷里').not.toContain(CANARY);
    });

    it('标签两侧多余空白被收掉，整串限长与后台同一口径', () => {
      const el = serialField(`  编号${'长'.repeat(200)}  `);
      showIdentityHint(el, 'serialNumber', true);
      const keyword = (clickPick() as { data: { keyword: string } }).data.keyword;
      // trim 掉两侧空格、再按 `utils/keywordMatch` 那把同一尺子裁到 64：首两字是「编号」
      expect(keyword).toBe(`编号${'长'.repeat(MAX_SEARCH_KEYWORD_LENGTH - 2)}`);
    });

    it('这一格没有可取的标签时整包载荷缺席，而不是写出空串', () => {
      // `makeField` 那枚裸 input 没有标签、没有占位符、也没有兄弟文字，只带 name 属性——
      // 属性串不是「这一格叫什么」，不许当检索词用。
      const bare = makeField('realName');
      layout.setRect(bare, { left: 100, top: 200, width: 240, height: 32 });
      showIdentityHint(bare, 'serialNumber', true);
      expect(clickPick()).toEqual({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: undefined });
    });

    it('组件库形状（标签块与控件块互为兄弟）取的是同项那段兄弟标签', () => {
      // Element Plus 一项两控件时不发 `for`，标签退化成 `<div class="el-form-item__label">`——
      // 这一形状下「这一格叫什么」只写在兄弟块里，分类器那条弱线索通道正是为此而存在。
      document.body.innerHTML =
        '<div class="el-form-item"><div class="el-form-item__label">学历证书编号</div>' +
        '<div class="el-form-item__content"><input id="s" name="certNo" type="text"></div></div>';
      const el = document.getElementById('s') as HTMLInputElement;
      el.value = CANARY;
      layout.setRect(el, { left: 100, top: 200, width: 240, height: 32 });

      showIdentityHint(el, 'serialNumber', true);
      expect(clickPick()).toEqual({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { keyword: '学历证书编号' } });
    });

    it('标签尾部的冒号与必填星号不进检索词：多一个字符就永远匹配不上用户存的那个名字', () => {
      // 身份库的匹配是「关键词是字段文本的子串」，`学历证书编号：` 比用户存的字段名长一个字符，
      // 落点会直接空手——所以装饰符必须在发出去之前裁掉，且只裁两端。
      const el = serialField('学历证书编号：*');
      showIdentityHint(el, 'serialNumber', true);
      expect(clickPick()).toEqual({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { keyword: '学历证书编号' } });
    });

    it('姓名族仍走原来那条本人姓名通道：这次改动没把标签文本扩到别的角色上', () => {
      document.body.innerHTML = '<label>证件号码<input id="s" name="certNo" type="text"></label>';
      const idEl = document.getElementById('s') as HTMLInputElement;
      idEl.value = CANARY;
      layout.setRect(idEl, { left: 100, top: 200, width: 240, height: 32 });
      // 同一张表单里另有本人姓名框——这一档的搜索词来自它，不来自「证件号码」这段标签
      makeField('realName', '张三');

      showIdentityHint(idEl, 'idNumber', true);
      expect(clickPick()).toEqual({ type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { keyword: '张三' } });
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

    /**
     * 键盘可达（WCAG 2.1.1）
     *
     * 宿主挂在 `documentElement` 末尾且 `position: fixed`，普通 Tab 会先触发绑定字段的
     * focusout 而把气泡收掉——提示读得到却永远按不到。`Alt+↓` 是这条唯一显式入口，
     * 且必须只在带 Alt 时生效：裸 `ArrowDown` 是页面自有下拉/候选列表的键，抢不得。
     */
    it('Alt+↓ 把焦点送进「从身份库选择」按钮并吃掉默认动作', () => {
      show('name');
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      const pick = bubbleRoot()?.querySelector('.aph-idh__btn--primary');
      focus.mockImplementationOnce(() => {});

      const event = keydown('ArrowDown', { alt: true });
      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus.mock.contexts[0]).toBe(pick);
    });

    it('裸 ArrowDown 不动焦点（不抢页面自有的下拉与候选列表语义）', () => {
      show('name');
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');

      document.dispatchEvent(keydown('ArrowDown'));

      expect(focus).not.toHaveBeenCalled();
      expect(bubbleRoot()?.querySelector('.aph-idh')).not.toBeNull();
    });

    it('焦点只是移进气泡自己的按钮时不收（否则键盘永远进不了动作行）', () => {
      show('name');
      const pick = bubbleRoot()?.querySelector('.aph-idh__btn--primary') as HTMLElement;
      // closed 影子树的 activeElement 由宿主脚本侧读取，jsdom 不自动维护，按真实语义桩上
      Object.defineProperty(shadow, 'activeElement', { configurable: true, get: () => pick });

      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

      expect(bubbleRoot()?.querySelector('.aph-idh')).not.toBeNull();
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

    /**
     * 重定位被 rAF 节流到下一帧：`position()` 先读几何（getBoundingClientRect/offset）
     * 再写 `style.top/left`，每个 scroll 事件同步跑一遍就是逐帧「读→写」强制回流
     *（口径同 FillAckChip 的 handleReposition）。
     * 本环境的 jsdom 不自己驱动动画帧，故用假定时器把「那一帧」显式按出来。
     */
    it('滚动与缩放后重新定位，缩放监听不随每次展示累积', () => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
      try {
        show('name');
        const before = field.getBoundingClientRect().top;
        layout.setRect(field, { left: 20, top: 400, width: 240, height: 32 });

        window.dispatchEvent(new Event('scroll'));
        const styled = bubbleRoot()?.querySelector('.aph-idh') as HTMLElement;
        // 帧未落地前先保持原位：这一格同时是「没有同步重排」的证据
        expect(styled.style.top).toBe(`${200 + 32 + 6}px`);

        vi.advanceTimersByTime(16);
        expect(styled.style.top).toBe(`${400 + 32 + 6}px`);
        expect(before).toBe(200);

        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(16);
        expect(bubbleRoot()?.querySelector('.aph-idh')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
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
