/** @vitest-environment jsdom */
/**
 * 密码可见性注入按钮的 DOM 生命周期测试
 *
 * 覆盖 PasswordVisibilityToggle 的四类不变量，全部对应真实缺陷而非实现细节：
 * 1. 释放完整性 —— 条目注销时按钮、`input.type`、宿主 position 必须一并还原
 *    （缺陷：跟随循环发现节点脱离时只删索引，被揭示的明文密码无 UI 可收回）。
 * 2. 布局跟随的启停与省写 —— 门槛是「按钮带可见类」而非「存在条目」，且稳定帧不得写入
 *    （缺陷：常驻 60fps 强制布局；以及续帧误走启停控制器导致每帧清空指纹）。
 * 3. 两阶段读写分离 —— 一帧内所有测量必须先于所有写入
 *    （缺陷：跨条目读-写交错触发逐帧同步重排）。
 * 4. 宿主 position 的归属与引用计数 —— 按父元素记账，最后一个条目释放才还原
 *    （缺陷：同父元素「密码 + 确认密码」时把恢复值固化到宿主，或提前清掉兄弟条目的定位上下文）。
 *
 * 依赖 tests/helpers/domLayout.ts 提供的几何登记表与手动 rAF 队列；文件开头先做装置自检，
 * 防止补丁静默失配产出「看似合理实则全错」的结论。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PasswordVisibilityToggle } from '@/entrypoints/content/PasswordVisibilityToggle';
import type { ToggleEntry } from '@/entrypoints/content/types';
import { installDomLayout, opOrder, writeCount, type DomLayout } from '@/tests/helpers/domLayout';

/** 可见态类名（与被测模块内的 VISIBLE_CLASS 一致） */
const VISIBLE_CLASS = 'aph-pwd-toggle-visible';

/** 测试用白盒视图：仅暴露生命周期断言所需的内部状态 */
interface ToggleInternals {
  liveEntries: Set<ToggleEntry>;
  scanAndInject: () => void;
}

const PARENT_RECT = { left: 100, top: 50, width: 300, height: 40 };
const INPUT_RECT = { left: 100, top: 50, width: 300, height: 40 };

/** 构造一个「父元素直下两个密码框」的登录/注册表单 */
function mountForm(inputCount: number): { parent: HTMLElement; inputs: HTMLInputElement[] } {
  const parent = document.createElement('form');
  const inputs: HTMLInputElement[] = [];
  for (let i = 0; i < inputCount; i++) {
    const input = document.createElement('input');
    input.type = 'password';
    parent.appendChild(input);
    inputs.push(input);
  }
  document.body.appendChild(parent);
  return { parent, inputs };
}

let layout: DomLayout;
let manager: PasswordVisibilityToggle;
let view: ToggleInternals;
/** beforeEach 是否跑到底；装置自检抛错时避开 afterEach 级联出一堆无关错误 */
let ready = false;

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  layout = installDomLayout();
  manager = new PasswordVisibilityToggle();
  view = manager as unknown as ToggleInternals;
  ready = true;
});

afterEach(() => {
  // 自检失败时 installDomLayout 已自行回滚补丁，manager 尚未 init 也无副作用，直接跳过
  if (!ready) return;
  ready = false;
  manager.destroy();
  layout.uninstall();
});

/** 让 input 进入「有值 → 按钮可见」状态，从而启动布局跟随 */
function typeInto(input: HTMLInputElement, text = 'secret'): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('测试装置自检（补丁失配会让以下所有结论失效）', () => {
  it('setRect 同时驱动 getBoundingClientRect 与 offsetWidth/offsetHeight', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(el.getBoundingClientRect().width).toBe(0);
    expect(el.offsetWidth).toBe(0);

    layout.setRect(el, { left: 10, top: 20, width: 200, height: 40 });
    const rect = el.getBoundingClientRect();
    expect([rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height]).toEqual([10, 210, 20, 60, 200, 40]);
    expect(el.offsetWidth).toBe(200);
    expect(el.offsetHeight).toBe(40);
  });

  it('getComputedStyle 对未声明属性返回浏览器基线（position 必须是 static 而非空串）', () => {
    const el = document.createElement('div');
    expect(window.getComputedStyle(el).position).toBe('static');
    layout.setStyles(el, { position: 'absolute' });
    expect(window.getComputedStyle(el).position).toBe('absolute');
  });

  it('rAF 由队列手动推进，id 不使用 0 哨兵值', () => {
    let calls = 0;
    const id = requestAnimationFrame(() => calls++);
    expect(id).not.toBe(0);
    expect(layout.raf.pending()).toBe(1);
    layout.raf.tick();
    expect(calls).toBe(1);
    expect(layout.raf.pending()).toBe(0);
  });

  it('写 style.left 既记入有序日志又真实生效（读回的值不是桩）', () => {
    const el = document.createElement('div');
    layout.resetOps();
    el.style.left = '42px';
    expect(el.style.left).toBe('42px');
    expect(opOrder(layout.ops)).toBe('w');
  });
});

describe('注入与布局跟随的启停', () => {
  it('空密码框（按钮不可见）不排任何帧 —— 不允许常驻 60fps 强制布局', () => {
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);

    manager.init();

    expect(view.liveEntries.size).toBe(1);
    expect(layout.raf.pending()).toBe(0);
  });

  it('按钮转为可见时才启动跟随；转回隐藏后立即停帧', () => {
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    manager.init();

    typeInto(inputs[0]);
    expect(layout.raf.pending()).toBe(1);

    typeInto(inputs[0], '');
    layout.raf.tick();
    expect(layout.raf.pending()).toBe(0);
  });

  it('稳定帧只读不写（续帧不得清空矩形指纹）', () => {
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    manager.init();
    typeInto(inputs[0]);

    layout.raf.tick(); // 冷启动首帧：建立指纹并定位一次
    layout.resetOps();

    layout.raf.tick(3); // 几何未变动的 3 帧

    expect(layout.ops.length).toBeGreaterThan(0); // 确实在逐帧测量
    expect(writeCount(layout.ops)).toBe(0); // 但零写入
  });

  it('布局漂移后的帧会重定位并继续自行续帧', () => {
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    manager.init();
    typeInto(inputs[0]);
    layout.raf.tick();

    // 移动父元素：锚点右缘与定位基准同时变化（只改 input 宽度可能仍解出同一锚点，不会触发写入）
    layout.setRect(parent, { left: 140, top: 50, width: 300, height: 40 });
    layout.resetOps();
    layout.raf.tick();

    expect(writeCount(layout.ops)).toBe(1);
    expect(layout.raf.pending()).toBe(1);
  });
});

describe('两阶段读写分离', () => {
  it('同一帧内多条目全部测量先于全部写入，不退化为读-写交错', () => {
    const { parent, inputs } = mountForm(2);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    layout.setRect(inputs[1], { left: 100, top: 100, width: 300, height: 40 });
    manager.init();
    typeInto(inputs[0]);
    typeInto(inputs[1]);
    layout.raf.tick();

    // 移动父元素：两个条目的指纹同时失效，一帧内都要重定位
    layout.setRect(parent, { left: 120, top: 50, width: 300, height: 40 });
    layout.resetOps();
    layout.raf.tick();

    const order = opOrder(layout.ops);
    // 读全部在前、写全部在后，且两边都不止一条（确实有两个条目在同一帧内被处理）
    expect(order).toMatch(/^r{2,}w{2,}$/);
    expect(writeCount(layout.ops)).toBe(2);
  });
});

describe('条目释放完整性', () => {
  it('destroy 还原按钮、input.type 与宿主 position', () => {
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    manager.init();

    const input = inputs[0];
    const button = parent.querySelector('button')!;
    expect(parent.style.position).toBe('relative');

    input.type = 'text'; // 复刻点击眼睛后的明文态
    manager.destroy();

    expect(button.isConnected).toBe(false);
    expect(input.type).toBe('password');
    expect(parent.style.position).toBe('');
    expect(view.liveEntries.size).toBe(0);
  });

  it('回归：按钮被框架摘除而 input 保留时，明文必须被收回且监听解绑', () => {
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    manager.init();
    typeInto(inputs[0]);
    layout.raf.tick();

    const input = inputs[0];
    const button = parent.querySelector('button')!;
    input.type = 'text'; // 已揭示明文
    button.remove(); // 宿主框架重渲染摘走了我们的按钮

    layout.raf.tick(); // 跟随发现脱离 → releaseEntry

    expect(input.type).toBe('password'); // 隐私基线：不留明文
    expect(view.liveEntries.size).toBe(0);
    // 监听已解绑：释放后继续输入不应再改动可见类（先洗掉残留类，才能区分「未解绑」与「从未抹除」）
    button.classList.remove(VISIBLE_CLASS);
    input.value = 'again';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(button.classList.contains(VISIBLE_CLASS)).toBe(false);
  });

  it('setEnabled(false) 也能回收按钮已脱离的条目（不依赖 querySelectorAll）', () => {
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    manager.init();
    parent.querySelector('button')!.remove(); // 按钮脱离，querySelectorAll 查不到

    manager.setEnabled(false);

    expect(view.liveEntries.size).toBe(0);
  });

  it('跟随停摆期间脱离的条目由扫描入口兜底回收', () => {
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    manager.init();
    // 不输入任何值 → 无可见按钮 → 没有帧在跑 → 脱离检测不会发生
    inputs[0].remove();
    parent.querySelector('button')!.remove();
    expect(view.liveEntries.size).toBe(1);

    view.scanAndInject();

    expect(view.liveEntries.size).toBe(0);
  });
});

describe('宿主 position 的归属与引用计数', () => {
  /** 逐个释放全部条目（走私有方法，等价于 removeAll 的循环） */
  const releaseAll = () => {
    const internals = manager as unknown as { releaseEntry(e: ToggleEntry): void };
    [...view.liveEntries].forEach(entry => internals.releaseEntry(entry));
  };

  it('同父元素两个密码框按注入顺序释放后不留 position 残留', () => {
    const { parent, inputs } = mountForm(2);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    layout.setRect(inputs[1], { left: 100, top: 100, width: 300, height: 40 });
    manager.init();
    expect(parent.style.position).toBe('relative');

    releaseAll();

    // 第二个条目的存在不应污染恢复值：引用归零时回到宿主的空 inline position
    expect(parent.style.position).toBe('');
  });

  it('全部释放同样在 destroy 路径下干净', () => {
    const { parent, inputs } = mountForm(2);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    layout.setRect(inputs[1], { left: 100, top: 100, width: 300, height: 40 });
    manager.init();

    manager.destroy();

    expect(parent.style.position).toBe('');
  });

  it('父元素 computed 本就不是 static 时从不改写、也从不回写', () => {
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    layout.setStyles(parent, { position: 'absolute' });

    manager.init();
    expect(parent.style.position).toBe('');
    manager.destroy();
    expect(parent.style.position).toBe('');
  });

  it('兄弟条目存活时释放其一不得剥掉定位上下文', () => {
    const { parent, inputs } = mountForm(2);
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);
    layout.setRect(inputs[1], { left: 100, top: 100, width: 300, height: 40 });
    manager.init();
    typeInto(inputs[0]);
    typeInto(inputs[1]);
    layout.raf.tick();

    inputs[0].remove(); // 第一个条目脱离，第二个仍存活
    layout.raf.tick();

    expect(view.liveEntries.size).toBe(1);
    expect(parent.style.position).toBe('relative');
    expect(parent.querySelector('button')).not.toBeNull();

    releaseAll();
    expect(parent.style.position).toBe('');
  });

  it('宿主自有 inline position 时按原值归还', () => {
    const { parent, inputs } = mountForm(1);
    parent.style.position = 'static';
    layout.setRect(parent, PARENT_RECT);
    layout.setRect(inputs[0], INPUT_RECT);

    manager.init();
    expect(parent.style.position).toBe('relative');
    manager.destroy();
    expect(parent.style.position).toBe('static');
  });
});

describe('锚点归属判定的实时性', () => {
  it('跟随停摆时按需补测，不返回陈旧锚点（否则钥匙图标避让会重叠）', () => {
    // 宽可视字段盒：尾随空间充足且无兄弟占据 → 锚定父元素右缘
    const { parent, inputs } = mountForm(1);
    layout.setRect(parent, { left: 100, top: 50, width: 300, height: 40 });
    layout.setRect(inputs[0], { left: 100, top: 52, width: 200, height: 36 });
    manager.init();

    expect(manager.anchorsToInputRight(inputs[0])).toBe(false);

    // 页面收敛为贴合 input 的窄盒：锚点应翻回 input 右缘
    layout.setRect(parent, { left: 100, top: 50, width: 202, height: 40 });
    expect(manager.anchorsToInputRight(inputs[0])).toBe(true);
  });

  it('未注入按钮的 input 保守返回 true（保留避让偏移）', () => {
    expect(manager.anchorsToInputRight(document.createElement('input'))).toBe(true);
  });
});
