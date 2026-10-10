/** @vitest-environment jsdom */
/**
 * 捕获链的标签预填接线测试
 *
 * `deriveCapturedTag` 的收敛规则由 `tests/utils/capturedTag.test.ts` 完整覆盖，本文件只管一件事：
 * 凭证捕获入口把 `document.title` 交给它清洗，而不是像历史行为那样整串塞进弹窗预填。
 * 这条接线纯函数测试抓不到——写错成 `document.title` 依然全绿，所以在此按真实调用链断言。
 *
 * 白盒调用私有方法 `onCredentialsCaptured`（同 loginAutoSave.pendingStorage.test.ts 的取舍），
 * 因为要看的是「弹窗收到的那串标签」，而不是弹窗自身的渲染。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '@/utils/types';
import type { SavePromptData } from '@/entrypoints/content/types';

/** 弹窗渲染入口的调用记录（返回空 controls：没有捕获到密码字段时 setupFieldSync 直接早退） */
const promptSpy = vi.hoisted(() => vi.fn<(data: SavePromptData) => Record<string, unknown>>(() => ({})));

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

/** 被测模块的白盒视图 */
interface CaptureInternals {
  configLoaded: boolean;
  onCredentialsCaptured(username: string, password: string): Promise<void>;
}

interface LoginAutoSaveModule {
  LoginAutoSave: new () => CaptureInternals;
}

/** 重新导入模块并构造已加载配置的实例（隔离模块级密钥状态） */
const createReadyInstance = async (): Promise<CaptureInternals> => {
  vi.resetModules();
  const mod = (await import('@/entrypoints/content/LoginAutoSave')) as unknown as LoginAutoSaveModule;
  const instance = new mod.LoginAutoSave();
  instance.configLoaded = true;
  return instance;
};

/** 弹窗拿到的预填标签 */
const promptedTag = (): string => promptSpy.mock.calls[0][0].tag;

describe('捕获链的标签预填', () => {
  beforeEach(() => {
    promptSpy.mockClear();
    sessionStorage.clear();
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((message: unknown) => {
      const type = (message as { type?: MessageType })?.type;
      if (type === MessageType.CHECK_CREDENTIAL_STATUS) return Promise.resolve({ status: 'new' });
      // 密钥申请按「后台拒发」处理：本文件不关心页面存储，只关心弹窗入参
      return Promise.resolve({ key: null });
    }) as never;
  });

  it('标题里的站点名被用作预填，而不是整串页面标题', async () => {
    document.title = 'Sign in to GitHub · GitHub';
    const instance = await createReadyInstance();

    await instance.onCredentialsCaptured('alice@example.com', 'S3cr3t!Passw0rd');

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptedTag()).toBe('GitHub');
  });

  it('整串标题长到收敛不出短名时预填空值，不再把一个存不回去的长串塞进标签', async () => {
    document.title = '这是一条超过三十个字符的页面标题用来验证收敛失败时不预填的行为';
    const instance = await createReadyInstance();

    await instance.onCredentialsCaptured('alice@example.com', 'S3cr3t!Passw0rd');

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptedTag()).toBe('');
  });

  it('标题本身就是短站点名时预填保持原样（短标题链路不回退）', async () => {
    document.title = 'GitHub';
    const instance = await createReadyInstance();

    await instance.onCredentialsCaptured('alice@example.com', 'S3cr3t!Passw0rd');

    expect(promptedTag()).toBe('GitHub');
  });
});
