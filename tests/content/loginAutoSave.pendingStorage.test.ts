/** @vitest-environment jsdom */
/**
 * 待保存凭据的页面存储不变量回归测试
 *
 * S2 把解密密钥从宿主页面 sessionStorage 迁到 background 的 storage.session，页面侧只剩
 * 不可解的密文。真正的安全属性落在 `LoginAutoSave` 本身，因此这里盯住三条不可让的不变量：
 * 1. **拿不到密钥就不写** —— 绝不退回明文存储（后台不可达 / 上下文失效时最多放弃「跳转后复现」）。
 * 2. **失败可重试** —— 后台不可达是瞬态条件，一次失败钉死null会让整个文档永久失去该能力（旧实现无此失败模式）。
 * 3. **清除必定落在写入之后** —— 密钥往返引入 await 后，在途写入不得复活已清除的容器。
 *
 * 白盒调用私有方法（同 tests/content/passwordVisibilityToggle.lifecycle.test.ts），
 * 因为这三条都是「写入路径」的契约，与捕获触发方式无关。
 * 每个用例前 `vi.resetModules()` 重新导入：密钥 Promise 与重试预算是模块级状态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingCredentials } from '@/entrypoints/content/types';
import { MessageType } from '@/utils/types';

/** 与 entrypoints/content/LoginAutoSave.ts 内部常量一致 */
const PENDING_SAVE_KEY = '__aph_pending_save__';
/** 升级前遗留的页面内密钥 key */
const LEGACY_PAGE_CIPHER_KEY = '__aph_sk__';

vi.mock('@/utils/storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/storage')>();
  return {
    ...actual,
    StorageUtils: {
      ...actual.StorageUtils,
      getAutoSaveConfig: vi.fn(async () => ({ enabled: false, domainPatterns: [], excludedDomains: [] })),
      isSessionValid: vi.fn(async () => false),
    },
  };
});

/** 被测模块的白盒视图 */
interface PendingInternals {
  persistPending(pending: PendingCredentials): Promise<void>;
  syncPendingToSession(password?: string, username?: string): Promise<void>;
  clearPending(): void;
}

interface LoginAutoSaveModule {
  LoginAutoSave: new () => PendingInternals;
}

const SECRET = 'S3cr3t!Passw0rd';

/** 重新导入模块并构造实例（隔离模块级密钥状态） */
const createInstance = async (): Promise<PendingInternals> => {
  vi.resetModules();
  const mod = (await import('@/entrypoints/content/LoginAutoSave')) as unknown as LoginAutoSaveModule;
  return new mod.LoginAutoSave();
};

const pendingOf = (overrides: Partial<PendingCredentials> = {}): PendingCredentials => ({
  username: 'alice@example.com',
  password: SECRET,
  url: location.host,
  tag: 'Example',
  remark: 'auto saved',
  tagEdited: false,
  remarkEdited: false,
  timestamp: Date.now(),
  mode: 'save',
  ...overrides,
});

/** 屏蔽 fakeBrowser 无监听者的 reject，由用例决定签发结果 */
const stubSendMessage = (impl: () => unknown) =>
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(impl as never);

const isBase64 = (value: string): boolean => /^[A-Za-z0-9+/]+={0,2}$/.test(value);

describe('待保存凭据的页面存储不变量', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('不变量1：background 拒发密钥时页面存储保持为空', async () => {
    const instance = await createInstance();
    const sendMessage = stubSendMessage(() => Promise.resolve({ key: null }));

    await instance.persistPending(pendingOf());

    expect(sendMessage).toHaveBeenCalledWith({ type: MessageType.GET_PENDING_CIPHER_KEY });
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
  });

  it('不变量2：一次申请失败不钉死后续写入（失败结果不入缓存）', async () => {
    const instance = await createInstance();
    let attempt = 0;
    stubSendMessage(() => {
      attempt++;
      return attempt === 1
        ? Promise.reject(new Error('Could not establish connection'))
        : Promise.resolve({ key: 'a'.repeat(64) });
    });

    await instance.persistPending(pendingOf());
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();

    await instance.persistPending(pendingOf());
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeTruthy();
    expect(attempt).toBe(2);
  });

  it('不变量2b：重试有预算上限，不会退化成逐次击键的跨进程申请', async () => {
    const instance = await createInstance();
    const sendMessage = stubSendMessage(() => Promise.resolve({ key: null }));

    for (let i = 0; i < 10; i++) {
      await instance.persistPending(pendingOf());
    }

    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('不变量3：写入在途期间被 clearPending 取代后，容器保持为空', async () => {
    const instance = await createInstance();
    const spy = stubSendMessage(() => Promise.resolve({ key: 'b'.repeat(64) }));

    // persistPending 同步领取代数后在 await 处让出微任务，因此这里的清除必然落在写入之前
    const write = instance.persistPending(pendingOf());
    instance.clearPending();
    await write;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
  });

  it('拿到密钥时只落不可解的 base64 密文，明文与密钥都不进页面可达存储', async () => {
    const instance = await createInstance();
    const key = 'c'.repeat(64);
    stubSendMessage(() => Promise.resolve({ key }));

    await instance.persistPending(pendingOf());

    const stored = sessionStorage.getItem(PENDING_SAVE_KEY);
    expect(stored).toBeTruthy();
    expect(isBase64(stored!)).toBe(true);
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain('alice@example.com');
    expect(sessionStorage.getItem(LEGACY_PAGE_CIPHER_KEY)).toBeNull();
    // 页面侧仅剩「一次读取即可还原」不成立的密文：还原必须依赖 background 侧的密钥
    const pageKeys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    expect(pageKeys).toEqual([PENDING_SAVE_KEY]);
  });

  it('容器不存在时同步击键不申请密钥（避免高频跨进程往返）', async () => {
    const instance = await createInstance();
    const sendMessage = stubSendMessage(() => Promise.resolve({ key: 'd'.repeat(64) }));

    await instance.syncPendingToSession('new-password');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_SAVE_KEY)).toBeNull();
  });

  it('init 清除升级前残留在页面的旧密钥', async () => {
    sessionStorage.setItem(LEGACY_PAGE_CIPHER_KEY, 'e'.repeat(64));

    await createInstance();
    await Promise.resolve();

    expect(sessionStorage.getItem(LEGACY_PAGE_CIPHER_KEY)).toBeNull();
  });
});
