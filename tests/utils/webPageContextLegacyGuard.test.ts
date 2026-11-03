/**
 * 宿主页面上下文不得执行「会覆写认证材料」的迁移/升级 —— 回归测试
 *
 * `navigator.locks` 按调用上下文的 origin 分组：扩展的 SW / Options / Popup / SidePanel 同属扩展
 * origin，彼此互斥成立；而**内容脚本跑在宿主页面的 origin 上**，它在 `aph-vault-key-transition`
 * 这把锁上拿到的共享租约，挡不住扩展侧正在进行的独占换钥（见 `utils/storage/vaultWriteLock.ts`
 * 头注的作用域声明）。
 *
 * 这条边界曾经是真的漏洞：换钥事务（数秒、含多次 PBKDF2）期间，用户在任意网站聚焦一次登录框
 * 就会触发内容脚本的旧版会话迁移，而该路径上有两处整对象覆写——
 * 1. `migrateLegacySessionInternal` 发布会话密钥材料（`WRAP_KEY` / `WRAPPED_DATA_KEY`）；
 * 2. `verifyMasterPassword` 对 legacy 校验配置做透明升级写回 `master_password_config`。
 * 后者尤其致命：旧口令的校验哈希盖掉刚提交的新配置之后，旧密码「验得过」但整库已是新钥密文，
 * 且新恢复套件的 AAD 绑定的是被覆盖掉的那份 verifier，等于库与套件同时失效。
 *
 * 因此这两个动作改为只在扩展自身上下文执行；宿主页面上验证仍可通过、但不写回，
 * 迁移交由 SW 会话巡检或侧边栏/管理页任一次会话检查完成（那条路径与换钥共用同一把锁）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, SESSION_MEMORY_KEYS } from '@/utils/storageKeys';

let SESSION_KEYS: Record<string, string>;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  // 直接读写 `globalThis.window` 而不用 `vi.stubGlobal`：后者配 `unstubAllGlobals` 会把
  // WxtVitest 注入的 `chrome` 桩一起撤掉。扩展自身上下文即「没有 window」（MV3 SW 形态）。
  delete (globalThis as Record<string, unknown>).window;
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  const session = await import('@/utils/sessionManager-storage');
  SESSION_KEYS = session.SESSION_STORAGE_KEYS;
});

/** legacy 夹具：单轮 SHA-256 校验配置 + 被 salt 派生密钥包裹的主密码 blob + 未过期会话 */
const seedLegacySession = async (password: string): Promise<Record<string, unknown>> => {
  const { hashPassword } = await import('@/utils/crypto-light');
  const enc = await import('@/utils/encryption');
  const salt = 'legacy-fixture-salt';
  const masterConfig = { salt, hashedPassword: await hashPassword(password, salt) };
  await chrome.storage.local.set({
    [STORAGE_KEYS.MASTER_PASSWORD]: masterConfig,
    [SESSION_KEYS.MASTER_PASSWORD]: await enc.encryptData(password, await enc.deriveSessionKey(salt)),
    [SESSION_KEYS.PASSWORD_EXPIRY]: Date.now() + 60_000,
    [SESSION_KEYS.VALIDITY_HOURS]: 24,
  });
  return masterConfig;
};

/** 把当前上下文伪装成内容脚本所在的宿主页面（origin 为 https） */
const asWebPageContext = (): void => {
  (globalThis as Record<string, unknown>).window = { location: { protocol: 'https:' } };
};

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('旧版会话迁移的上下文门禁', () => {
  it('宿主页面上整体跳过：不发布会话密钥材料，也不覆写校验配置', async () => {
    const password = 'legacy-fixture';
    const masterConfig = await seedLegacySession(password);
    asWebPageContext();
    const session = await import('@/utils/sessionManager-storage');
    const before = await chrome.storage.local.get(null);

    expect(await session.isSessionValid({ skipConsistencyCheck: true })).toBe(false);

    const after = await chrome.storage.local.get(null);
    expect(after, '网页上下文不得写坏扩展侧的认证材料').toEqual(before);
    expect(after[SESSION_KEYS.WRAPPED_DATA_KEY]).toBeUndefined();
    expect(after[SESSION_KEYS.WRAP_KEY]).toBeUndefined();
    expect(after[STORAGE_KEYS.MASTER_PASSWORD]).toEqual(masterConfig);
    expect(
      (await chrome.storage.session.get(SESSION_MEMORY_KEYS.DATA_KEY))[SESSION_MEMORY_KEYS.DATA_KEY],
      '迁移被跳过时也不得把数据密钥放进 storage.session',
    ).toBeUndefined();
  });

  it('扩展自身上下文照旧完成迁移并升级为 PBKDF2 校验（正向对照，判据不是空跑）', async () => {
    const password = 'legacy-fixture';
    await seedLegacySession(password);
    const session = await import('@/utils/sessionManager-storage');

    expect(await session.isSessionValid({ skipConsistencyCheck: true })).toBe(true);

    const after = await chrome.storage.local.get(null);
    expect(after[SESSION_KEYS.WRAPPED_DATA_KEY]).toBeTypeOf('string');
    expect(after[STORAGE_KEYS.MASTER_PASSWORD]).toMatchObject({ kdf: 'pbkdf2-sha256' });
    expect(after[SESSION_KEYS.MASTER_PASSWORD], '迁移成功后旧版主密码 blob 应被清除').toBeUndefined();
  }, 30_000);
});

describe('校验哈希透明升级的上下文门禁', () => {
  it('宿主页面上验证仍返回 true，但不写回升级结果', async () => {
    const password = 'legacy-verifier-fixture';
    const { hashPassword } = await import('@/utils/crypto-light');
    const salt = 'verifier-fixture-salt';
    const legacyConfig = { salt, hashedPassword: await hashPassword(password, salt) };
    await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_PASSWORD]: legacyConfig });
    asWebPageContext();
    const master = await import('@/utils/storage/masterPassword');

    expect(await master.verifyMasterPassword(password)).toBe(true);
    expect(await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD)).toEqual({
      [STORAGE_KEYS.MASTER_PASSWORD]: legacyConfig,
    });
  });

  it('扩展自身上下文仍执行透明升级（正向对照）', async () => {
    const password = 'legacy-verifier-fixture';
    const { hashPassword } = await import('@/utils/crypto-light');
    const salt = 'verifier-fixture-salt';
    await chrome.storage.local.set({
      [STORAGE_KEYS.MASTER_PASSWORD]: { salt, hashedPassword: await hashPassword(password, salt) },
    });
    const master = await import('@/utils/storage/masterPassword');

    expect(await master.verifyMasterPassword(password)).toBe(true);

    const after = (await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD))[STORAGE_KEYS.MASTER_PASSWORD] as {
      kdf?: string;
      salt: string;
    };
    expect(after.kdf).toBe('pbkdf2-sha256');
    expect(after.salt, '升级必须沿用原 salt，否则存量用户永久解不开').toBe(salt);
  }, 30_000);
});

/**
 * 判定面本身：漏判一次，本文件上面那两条守卫就都白设
 *
 * `about:srcdoc` 是本机评审时发现的漏网——MV3 会把内容脚本按父页面的规则注进 srcdoc 框架，
 * 而它的 `location.protocol` 是 `about:`，不在协议清单里，于是被当成扩展自身上下文放行。
 * `about:blank` 必须继续判为扩展侧：MV3 SW 与测试夹具的空文档都长这样，判反会让该跑的迁移不跑。
 */
describe('isWebPageContext 的判定面', () => {
  const at = (href: string, protocol: string) => {
    (globalThis as Record<string, unknown>).window = { location: { href, protocol } };
  };

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it.each([
    ['https://evil.example/login', 'https:', true],
    ['http://localhost:8899/demo', 'http:', true],
    ['file:///Users/me/vault.html', 'file:', true],
    ['about:srcdoc', 'about:', true],
    ['chrome-extension://abc/options.html', 'chrome-extension:', false],
    ['about:blank', 'about:', false],
  ] as const)('%s → %s', (href, protocol, expected) => {
    at(href, protocol);
    return import('@/utils/runtimeContext').then(({ isWebPageContext }) => {
      expect(isWebPageContext(), `${href} 的归属判错`).toBe(expected);
    });
  });

  it('没有 window（MV3 Service Worker 形态）按扩展自身上下文处理', async () => {
    delete (globalThis as Record<string, unknown>).window;
    const { isWebPageContext } = await import('@/utils/runtimeContext');
    expect(isWebPageContext()).toBe(false);
  });
});
