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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElMessage } from 'element-plus';

const storage = vi.hoisted(() => ({
  setMasterPassword: vi.fn(async () => {}),
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

const loadFlow = async (loadPasswords = vi.fn(async () => {})) => {
  const { useAuthFlow } = await import('@/composables/useAuthFlow');
  return useAuthFlow({ loadPasswords });
};

/** 用真实异步边界控制锁定与认证的先后。 */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ElMessage', ElMessage);
  storage.createSession.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe('认证代际与锁定竞态', () => {
  it.each(['check', 'verify', 'setup'] as const)('%s：加载挂起后锁定完成，旧加载不得重新认证', async operation => {
    const started = deferred<void>();
    const pending = deferred<void>();
    const load = vi.fn(async () => {
      started.resolve();
      await pending.promise;
    });
    const flow = await loadFlow(load);
    flow.setupForm.value.password = 'Test-password#1';
    const running =
      operation === 'check'
        ? flow.checkAuth()
        : operation === 'setup'
          ? flow.handleSetupSubmit()
          : flow.handleVerifySubmit('Test-password#1');
    await started.promise;
    await flow.handleSessionExpired();
    vi.mocked(ElMessage.success).mockClear();
    pending.resolve();
    await running;

    expect(flow.isAuthenticated.value).toBe(false);
    expect(flow.showPasswordVerify.value).toBe(true);
    expect(ElMessage.success).not.toHaveBeenCalled();
    expect(flow.setupLoading.value).toBe(false);
    expect(flow.verifyLoading.value).toBe(false);
    // 锁定只作废旧一轮，不得阻止用户随后正常解锁。
    await flow.handleVerifySubmit('Test-password#2');
    expect(flow.isAuthenticated.value).toBe(true);
  });

  it('锁定在 hasMasterPassword 读取完成前已同步撤销认证', async () => {
    const flow = await loadFlow();
    flow.isAuthenticated.value = true;
    const pending = deferred<boolean>();
    storage.hasMasterPassword.mockReturnValueOnce(pending.promise);
    const locking = flow.handleSessionExpired();
    const authenticatedWhileReading = flow.isAuthenticated.value;
    pending.resolve(true);
    await locking;
    expect(authenticatedWhileReading).toBe(false);
  });

  it.each(['check', 'verify', 'setup'] as const)('%s：锁定后新一轮已加载，旧错误不改动新状态', async operation => {
    const started = deferred<void>();
    const pending = deferred<void>();
    const load = vi
      .fn(async () => {})
      .mockImplementationOnce(async () => {
        started.resolve();
        await pending.promise;
      });
    const flow = await loadFlow(load);
    flow.setupForm.value.password = 'Test-password#1';
    const running =
      operation === 'check'
        ? flow.checkAuth()
        : operation === 'setup'
          ? flow.handleSetupSubmit()
          : flow.handleVerifySubmit('Test-password#1');
    await started.promise;
    await flow.handleSessionExpired();
    await flow.handleVerifySubmit('Test-password#2');
    vi.mocked(ElMessage.error).mockClear();
    pending.reject(new Error('stale read failed'));
    await running;

    expect(flow.isAuthenticated.value).toBe(true);
    expect(flow.showPasswordVerify.value).toBe(false);
    expect(flow.verifyError.value).toBe('');
    expect(ElMessage.error).not.toHaveBeenCalled();
  });

  it('旧 createSession 拒绝与 finally 不覆盖新解锁的输入/错误/loading', async () => {
    const pending = deferred<void>();
    storage.createSession.mockReturnValueOnce(pending.promise);
    const flow = await loadFlow();
    const old = flow.handleVerifySubmit('old-test-password');
    await flow.handleSessionExpired();
    const fresh = deferred<void>();
    storage.createSession.mockReturnValueOnce(fresh.promise);
    const current = flow.handleVerifySubmit('new-test-password');
    pending.reject(Object.assign(new Error('wrong'), { code: 'WRONG_PASSWORD' }));
    await old;
    expect(flow.verifyLoading.value).toBe(true);
    expect(flow.verifyForm.value.password).toBe('new-test-password');
    expect(flow.verifyError.value).toBe('');
    expect(flow.verifyFailCount.value).toBe(0);
    fresh.resolve();
    await current;
    expect(flow.isAuthenticated.value).toBe(true);
  });

  it('旧锁定提示语读取晚于新解锁时，不再回写有效期与提示语', async () => {
    const flow = await loadFlow();
    const hint = deferred<string>();
    storage.getMasterPasswordHint.mockReturnValueOnce(hint.promise);
    await flow.handleSessionExpired();
    await flow.handleVerifySubmit('new-test-password');
    flow.masterPasswordHint.value = 'current hint';
    flow.verifyForm.value.validityHours = 8;
    hint.resolve('stale hint');
    await Promise.resolve();
    await Promise.resolve();
    expect(flow.masterPasswordHint.value).toBe('current hint');
    expect(flow.verifyForm.value.validityHours).toBe(8);
  });

  it('setup 的存储写入挂起后锁定，不继续建立会话或加载列表', async () => {
    const pending = deferred<void>();
    storage.setMasterPassword.mockReturnValueOnce(pending.promise);
    const load = vi.fn(async () => {});
    const flow = await loadFlow(load);
    flow.setupForm.value.password = 'Test-password#1';
    const running = flow.handleSetupSubmit();
    await flow.handleSessionExpired();
    pending.resolve();
    await running;
    expect(storage.createSession).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(flow.isAuthenticated.value).toBe(false);
  });
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

  it('以提交事件载荷为准：父级 props 尚未同步时也不误报空密码', async () => {
    const flow = await loadFlow();
    flow.verifyForm.value.password = '';
    flow.verifyForm.value.validityHours = 24;

    await flow.handleVerifySubmit('right-from-child');

    expect(storage.createSession).toHaveBeenCalledWith('right-from-child', 24);
    expect(flow.isAuthenticated.value).toBe(true);
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
