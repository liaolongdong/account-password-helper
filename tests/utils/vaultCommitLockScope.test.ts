/**
 * 跨上下文提交锁的临界区必须只包住「重读 + 合并 + 落盘」（评审 2026-11-02 P1）
 *
 * `aph-vault-commit` 是**全局唯一**一把排他锁：密码库、身份库、两个回收站的整包写共用它。
 * 身份域原先把 `resolveDataKey`（锁定态是两次 600k 迭代的 PBKDF2）和逐条 `encryptData`
 * 整段放进锁里——一次锁定态保存身份 ≈ 秒级独占，期间另一个上下文的「保存密码」无声排队，
 * 而 `navigator.locks` 的等待没有超时，用户只看到转圈。
 * 密码域刻意是反的（`commitPasswordRows` 只包「重读 + 合并 + 单次 set」），本用例把两域对齐。
 *
 * 判据用真 `navigator.locks` 观测，不依赖任何锁桩：在派生/加密发生的那一刻问一句
 * 「提交锁是否被人持着」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { IdentityPayload, IdentityRecord } from '@/utils/identity/types';
import { hasRealWebLocks, isVaultCommitLockHeld } from '@/tests/helpers/vaultLockProbe';

const { encryptData, decryptData, deriveEncryptionKey, verifyMasterPassword } = vi.hoisted(() => ({
  encryptData: vi.fn<(data: string, key: string) => Promise<string>>(),
  decryptData: vi.fn<(data: string, key: string) => Promise<string>>(),
  deriveEncryptionKey: vi.fn<(password: string) => Promise<string>>(),
  verifyMasterPassword: vi.fn<(password: string) => Promise<boolean>>(),
}));

/** 每次调用发生时「提交锁是否正被持有」的观测序列。 */
const heldAt = vi.hoisted(() => ({ derive: [] as boolean[], verify: [] as boolean[], encrypt: [] as boolean[] }));

vi.mock('@/utils/encryption', () => ({
  encryptData: async (data: string, key: string) => {
    heldAt.encrypt.push(await isVaultCommitLockHeld());
    return encryptData(data, key);
  },
  decryptData,
  deriveEncryptionKey: async (password: string) => {
    heldAt.derive.push(await isVaultCommitLockHeld());
    return deriveEncryptionKey(password);
  },
  deriveVerifierHash: vi.fn(async (password: string) => `verifier:${password}`),
}));

vi.mock('@/utils/storage/masterPassword', () => ({
  verifyMasterPassword: async (password: string) => {
    heldAt.verify.push(await isVaultCommitLockHeld());
    return verifyMasterPassword(password);
  },
  getMasterPasswordConfig: vi.fn(async () => null),
}));

const { getSessionDataKey } = vi.hoisted(() => ({
  getSessionDataKey: vi.fn<(forceFresh?: boolean) => Promise<string | null>>(),
}));

vi.mock('@/utils/storage/facades', () => ({ getSessionDataKey }));

let store: Record<string, unknown>;

const identityRow = (id: string, updateTime: number): IdentityRecord =>
  ({ id, encryptedPayload: `cipher-${id}`, createTime: 1, updateTime }) as IdentityRecord;

const payload = (name: string): IdentityPayload => ({ name, phone: '13800000000' }) as IdentityPayload;

beforeEach(() => {
  vi.clearAllMocks();
  heldAt.derive = [];
  heldAt.verify = [];
  heldAt.encrypt = [];

  store = { [STORAGE_KEYS.IDENTITY]: [identityRow('a', 100)] };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const found: Record<string, unknown> = {};
          for (const key of list) if (key in store) found[key] = store[key];
          return found;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
  });

  verifyMasterPassword.mockResolvedValue(true);
  deriveEncryptionKey.mockResolvedValue('derived-key');
  getSessionDataKey.mockResolvedValue('session-key');
  encryptData.mockImplementation(async (data: string) => `enc(${data})`);
  decryptData.mockImplementation(async (data: string) => JSON.stringify({ name: data.replace('cipher-', ''), pv: 1 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** 断言辅助：把「发生在临界区内的次数」算出来，并先证明被测动作真的发生过。 */
const assertOutsideCommitSection = (observed: boolean[], label: string): void => {
  expect(observed.length, `用例空跑：本次流程里压根没发生过 ${label}，判据失去牙齿`).toBeGreaterThan(0);
  expect(observed.filter(Boolean), `${label} 发生在跨上下文提交锁的临界区内，会把其它数据域的整包写一起拖住`).toEqual(
    [],
  );
};

describe('探针的运行前提', () => {
  it('宿主必须提供真实 navigator.locks，否则本文件的临界区断言全是空跑', () => {
    expect(hasRealWebLocks(), '探针依赖真 Web Locks 的持有/排队语义；缺环境时宁可当场失败，不允许静默绿').toBe(true);
  });
});

describe('身份库写路径的临界区范围', () => {
  it('锁定态保存一条身份：主密码校验与密钥派生都不得占着提交锁', async () => {
    const { saveIdentity } = await import('@/utils/storage/identityCrud');

    await saveIdentity(payload('张三'), 'master-pw');

    assertOutsideCommitSection(heldAt.verify, 'verifyMasterPassword');
    assertOutsideCommitSection(heldAt.derive, 'deriveEncryptionKey（600k 迭代 PBKDF2）');
    assertOutsideCommitSection(heldAt.encrypt, 'encryptData');
    expect(store[STORAGE_KEYS.IDENTITY] as IdentityRecord[]).toHaveLength(2);
  });

  it('整包替换（导入备份）：逐条加密全程不得占着提交锁', async () => {
    const { replaceAllIdentity, getAllIdentityRaw } = await import('@/utils/storage/identityCrud');

    await replaceAllIdentity(
      [
        { id: 'x', createTime: 1, updateTime: 2, payload: payload('甲') },
        { id: 'y', createTime: 1, updateTime: 2, payload: payload('乙') },
        { id: 'z', createTime: 1, updateTime: 2, payload: payload('丙') },
      ],
      'master-pw',
    );

    // 只有导入胜出的行才重新加密：磁盘上没被导入覆盖的 id=a 连密文都不该动
    // （逐 id 定夺只需要 decrypt 一次判断可解性，不需要再加密回去）。
    expect(heldAt.encrypt).toHaveLength(3);
    assertOutsideCommitSection(heldAt.encrypt, '批量 encryptData');
    assertOutsideCommitSection(heldAt.derive, 'deriveEncryptionKey');
    // 「不丢弃不变量」：入参没覆盖到的既有记录（id=a）原样保留，所以是 3 新 + 1 旧 = 4 条。
    const rows = await getAllIdentityRaw();
    expect(rows).toHaveLength(4);
    expect(rows.find(r => r.id === 'a')?.encryptedPayload).toBe('cipher-a');
  });

  it('会话态更新一条身份：主密码派生不在锁内，落盘前的重读与合并仍在锁内', async () => {
    const { updateIdentity } = await import('@/utils/storage/identityCrud');

    // 不传 masterPassword → 走会话数据密钥，本来就没有 PBKDF2；这里锁的是「不再多取一次锁」以外的行为
    await updateIdentity('a', { name: '改名' } as Partial<IdentityPayload>, 100);

    expect(heldAt.derive, '会话态不该派生密钥').toHaveLength(0);
    expect(decryptData).toHaveBeenCalled();
    expect((store[STORAGE_KEYS.IDENTITY] as IdentityRecord[])[0].updateTime).toBeGreaterThan(100);
  });
});

/**
 * 「所有整包覆写型写入都在提交锁内」这句话目前的覆盖面（评审 2026-11-02 Q2）
 *
 * at-rest 迁移原先自带 updateTime 漂移检测，就把自己算作「安全」了——但漂移检测只挡得住
 * 「同一条目被改过」，挡不住「我读完之后、写下去之前，另一个上下文提交了整包结果」：
 * 那一次交错里迁移会拿自己早一步的快照把对方的编辑整片盖掉。补齐后这句话才真的成立。
 *
 * 这条用源码形状判（迁移入口要驱动旧版会话状态，成本与收益不对等），但它有牙：
 * 把 `withVaultCommit` 那层包裹摘掉，紧邻的前一次出现就找不到，判据当场红。
 */
describe('整包覆写型写入的锁覆盖', () => {
  it('at-rest 迁移的「重读 → 合并 → set」必须在提交锁内', async () => {
    const { readSource } = await import('../helpers/architectureScan');
    const src = readSource('utils/sessionManager-storage.ts');
    const readAt = src.indexOf('const latest = await readAtRest()');
    expect(readAt, '迁移的落盘前重读被改名或删除：本守卫需同步').toBeGreaterThan(-1);

    const commitAt = src.lastIndexOf('withVaultCommit(', readAt);
    expect(commitAt, '重读与 set 这段落回提交锁外：漂移检测挡不住「读后写前」的整包交错').toBeGreaterThan(-1);
    expect(readAt - commitAt, 'withVaultCommit 与这段之间隔得太远，多半不是同一层包裹').toBeLessThan(400);

    // 只断言「先重读、后 set」挡不住把 set 挪出临界区这种改法，所以再用花括号配平求出
    // 回调区间，确认重读与 set 同在其中。
    const bodyOpen = src.indexOf('{', commitAt);
    let depth = 0;
    let commitEnd = -1;
    for (let i = bodyOpen; i < src.length; i++) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          commitEnd = i;
          break;
        }
      }
    }
    expect(commitEnd, '定位不到 withVaultCommit 回调的闭合花括号：本守卫需同步').toBeGreaterThan(bodyOpen);

    const setAt = src.indexOf('await chrome.storage.local.set(payload)', readAt);
    expect(setAt, '迁移的整包 set 找不到：本守卫需同步').toBeGreaterThan(readAt);
    expect(
      readAt > commitAt && readAt < commitEnd && setAt > commitAt && setAt < commitEnd,
      '重读与 set 必须同在提交锁回调区间内：只保证先后顺序挡不住把 set 挪出临界区',
    ).toBe(true);
  });
});

/**
 * 收窄临界区不得顺带改掉单错的优先级与结果——这三条是「行为等价」的守卫。
 */
describe('收窄临界区后既有错误口径不变', () => {
  const errorCodeOf = async (fn: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      await fn();
    } catch (error) {
      return (error as { code?: string })?.code;
    }
    return undefined;
  };

  it('目标条目不存在 → 仍报 NOT_FOUND', async () => {
    const { updateIdentity } = await import('@/utils/storage/identityCrud');

    const code = await errorCodeOf(() => updateIdentity('missing', { name: 'x' }, 100));
    expect(code).toBe('NOT_FOUND');
  });

  it('并发令牌不匹配 → 仍报 UPDATE_CONFLICT', async () => {
    const { updateIdentity } = await import('@/utils/storage/identityCrud');

    const code = await errorCodeOf(() => updateIdentity('a', { name: 'x' }, 999_999));
    expect(code).toBe('UPDATE_CONFLICT');
  });

  it('条数已达上限 → 保存仍报 LIMIT_REACHED 且不落盘', async () => {
    const { saveIdentity } = await import('@/utils/storage/identityCrud');
    const { MAX_IDENTITIES } = await import('@/utils/identity/constants');
    store[STORAGE_KEYS.IDENTITY] = Array.from({ length: MAX_IDENTITIES }, (_, i) => identityRow(`f${i}`, 1));

    const code = await errorCodeOf(() => saveIdentity(payload('超限'), 'master-pw'));
    expect(code).toBe('LIMIT_REACHED');
    expect(store[STORAGE_KEYS.IDENTITY] as IdentityRecord[]).toHaveLength(MAX_IDENTITIES);
  });
});
