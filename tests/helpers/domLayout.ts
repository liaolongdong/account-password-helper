/**
 * content script 叠加 UI 的 DOM 生命周期测试装置
 *
 * jsdom 不提供真实布局，三处读数与浏览器行为不一致，直接跑被测代码会全体走进降级分支：
 * - `getBoundingClientRect()` 恒为全 0 → `measureAnchor` 永远返回 null，锚点解析无从验证；
 * - `offsetWidth` / `offsetHeight` 恒为 0 → `isElementVisible` 恒 false，按钮根本注入不了；
 * - `getComputedStyle()` 对未显式声明的属性返回空串，`position` 尤其如此（真实浏览器返回
 *   `'static'`）→ 「是否需要改写宿主 position」的判定被静默反转。
 *
 * 本装置用一张登记表接管这三处读数，并额外提供两样生命周期测试必需的控制：
 * - 手动推进的 rAF 队列（可断言「有没有排帧」，而不是等待真实帧）；
 * - 跨读取/写入的全局有序日志（可断言两阶段循环确实是「先全读后全写」）。
 *
 * 补丁中途失败会回滚已装的补丁，避免污染同一 worker 内的其他测试文件。所有补丁都
 * 保存原 descriptor 并在 `uninstall()` 还原，不使用 `vi.unstubAllGlobals`
 * （会连带清掉框架注入的 `window` / `chrome` 全局）。
 */

/** 矩形登记项：以左/上/宽/高描述，其余边界自动推导 */
export interface RectSpec {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 受装置接管的几何读数形状（DOMRect 的只读子集） */
export interface LaidOutRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

/** 装置句柄 */
export interface DomLayout {
  /** 有序操作日志：`r<seq>` = getBoundingClientRect，`w<seq>` = 写 style.left */
  readonly ops: string[];
  /** 登记元素的矩形；offsetWidth/offsetHeight 随之联动 */
  setRect(el: Element, spec: RectSpec): void;
  /** 登记元素的计算样式（与浏览器基线浅合并） */
  setStyles(el: Element, styles: Record<string, string>): void;
  /** 读取当前登记的矩形，用于回带校验断言 */
  rectOf(el: Element): LaidOutRect;
  /** 手动 rAF 队列 */
  raf: {
    /** 当前排队但未执行的回调数 */
    pending(): number;
    /** 执行 n 轮帧（每轮把当轮已排队的回调全部跑掉，模拟真实逐帧语义） */
    tick(n?: number): void;
  };
  /** 清空操作日志 */
  resetOps(): void;
  /** 还原所有全局补丁 */
  uninstall(): void;
}

/** 未显式登记时的计算样式基线（对齐真实浏览器对未声明属性的取值） */
const DEFAULT_COMPUTED: Record<string, string> = {
  position: 'static',
  display: 'block',
  visibility: 'visible',
  opacity: '1',
};

const ZERO_RECT: LaidOutRect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };

/** 被测代码实际用到的 window 侧 API 子集 */
interface PatchedWindow {
  getComputedStyle: (el: Element) => Record<string, string>;
  requestAnimationFrame: (cb: (t: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
}

/**
 * 安装 DOM 布局装置
 *
 * @returns 句柄；测试结束必须在 afterEach 中调用 `uninstall()`
 */
export function installDomLayout(): DomLayout {
  const win = window as unknown as PatchedWindow;

  const rects = new Map<Element, LaidOutRect>();
  const styles = new Map<Element, Record<string, string>>();
  const ops: string[] = [];
  let seq = 0;

  // 一次性抓齐所有原 descriptor：任何一项不可补丁都在装任何东西之前失败
  const gbcDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');
  const offsetWidthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const offsetHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const styleDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
  if (!gbcDesc || typeof gbcDesc.value !== 'function') {
    throw new Error('测试装置失效：Element.prototype.getBoundingClientRect 不可补丁');
  }
  if (!offsetWidthDesc?.get || !offsetHeightDesc?.get) {
    throw new Error('测试装置失效：HTMLElement 的 offsetWidth/offsetHeight 不是可读属性');
  }
  if (!styleDesc?.get) {
    throw new Error('测试装置失效：HTMLElement.prototype.style 不是访问器，无法记录样式写入');
  }

  const realGetComputedStyle = win.getComputedStyle;
  const realRaf = win.requestAnimationFrame;
  const realCancel = win.cancelAnimationFrame;

  let rafId = 1;
  let queue = new Map<number, (t: number) => void>();
  const styleProxies = new WeakMap<object, object>();

  // 把校验后的非空 descriptor 固定到一个类型明确的对象上：闭包内不保留外部变量的窄化，
  // 直接引用原变量会在 restoreAll 里退回 `PropertyDescriptor | undefined`
  const originals = {
    getBoundingClientRect: gbcDesc,
    offsetWidth: offsetWidthDesc,
    offsetHeight: offsetHeightDesc,
    style: styleDesc,
  };

  const restoreAll = (): void => {
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', originals.getBoundingClientRect);
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originals.offsetWidth);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originals.offsetHeight);
    Object.defineProperty(HTMLElement.prototype, 'style', originals.style);
    win.getComputedStyle = realGetComputedStyle;
    win.requestAnimationFrame = realRaf;
    win.cancelAnimationFrame = realCancel;
  };

  try {
    // ---- getBoundingClientRect：登记表驱动 ----
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
      configurable: true,
      writable: true,
      value: function getBoundingClientRect(this: Element): LaidOutRect {
        ops.push(`r${++seq}`);
        return rects.get(this) ?? ZERO_RECT;
      },
    });

    // ---- offsetWidth / offsetHeight：与登记的矩形联动，使 isElementVisible 能真实生效 ----
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return rects.get(this)?.width ?? 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return rects.get(this)?.height ?? 0;
      },
    });

    // ---- getComputedStyle：登记表驱动，未登记按浏览器基线返回 ----
    win.getComputedStyle = (el: Element) => ({ ...DEFAULT_COMPUTED, ...styles.get(el) });

    // ---- 样式写入：jsdom 30 把 CSSStyleDeclaration 属性做在实例 Proxy 里（原型上取不到
    // left 描述符），因此改在 HTMLElement.prototype.style 这一层套转发代理：
    // 写 left 记入有序日志，读取与存储仍走真实对象，保证测到的 left 值不是桩。
    const realStyleGet = styleDesc.get;
    Object.defineProperty(HTMLElement.prototype, 'style', {
      configurable: true,
      enumerable: styleDesc.enumerable,
      get(this: HTMLElement): CSSStyleDeclaration {
        const real = realStyleGet.call(this) as unknown as object;
        const cached = styleProxies.get(real);
        if (cached) return cached as unknown as CSSStyleDeclaration;
        const proxy = new Proxy(real, {
          get(target, prop) {
            const value = Reflect.get(target, prop, target);
            // 绑定回真实目标：否则以代理为 this 调用 setProperty 等内部方法会报错
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
          set(target, prop, value) {
            if (prop === 'left') ops.push(`w${++seq}`);
            Reflect.set(target, prop, value, target);
            return true;
          },
        });
        styleProxies.set(real, proxy);
        return proxy as unknown as CSSStyleDeclaration;
      },
    });

    // ---- rAF：手动队列；id 从 1 起（0 是「无句柄」的哨兵值，不能被占用）----
    win.requestAnimationFrame = (cb: (t: number) => void) => {
      const id = rafId++;
      queue.set(id, cb);
      return id;
    };
    win.cancelAnimationFrame = (id: number) => {
      queue.delete(id);
    };
  } catch (err) {
    restoreAll();
    throw err;
  }

  return {
    ops,
    setRect(el, spec) {
      rects.set(el, {
        left: spec.left,
        top: spec.top,
        right: spec.left + spec.width,
        bottom: spec.top + spec.height,
        width: spec.width,
        height: spec.height,
        x: spec.left,
        y: spec.top,
      });
    },
    setStyles(el, next) {
      styles.set(el, { ...styles.get(el), ...next });
    },
    rectOf(el) {
      return rects.get(el) ?? ZERO_RECT;
    },
    raf: {
      pending: () => queue.size,
      tick(n = 1) {
        for (let i = 0; i < n; i++) {
          const batch = queue;
          queue = new Map();
          batch.forEach(cb => cb(i));
        }
      },
    },
    resetOps() {
      ops.length = 0;
    },
    uninstall() {
      restoreAll();
      queue.clear();
      rects.clear();
      styles.clear();
    },
  };
}

/**
 * 从操作日志中剥出读取与写入的先后顺序
 *
 * @param ops 装置日志
 * @returns 形如 `rrwrw` 的压缩序列，便于断言「读全部先于写」
 */
export function opOrder(ops: readonly string[]): string {
  return ops.map(op => (op.startsWith('r') ? 'r' : 'w')).join('');
}

/**
 * 统计操作日志中的写入次数
 *
 * @param ops 装置日志
 * @returns `style.left` 被赋值的次数
 */
export function writeCount(ops: readonly string[]): number {
  return ops.reduce((total, op) => (op.startsWith('w') ? total + 1 : total), 0);
}
