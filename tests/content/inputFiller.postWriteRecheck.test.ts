/** @vitest-environment jsdom */
/**
 * 填充回执的写后复检（把「进得去」和「留得住」分开判）
 *
 * 三条策略各自的回读只等 50ms，而站点的异步改写大多发生得更晚：受控组件在自己的
 * rAF / 防抖窗口里把 DOM 值改回受控状态，掩码框在失焦后重排格式，校验脚本清空它认为
 * 不合法的值。于是旧实现在这些页面上给出 `verified: true`，用户读到「已填充」却面对一个
 * 空框——而自动提交只看 `filled`，空表单就这么交了上去。
 *
 * 本文件钉住修法与它的边界：
 * 1. 首读相等**再等一次复检**，复检不等才继续下一条策略——不提前返回，也不新增
 *    「值被抹掉却回执已填充」；`filled` 仍由末尾分支按当场读数计算，所以自动提交那道门
 *    既不会因此关掉，也不会被撑开。
 * 2. 首读就不等的情况**不排队复检**（第三条用例按时序钉住），健康页面的代价只有
 *    判定窗口从 50ms 变成 150ms。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputFiller } from '@/entrypoints/content/InputFiller';
import type { InputFillResult } from '@/entrypoints/content/types';

/** 复检窗口结束时刻：首次回读 50ms + 复检 100ms */
const RECHECK_DONE_AT = 150;

describe('填充回执的写后复检', () => {
  let input: HTMLInputElement;

  /**
   * 装一个「站点稍后把值改走」的脚本
   *
   * 挂在 `input` 事件上而不是定时器里，是为了让每条策略的写入都各自触发一次改写——
   * 真实受控组件就是这个形状：它不关心谁写的，只在自己的节拍里回到受控值。
   * @param delayMs - 从写入到改写之间的毫秒数
   */
  const siteRevertsAfter = (delayMs: number, nextValue = ''): void => {
    input.addEventListener('input', () => {
      setTimeout(() => {
        input.value = nextValue;
      }, delayMs);
    });
  };

  /** 跑完整条策略级联并返回结果（虚拟时间由测试自己推进） */
  const runCascade = async (value: string): Promise<InputFillResult> => {
    const filler = new InputFiller();
    let result: InputFillResult | undefined;
    const pending = filler.setInputValueWithStrategies(input, value).then(r => {
      result = r;
    });
    await vi.runAllTimersAsync();
    await pending;
    return result as InputFillResult;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom 不实现 execCommand，而原生策略要调它做清除；桩成 no-op 让策略 1 走完整分支
    (document as any).execCommand = vi.fn(() => true);
    input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('站点在复检窗口把值抹掉时不再判 verified，且 filled 如实为 false', async () => {
    // 80ms 改写：落在首次回读（50ms）之后、复检（150ms）之前——正是旧实现看不见的那一类
    siteRevertsAfter(80);

    const result = await runCascade('s3cret');

    expect(result.verified).toBe(false);
    // 级联照旧走完，末尾分支按当场读数判定：框被清空，所以没有任何东西落地
    expect(result.filled).toBe(false);
    expect(input.value).toBe('');
  });

  it('值留得住时只多花一个复检窗口，策略与结果档不变', async () => {
    const filler = new InputFiller();
    let result: InputFillResult | undefined;
    const pending = filler.setInputValueWithStrategies(input, 's3cret').then(r => {
      result = r;
    });

    // 50ms 首读已经相等，但结论要等复检落定
    await vi.advanceTimersByTimeAsync(RECHECK_DONE_AT - 1);
    expect(result).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(result).toEqual({ filled: true, verified: true, strategy: 'native' });
  });

  it('首次回读就不等时不排队复检，立刻进下一条策略', async () => {
    // 20ms 改写：50ms 首读时值已经没了，此时没有任何「先确认一下再往下试」的余地
    siteRevertsAfter(20);
    const execCommand = (document as any).execCommand as ReturnType<typeof vi.fn>;

    const filler = new InputFiller();
    const pending = filler.setInputValueWithStrategies(input, 's3cret');

    // 策略 2 的 execCommand 发生在 50ms 而不是 150ms，证明复检定时器根本没被排上
    await vi.advanceTimersByTimeAsync(60);
    expect(execCommand).toHaveBeenCalledWith('insertText', false, 's3cret');

    await vi.runAllTimersAsync();
    await pending;
  });

  it('复检比的是全等而不是非空：框里留着另一种写法也不算核验通过', async () => {
    // 站点把我们写的号码重排成带分隔符的格式——值非空，但条目里那个值并没有真的留在框里
    siteRevertsAfter(80, '138-0000-0000');

    const filler = new InputFiller();
    let result: InputFillResult | undefined;
    const pending = filler.setInputValueWithStrategies(input, '13800000000').then(r => {
      result = r;
    });

    // 复检点（50 + 100）上框里是有内容的，所以「提前返回已填充」这一步必须没发生
    await vi.advanceTimersByTimeAsync(RECHECK_DONE_AT);
    expect(input.value).toBe('138-0000-0000');
    expect(result).toBeUndefined();

    await vi.runAllTimersAsync();
    await pending;
    expect(result?.verified).toBe(false);
  });
});
