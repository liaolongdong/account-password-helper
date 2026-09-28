/**
 * 填充入口失败反馈通道回归测试（quickFillHandler）
 *
 * 背景：`handleQuickFill` 与 `handleOpenInlineDropdown` 在拿不到活跃标签页时
 * 曾只 `logger.warn` 后静默返回，用户按下快捷键却零感知；而它们的其它所有失败
 * 分支都经 `notifyFailure`（桌面通知 + 工具栏角标）双通道反馈。
 *
 * 本测试锁定：
 * 1. no-tab 早退分支同样触发 notifyFailure（修复前静默返回）；
 * 2. `showPageNotice` 只下发到顶层 frame，且 content script 不可达时不抛异常
 *    （页面内提示条是不依赖系统通知权限的兜底通道）；
 * 3. 通知 ID 按语义拆分：普通失败走通用 ID，「需解锁」走专用 ID，
 *    使 `notifications.onClicked` 能区分并直达主密码验证页。
 *
 * 反向验证——移除上述任一实现后，对应断言必然失败。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  handleQuickFill,
  notifyFailure,
  showPageNotice,
  UNLOCK_NOTIFICATION_ID,
} from '@/entrypoints/background/quickFillHandler';
import { handleOpenInlineDropdown } from '@/entrypoints/background/inlineDropdownHandler';
import { MessageType } from '@/utils/types';

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

describe('showPageNotice — 页面内提示条兜底通道', () => {
  /** 提示条只走 tabs.sendMessage，局部 spy 以免干扰其它用例的默认桩 */
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    sendSpy.mockRestore();
  });

  it('定向下发到顶层 frame（提示条不依赖系统通知权限）', async () => {
    await showPageNotice(7, '会话未验证');

    expect(sendSpy).toHaveBeenCalledWith(
      7,
      { type: MessageType.SHOW_PAGE_NOTICE, data: { message: '会话未验证', type: 'warning' } },
      { frameId: 0 },
    );
  });

  it('content script 未注入时静默降级，不抛异常影响后续通知与角标', async () => {
    sendSpy.mockRejectedValue(new Error('Could not establish connection.'));

    await expect(showPageNotice(7, '会话未验证')).resolves.toBeUndefined();
  });
});

describe('notifyFailure — 通知 ID 按语义拆分', () => {
  it('默认走「一键填充」通知 ID', async () => {
    await notifyFailure('bg.quickFill.noMatch');

    expect(notifyCreateSpy.mock.calls[0][0]).toBe('quick-fill');
  });

  it('需解锁反馈走专用 ID，供 notifications.onClicked 直达主密码验证页', async () => {
    await notifyFailure('bg.quickFill.sessionExpiredUnlock', 'cm.title', UNLOCK_NOTIFICATION_ID);

    expect(notifyCreateSpy.mock.calls[0][0]).toBe('unlock-required');
    const options = notifyCreateSpy.mock.calls[0][1] as chrome.notifications.NotificationOptions;
    expect(options.title).toBe('cm.title');
  });
});
