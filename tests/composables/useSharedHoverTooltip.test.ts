/** @vitest-environment jsdom */

/**
 * 共享悬浮提示排程器回归测试（composables/useSharedHoverTooltip.ts）
 *
 * 背景：管理页操作列原本每行创建 5 个 `el-tooltip` 实例（600 行 = 3000 个组件实例），
 * 实测占掉整表挂载耗时的四成（`docs/PERF_LARGE_VAULT_EVALUATION.md` 9.9）。
 * 改造后全表只有一个 `virtual-triggering` 的 tooltip 实例，隐藏与 `enterable` 仍由
 * Element Plus 自己负责（它的计时器在实例内部，逐字沿用原行为），本模块只补上
 * Element Plus 无法自己做的一件事：**把「悬停哪个元素」换成了 mouseenter 之后才设定的
 * 虚拟触发点，所以 400 毫秒的显示延迟必须由调用方计时**。
 *
 * 因此这里钉住的是等价性的三个要害：
 * 1. 到点前绝不改动 `triggerEl` / `content`（提前改会让仍显示的浮层跳到新按钮上换文案，
 *    而原实现是「旧的 200 毫秒后关、新的 400 毫秒后开」，中间有一段空白）；
 * 2. 提前离开就不显示（取消排程）；
 * 3. 不做任何「已经显示过就跳过」的短路——重复悬停必须照常排程，
 *    因为「200 毫秒内回到同一元素不闪烁」是靠 Element Plus 自己的计时器取消实现的。
 */
import { describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useSharedHoverTooltip } from '@/composables/useSharedHoverTooltip';

/** 构造一个带 data-tip 的操作按钮（真实形态：按钮内还有图标子节点） */
const buildButton = (tip: string) => {
  const btn = document.createElement('button');
  btn.dataset.tip = tip;
  btn.appendChild(document.createElement('i'));
  document.body.appendChild(btn);
  return btn;
};

/** 用真实节点伪造 mouseenter 事件（`currentTarget` 由 Vue 的 DOM 绑定给出） */
const enterEvent = (el: HTMLElement) => ({ type: 'mouseenter', currentTarget: el }) as unknown as MouseEvent;

/** 记录每次到点展示的上下文 */
const createPresenter = () => {
  const calls: Array<{ element: HTMLElement; content: string }> = [];
  return { calls, present: (ctx: { element: HTMLElement; content: string }) => void calls.push(ctx) };
};

describe('useSharedHoverTooltip 显示排程', () => {
  it('悬停满 400 毫秒才展示，元素与文案取自 data-tip', () => {
    vi.useFakeTimers();
    const btn = buildButton('复制');
    const { calls, present } = createPresenter();
    const tip = useSharedHoverTooltip({ present });

    tip.arm(enterEvent(btn));
    vi.advanceTimersByTime(399);
    expect(calls).toHaveLength(0);
    expect(tip.triggerEl.value).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].element).toBe(btn);
    expect(calls[0].content).toBe('复制');
    expect(tip.triggerEl.value).toBe(btn);
    expect(tip.content.value).toBe('复制');
  });

  it('400 毫秒内离开则本次悬停不展示', () => {
    vi.useFakeTimers();
    const btn = buildButton('编辑');
    const { calls, present } = createPresenter();
    const tip = useSharedHoverTooltip({ present });

    tip.arm(enterEvent(btn));
    vi.advanceTimersByTime(200);
    tip.cancel();
    vi.advanceTimersByTime(1000);

    expect(calls).toHaveLength(0);
  });

  it('换悬停另一个按钮时，到点前不动已有的触发点与文案', () => {
    vi.useFakeTimers();
    const a = buildButton('收藏');
    const b = buildButton('取消收藏');
    const presenter = createPresenter();
    const tip = useSharedHoverTooltip({ present: presenter.present });

    tip.arm(enterEvent(a));
    vi.advanceTimersByTime(400);
    expect(tip.content.value).toBe('收藏');

    tip.cancel();
    tip.arm(enterEvent(b));
    vi.advanceTimersByTime(399);
    expect(tip.triggerEl.value).toBe(a);
    expect(tip.content.value).toBe('收藏');

    vi.advanceTimersByTime(1);
    expect(tip.triggerEl.value).toBe(b);
    expect(tip.content.value).toBe('取消收藏');
  });

  it('重复悬停同一元素照常排程，不做「已显示过」短路', () => {
    vi.useFakeTimers();
    const btn = buildButton('删除');
    const presenter = createPresenter();
    const tip = useSharedHoverTooltip({ present: presenter.present });

    tip.arm(enterEvent(btn));
    vi.advanceTimersByTime(400);
    tip.cancel();
    tip.arm(enterEvent(btn));
    vi.advanceTimersByTime(400);

    expect(presenter.calls).toHaveLength(2);
  });

  it('快速划过多个按钮时只有最后一个会展示', () => {
    vi.useFakeTimers();
    const a = buildButton('A');
    const b = buildButton('B');
    const c = buildButton('C');
    const presenter = createPresenter();
    const tip = useSharedHoverTooltip({ present: presenter.present });

    tip.arm(enterEvent(a));
    tip.cancel();
    tip.arm(enterEvent(b));
    tip.cancel();
    tip.arm(enterEvent(c));
    vi.advanceTimersByTime(400);

    expect(presenter.calls).toHaveLength(1);
    expect(presenter.calls[0].content).toBe('C');
  });

  it('把事件对象透传给展示回调，供 el-tooltip 记录触发原因', () => {
    vi.useFakeTimers();
    const btn = buildButton('查看详情');
    const seen: unknown[] = [];
    const tip = useSharedHoverTooltip({
      present: ctx => void seen.push(ctx.event),
    });
    const event = enterEvent(btn);

    tip.arm(event);
    vi.advanceTimersByTime(400);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(event);
  });
});

describe('useSharedHoverTooltip 输入校验与配置', () => {
  it('data-tip 为空时不排程，避免弹空浮层', () => {
    vi.useFakeTimers();
    const empty = document.createElement('button');
    empty.dataset.tip = '   ';
    document.body.appendChild(empty);
    const presenter = createPresenter();
    const tip = useSharedHoverTooltip({ present: presenter.present });

    tip.arm(enterEvent(empty));
    vi.advanceTimersByTime(1000);

    expect(presenter.calls).toHaveLength(0);
  });

  it('currentTarget 不是元素时安全忽略', () => {
    vi.useFakeTimers();
    const presenter = createPresenter();
    const tip = useSharedHoverTooltip({ present: presenter.present });

    tip.arm({ currentTarget: null } as unknown as MouseEvent);
    tip.arm({ currentTarget: {} } as unknown as MouseEvent);
    vi.advanceTimersByTime(1000);

    expect(presenter.calls).toHaveLength(0);
  });

  it('可自定义属性名与延迟', () => {
    vi.useFakeTimers();
    const btn = document.createElement('button');
    btn.dataset.hint = '详情';
    document.body.appendChild(btn);
    const presenter = createPresenter();
    const tip = useSharedHoverTooltip({
      tipDataKey: 'hint',
      showAfter: 100,
      present: presenter.present,
    });

    tip.arm(enterEvent(btn));
    vi.advanceTimersByTime(99);
    expect(presenter.calls).toHaveLength(0);
    vi.advanceTimersByTime(1);

    expect(presenter.calls).toHaveLength(1);
    expect(presenter.calls[0].content).toBe('详情');
  });

  it('作用域销毁时清掉挂起的定时器', () => {
    vi.useFakeTimers();
    const btn = buildButton('复制');
    const presenter = createPresenter();
    const scope = effectScope();
    let tip!: ReturnType<typeof useSharedHoverTooltip>;

    scope.run(() => {
      tip = useSharedHoverTooltip({ present: presenter.present });
    });
    tip.arm(enterEvent(btn));
    scope.stop();
    vi.advanceTimersByTime(1000);

    expect(presenter.calls).toHaveLength(0);
  });
});
