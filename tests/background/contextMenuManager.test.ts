/**
 * 右键上下文菜单（contextMenuManager）回归测试
 *
 * 覆盖：纯函数条目解析（用户名/密码/无匹配/空值）、菜单结构契约（显式单父项）、
 * 点击分发（会话失效就地引导、生成强密码豁免会话门控、跨域 frame 门控、
 * content script 未注入降级、TOTP 动态码填充、打开侧边栏/管理页）、
 * 成功路径的角标反馈与元数据更新、失败路径的三层反馈与可点击解锁通知。
 */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { resolveContextMenuFill, setupContextMenu } from '@/entrypoints/background/contextMenuManager';

vi.mock('@/utils/i18n-lite', () => ({
  tl: vi.fn((key: string) => key),
  onLiteLocaleChanged: vi.fn(() => vi.fn()),
}));

vi.mock('@/entrypoints/background/quickFillHandler', () => ({
  notifyFailure: vi.fn(async () => {}),
  showBadgeFeedback: vi.fn(),
  showPageNotice: vi.fn(async () => {}),
  UNLOCK_NOTIFICATION_ID: 'unlock-required',
  extractHostname: vi.fn((url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }),
  extractPortFromUrl: vi.fn(() => undefined),
}));

vi.mock('@/entrypoints/background/inlineDropdownHandler', () => ({
  tryOpenInlineDropdown: vi.fn(async () => 'opened'),
}));

vi.mock('@/entrypoints/background/optionsPageManager', () => ({
  openOptionsPage: vi.fn(async () => {}),
}));

vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  openSidePanelAndRespond: vi.fn(),
}));

vi.mock('@/entrypoints/background/passwordCache', () => ({
  ensureCredentialAccessAfterStartupRelock: vi.fn(async () => true),
  getCachedPasswords: vi.fn(),
  getOrWarmCache: vi.fn(),
  sortMatchesForDomain: vi.fn(async (passwords: unknown[]) => passwords),
  getInlineTotpCode: vi.fn(),
  recordPendingTotpIfEligible: vi.fn(async () => {}),
}));

vi.mock('@/utils/sessionManager-storage', () => ({
  isSessionValid: vi.fn(async () => true),
  isSessionActiveSync: vi.fn(() => true),
}));

vi.mock('@/utils/frameFill', () => ({
  isFrameFillable: vi.fn(async () => true),
}));

vi.mock('@/utils/passwordGenerator', () => ({
  generatePassword: vi.fn(() => 'Gen@rated123'),
}));

vi.mock('@/utils/storage/passwordCrud', () => ({
  updatePasswordInSession: vi.fn(async () => {}),
}));

import { notifyFailure, showBadgeFeedback, showPageNotice } from '@/entrypoints/background/quickFillHandler';
import { tryOpenInlineDropdown } from '@/entrypoints/background/inlineDropdownHandler';
import { openOptionsPage } from '@/entrypoints/background/optionsPageManager';
import { openSidePanelAndRespond } from '@/entrypoints/background/sidePanelManager';
import {
  ensureCredentialAccessAfterStartupRelock,
  getCachedPasswords,
  sortMatchesForDomain,
  getInlineTotpCode,
  recordPendingTotpIfEligible,
} from '@/entrypoints/background/passwordCache';
import { isFrameFillable } from '@/utils/frameFill';
import { isSessionActiveSync, isSessionValid } from '@/utils/sessionManager-storage';
import { updatePasswordInSession } from '@/utils/storage/passwordCrud';
import { MessageType, type PasswordEntry } from '@/utils/types';

const mockedNotifyFailure = vi.mocked(notifyFailure);
const mockedBadge = vi.mocked(showBadgeFeedback);
const mockedPageNotice = vi.mocked(showPageNotice);
const mockedOpenInline = vi.mocked(tryOpenInlineDropdown);
const mockedSessionActive = vi.mocked(isSessionActiveSync);
const mockedSessionValid = vi.mocked(isSessionValid);
const mockedEnsure = vi.mocked(ensureCredentialAccessAfterStartupRelock);
const mockedCached = vi.mocked(getCachedPasswords);
const mockedSort = vi.mocked(sortMatchesForDomain);
const mockedTotp = vi.mocked(getInlineTotpCode);
const mockedPending = vi.mocked(recordPendingTotpIfEligible);
const mockedFrameFillable = vi.mocked(isFrameFillable);
const mockedUpdate = vi.mocked(updatePasswordInSession);
const mockedOpenSidePanel = vi.mocked(openSidePanelAndRespond);

const entryA = {
  id: 'entry-a',
  username: 'user-a',
  password: 'pass-a',
  url: 'example.com',
  tag: '',
  remark: '',
  totp: '',
  createTime: 1,
  updateTime: 1,
} as PasswordEntry;

const entryTotp = {
  ...entryA,
  id: 'entry-b',
  username: 'user-b',
  totp: 'otpauth://totp/x?secret=AAA',
} as PasswordEntry;

// fakeBrowser 可能未提供 sidePanel 桩；打开侧边栏处理函数对其做真值检查
if (!chrome.sidePanel) {
  Object.defineProperty(chrome, 'sidePanel', { value: {}, configurable: true });
}

/** 右键发生的标签页（常规顶层页面） */
const tab = { id: 1, url: 'https://example.com/login' } as chrome.tabs.Tab;

// fakeBrowser 未实现 chrome.contextMenus（create/removeAll/onClicked 均抛 not implemented），
// 注入内存桩：记录点击监听器与已创建菜单项，供断言使用
let clickListener: ((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => unknown) | undefined;
const createdMenuItems: chrome.contextMenus.CreateProperties[] = [];

beforeAll(() => {
  Object.defineProperty(chrome, 'contextMenus', {
    value: {
      onClicked: {
        addListener: vi.fn((listener: typeof clickListener) => {
          clickListener = listener;
        }),
      },
      create: vi.fn((item: chrome.contextMenus.CreateProperties, callback?: () => void) => {
        createdMenuItems.push(item);
        callback?.();
      }),
      removeAll: vi.fn((callback?: () => void) => {
        createdMenuItems.length = 0;
        callback?.();
      }),
    },
    configurable: true,
  });
});

/** 模块级幂等：确保 setupContextMenu 已执行并返回注册的点击监听器 */
const ensureClickListener = () => {
  if (!clickListener) setupContextMenu();
  return clickListener!;
};

/** 默认：会话有效 + 已认证缓存包含指定条目 */
const armHappyPath = (entries: PasswordEntry[]) => {
  mockedEnsure.mockResolvedValue(true);
  mockedCached.mockResolvedValue({ isAuthenticated: true, passwords: entries } as never);
  mockedSort.mockImplementation(async passwords => passwords as PasswordEntry[]);
  mockedFrameFillable.mockResolvedValue(true);
  mockedSessionActive.mockReturnValue(true);
  mockedSessionValid.mockResolvedValue(true);
  mockedOpenInline.mockResolvedValue('opened');
  sendMessageSpy.mockResolvedValue({ success: true } as never);
};

/** chrome.tabs.sendMessage  spies（fakeBrowser 桩非 vi.fn，需 spy 包装） */
let sendMessageSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  sendMessageSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue({ success: true } as never);
  armHappyPath([entryA]);
});

afterEach(() => {
  sendMessageSpy.mockRestore();
});

describe('菜单注册（结构契约）', () => {
  it('两个显式父项 + 4 个输入框填充项 + 2 个页面入口项，子项挂在父项下', async () => {
    ensureClickListener();
    await vi.waitFor(() => expect(createdMenuItems.length).toBe(8));
    const editable = createdMenuItems.filter(item => item.contexts?.includes('editable'));
    const page = createdMenuItems.filter(item => item.contexts?.includes('page'));
    expect(editable.map(item => item.id)).toEqual([
      'aph-cm-parent-fill',
      'aph-cm-fill-username',
      'aph-cm-fill-password',
      'aph-cm-fill-totp',
      'aph-cm-generate-password',
    ]);
    expect(page.map(item => item.id)).toEqual(['aph-cm-parent-page', 'aph-cm-open-sidepanel', 'aph-cm-open-options']);
    expect(createdMenuItems.every(item => typeof item.title === 'string' && item.title.length > 0)).toBe(true);
  });

  it('每个上下文只有一个顶级项（避开 Chrome 按扩展全名折叠），且父项先于子项创建', async () => {
    // 直接重建而非复用 ensureClickListener（监听器已存在时它会短路，断言的将是上一个用例的残留菜单）
    setupContextMenu();
    await vi.waitFor(() => expect(createdMenuItems.length).toBe(8));
    const topLevel = createdMenuItems.filter(item => item.parentId === undefined);
    expect(topLevel.map(item => item.id)).toEqual(['aph-cm-parent-fill', 'aph-cm-parent-page']);
    for (const item of createdMenuItems) {
      if (!item.parentId) continue;
      const parentIndex = createdMenuItems.findIndex(menu => menu.id === item.parentId);
      expect(parentIndex).toBeGreaterThanOrEqual(0);
      expect(parentIndex).toBeLessThan(createdMenuItems.indexOf(item));
    }
  });
});

describe('resolveContextMenuFill（已存条目与明文解析）', () => {
  it('username/password 取排序后首条（侧边栏展示顺序 = 最优匹配）', () => {
    const matched = [entryA, entryTotp];
    expect(resolveContextMenuFill(matched, 'username')).toEqual({ ok: true, entry: entryA, value: 'user-a' });
    expect(resolveContextMenuFill(matched, 'password')).toEqual({ ok: true, entry: entryA, value: 'pass-a' });
  });

  it('无匹配条目时返回 noMatch 文案 key', () => {
    expect(resolveContextMenuFill([], 'username')).toEqual({ ok: false, errorKey: 'bg.quickFill.noMatch' });
  });

  it('命中条目但目标字段为空时返回 fillFailed 文案 key', () => {
    const emptyUsername = { ...entryA, username: '' };
    expect(resolveContextMenuFill([emptyUsername], 'username')).toEqual({
      ok: false,
      errorKey: 'bg.quickFill.fillFailed',
    });
  });
});

describe('填充类菜单点击分发', () => {
  it('用户名填充：定向下发 CONTEXT_MENU_FILL 到右键 frame，仅角标反馈', async () => {
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-username', frameId: 2 } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        { type: MessageType.CONTEXT_MENU_FILL, data: { action: 'username', value: 'user-a' } },
        { frameId: 2 },
      ),
    );
    await vi.waitFor(() => expect(mockedBadge).toHaveBeenCalledWith(true));
    expect(mockedNotifyFailure).not.toHaveBeenCalled();
  });

  it('frameId 缺省时下发到顶层 frame', async () => {
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-password' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        { type: MessageType.CONTEXT_MENU_FILL, data: { action: 'password', value: 'pass-a' } },
        { frameId: 0 },
      ),
    );
  });

  it('启动重锁未通过：就地展开内联下拉锁定卡片，不下发明文也不弹通知', async () => {
    mockedEnsure.mockResolvedValue(false);
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-username', frameId: 2 } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(mockedOpenInline).toHaveBeenCalledWith(1, { useContextMenuTarget: true, frameId: 2 }),
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(mockedNotifyFailure).not.toHaveBeenCalled();
  });

  it('会话失效（异步校验也不通过）同样走就地引导，锚定参数携带右键 frame', async () => {
    mockedSessionActive.mockReturnValue(false);
    mockedSessionValid.mockResolvedValue(false);
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-password' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(mockedOpenInline).toHaveBeenCalledWith(1, { useContextMenuTarget: true, frameId: undefined }),
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(mockedNotifyFailure).not.toHaveBeenCalled();
  });

  it('面板无法展开（无登录字段）时回退三层反馈：页面提示条 + 可点击解锁通知 + 失败角标', async () => {
    mockedSessionActive.mockReturnValue(false);
    mockedSessionValid.mockResolvedValue(false);
    mockedOpenInline.mockResolvedValue('noLoginField');
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-username' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() => expect(mockedPageNotice).toHaveBeenCalledWith(1, 'bg.quickFill.sessionExpiredUnlock'));
    await vi.waitFor(() =>
      expect(mockedNotifyFailure).toHaveBeenCalledWith(
        'bg.quickFill.sessionExpiredUnlock',
        'cm.title',
        'unlock-required',
      ),
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('旧标签页未注入 content script 时按「刷新页面」指引反馈，不误导用户去验证主密码', async () => {
    mockedSessionActive.mockReturnValue(false);
    mockedSessionValid.mockResolvedValue(false);
    mockedOpenInline.mockResolvedValue('pageNotReady');
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-username' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(mockedNotifyFailure).toHaveBeenCalledWith('bg.quickFill.pageNotReady', 'cm.title', undefined),
    );
    expect(mockedPageNotice).toHaveBeenCalledWith(1, 'bg.quickFill.pageNotReady');
  });

  it('生成强密码豁免会话门控：锁定态下仍下发随机密码，不读缓存也不展开解锁面板', async () => {
    mockedEnsure.mockResolvedValue(false);
    mockedSessionActive.mockReturnValue(false);
    mockedSessionValid.mockResolvedValue(false);
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-generate-password' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        { type: MessageType.CONTEXT_MENU_FILL, data: { action: 'generate', value: 'Gen@rated123' } },
        { frameId: 0 },
      ),
    );
    expect(mockedCached).not.toHaveBeenCalled();
    expect(mockedOpenInline).not.toHaveBeenCalled();
    expect(mockedNotifyFailure).not.toHaveBeenCalled();
    // 生成值不属于任何条目：不记录接力标记、不更新最近使用时间
    expect(mockedPending).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('跨域 frame 门控拒绝时提示且不下发明文', async () => {
    mockedFrameFillable.mockResolvedValue(false);
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-username', frameId: 3 } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(mockedNotifyFailure).toHaveBeenCalledWith('cm.frameNotFillable', 'cm.title', undefined),
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('无匹配条目时提示 noMatch，并同时走页面内提示条兜底', async () => {
    armHappyPath([]);
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-password' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(mockedNotifyFailure).toHaveBeenCalledWith('bg.quickFill.noMatch', 'cm.title', undefined),
    );
    expect(mockedPageNotice).toHaveBeenCalledWith(1, 'bg.quickFill.noMatch');
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('content script 未注入（Receiving end does not exist）时引导刷新页面', async () => {
    sendMessageSpy.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-username' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(mockedNotifyFailure).toHaveBeenCalledWith('bg.quickFill.pageNotReady', 'cm.title', undefined),
    );
  });

  it('content 端返回失败时透传其失败原因', async () => {
    sendMessageSpy.mockResolvedValue({ success: false, message: 'cs.cm.noTarget' } as never);
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-username' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() => expect(mockedNotifyFailure).toHaveBeenCalledWith('cs.cm.noTarget', 'cm.title', undefined));
  });

  it('TOTP 填充：取首个配置两步验证的条目并下发动态码，不记录接力标记', async () => {
    armHappyPath([entryA, entryTotp]);
    mockedTotp.mockResolvedValue({ code: '123456', expiresAt: Date.now() + 30000 } as never);
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-totp' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        { type: MessageType.CONTEXT_MENU_FILL, data: { action: 'totp', value: '123456' } },
        { frameId: 0 },
      ),
    );
    expect(mockedTotp).toHaveBeenCalledWith('entry-b');
    expect(mockedPending).not.toHaveBeenCalled();
  });

  it('TOTP 填充：匹配条目均未配置两步验证时提示专用文案', async () => {
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-totp' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() => expect(mockedNotifyFailure).toHaveBeenCalledWith('cm.noTotpEntry', 'cm.title', undefined));
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('账密填充成功且条目配置 2FA 时记录待接力标记并更新最近使用时间', async () => {
    armHappyPath([entryTotp]);
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-fill-username' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() => expect(mockedPending).toHaveBeenCalledWith(1, 'entry-b'));
    await vi.waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    const [entryId, patch] = mockedUpdate.mock.calls[0];
    expect(entryId).toBe('entry-b');
    expect(patch).toHaveProperty('lastUsedAt');
  });
});

describe('页面类菜单点击分发', () => {
  it('打开侧边栏：以 context 触发源复用既有打开路径', async () => {
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-open-sidepanel' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() =>
      expect(openSidePanelAndRespond).toHaveBeenCalledWith(1, expect.any(Function), { trigger: 'context' }),
    );
  });

  it('打开密码管理页：复用单实例打开路径', async () => {
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-open-options' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledTimes(1));
  });

  it('打开侧边栏失败时经通知反馈，不静默吞掉', async () => {
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-open-sidepanel' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() => expect(mockedOpenSidePanel).toHaveBeenCalledTimes(1));
    const sendResponse = mockedOpenSidePanel.mock.calls[0][1];
    sendResponse({ success: false, error: 'User gesture is required to show side panel' });

    await vi.waitFor(() =>
      expect(mockedNotifyFailure).toHaveBeenCalledWith('cm.openSidepanelFailed', 'cm.title', undefined),
    );
  });

  it('打开侧边栏成功时不触发失败通知', async () => {
    const listener = ensureClickListener();
    listener({ menuItemId: 'aph-cm-open-sidepanel' } as chrome.contextMenus.OnClickData, tab);

    await vi.waitFor(() => expect(mockedOpenSidePanel).toHaveBeenCalledTimes(1));
    mockedOpenSidePanel.mock.calls[0][1]({ success: true });

    await vi.waitFor(() => expect(mockedOpenSidePanel).toHaveBeenCalledTimes(1));
    expect(mockedNotifyFailure).not.toHaveBeenCalled();
  });

  it('无 sidePanel API 的环境（如 Firefox）不注册「打开侧边栏」子项（父页项仍保留）', async () => {
    ensureClickListener();
    Object.defineProperty(chrome, 'sidePanel', { value: undefined, configurable: true });
    try {
      setupContextMenu();
      await vi.waitFor(() => expect(createdMenuItems.length).toBe(7));
      expect(createdMenuItems.some(item => item.id === 'aph-cm-open-sidepanel')).toBe(false);
      expect(createdMenuItems.some(item => item.id === 'aph-cm-open-options')).toBe(true);
      expect(createdMenuItems.some(item => item.id === 'aph-cm-parent-page')).toBe(true);
    } finally {
      // 恢复 sidePanel 桩与 8 项菜单，避免影响后续用例
      Object.defineProperty(chrome, 'sidePanel', { value: {}, configurable: true });
      setupContextMenu();
      await vi.waitFor(() => expect(createdMenuItems.length).toBe(8));
    }
  });
});
