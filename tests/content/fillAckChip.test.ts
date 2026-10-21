/** @vitest-environment jsdom */
/**
 * 填充回执胶囊（M-4）的行为基线
 *
 * 侧边栏填充成功后 300ms 自动关闭、快捷键与右键菜单则完全没有页面内提示，
 * 这枚胶囊是「值到底落进框了没有」的唯一就地答案，因此它必须满足：
 * 1. 隔离：closed 影子树 + `all: initial` 宿主，外部只凭 `data-aph` 找到宿主节点，整帧只挂一次；
 * 2. 文案：只渲染固定回执，四档（已填充 / 请核对 / 来自站点规则 / 来自规则且该框像验证码框）
 *    走同一套 i18n-lite key，除此之外不写任何内容——填充值与选择器都绝不能出现在 DOM 里；
 * 3. 落位：默认贴在字段下缘，下缘越界翻到字段上方，字段整体在视口外时夹进视口内而不是消失；
 * 4. 生命周期：定时自动收起、期间的再次展示换文案并重置计时、字段被 SPA 换掉后滚动一帧即收起、
 *    destroy 移除宿主并解绑监听；
 * 5. 减弱档：入场那 3px 位移归零，淡入淡出保留。
 *
 * jsdom 不排版，几何读数与 rAF 全部由 `tests/helpers/domLayout.ts` 装置接管，
 * 因此下面的期望值都是可手算的确定数，而不是「调用过就行」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FillAckChip, fillAckChipStyles } from '@/entrypoints/content/FillAckChip';
import { DEFAULT_THEME } from '@/utils/theme';
import { tl } from '@/utils/i18n-lite';
import { installDomLayout, type DomLayout } from '../helpers/domLayout';

/** 宿主定位凭据（closed 影子树外部找节点的唯一入口） */
const HOST_SELECTOR = '[data-aph="fill-ack-chip"]';

/** 自动收起时长，与被测模块的 ACK_VISIBLE_MS 同值 */
const ACK_VISIBLE_MS = 1600;

/** 胶囊在 jsdom 里取不到实际尺寸时使用的兜底宽高，与被测模块一致 */
const FALLBACK_WIDTH = 150;
const FALLBACK_HEIGHT = 24;

/** 胶囊与字段下缘的间距、与视口边缘的留白 */
const GAP = 6;
const INSET = 8;

/** closed 影子树不挂在 `host.shadowRoot` 上，只能从 attachShadow 的返回值截获 */
const originalAttachShadow = Element.prototype.attachShadow;
let shadow: ShadowRoot | null = null;

describe('填充回执胶囊', () => {
  let layout: DomLayout;
  let chip: FillAckChip;
  let field: HTMLInputElement;

  /** 视口尺寸（jsdom 默认 1024×768，期望值全部由它推导，环境变更时不会误判） */
  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;

  /** 取胶囊节点（影子树内唯一带 .aph-ack 的元素） */
  const chipEl = (): HTMLElement => shadow!.querySelector<HTMLElement>('.aph-ack')!;

  beforeEach(() => {
    document.body.innerHTML = '';
    shadow = null;
    layout = installDomLayout();
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
      shadow = originalAttachShadow.call(this, init);
      return shadow;
    });

    field = document.createElement('input');
    document.body.appendChild(field);
    layout.setRect(field, { left: 100, top: 200, width: 300, height: 34 });

    chip = new FillAckChip();
  });

  afterEach(() => {
    chip.destroy();
    vi.restoreAllMocks();
    layout.uninstall();
    document.body.innerHTML = '';
  });

  it('宿主只挂一次，且是 closed 影子树', () => {
    chip.show(field, 'filled', DEFAULT_THEME);
    chip.show(field, 'check', DEFAULT_THEME);

    const hosts = document.body.querySelectorAll(HOST_SELECTOR);
    expect(hosts).toHaveLength(1);
    // closed：宿主上不暴露 shadowRoot，外部拿不到内部节点
    expect(hosts[0].shadowRoot).toBeNull();
    expect(chipEl()).not.toBeNull();
  });

  it('四档回执各取自己的文案，且胶囊里除了这句什么都不渲染', () => {
    chip.show(field, 'filled', DEFAULT_THEME);
    expect(chipEl().textContent).toBe(tl('cs.ack.filled'));
    expect(chipEl().getAttribute('role')).toBe('status');

    chip.show(field, 'check', DEFAULT_THEME);
    expect(chipEl().textContent).toBe(tl('cs.ack.check'));

    // 这两档是「这次写入来自你配的站点规则」的唯一页面内出口，文案接错就等于把来源说丢
    chip.show(field, 'rule', DEFAULT_THEME);
    expect(chipEl().textContent).toBe(tl('cs.ack.rule'));

    chip.show(field, 'ruleCodeLike', DEFAULT_THEME);
    expect(chipEl().textContent).toBe(tl('cs.ack.ruleCodeLike'));
    expect(chipEl().children).toHaveLength(1);
  });

  it('默认贴在字段下缘，字段下缘越界时翻到字段上方', () => {
    // 字段 bottom = 200 + 34 = 234，胶囊高取兜底值
    chip.show(field, 'filled', DEFAULT_THEME);
    expect(chipEl().style.top).toBe(`${234 + GAP}px`);
    expect(chipEl().style.left).toBe('100px');

    layout.setRect(field, { left: 40, top: vh() - 20, width: 200, height: 16 });
    chip.show(field, 'filled', DEFAULT_THEME);
    expect(chipEl().style.top).toBe(`${vh() - 20 - GAP - FALLBACK_HEIGHT}px`);
  });

  it('字段滚出视口时把胶囊夹进视口内，回执不会跟着字段一起看不见', () => {
    layout.setRect(field, { left: vw() - 10, top: 5000, width: 200, height: 30 });
    chip.show(field, 'filled', DEFAULT_THEME);

    expect(chipEl().style.top).toBe(`${vh() - FALLBACK_HEIGHT - INSET}px`);
    expect(chipEl().style.left).toBe(`${vw() - FALLBACK_WIDTH - INSET}px`);
  });

  it('定时自动收起；期间的再次展示换文案并重置计时', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      chip.show(field, 'filled', DEFAULT_THEME);
      expect(chipEl().classList.contains('visible')).toBe(true);

      vi.advanceTimersByTime(ACK_VISIBLE_MS - 600);
      chip.show(field, 'check', DEFAULT_THEME);
      vi.advanceTimersByTime(ACK_VISIBLE_MS - 600);
      // 距第一次已超时，但第二次只过了 1 秒：必须还在
      expect(chipEl().classList.contains('visible')).toBe(true);

      vi.advanceTimersByTime(600);
      expect(chipEl().classList.contains('visible')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('字段被 SPA 换掉后，滚动一帧即收起', () => {
    chip.show(field, 'filled', DEFAULT_THEME);
    field.remove();

    window.dispatchEvent(new Event('scroll'));
    expect(layout.raf.pending()).toBe(1);
    layout.raf.tick();
    expect(chipEl().classList.contains('visible')).toBe(false);
  });

  it('destroy 移除宿主并解绑滚动监听', () => {
    chip.show(field, 'filled', DEFAULT_THEME);
    chip.destroy();

    expect(document.body.querySelectorAll(HOST_SELECTOR)).toHaveLength(0);
    window.dispatchEvent(new Event('scroll'));
    expect(layout.raf.pending()).toBe(0);
  });

  it('样式首条是 :host{all:initial}，减弱档撤掉位移但保留淡入', () => {
    expect(fillAckChipStyles).toContain(':host {\n  all: initial;\n}');
    expect(fillAckChipStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.aph-ack \{\s*transition:[^;]*opacity[^;]*;\s*transform: none;/,
    );
  });
});
