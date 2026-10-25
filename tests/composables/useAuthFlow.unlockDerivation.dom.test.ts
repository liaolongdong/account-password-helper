/** @vitest-environment jsdom */
/**
 * 解锁路径的慢哈希预算（评审报告 P1-4）
 *
 * `handleVerifySubmit` 原先先调 `verifyMasterPassword` 预检，再调 `createSession`——而
 * `createSession` 内部**必须**在租约内复验当前校验配置（外部 UI 的验证可能早于另一上下文换钥，
 * 这道复验不能省）。于是每次解锁付了两次 600k 迭代的 PBKDF2（本机约 430ms/次，见
 * `docs/reports/PERF_ISSUE89_DATA_LAYER_EVALUATION.md`），解锁时长平白多出近一半。
 *
 * 现在只留 `createSession` 那一次复验，失败按稳定码分流：
 * - `WRONG_PASSWORD` → 计入连续失败次数（提示语门槛）、清空输入、焦点回输入框；
 * - `VAULT_BUSY` → 换钥进行中，不算密码错：不计数、不清输入，可原地重试；
 * - 其他异常 → 通用「验证失败」。
 *
 * 认证失败的一次尝试不该把有效期偏好写进存储，所以 `setMasterPasswordValidityHours` 只在
 * 认证成功之后调用——这里一并锁死，避免有人为了「少一个 await」把它挪回前面。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  createSession: vi.fn(async () => {}),
  setMasterPasswordValidityHours: vi.fn(async () => {}),
  migrateUnencryptedEntries: vi.fn(async () => {}),
  verifyMasterPassword: vi.fn(async () => true),
  hasMasterPassword: vi.fn(async () => true),
  isSessionValid: vi.fn(async () => true),
  getMasterPasswordValidityHours: vi.fn(async () => 24),
  getMasterPasswordHint: vi.fn(async () => ''),
}));

vi.mock('@/utils/storage', () => ({ StorageUtils: storage }));
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn(async () => true) },
}));

const loadFlow = async () => {
  const { useAuthFlow } = await import('@/composables/useAuthFlow');
  return useAuthFlow({ loadPasswords: vi.fn(async () => {}) });
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.createSession.mockResolvedValue(undefined);
});

describe('解锁只付一次慢哈希派生', () => {
  it('认证成功：不再单独预检，createSession 恰好一次', async () => {
    const flow = await loadFlow();
    flow.verifyForm.value.password = 'right-pw';
    flow.verifyForm.value.validityHours = 24;

    await flow.handleVerifySubmit();

    expect(storage.verifyMasterPassword, '预检就是多付的那一次 PBKDF2，必须不再出现').not.toHaveBeenCalled();
    expect(storage.createSession).toHaveBeenCalledTimes(1);
    expect(flow.isAuthenticated.value).toBe(true);
    expect(flow.verifyFailCount.value).toBe(0);
  });

  it('密码错误：计一次失败、清空输入，且不把有效期偏好写进存储', async () => {
    storage.createSession.mockRejectedValue(Object.assign(new Error('主密码验证失败'), { code: 'WRONG_PASSWORD' }));
    const flow = await loadFlow();
    flow.verifyForm.value.password = 'typo-pw';

    await flow.handleVerifySubmit();

    expect(flow.verifyFailCount.value).toBe(1);
    expect(flow.verifyError.value).toBeTruthy();
    expect(flow.verifyForm.value.password).toBe('');
    expect(flow.isAuthenticated.value).toBe(false);
    expect(storage.setMasterPasswordValidityHours, '失败的尝试不该改动库里的设置').not.toHaveBeenCalled();
  });

  it('换钥进行中（VAULT_BUSY）：不算密码错，保留输入以便原地重试', async () => {
    storage.createSession.mockRejectedValue(
      Object.assign(new Error('Vault has an unfinished write'), { code: 'VAULT_BUSY' }),
    );
    const flow = await loadFlow();
    flow.verifyForm.value.password = 'right-but-busy';

    await flow.handleVerifySubmit();

    expect(flow.verifyFailCount.value, '忙碌不是密码错，不该推动提示语门槛').toBe(0);
    expect(flow.verifyForm.value.password).toBe('right-but-busy');
    expect(flow.verifyError.value).toBeTruthy();
    expect(storage.setMasterPasswordValidityHours).not.toHaveBeenCalled();
  });

  it('其他异常仍走通用「验证失败」，不伪装成密码错误', async () => {
    storage.createSession.mockRejectedValue(new Error('browser startup relock pending'));
    const flow = await loadFlow();
    flow.verifyForm.value.password = 'whatever';

    await flow.handleVerifySubmit();

    expect(flow.verifyFailCount.value).toBe(0);
    expect(flow.verifyError.value).toBeTruthy();
    expect(flow.isAuthenticated.value).toBe(false);
  });
});
