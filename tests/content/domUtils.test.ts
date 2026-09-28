/**
 * content script DOM 工具测试
 *
 * 重点覆盖 isDetectableCheckbox 的复选框可检测性判定回归：
 * 阿里云 havana 登录等页面的协议复选框采用「原生 input visibility:hidden +
 * label 伪元素绘制勾选外观」的载体形式，旧检测逻辑按 visibility:hidden 将其
 * 排除，导致填充时协议复选框不会自动勾选。
 *
 * 测试环境为 node（无 jsdom），DOM 构造器全局不存在，故用普通对象模拟元素，
 * 并以读取对象挂载样式的桩替换 window.getComputedStyle。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  hasVisibleAssociatedLabel,
  isDetectableCheckbox,
  resolveToggleAnchorRight,
} from '@/entrypoints/content/domUtils';
import type { RectMetrics } from '@/entrypoints/content/domUtils';

interface FakeElement {
  tagName: string;
  disabled?: boolean;
  offsetParent?: FakeElement | null;
  offsetWidth: number;
  offsetHeight: number;
  labels?: FakeElement[];
  /** 供 getComputedStyle 桩读取的计算样式 */
  computed?: Record<string, string>;
}

const VISIBLE_STYLE = { display: 'block', visibility: 'visible', opacity: '1' };

/** 构造模拟元素，默认自身可见（有 offsetParent 与布局尺寸） */
function fakeElement(computed: Record<string, string>, extra: Partial<FakeElement> = {}): FakeElement {
  return {
    tagName: 'INPUT',
    offsetParent: { tagName: 'DIV', offsetWidth: 100, offsetHeight: 100 },
    offsetWidth: 13,
    offsetHeight: 13,
    computed,
    ...extra,
  };
}

/** 构造模拟 label，默认可见 */
function fakeLabel(computed: Record<string, string> = VISIBLE_STYLE): FakeElement {
  return { tagName: 'LABEL', offsetWidth: 300, offsetHeight: 20, computed };
}

const asInput = (el: FakeElement): HTMLInputElement => el as unknown as HTMLInputElement;

let restoreWindow: (() => void) | null = null;

/**
 * 替换全局 window 为 getComputedStyle 桩（读取 el.computed，缺省按可见处理）
 * 采用手动 descriptor 还原，避免影响框架注入的其他全局
 */
function stubWindow(): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      getComputedStyle: (el: FakeElement) => el.computed ?? VISIBLE_STYLE,
    },
  });
  restoreWindow = () => {
    if (descriptor) {
      Object.defineProperty(globalThis, 'window', descriptor);
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
    restoreWindow = null;
  };
}

afterEach(() => {
  restoreWindow?.();
});

describe('isDetectableCheckbox', () => {
  it('原生可见的复选框纳入候选', () => {
    stubWindow();
    expect(isDetectableCheckbox(asInput(fakeElement(VISIBLE_STYLE)))).toBe(true);
  });

  it('回归：visibility:hidden 原生 input 存在可见关联 label 时纳入候选（阿里云 havana 协议复选框载体）', () => {
    stubWindow();
    const input = fakeElement({ ...VISIBLE_STYLE, visibility: 'hidden' }, { labels: [fakeLabel()] });
    expect(isDetectableCheckbox(asInput(input))).toBe(true);
  });

  it('display:none 原生 input 存在可见关联 label 时纳入候选', () => {
    stubWindow();
    const input = fakeElement({ ...VISIBLE_STYLE, display: 'none' }, { labels: [fakeLabel()] });
    expect(isDetectableCheckbox(asInput(input))).toBe(true);
  });

  it('隐藏且无关联 label 的 input 排除（纯隐藏功能开关/蜜罐字段）', () => {
    stubWindow();
    expect(isDetectableCheckbox(asInput(fakeElement({ ...VISIBLE_STYLE, visibility: 'hidden' })))).toBe(false);
    expect(isDetectableCheckbox(asInput(fakeElement({ ...VISIBLE_STYLE, display: 'none' })))).toBe(false);
  });

  it('隐藏 input 的关联 label 同样不可见时排除', () => {
    stubWindow();
    const input = fakeElement(
      { ...VISIBLE_STYLE, visibility: 'hidden' },
      {
        labels: [fakeLabel({ ...VISIBLE_STYLE, visibility: 'hidden' })],
      },
    );
    expect(isDetectableCheckbox(asInput(input))).toBe(false);
  });

  it('display:none 容器内（offsetParent 为 null）且 label 不可见时排除', () => {
    stubWindow();
    const input = fakeElement(
      { ...VISIBLE_STYLE, display: 'none' },
      {
        offsetParent: null,
        labels: [fakeLabel({ ...VISIBLE_STYLE, display: 'none' })],
      },
    );
    expect(isDetectableCheckbox(asInput(input))).toBe(false);
  });

  it('disabled 复选框排除', () => {
    stubWindow();
    expect(isDetectableCheckbox(asInput(fakeElement(VISIBLE_STYLE, { disabled: true })))).toBe(false);
  });
});

describe('hasVisibleAssociatedLabel', () => {
  it('任一关联 label 可见返回 true', () => {
    stubWindow();
    const input = fakeElement(VISIBLE_STYLE, { labels: [fakeLabel()] });
    expect(hasVisibleAssociatedLabel(asInput(input))).toBe(true);
  });

  it('无关联 label 返回 false', () => {
    stubWindow();
    expect(hasVisibleAssociatedLabel(asInput(fakeElement(VISIBLE_STYLE)))).toBe(false);
  });

  it('关联 label 均不可见返回 false', () => {
    stubWindow();
    const input = fakeElement(VISIBLE_STYLE, { labels: [fakeLabel({ ...VISIBLE_STYLE, opacity: '0' })] });
    expect(hasVisibleAssociatedLabel(asInput(input))).toBe(false);
  });
});

describe('resolveToggleAnchorRight', () => {
  /** 构造矩形度量：width/height 由边界推导 */
  const rect = (left: number, right: number, top: number, bottom: number): RectMetrics => ({
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  });

  it('父元素紧贴 input（尾随空间不足）时锚定 input 右缘', () => {
    const inputRect = rect(180, 905, 460, 540);
    expect(resolveToggleAnchorRight(inputRect, rect(179, 906, 458, 542), [])).toBe(905);
  });

  it('父元素为更宽的可视字段盒且尾随空间空闲时锚定父元素右缘', () => {
    const inputRect = rect(180, 730, 460, 540);
    expect(resolveToggleAnchorRight(inputRect, rect(180, 905, 455, 545), [])).toBe(905);
  });

  it('尾随空间被兄弟元素（行内按钮）占据时保持 input 右缘', () => {
    const inputRect = rect(180, 730, 460, 540);
    const sibling = rect(740, 890, 460, 540);
    expect(resolveToggleAnchorRight(inputRect, rect(180, 905, 455, 545), [sibling])).toBe(730);
  });

  it('父元素垂直松散（含标签/多行）时保持 input 右缘', () => {
    const inputRect = rect(180, 730, 460, 540);
    expect(resolveToggleAnchorRight(inputRect, rect(180, 905, 400, 640), [])).toBe(730);
  });

  it('兄弟元素仅悬浮于 input 内部（页面原生眼睛）且尾随空闲时锚定父元素右缘', () => {
    const inputRect = rect(180, 730, 460, 540);
    const nativeEye = rect(685, 710, 480, 520);
    expect(resolveToggleAnchorRight(inputRect, rect(180, 905, 455, 545), [nativeEye])).toBe(905);
  });

  it('零尺寸兄弟元素（display:none）不视为占据尾随空间', () => {
    const inputRect = rect(180, 730, 460, 540);
    const hidden = rect(740, 740, 460, 460);
    expect(resolveToggleAnchorRight(inputRect, rect(180, 905, 455, 545), [hidden])).toBe(905);
  });
});
