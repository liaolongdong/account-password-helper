/**
 * 工具栏角标反馈的重入回归测试（quickFillHandler.showBadgeFeedback）
 *
 * 回归背景：角标是全局单例状态，实现方式「先快照既有角标 → 显示 ✓/! → 3s 后写回快照」。
 * 两次反馈在 3s 窗口内重叠时（连点快捷键、快捷键与右键菜单相继触发、成功紧接失败），
 * 后一次把前一次的临时角标（'✓'）当成持久角标快照，于是先到的定时器清空、
 * 后到的定时器又把 '✓' 永久写回图标——用户此后怎么看都以为「刚填充成功过」，
 * 而版本更新的持久 "new" 角标已被这次恢复覆盖掉（快照里已经没有它了）。
 * 另一个同源问题：后一次调用不会续期，前一个定时器会在 3s 到点时提前抹掉刚给出的反馈。
 *
 * 修复后：进入临时态时快照一次，重叠调用只续期不重新快照。
 *
 * 装置要点：角标必须做成**有状态**的桩——`getBadgeText` 返回最近一次 `setBadgeText` 写入的值。
 * 若按常规写法让它固定返回脚本值，第二次「快照」读到的仍是 'new'，重入 bug 在断言层面被抹平，
 * 测试会在有缺陷的实现上照样通过。
 *
 * 单独成文而非并入 `quickFillHandler.test.ts`：该文件的既有用例在真实定时器下触发角标，
 * 与本文件的假定时器混用会让前序用例遗留的 3s 定时器在断言中途回调；
 * 独立文件同时保证模块级角标状态从干净开始。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showBadgeFeedback } from '@/entrypoints/background/quickFillHandler';

vi.mock('@/utils/i18n-lite', () => ({
  tl: vi.fn((key: string) => key),
}));

vi.mock('@/utils/sessionManager-storage', () => ({
  isSessionValid: vi.fn(async () => true),
  isSessionActiveSync: vi.fn(() => true),
}));

vi.mock('@/entrypoints/background/passwordCache', () => ({
  ensureCredentialAccessAfterStartupRelock: vi.fn(async () => true),
  getCachedPasswords: vi.fn(async () => null),
  getOrWarmCache: vi.fn(async () => null),
  sortMatchesForDomain: vi.fn(async () => []),
  recordPendingTotpIfEligible: vi.fn(async () => {}),
  getInlineTotpCode: vi.fn(async () => null),
}));

/** 与实现中的 BADGE_CLEAR_DELAY_MS 一致 */
const CLEAR_DELAY_MS = 3000;

/** 当前图标上的角标文本（有状态桩的唯一事实来源） */
let badgeText = '';

let getBadgeTextSpy: ReturnType<typeof vi.spyOn>;
let setBadgeColorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  // 默认稳态：版本更新留下的持久 "new" 蓝底角标
  badgeText = 'new';
  getBadgeTextSpy = vi.spyOn(chrome.action, 'getBadgeText').mockImplementation(async () => badgeText);
  vi.spyOn(chrome.action, 'setBadgeText').mockImplementation(async (details: chrome.action.BadgeTextDetails) => {
    badgeText = details.text ?? '';
  });
  setBadgeColorSpy = vi
    .spyOn(chrome.action, 'setBadgeBackgroundColor')
    .mockImplementation(async () => undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('showBadgeFeedback 的角标反馈', () => {
  it('单次调用的既有语义不变：临时角标延时后还原持久角标与蓝底', async () => {
    await showBadgeFeedback(true);
    expect(badgeText).toBe('✓');
    expect(setBadgeColorSpy).toHaveBeenLastCalledWith({ color: '#67c23a' });

    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS);
    expect(badgeText).toBe('new');
    expect(setBadgeColorSpy).toHaveBeenLastCalledWith({ color: '#409eff' });
  });

  it('成功紧接失败时，最终还原的是进入临时态前的持久角标而不是上一次的 ✓', async () => {
    await showBadgeFeedback(true);
    await vi.advanceTimersByTimeAsync(1000);
    await showBadgeFeedback(false);
    expect(badgeText).toBe('!');

    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS);
    // 修复前：第二次调用把 '✓' 快照为「持久角标」，此处又被永久写回
    expect(badgeText).toBe('new');
    expect(getBadgeTextSpy).toHaveBeenCalledTimes(1);
  });

  it('临时角标的 3s 窗口以最后一次反馈为基准，不被前一个定时器提前抹掉', async () => {
    await showBadgeFeedback(true);
    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS - 500);
    await showBadgeFeedback(true);

    // 首个定时器到点，但用户 500ms 前才看到新反馈，角标必须仍在
    await vi.advanceTimersByTimeAsync(1000);
    expect(badgeText).toBe('✓');

    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS);
    expect(badgeText).toBe('new');
  });

  it('无持久角标时，重叠调用结束后回到空角标', async () => {
    badgeText = '';

    await showBadgeFeedback(false);
    await vi.advanceTimersByTimeAsync(500);
    await showBadgeFeedback(true);
    await vi.advanceTimersByTimeAsync(CLEAR_DELAY_MS);

    expect(badgeText).toBe('');
  });
});
