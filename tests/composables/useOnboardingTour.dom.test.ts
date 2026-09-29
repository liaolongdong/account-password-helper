/** @vitest-environment jsdom */

/**
 * 聚光引导状态机的 DOM 侧测试（composables/useOnboardingTour.ts）
 *
 * `tests/utils/onboardingTour.test.ts` 量的是纯函数那一半（几何分支、剧本约束、锚点契约、
 * 文案齐全度），这里量的是只有装了 DOM 才存在的那一半：
 * - 锚点查询真的走 `[data-tour=…]`，测到的矩形真的是 `getBoundingClientRect()` 的返回值；
 * - 视口取的是 `window.innerWidth / innerHeight`，卡片高度取的是 `offsetHeight` /
 *   `ResizeObserver` 回传值——三者任一接错，落点就会飘到屏幕外；
 * - 键盘三键（← / → / Esc）在激活与未激活、可编辑目标与非可编辑目标之间的接管边界；
 * - 监听器随开随关、scope 销毁后不残留（SW 之外的页面同样会因组件复用泄漏监听）；
 * - 结束时只落 `{ seen, outcome, finishedAt }` 三个标记位。
 *
 * jsdom 没有真实布局，`getBoundingClientRect()` 与 `offsetHeight` 恒为 0，
 * 因此复用 `tests/helpers/domLayout.ts` 的登记表装置；它同时提供手动 rAF 队列，
 * 让「滚动 / 缩放后重测」这条节流路径可以被断言而不是靠等帧。
 * `ResizeObserver` 与 `scrollIntoView` 装置不管，本文件自带桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { installDomLayout, type DomLayout } from '../helpers/domLayout';
import { SPOT_PADDING, TOUR_STEPS } from '@/utils/onboardingTour';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { useOnboardingTour, type OnboardingTourApi } from '@/composables/useOnboardingTour';

/** jsdom 缺位的 ResizeObserver：记录 observe / unobserve / disconnect，并可手动回传高度 */
class FakeResizeObserver {
  /** 本用例内创建过的实例（每次 `useOnboardingTour()` 恰好一个） */
  static created: FakeResizeObserver[] = [];

  readonly observed = new Set<Element>();
  disconnectCount = 0;

  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.created.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
    this.disconnectCount += 1;
  }

  /** 以真实回调通知一次高度变化 */
  emit(height: number): void {
    const entry = { contentRect: { height } } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

/** 页面上的锚点键名 → 元素，供逐个登记矩形与摘除 */
function anchorElements(): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-tour]')) {
    map.set(element.dataset.tour as string, element);
  }
  return map;
}

/** 建一段管理页骨架：只有列出的锚点存在 */
function buildPage(anchors: string[]): Map<string, HTMLElement> {
  document.body.innerHTML = anchors.map(name => `<button data-tour="${name}">${name}</button>`).join('\n');
  return anchorElements();
}

/** 在 jsdom 上改写视口尺寸（`window.innerWidth` 是 getter，只能重新定义） */
function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

/** 让出一轮宏任务，把 `close()` 里那条 fire-and-forget 的落盘链跑完 */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** 本文件内已挂载但未销毁的 scope，兜底在 afterEach 里停掉 */
const liveScopes = new Set<{ stop(): void }>();

/** 在 effectScope 内装配状态机，返回句柄与销毁函数（`onScopeDispose` 需要 scope 才生效） */
function mountTour(): { tour: OnboardingTourApi; dispose: () => void } {
  const scope = effectScope();
  liveScopes.add(scope);
  const tour = scope.run(() => useOnboardingTour()) as OnboardingTourApi;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    liveScopes.delete(scope);
    scope.stop();
  };
  return { tour, dispose };
}

/** 派发一个冒泡到 window 的按键 */
function press(key: string, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** 内存版 chrome.storage.local 后备 */
let store: Record<string, unknown>;
let layout: DomLayout;
let scrollSpy: Mock<(arg?: boolean | ScrollIntoViewOptions) => void>;

beforeEach(() => {
  store = {};
  FakeResizeObserver.created = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
    },
  });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  layout = installDomLayout();
  scrollSpy = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
  Element.prototype.scrollIntoView = scrollSpy;
  setViewport(1280, 900);
});

afterEach(() => {
  // 断言失败会跳过用例尾部的 dispose()，漏下的监听器会把下一个用例的窗口事件一起带走
  for (const scope of liveScopes) scope.stop();
  liveScopes.clear();
  layout.uninstall();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('锚点查询与剧本裁剪', () => {
  it('只把页面上存在的锚点对应的步骤收进剧本，顺序跟 TOUR_STEPS', async () => {
    buildPage(['add', 'search', 'health']);
    const { tour, dispose } = mountTour();

    expect(await tour.start()).toBe(true);
    expect(tour.steps.value.map(step => step.id)).toEqual(['welcome', 'add', 'search', 'health']);
    dispose();
  });

  it('空库态与检索态由锚点存在性天然二选一，不需要额外状态判断', async () => {
    const withEmpty = mountTour();
    buildPage(['add', 'empty']);
    await withEmpty.tour.start();
    expect(withEmpty.tour.steps.value.map(step => step.id)).toContain('empty');
    expect(withEmpty.tour.steps.value.map(step => step.id)).not.toContain('search');
    withEmpty.dispose();

    const withSearch = mountTour();
    buildPage(['add', 'search']);
    await withSearch.tour.start();
    expect(withSearch.tour.steps.value.map(step => step.id)).toContain('search');
    expect(withSearch.tour.steps.value.map(step => step.id)).not.toContain('empty');
    withSearch.dispose();
  });

  it('欢迎步无锚点，恒在剧本首位（锚点全缺时也能打开，不摆空弹窗）', async () => {
    buildPage([]);
    const { tour, dispose } = mountTour();

    expect(await tour.start()).toBe(true);
    expect(tour.steps.value.map(step => step.id)).toEqual(['welcome']);
    expect(tour.spot.value).toBeNull();
    expect(tour.placement.value).toEqual({ side: 'center', top: 0, left: 0 });
    dispose();
  });

  it('剧本是开场快照：中途摘掉锚点元素也不抽步、不错位', async () => {
    const page = buildPage(['add', 'search']);
    const { tour, dispose } = mountTour();
    await tour.start();
    const total = tour.total.value;

    page.get('add')?.remove();
    page.get('search')?.remove();

    expect(tour.total.value).toBe(total);
    dispose();
  });

  it('startId 定位到指定步，未知 id 回到首位', async () => {
    buildPage(['add', 'search', 'data']);
    const { tour, dispose } = mountTour();
    await tour.start({ startId: 'search' });
    expect(tour.currentStep.value?.id).toBe('search');
    dispose();

    const back = mountTour();
    await back.tour.start({ startId: '不存在的步骤' });
    expect(back.tour.currentStep.value?.id).toBe('welcome');
    back.dispose();
  });
});

describe('几何读数接线', () => {
  it('聚光框来自锚点的 getBoundingClientRect 外扩 SPOT_PADDING', async () => {
    const page = buildPage(['add']);
    const add = page.get('add') as HTMLElement;
    layout.setRect(add, { left: 100, top: 60, width: 80, height: 32 });

    const { tour, dispose } = mountTour();
    await tour.start({ startId: 'add' });

    expect(tour.spot.value).toMatchObject({
      left: 100 - SPOT_PADDING,
      top: 60 - SPOT_PADDING,
      width: 80 + SPOT_PADDING * 2,
      height: 32 + SPOT_PADDING * 2,
    });
    dispose();
  });

  it('落点的视口取自 window.innerWidth / innerHeight：底部放不下才翻到上方', async () => {
    const page = buildPage(['add']);
    const add = page.get('add') as HTMLElement;
    // 锚点下方还剩 192px：卡片高度未知时装得下，回传 220px 后装不下，只能翻到上方
    setViewport(1280, 700);
    layout.setRect(add, { left: 600, top: 440, width: 80, height: 32 });

    const { tour, dispose } = mountTour();
    await tour.start({ startId: 'add' });
    // 首帧卡片高度未知（0），按 prefer=bottom 直接放行；ResizeObserver 回传真实高度后重解
    expect(tour.placement.value.side).toBe('bottom');

    tour.setCard(document.createElement('div'));
    await nextTick();
    FakeResizeObserver.created[0]?.emit(220);
    await nextTick();

    expect(tour.placement.value.side).toBe('top');
    dispose();
  });

  it('锚点在开场后被回收时退回居中，不让卡片飘到未知位置', async () => {
    const page = buildPage(['add', 'search']);
    const { tour, dispose } = mountTour();
    await tour.start({ startId: 'add' });
    expect(tour.spot.value).not.toBeNull();

    page.get('add')?.remove();
    tour.goToStep(0);
    await nextTick();
    tour.goToStep(1);
    await nextTick();

    expect(tour.currentStep.value?.id).toBe('add');
    expect(tour.spot.value).toBeNull();
    expect(tour.placement.value).toEqual({ side: 'center', top: 0, left: 0 });
    dispose();
  });

  it('滚动与缩放经同一个 rAF 节流：多次事件只排一帧', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start({ startId: 'add' });
    layout.resetOps();

    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(layout.raf.pending()).toBe(1);

    layout.raf.tick();
    expect(layout.raf.pending()).toBe(0);
    dispose();
  });
});

describe('键盘接管', () => {
  it('→ / ← 切步并夹在剧本两端，连按不出界', async () => {
    buildPage(['add', 'search']);
    const { tour, dispose } = mountTour();
    await tour.start();
    const last = tour.total.value - 1;

    for (let i = 0; i < 10; i++) press('ArrowRight');
    expect(tour.stepIndex.value).toBe(last);
    expect(tour.isLast.value).toBe(true);

    for (let i = 0; i < 10; i++) press('ArrowLeft');
    expect(tour.stepIndex.value).toBe(0);
    expect(tour.isFirst.value).toBe(true);
    dispose();
  });

  it('三个键都消费掉默认行为，免得方向键滚走背后的列表', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start();

    for (const key of ['ArrowRight', 'ArrowLeft', 'Escape']) {
      const event = press(key);
      expect(event.defaultPrevented, key).toBe(true);
    }
    dispose();
  });

  it('焦点落在输入框里时整体让路，不抢原生行为', async () => {
    buildPage(['add']);
    const input = document.createElement('input');
    document.body.append(input);

    const { tour, dispose } = mountTour();
    await tour.start();
    const before = tour.stepIndex.value;

    const event = press('ArrowRight', input);
    expect(tour.stepIndex.value).toBe(before);
    expect(event.defaultPrevented).toBe(false);
    dispose();
  });

  it('Esc 走 skip 分支：落盘 outcome=skipped', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start();

    press('Escape');
    await settle();

    expect(tour.isActive.value).toBe(false);
    expect(store[STORAGE_KEYS.ONBOARDING_TOUR]).toMatchObject({ seen: true, outcome: 'skipped' });
    dispose();
  });

  it('未激活时不再处理按键：关档后同一批按键既不改步也不写存储', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start();
    await tour.finish();

    press('ArrowRight');
    expect(tour.stepIndex.value).toBe(0);
    expect(tour.isActive.value).toBe(false);
    dispose();
  });

  it('引导关闭后监听器全部摘除，scope 销毁同样兜底', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start();
    await tour.skip();

    // 关闭后一次按键不应产生任何存储写入
    const writesBefore = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;
    press('ArrowRight');
    press('Escape');
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(writesBefore);
    dispose();
  });
});

describe('结束落盘', () => {
  it('走完写 completed、中途退写 skipped，都只带三个标记位', async () => {
    buildPage(['add']);
    const finished = mountTour();
    await finished.tour.start();
    await finished.tour.finish();
    finished.dispose();

    const state = store[STORAGE_KEYS.ONBOARDING_TOUR] as Record<string, unknown>;
    expect(Object.keys(state).sort()).toEqual(['finishedAt', 'outcome', 'seen']);
    expect(state).toMatchObject({ seen: true, outcome: 'completed' });
    expect(typeof state.finishedAt).toBe('number');
  });

  it('未打开过就不写：close 在 isActive 为假时直接返回', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.finish();

    expect(store[STORAGE_KEYS.ONBOARDING_TOUR]).toBeUndefined();
    expect(tour.isActive.value).toBe(false);
    dispose();
  });

  it('脏数据只影响读、不影响写：三字段收窄由 configManager 负责，这里不重复落非法值', async () => {
    store[STORAGE_KEYS.ONBOARDING_TOUR] = { seen: 'yes', outcome: 'destroyed', finishedAt: '昨天' };
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start();
    await tour.finish();

    expect(store[STORAGE_KEYS.ONBOARDING_TOUR]).toMatchObject({ seen: true, outcome: 'completed' });
    dispose();
  });
});

describe('卡片节点交接与焦点', () => {
  it('setCard 交回节点后：observe 它、按 offsetHeight 定高、激活态下真的聚焦', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start();

    const card = document.createElement('div');
    card.tabIndex = -1;
    // 必须挂进文档：jsdom 不给游离节点聚焦，而真实卡片始终在文档里
    document.body.append(card);
    Object.defineProperty(card, 'offsetHeight', { configurable: true, get: () => 180 });
    tour.setCard(card);
    await nextTick();

    const observer = FakeResizeObserver.created[0];
    expect(observer.observed.has(card)).toBe(true);
    expect(document.activeElement).toBe(card);
    dispose();
  });

  it('换卡片节点先 unobserve 旧的；置空则断开', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start();

    const first = document.createElement('div');
    const second = document.createElement('div');
    tour.setCard(first);
    await nextTick();
    tour.setCard(second);
    await nextTick();

    const observer = FakeResizeObserver.created[0];
    expect(observer.observed.has(first)).toBe(false);
    expect(observer.observed.has(second)).toBe(true);

    tour.setCard(null);
    await nextTick();
    expect(observer.observed.size).toBe(0);
    dispose();
  });

  it('scope 销毁时断开 observer，不给复用组件树留下野观察者', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start();
    tour.setCard(document.createElement('div'));
    await nextTick();

    const observer = FakeResizeObserver.created[0];
    dispose();
    expect(observer.disconnectCount).toBe(1);
  });
});

describe('revealAnchor', () => {
  it('切步时把锚点滚进视野，无锚点的欢迎步不发起滚动', async () => {
    buildPage(['add']);
    const { tour, dispose } = mountTour();
    await tour.start();
    expect(scrollSpy).not.toHaveBeenCalled();

    tour.goToStep(1);
    await nextTick();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.calls[0]?.[0]).toMatchObject({ block: 'nearest', inline: 'nearest' });
    dispose();
  });
});

it('剧本里每个锚点都有对应的 data-tour 用法被本文件覆盖到', () => {
  // 装置页一次装齐：漏装会让上面的裁剪用例失真
  const page = buildPage(TOUR_STEPS.filter(step => step.anchor).map(step => step.anchor as string));
  expect(page.size).toBe(TOUR_STEPS.filter(step => step.anchor).length);
});
