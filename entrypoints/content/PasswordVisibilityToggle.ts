import { eyeOpenIcon, eyeClosedIcon } from '@/entrypoints/content/floatingButtons/icons';
import type { ToggleEntry } from '@/entrypoints/content/types';
import { applyThemeTokensToHost, DEFAULT_THEME, type ThemeName } from '@/utils/theme';
import { isElementVisible, resolveToggleAnchorRight, type RectMetrics } from './domUtils';
import { tl } from '@/utils/i18n-lite';

/** 注入按钮的基础类名 */
const BUTTON_CLASS = 'aph-pwd-toggle-btn';

/** 注入按钮的可见态类名（input 有值时挂上；布局跟随仅在存在可见按钮期间运行） */
const VISIBLE_CLASS = 'aph-pwd-toggle-visible';

/**
 * 注入到页面中的 CSS 样式
 *
 * 零侵入方案：按钮作为 input 兄弟节点，position: absolute 定位。
 * 垂直居中由 CSS 处理，水平位置由 JS 计算。
 * 不包裹 input，不修改 input 样式，仅父元素临时设为 position: relative。
 */
const INJECTED_STYLES = `
.${BUTTON_CLASS} {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: var(--aph-primary);
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, visibility 0.2s ease, color 0.15s ease;
  z-index: 200;
  border-radius: 4px;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  line-height: 0;
  font-size: 0;
  pointer-events: auto;
}

.${BUTTON_CLASS}.${VISIBLE_CLASS} {
  opacity: 1;
  visibility: visible;
}

.${BUTTON_CLASS}:hover {
  color: var(--aph-primary-hover);
  background: rgb(var(--aph-primary-rgb) / 10%);
}

.${BUTTON_CLASS}:active {
  color: var(--aph-primary);
  background: rgb(var(--aph-primary-rgb) / 18%);
}

.${BUTTON_CLASS} svg {
  width: 16px;
  height: 16px;
  pointer-events: none;
  flex-shrink: 0;
}
`;

/** STYLE 元素 ID */
const STYLE_ELEMENT_ID = 'aph-pwd-toggle-styles';

/** 按钮左边缘距锚点右边缘的距离 = 按钮宽度(24) + 间距(4) */
const BUTTON_LEFT_OFFSET = 28;

/** 按钮水平定位的测量结果（锚点右缘 + 父元素左缘基准） */
interface AnchorMeasurement {
  /** 水平锚点右缘（视口坐标） */
  anchorRight: number;
  /** 定位父元素左缘（视口坐标，left 的计算基准） */
  parentLeft: number;
  /** 锚点是否为 input 右缘（供钥匙图标避让偏移判定） */
  atInputRight: boolean;
}

/**
 * 密码输入框显示/隐藏切换管理器
 *
 * 零侵入方案：
 * - 不对 input 做 DOM 包裹或样式修改
 * - 按钮作为 input 兄弟节点插入（同一父元素）
 * - 父元素设为 position: relative（无偏移量，视觉零影响）
 * - 按钮 position: absolute，CSS 垂直居中 + JS 水平定位
 * - 水平定位经布局跟随逐帧修正：iframe 二次布局/入场动画/异步样式导致的漂移
 *   不产生 resize 事件，一次性测量会停留在瞬态坐标
 * - 布局跟随仅在「功能启用且至少一个按钮带可见类」期间运行，空密码框页面无常驻开销
 * - 条目释放只经 releaseEntry 单一路径，保证按钮、input.type 与宿主定位一并还原；
 *   定位改写按父元素引用计数归还，同父元素多个密码框共享一份 relative 时不误清
 */
export class PasswordVisibilityToggle {
  /** input → 条目反查索引（条目的真实持有者是 liveEntries，故此处不构成弱引用保证） */
  private entries = new WeakMap<HTMLInputElement, ToggleEntry>();

  /** 已处理过的输入框集合（用于去重） */
  private processedInputs = new WeakSet<HTMLInputElement>();

  /** DOM 变化观察器 */
  private observer: MutationObserver | null = null;

  /** 功能开关状态 */
  private enabled = true;

  /** 样式元素引用 */
  private styleElement: HTMLStyleElement | null = null;

  /** 当前主题（用于注入按钮的令牌换肤） */
  private currentTheme: ThemeName = DEFAULT_THEME;

  /** 布局跟随 rAF 句柄（存在可见按钮期间逐帧跟踪 input/parent 相对几何） */
  private followRaf: number | null = null;

  /**
   * 托管条目的唯一事实来源（强引用；WeakMap 不可迭代，跟随循环需要遍历）
   *
   * 条目生命周期等于本 Set 的成员资格，因此必须靠 releaseEntry 显式摘除：
   * 任何只删 Set 之外索引的路径都会让条目连同 input/parent/button 引用永久残留。
   */
  private liveEntries = new Set<ToggleEntry>();

  /**
   * 宿主父元素的 position 改写归属（原值 + 依赖这份改写的在管条目数）
   *
   * 无记录代表该父元素的 computed 本就不是 static，我们从未改过它，也就无权回写；
   * 有记录时只有最后一个条目释放才还原，避免半路清掉兄弟条目的定位上下文。
   */
  private parentPositionOverrides = new WeakMap<HTMLElement, { original: string; refs: number }>();

  /**
   * 初始化
   */
  init(): void {
    this.injectStyles();
    this.scanAndInject();
    this.startObserver();
  }

  /**
   * 动态启用/禁用
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;

    if (enabled) {
      this.injectStyles();
      this.scanAndInject();
      this.startObserver();
    } else {
      this.removeAll();
    }
  }

  /**
   * 更新主题：刷新当前主题并对已注入按钮重写令牌，实现实时换肤
   * @param theme 主题名
   */
  setTheme(theme: ThemeName): void {
    this.currentTheme = theme;
    const buttons = document.querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`);
    buttons.forEach(button => applyThemeTokensToHost(button, theme));
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.removeAll();
    this.observer?.disconnect();
    this.observer = null;
    this.styleElement?.remove();
    this.styleElement = null;
  }

  /**
   * 注入全局样式（只注入一次）
   */
  private injectStyles(): void {
    if (document.getElementById(STYLE_ELEMENT_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = INJECTED_STYLES;
    document.head.appendChild(style);
    this.styleElement = style;
  }

  /**
   * 扫描所有密码输入框并注入按钮
   *
   * 开头先回收已脱离文档的条目：布局跟随只在按钮可见期间运行，空密码框页面根本没有帧在跑，
   * SPA 重挂留下的孤儿条目若只等跟随清理就永不释放（liveEntries 是强引用）。本方法恰好在
   * 「新增了密码节点」的 mutation 之后被调用（且与注入共用一次 querySelectorAll），是最经济的回收时机。
   */
  private scanAndInject(): void {
    if (!this.enabled) return;
    for (const entry of Array.from(this.liveEntries)) {
      if (!entry.input.isConnected || !entry.button.isConnected) this.releaseEntry(entry);
    }
    const passwordInputs = document.querySelectorAll('input[type="password"]') as NodeListOf<HTMLInputElement>;
    passwordInputs.forEach(input => this.injectToggle(input));
  }

  /**
   * 为单个密码输入框注入切换按钮
   *
   * 注入后立即做一次最佳努力定位，后续由布局跟随逐帧修正，
   * 覆盖弹窗动画/iframe 二次布局/异步样式导致的漂移。
   */
  private injectToggle(input: HTMLInputElement): void {
    if (this.processedInputs.has(input)) return;
    if (!isElementVisible(input)) return;

    const parent = input.parentElement;
    if (!parent) return;

    this.processedInputs.add(input);
    // 标记为密码字段，确保 LoginAutoSave 在 type 被切换为 text 后仍能通过选择器定位
    input.dataset.aphPassword = 'true';

    // 父元素设为 position: relative（无偏移量 = 视觉零影响）。同父元素的多个密码框共享这一份
    // 改写：第二个条目不再改写，也就不会把我们写的 relative 误当成宿主原值存入恢复记录
    let positionOverride = this.parentPositionOverrides.get(parent);
    if (!positionOverride && window.getComputedStyle(parent).position === 'static') {
      positionOverride = { original: parent.style.position || '', refs: 0 };
      this.parentPositionOverrides.set(parent, positionOverride);
      parent.style.position = 'relative';
    }
    if (positionOverride) positionOverride.refs += 1;

    // 创建按钮
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.setAttribute('tabindex', '-1');
    button.setAttribute('aria-label', tl('cs.pv.show'));
    // 动作语义：密文状态显示睁眼图标（表示"点击显示密码"）
    button.innerHTML = eyeOpenIcon;

    // 写入当前主题令牌到按钮元素（light DOM，仅作用于自身及其伪类，零侵入页面）
    applyThemeTokensToHost(button, this.currentTheme);

    // 按钮作为兄弟节点插入到 input 之后
    parent.insertBefore(button, input.nextSibling);

    // 根据当前是否有值控制按钮可见性
    if (input.value.length > 0) {
      button.classList.add(VISIBLE_CLASS);
    }

    // input 事件：有值时显示按钮
    const onInput = () => {
      button.classList.toggle(VISIBLE_CLASS, input.value.length > 0);
      // 可见性是布局跟随唯一的启停信号：按钮隐藏期间无需逐帧测量宿主几何
      this.syncFollow();
    };
    input.addEventListener('input', onInput);

    // click 事件：切换密码可见性
    let isRevealed = false;
    const onClick = () => {
      isRevealed = !isRevealed;
      input.type = isRevealed ? 'text' : 'password';
      // 动作语义：明文显示划线眼（表示"点击隐藏密码"），密文显示睁眼（表示"点击显示密码"）
      button.innerHTML = isRevealed ? eyeClosedIcon : eyeOpenIcon;
      button.setAttribute('aria-label', isRevealed ? tl('cs.pv.hide') : tl('cs.pv.show'));

      // 保持焦点在输入框上，不影响用户操作
      input.focus();

      // 切换 type 后重定位（尺寸可能有细微差异）
      this.positionButton(input, button);

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    button.addEventListener('click', onClick);

    // 记录条目
    const entry: ToggleEntry = {
      input,
      parent,
      button,
      onInput,
      onClick,
      lastRectKey: '',
      anchorAtInputRight: true,
    };
    this.entries.set(input, entry);
    this.liveEntries.add(entry);

    // 立即最佳努力定位；按钮可见期间发生的后续漂移由布局跟随逐帧修正
    // （空字段下按钮不可见，无需修正；input 首次有值时 onInput 会启动跟随并强制重定位）
    this.positionButton(input, button);
    this.syncFollow();
  }

  /**
   * MutationObserver：监听动态新增的密码输入框
   */
  private startObserver(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(mutations => {
      if (!this.enabled) return;

      let shouldScan = false;
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          if (
            el.querySelector?.('input[type="password"]') ||
            (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password')
          ) {
            shouldScan = true;
            break;
          }
        }
        if (shouldScan) break;
      }

      if (shouldScan) {
        // 延迟扫描，等待 DOM 渲染完成
        setTimeout(() => this.scanAndInject(), 100);
      }
    });

    // allFrames 注入时部分 iframe（about:blank / srcdoc 空文档）document.body 为 null，
    // 此时无 DOM 可观察，跳过 observe 避免抛出 TypeError
    if (document.body) {
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  /**
   * 移除所有注入的切换按钮，恢复原始 DOM 结构
   *
   * 遍历 liveEntries 而非 querySelectorAll：后者查不到已脱离文档的按钮，
   * 其条目会连同强引用一起永久残留，而本方法结束时 rAF 已随 enabled 关闭，再无清理路径。
   */
  private removeAll(): void {
    for (const entry of Array.from(this.liveEntries)) {
      this.releaseEntry(entry);
    }

    // 移除样式
    this.styleElement?.remove();
    this.styleElement = null;

    // 停止观察器
    this.observer?.disconnect();
    this.observer = null;

    // 条目清空后停止布局跟随
    this.syncFollow();
  }

  /**
   * 完整释放一条注入：解绑监听、还原 input 类型与宿主定位、移除按钮并注销条目
   *
   * 所有清理路径（removeAll、布局跟随发现节点脱离）必须共用本方法：只删索引不还原 DOM
   * 会留下「条目已注销、按钮与宿主改动仍在原地」的半清理状态——被揭示的明文密码无 UI
   * 可收回、宿主 position 被污染。
   *
   * position 还原按父元素引用计数归还（见 parentPositionOverrides）：先注销自身再归还，
   * 保证同父元素的兄弟条目不会提前失去定位上下文，也不会把残留的 relative 固化到宿主上。
   *
   * @param entry 待释放的托管条目
   */
  private releaseEntry(entry: ToggleEntry): void {
    entry.input.removeEventListener('input', entry.onInput);
    entry.button.removeEventListener('click', entry.onClick);
    entry.input.type = 'password';
    entry.button.remove();

    this.entries.delete(entry.input);
    this.processedInputs.delete(entry.input);
    this.liveEntries.delete(entry);

    const override = this.parentPositionOverrides.get(entry.parent);
    if (override) {
      override.refs -= 1;
      if (override.refs <= 0) {
        entry.parent.style.position = override.original;
        this.parentPositionOverrides.delete(entry.parent);
      }
    }
  }

  /**
   * 测量按钮水平定位所需几何：锚点右缘 + 父元素左缘
   *
   * input 尚未布局（display:none / 入场动画初始帧）时返回 null，调用方跳过写入。
   */
  private measureAnchor(input: HTMLInputElement, button: HTMLButtonElement): AnchorMeasurement | null {
    const parent = input.parentElement;
    if (!parent) return null;
    const parentRect = parent.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    if (inputRect.width === 0 || inputRect.height === 0) return null;

    // 收集父元素内其余子元素矩形，判断 input 右侧尾随空间是否已被占据
    const siblingRects: RectMetrics[] = [];
    for (const child of Array.from(parent.children)) {
      if (child === input || child === button) continue;
      siblingRects.push(child.getBoundingClientRect());
    }
    const anchorRight = resolveToggleAnchorRight(inputRect, parentRect, siblingRects);
    return { anchorRight, parentLeft: parentRect.left, atInputRight: anchorRight === inputRect.right };
  }

  /**
   * 计算按钮水平位置（垂直方向由 CSS top:50% + translateY(-50%) 处理）
   *
   * 锚点右缘经 resolveToggleAnchorRight 解析：默认 input 右内缘；
   * 父元素为更宽的可视字段盒且尾随空间空闲时改用父元素右缘。
   */
  private positionButton(
    input: HTMLInputElement,
    button: HTMLButtonElement,
    measurement: AnchorMeasurement | null = this.measureAnchor(input, button),
  ): void {
    if (!measurement) return;
    const entry = this.entries.get(input);
    if (entry) entry.anchorAtInputRight = measurement.atInputRight;

    // 按钮定位在锚点右缘内部 28px 处（按钮宽 24 + 间距 4）
    const left = measurement.anchorRight - measurement.parentLeft - BUTTON_LEFT_OFFSET;
    button.style.left = `${Math.round(left)}px`;
  }

  /**
   * 查询指定输入框的可见性按钮是否锚定在 input 右内缘
   *
   * 钥匙图标据此决定是否预留避让偏移：按钮锚定父元素（可视字段盒）右缘时
   * 与 input 右缘不再相邻，无需预留。未注入按钮时按预留处理（保守兼容旧行为）。
   *
   * 查询前先补一次测量：布局跟随仅在按钮可见期间运行，而获焦/点击时字段往往仍为空、
   * 循环处于停摆，`anchorAtInputRight` 可能停在注入那一刻的瞬态值；跟随循环本身不会在
   * 停摆期间刷新它，但钥匙图标已按旧值定下避让偏移，会造成与眼睛图标重叠。
   *
   * @param input 密码输入框
   */
  anchorsToInputRight(input: HTMLInputElement): boolean {
    const entry = this.entries.get(input);
    if (!entry) return true;
    this.positionButton(input, entry.button);
    return entry.anchorAtInputRight;
  }

  /**
   * 是否存在当前可见的切换按钮
   *
   * 按钮默认 opacity:0 + visibility:hidden，仅 input 有值时才挂上可见类；空密码框（常态）
   * 下没有任何需要跟随的可见 UI。只读 classList，不触发布局计算。
   *
   * 以可见类而非实时几何为准：字段有值后被 CSS 隐藏（弹窗 display:none 但未清值）时
   * 仍会保持跟随，代价是那一页的跟随不会停；换成实时判定就得每帧读 rect，不划算。
   */
  private hasVisibleButton(): boolean {
    for (const entry of this.liveEntries) {
      if (entry.button.classList.contains(VISIBLE_CLASS)) return true;
    }
    return false;
  }

  /**
   * 启停布局跟随：仅在功能启用且至少一个按钮可见期间逐帧跟踪 input 与父元素的相对几何
   *
   * iframe 二次布局、入场动画、异步样式加载等场景下，input 宽度/位置可能在初始定位后
   * 再次漂移，且全程不产生 window resize 事件；一次性测量（含双帧 rAF 延迟）覆盖不到，
   * 按钮会停留在瞬态坐标（部分 iframe 登录页眼睛图标偏移的根因）。
   * 跟随仅在矩形指纹变化时重定位，稳定帧只读不写；按钮全部隐藏、条目清空或功能禁用后停止。
   */
  private syncFollow(): void {
    if (!this.enabled || !this.hasVisibleButton()) {
      if (this.followRaf !== null) {
        cancelAnimationFrame(this.followRaf);
        this.followRaf = null;
      }
      return;
    }
    if (this.followRaf !== null) return;
    // 冷启动才需失效指纹：停摆期间不产生任何帧，那份漂移是看不到的
    for (const entry of this.liveEntries) entry.lastRectKey = '';
    this.followRaf = requestAnimationFrame(this.followTick);
  }

  /**
   * 布局跟随每帧：先全部测量再统一写入，避免跨条目的读写交错退化为强制同步布局
   *
   * 写入 style.left 会标脏样式，紧接着下一个条目的 getBoundingClientRect 就会触发同步重排；
   * 单条目页面不易察觉，但登录页常见的新旧密码 / 密码+确认密码同屏时会逐帧抖动。
   */
  private followTick = (): void => {
    this.followRaf = null;
    if (!this.enabled) return;

    /** 阶段一产物：矩形指纹变化、待写入的条目及其已算好的测量结果 */
    const pending: Array<{ entry: ToggleEntry; measurement: AnchorMeasurement }> = [];
    /** 阶段一产物：已脱离文档、需在写入阶段之后整体释放的条目 */
    const detached: ToggleEntry[] = [];

    for (const entry of this.liveEntries) {
      if (!entry.input.isConnected || !entry.button.isConnected) {
        // SPA 重渲染可能整体替换节点：收集后统一释放，不在此处做 DOM 写入
        detached.push(entry);
        continue;
      }
      const measurement = this.measureAnchor(entry.input, entry.button);
      const key = measurement
        ? `${Math.round(measurement.anchorRight)},${Math.round(measurement.parentLeft)}`
        : 'unlaid';
      if (key !== entry.lastRectKey) {
        entry.lastRectKey = key;
        if (measurement) pending.push({ entry, measurement });
      }
    }

    // 阶段二：只做写入与条目释放，不再产生任何布局读取
    for (const { entry, measurement } of pending) {
      this.positionButton(entry.input, entry.button, measurement);
    }
    for (const entry of detached) {
      this.releaseEntry(entry);
    }

    // 直接续下一帧，不能走 syncFollow：本帧开头已把 followRaf 置 null，走过去会落进
    // 「冷启动」分支把刚写入的指纹全清，稳定帧因此退化成每帧写 style.left
    if (this.hasVisibleButton()) {
      this.followRaf = requestAnimationFrame(this.followTick);
    }
  };
}
