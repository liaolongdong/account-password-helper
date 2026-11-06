/** @vitest-environment jsdom */
/**
 * 手机号登录的「跳转后复现弹窗」
 *
 * 国内 PC 站的短信登录常常是**整页跳转**（提交后换文档），而不是 XHR 原地登录。这条形态靠的是
 * 捕获时把待确认凭证加密暂存 sessionStorage、新文档加载时由 `checkPendingCredentials` 恢复弹窗。
 * 而恢复侧的校验此前写的是「必须有用户名和密码」——手机号形态的 `password` 合法为空串，
 * 于是刚写进去的凭证在新页面被当成脏数据静默删除，功能在最常见的那一种登录形态上不成立。
 * `entrypoints/content/types.ts` 里 `PendingCredentials.mobileLogin` 的注释承诺的正是这一位
 * 用来区分「合法空口令」与「脏数据」，代码必须兑现它。
 *
 * 白盒调用私有方法（同 `loginAutoSave.pendingStorage.test.ts` 的取舍）：要看的是恢复路径
 * 认不认这份凭证，而不是弹窗自身怎么渲染。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingCredentials } from '@/entrypoints/content/types';
import { MessageType } from '@/utils/types';

const PENDING_SAVE_KEY = '__aph_pending_save__';

/** 弹窗渲染入口的调用记录 */
const promptSpy = vi.hoisted(() =>
  vi.fn<(data: unknown) => Record<string, unknown>>(() => ({
    updateUsername: vi.fn(),
    updatePassword: vi.fn(),
  })),
);

vi.mock('@/entrypoints/content/SavePasswordPrompt', () => ({
  showSavePasswordPrompt: promptSpy,
  dismissSavePasswordPrompt: vi.fn(),
}));

vi.mock('@/entrypoints/content/NativeNotification', () => ({
  showNativeNotification: vi.fn(),
}));

vi.mock('@/utils/storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    StorageUtils: {
      ...actual.StorageUtils,
      isSessionValid: vi.fn(async () => true),
      isDomainMatchForAutoSave: vi.fn(() => true),
      getAutoSaveConfig: vi.fn(async () => ({ enabled: true, domainPatterns: [], excludedDomains: [] })),
    },
  };
});

/** 密钥申请正常签发（与真实实现同形：64 位 hex） */
const CIPHER_KEY = 'a'.repeat(64);

interface RestoreInternals {
  configLoaded: boolean;
  persistPending(pending: PendingCredentials): Promise<void>;
  checkPendingCredentials(): Promise<void>;
}

const createInstance = async (): Promise<RestoreInternals> => {
  vi.resetModules();
  const mod = (await import('@/entrypoints/content/LoginAutoSave')) as unknown as {
    LoginAutoSave: new () => RestoreInternals;
  };
  const instance = new mod.LoginAutoSave();
  instance.configLoaded = true;
  return instance;
};

const pendingOf = (overrides: Partial<PendingCredentials> = {}): PendingCredentials => ({
  username: '13800000000',
  password: '',
  url: location.host,
  tag: '',
  remark: '自动保存',
  tagEdited: false,
  remarkEdited: false,
  timestamp: Date.now(),
  mode: 'save',
  protocol: location.protocol,
  ...overrides,
});

const stubMessages = () =>
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((message: unknown) => {
    const type = (message as { type?: MessageType })?.type;
    if (type === MessageType.GET_PENDING_CIPHER_KEY) return Promise.resolve({ key: CIPHER_KEY });
    if (type === MessageType.CHECK_CREDENTIAL_STATUS) return Promise.resolve({ status: 'new' });
    return Promise.resolve({});
  }) as never);

beforeEach(() => {
  sessionStorage.clear();
  promptSpy.mockClear();
  stubMessages();
});

describe('手机号登录跨页导航后恢复保存弹窗', () => {
  it('声明了 mobileLogin 的空口令凭证要恢复并弹窗，而不是当脏数据删掉', async () => {
    const instance = await createInstance();
    await instance.persistPending(pendingOf({ mobileLogin: true }));
    // 前提：写入侧确实落了密文，否则「没弹窗」就成了环境造成的假绿
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeTruthy();

    await instance.checkPendingCredentials();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy.mock.calls[0][0]).toMatchObject({ username: '13800000000', password: '', mobileLogin: true });
  });

  it('没声明 mobileLogin 的空口令仍按脏数据清除：授权位不是「空口令一律合法」', async () => {
    const instance = await createInstance();
    await instance.persistPending(pendingOf());

    await instance.checkPendingCredentials();

    expect(promptSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
  });

  it('有口令的常规凭证照常恢复（新门禁不得挡掉老路径）', async () => {
    const instance = await createInstance();
    await instance.persistPending(pendingOf({ username: 'alice', password: 'S3cr3t!Passw0rd' }));

    await instance.checkPendingCredentials();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy.mock.calls[0][0]).toMatchObject({ username: 'alice', password: 'S3cr3t!Passw0rd' });
  });
});
