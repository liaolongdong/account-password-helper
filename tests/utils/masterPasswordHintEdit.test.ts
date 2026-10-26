/**
 * 提示语可编辑之后的落盘边界（评审报告 P2-4 的落地）
 *
 * 提示语此前只有「首次设置主密码」那一次能写，之后既不能改也不能清：
 * 用恢复码换回本机库的人会被留一条指向已作废口令的明文提示，而唯一消除办法是清空整库。
 * 新增的 `updateMasterPasswordHint` 必须同时守住三件事：
 * 1. **只动 hint**——`salt` / `hashedPassword` / `kdf` 原样保留，否则离线恢复套件的 AAD
 *    与 `masterFingerprint` 会跟着变，已登记的套件被一次「改提示语」悄悄弄失效；
 * 2. **空值口径**——清除是省略字段而不是留一个空串，与既有读取端「缺失即未设置」一致；
 * 3. **写者交错**——shared 租约不互斥，落盘前重读并把 hint 合并到最新配置上，
 *    不能把期间同时完成的换钥新校验值写回旧的那一份。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import type { MasterPasswordConfig } from '@/utils/types';
import { MAX_MASTER_PASSWORD_HINT_LENGTH, updateMasterPasswordHint } from '@/utils/storage/masterPassword';

const BASE: MasterPasswordConfig = {
  salt: 'fixture-salt',
  hashedPassword: 'fixture-verifier',
  kdf: 'pbkdf2-sha256',
  hint: 'old hint',
};

const readConfig = async (): Promise<MasterPasswordConfig | undefined> =>
  (await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD))[STORAGE_KEYS.MASTER_PASSWORD] as
    MasterPasswordConfig | undefined;

beforeEach(async () => {
  vi.restoreAllMocks();
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ [STORAGE_KEYS.MASTER_PASSWORD]: { ...BASE } });
});

describe('updateMasterPasswordHint', () => {
  it('只改 hint：校验哈希、盐值与 kdf 逐字保留（不动恢复套件绑定的那几项）', async () => {
    await updateMasterPasswordHint('  brand new hint  ');

    expect(await readConfig()).toEqual({ ...BASE, hint: 'brand new hint' });
  });

  it('清除时省略字段，而不是留下一个空串', async () => {
    await updateMasterPasswordHint('   ');

    const after = await readConfig();
    expect(after?.hint, '空串会被读端当成「有提示语」，与「未设置」两种状态混淆').toBeUndefined();
    expect(after).toMatchObject({ salt: BASE.salt, hashedPassword: BASE.hashedPassword });
  });

  it('超过上限按码位截断到存储层阈值，不在界面另写一个数字', async () => {
    const long = '提'.repeat(MAX_MASTER_PASSWORD_HINT_LENGTH + 8);

    await updateMasterPasswordHint(long);

    expect((await readConfig())?.hint).toHaveLength(MAX_MASTER_PASSWORD_HINT_LENGTH);
  });

  it('主密码尚未设置：抛出可判别的错误，且不写盘', async () => {
    await chrome.storage.local.remove(STORAGE_KEYS.MASTER_PASSWORD);

    await expect(updateMasterPasswordHint('orphan')).rejects.toThrow('MASTER_PASSWORD_NOT_SET');
    expect(await chrome.storage.local.get(STORAGE_KEYS.MASTER_PASSWORD)).toEqual({});
  });

  /**
   * 换钥与改提示语可以同时在跑：两者都只拿共享租约，彼此不互斥。
   * 若把进入函数时快照的配置原样写回，就会把新校验哈希退回旧的那一份——
   * 旧密码「验得过」而整库已是新钥密文，绑定新配置的恢复套件同时作废。
   */
  it('落盘前重读：期间完成的换钥新校验值不得被本次写回覆盖', async () => {
    const rotated: MasterPasswordConfig = { salt: 'new-salt', hashedPassword: 'new-verifier', kdf: 'pbkdf2-sha256' };
    const get = vi.spyOn(chrome.storage.local, 'get');
    get.mockImplementation(async () => ({ [STORAGE_KEYS.MASTER_PASSWORD]: { ...rotated } }) as never);

    await updateMasterPasswordHint('merged hint');

    get.mockRestore();
    expect(await readConfig()).toEqual({ ...rotated, hint: 'merged hint' });
  });
});
