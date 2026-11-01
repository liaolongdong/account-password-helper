/** @vitest-environment jsdom */
/**
 * FormDetector MutationObserver 回调的成本不变量
 *
 * 背景：观察器以 `childList + subtree + attributes(class,style,placeholder)` 挂在 `document.body`
 * 上（本文件不测这个范围，只测回调里的单次成本），而可取消的 debounce 只包住了 `detectForms`。
 * 于是**回调本体是每条变更记录同步执行的**：属性分支对 `mutation.target` 取 `textContent`
 * （容器class 抖动时等于把整棵子树拼成一个字符串），按钮分支先 `innerText`（强制布局）
 * 再对同一选择器重复 `querySelector`。SPA 每帧抖 class、信息流每批插入带按钮的行，
 * 都会把这些成本叠在页面主线程上——与 AGENTS.md「Content script 的 DOM 扫描和批量更新应限流、
 * 分批或复用缓存」直接冲突。
 *
 * 断言口径（都是可被缺陷证伪的不变量，不是实现细节）：
 * 1. 回调阶段零文本物化——判定所需的文本读取必须下沉到去抖之后的那一次任务里。
 * 2. 一次突发内的文本读取次数与候选集合规模都有上界——超出上限只丢候选，
 *    不因此放宽 `detectForms` 的触发条件（动画密集页不该反复全页扫描）。
 * 3. 同一元素的同一选择器不重复查询。
 * 4. 检测语义不变：登录字样出现仍触发重检测；无关抖动仍不触发；字段出现必触发。
 * 5. 生命周期收尾：destroy 必须清空候选集合（Set 不像 WeakSet 会自动放行），
 *    且迟到的去抖到期不得再重扫。
 *
 * 观察器回调通过「捕获式 MutationObserver」在构造期截获，再手工投递合成记录：
 * jsdom 的真实 MutationRecord 无法按批构造规模，而本用例要测的正是回调函数本体对
 * 「一批记录」的处理成本，手工投递反而得到确定性读数。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDetector } from '@/entrypoints/content/FormDetector';

/** 生产代码按钮分支使用的选择器集合（与 FormDetector 内 loginButtonSelectors 同口径） */
const BUTTON_SELECTORS = ['button', 'input[type="submit"]', 'input[type="button"]', '[role="button"]'];

/** 文本物化次数：`textContent` / `innerText` 读取各计一次 */
let textReads = 0;
/** 回调阶段落在按钮选择器上的 querySelector 调用（记录 `元素标识::选择器`） */
let buttonQueries: string[] = [];
/** 被捕获的观察器实例，`attributes: true` 的那个即 FormDetector 的观察器 */
let observers: CapturedObserver[] = [];

/** 捕获式观察器：只登记，不做真实观察，回调由测试手工投递 */
class CapturedObserver {
  readonly callback: MutationCallback;
  /** observe 实参，用于按配置识别归属 */
  options: MutationObserverInit | null = null;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    observers.push(this);
  }

  observe(_target: Node, options?: MutationObserverInit): void {
    this.options = options ?? null;
  }

  disconnect(): void {}

  takeRecords(): MutationRecord[] {
    return [];
  }
}

/** 取 FormDetector 的观察器回调（按 `attributes: true` 认领，其它模块只看 childList） */
function formDetectorCallback(): MutationCallback {
  const entry = observers.find(observer => observer.options?.attributes === true);
  if (!entry) throw new Error('测试前置失败：未捕获到带 attributes 的观察器');
  return entry.callback;
}

/** 合成一条属性变更记录（生产代码只读 type / target / addedNodes） */
const attrRecord = (target: Element): MutationRecord =>
  ({
    type: 'attributes',
    attributeName: 'class',
    target,
    addedNodes: [],
    removedNodes: [],
  }) as unknown as MutationRecord;

/** 合成一条节点插入记录 */
const addedRecord = (node: Node): MutationRecord =>
  ({ type: 'childList', target: document.body, addedNodes: [node], removedNodes: [] }) as unknown as MutationRecord;

/** 布出一个含深层文本的容器，模拟「SPA 每帧给外层容器换 class」的页面形状 */
function mountNoisyContainer(children: number): HTMLElement {
  const wrap = document.createElement('div');
  for (let i = 0; i < children; i++) {
    const span = document.createElement('span');
    span.textContent = `正文段落 ${i}，长度足以让一次子树文本拼接变得可观，与身份校验无关`;
    wrap.appendChild(span);
  }
  document.body.appendChild(wrap);
  return wrap;
}

/** 劫持文本物化与按钮选择器查询的计数器 */
function installCostProbes(): () => void {
  const textContentDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  const innerTextDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
  const nativeQuerySelector = Element.prototype.querySelector;
  const originalObserver = globalThis.MutationObserver;

  if (textContentDescriptor?.get) {
    const nativeGet = textContentDescriptor.get;
    Object.defineProperty(Node.prototype, 'textContent', {
      ...textContentDescriptor,
      get(this: Node) {
        textReads += 1;
        return nativeGet.call(this);
      },
    });
  }

  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      textReads += 1;
      return innerTextDescriptor?.get ? innerTextDescriptor.get.call(this) : this.textContent;
    },
    set: innerTextDescriptor?.set,
  });

  Element.prototype.querySelector = function (this: Element, selector: string) {
    if (BUTTON_SELECTORS.includes(selector)) {
      buttonQueries.push(`${(this as HTMLElement).dataset.probeId ?? 'anonymous'}::${selector}`);
    }
    return nativeQuerySelector.call(this, selector);
  };

  globalThis.MutationObserver = CapturedObserver as unknown as typeof MutationObserver;

  return () => {
    if (textContentDescriptor) Object.defineProperty(Node.prototype, 'textContent', textContentDescriptor);
    if (innerTextDescriptor) Object.defineProperty(HTMLElement.prototype, 'innerText', innerTextDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, 'innerText');
    Element.prototype.querySelector = nativeQuerySelector;
    globalThis.MutationObserver = originalObserver;
  };
}

describe('FormDetector 观察器回调的页面主线程成本', () => {
  let detector: FormDetector;
  let restoreProbes: () => void;
  let detectForms: ReturnType<typeof vi.spyOn>;

  /**
   * 复位计数窗口
   *
   * 构造期的 `siteRuleReady.then(() => detectForms())` 是微任务，会在 hook 与用例体之间
   * 冲刷一次，直接计入用例的调用数。每个用例从自己的窗口起点开始计数。
   */
  const resetCaseCounters = (): void => {
    detectForms.mockClear();
    textReads = 0;
    buttonQueries = [];
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    textReads = 0;
    buttonQueries = [];
    observers = [];
    restoreProbes = installCostProbes();
    detector = new FormDetector();
    // 先放掉构造期排在 500ms 的首轮检测，避免它混进本用例的计数窗口
    vi.advanceTimersByTime(1500);
    detectForms = vi
      .spyOn(detector as unknown as { detectForms: () => void }, 'detectForms')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    (detector as unknown as { destroy: () => void }).destroy();
    restoreProbes();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('属性抖动 burst 的回调阶段不物化任何元素文本', () => {
    resetCaseCounters();
    const wrap = mountNoisyContainer(50);
    const before = textReads;

    formDetectorCallback()(
      Array.from({ length: 50 }, () => attrRecord(wrap)),
      {} as MutationObserver,
    );

    expect(textReads - before).toBe(0);
  });

  it('一次突发的文本读取与候选集合都有上界，且溢出不放宽重检测触发', () => {
    resetCaseCounters();
    const containers = Array.from({ length: 200 }, (_unused, index) => {
      const wrap = mountNoisyContainer(1);
      wrap.dataset.probeId = `c${index}`;
      return wrap;
    });
    const before = textReads;

    formDetectorCallback()(
      containers.map(el => attrRecord(el)),
      {} as MutationObserver,
    );

    // 去抖尚未到期（模拟持续抖动一路重置计时器）时，候选集合不得按记录数无界持有 DOM 引用：
    // 内容脚本与页面同寿命，集合只在到期任务里清空
    const buckets = detector as unknown as {
      pendingMutationAttributeTargets: Set<Element>;
      pendingMutationButtons: Set<Element>;
    };
    expect(buckets.pendingMutationAttributeTargets.size).toBeLessThanOrEqual(32);
    expect(buckets.pendingMutationButtons.size).toBeLessThanOrEqual(32);

    vi.advanceTimersByTime(500);

    // 判定次数有上界；且候选够多本身不构成重检测理由——这些元素里没有任何登录字样，
    // 动画密集页不该因此把全页扫描变成常态
    expect(textReads - before).toBeLessThanOrEqual(32);
    expect(detectForms).not.toHaveBeenCalled();
  });

  it('同一元素的同一按钮选择器不重复查询', () => {
    resetCaseCounters();
    const row = document.createElement('div');
    row.dataset.probeId = 'row';
    const button = document.createElement('button');
    button.textContent = '立即登录';
    row.appendChild(button);

    formDetectorCallback()([addedRecord(row)], {} as MutationObserver);

    const duplicates = buttonQueries.filter(
      (entry, index) => buttonQueries.indexOf(entry) !== index && entry.startsWith('row::'),
    );
    expect(duplicates).toEqual([]);
  });

  it('标签文案变为「密码登录」时去抖后仍触发一次重检测', () => {
    resetCaseCounters();
    const tab = document.createElement('span');
    tab.textContent = '密码登录';
    document.body.appendChild(tab);

    formDetectorCallback()([attrRecord(tab)], {} as MutationObserver);
    expect(detectForms).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(detectForms).toHaveBeenCalledTimes(1);
  });

  it('无关文案的 class 抖动去抖后不触发重检测', () => {
    resetCaseCounters();
    const wrap = mountNoisyContainer(5);

    formDetectorCallback()([attrRecord(wrap)], {} as MutationObserver);
    vi.advanceTimersByTime(500);

    expect(detectForms).not.toHaveBeenCalled();
  });

  it('新增含「立即登录」按钮的子树时去抖后触发重检测', () => {
    resetCaseCounters();
    const row = document.createElement('div');
    const button = document.createElement('button');
    button.textContent = '立即登录';
    row.appendChild(button);

    formDetectorCallback()([addedRecord(row)], {} as MutationObserver);
    vi.advanceTimersByTime(500);

    expect(detectForms).toHaveBeenCalledTimes(1);
  });

  it('字段出现即必重扫，不依赖文本候选也不受候选上限影响', () => {
    resetCaseCounters();
    // 与既有「无关文案不触发」那条相对：这条钉住反方向——出现表单字段却没有关键词时
    // 仍必须重扫，否则「恒定触发」与「永不触发」的错实现都能骗过关键词用例
    const row = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'text';
    row.appendChild(input);

    formDetectorCallback()([addedRecord(row)], {} as MutationObserver);
    vi.advanceTimersByTime(500);

    expect(detectForms).toHaveBeenCalledTimes(1);
  });

  it('destroy 清空突发候选集合，晚到的去抖到期不再重扫', () => {
    resetCaseCounters();
    const wrap = mountNoisyContainer(3);
    formDetectorCallback()([attrRecord(wrap)], {} as MutationObserver);

    const buckets = detector as unknown as {
      pendingMutationAttributeTargets: Set<Element>;
      pendingMutationButtons: Set<Element>;
    };
    expect(buckets.pendingMutationAttributeTargets.size).toBe(1);

    (detector as unknown as { destroy: () => void }).destroy();
    expect(buckets.pendingMutationAttributeTargets.size).toBe(0);
    expect(buckets.pendingMutationButtons.size).toBe(0);

    // destroy 已清计时器；即便有迟到的到期回调，`disposed` 门也必须挡住重扫
    vi.advanceTimersByTime(5000);
    expect(detectForms).not.toHaveBeenCalled();
  });
});
