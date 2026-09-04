/**
 * 快捷键填充入口「无活跃标签页」失败反馈回归测试
 *
 * 背景：`handleQuickFill` 与 `handleOpenInlineDropdown` 在拿不到活跃标签页时
 * 曾只 `logger.warn` 后静默返回，用户按下快捷键却零感知；而它们的其它所有失败
 * 分支都经 `notifyFailure`（桌面通知 + 工具栏角标）双通道反馈。
 *
 * 本测试锁定修复后行为：no-tab 早退分支同样触发 notifyFailure。
 * 反向验证——移除修复（notifyFailure 调用）后这两个断言必然失败。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { handleQuickFill } from '@/entrypoints/background/quickFillHandler';
import { handleOpenInlineDropdown } from '@/entrypoints/background/inlineDropdownHandler';

vi.mock('@/utils/i18n-lite', () => ({
  tl: vi.fn((key: string) => key),
}));

vi.mock('@/utils/sessionManager-storage', () => ({
  isSessionValid: vi.fn(async () => true),
  isSessionActiveSync: vi.fn(() => true),
}));

vi.mock('@/utils/frameFill', () => ({
  getFillableFrameIds: vi.fn(async () => [0]),
  fillPasswordInFrames: vi.fn(async () => ({ success: true })),
  isFrameFillable: vi.fn(async () => true),
}));

vi.mock('@/entrypoints/background/passwordCache', () => ({
  ensureCredentialAccessAfterStartupRelock: vi.fn(async () => true),
  getCachedPasswords: vi.fn(async () => null),
  getOrWarmCache: vi.fn(async () => null),
  sortMatchesForDomain: vi.fn(async () => []),
  recordPendingTotpIfEligible: vi.fn(async () => {}),
  getInlineTotpCode: vi.fn(async () => null),
}));

// fakeBrowser 桩非 vi.fn，需 spy 包装；默认值统一放 beforeEach（见项目测试经验）
let querySpy: ReturnType<typeof vi.spyOn>;
let notifyCreateSpy: ReturnType<typeof vi.spyOn>;
let badgeTextSpy: ReturnType<typeof vi.spyOn>;
let badgeSetSpy: ReturnType<typeof vi.spyOn>;
let badgeColorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // 无活跃标签页：query 返回空数组 → getActiveTab() 得到 null → 触发 !tab?.id 早退分支
  querySpy = vi.spyOn(chrome.tabs, 'query').mockResolvedValue([] as never);
  notifyCreateSpy = vi.spyOn(chrome.notifications, 'create').mockResolvedValue('' as never);
  badgeTextSpy = vi.spyOn(chrome.action, 'getBadgeText').mockResolvedValue('' as never);
  badgeSetSpy = vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined as never);
  badgeColorSpy = vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined as never);
});

afterEach(() => {
  querySpy.mockRestore();
  notifyCreateSpy.mockRestore();
  badgeTextSpy.mockRestore();
  badgeSetSpy.mockRestore();
  badgeColorSpy.mockRestore();
});

describe('handleQuickFill — 无活跃标签页', () => {
  it('经桌面通知反馈失败（修复前静默返回，不创建通知）', async () => {
    await handleQuickFill();

    expect(notifyCreateSpy).toHaveBeenCalledTimes(1);
    const options = notifyCreateSpy.mock.calls[0][1] as chrome.notifications.NotificationOptions;
    expect(options.message).toBe('bg.quickFill.noUrl');
    expect(options.title).toBe('bg.quickFill.title');
  });

  it('经失败角标（! 红色）双通道反馈', async () => {
    await handleQuickFill();

    // showBadgeFeedback 以 void 触发、与通知并发，用 waitFor 消除微任务竞态
    await vi.waitFor(() => expect(badgeSetSpy).toHaveBeenCalledWith({ text: '!' }));
    expect(badgeColorSpy).toHaveBeenCalledWith({ color: '#f56c6c' });
  });
});

describe('handleOpenInlineDropdown — 无活跃标签页', () => {
  it('经桌面通知反馈失败，标题为「内联填充」', async () => {
    await handleOpenInlineDropdown();

    expect(notifyCreateSpy).toHaveBeenCalledTimes(1);
    const options = notifyCreateSpy.mock.calls[0][1] as chrome.notifications.NotificationOptions;
    expect(options.message).toBe('bg.quickFill.noUrl');
    expect(options.title).toBe('bg.inline.title');
  });
});
