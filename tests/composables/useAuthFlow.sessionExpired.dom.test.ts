/** @vitest-environment jsdom */
/**
 * 会话过期广播必须销毁已输入的明文凭据（评审 2026-11-02 S1）
 *
 * `handleSessionExpired` 是**会话终止**事件（手动锁定 / 到期 / 跨上下文广播都走这里），
 * 与 `checkAuth` 的重复调用不是一回事：后者只是「重新问一次认证状态」，用户此刻正在输入，
 * 抹掉他的输入是纯粹的 UX 倒退；前者是会话已经结束，留在输入框里的主密码既在两级响应式
 * 状态中存活，也**直接显示在屏幕上**（可肩窥）。
 *
 * 397ed1c 把两处都用同一个 `wasVerifyVisible` 条件收口了，于是过期路径的无条件清空被削弱成
 * 条件清空。本文件把两条口径钉死成两句可判定的话：过期一律清空，重复 checkAuth 一律保留。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  createSession: vi.fn(async () => {}),
  setMasterPasswordValidityHours: vi.fn(async () => {}),
  migrateUnencryptedEntries: vi.fn(async () => {}),
  verifyMasterPassword: vi.fn(async () => true),
  hasMasterPassword: vi.fn(async () => true),
  isSessionValid: vi.fn(async () => false),
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
  storage.isSessionValid.mockResolvedValue(false);
  storage.hasMasterPassword.mockResolvedValue(true);
});

describe('会话过期广播销毁明文凭据', () => {
  it('已在解锁页且已输入口令：收到过期广播后输入值必须被清空', async () => {
    const flow = await loadFlow();

    // 进入解锁视图（第一次 checkAuth，此时按新口径本就应当是空的）
    await flow.checkAuth();
    expect(flow.showPasswordVerify.value).toBe(true);

    // 用户开始输入主密码
    flow.verifyForm.value.password = 'typed-before-expiry';

    // 会话结束事件到达（App.vue 里挂在 window 的 `sessionExpired` 上）
    await flow.handleSessionExpired();

    expect(flow.verifyForm.value.password, '过期后口令继续留在输入框里＝明文存活时间被扩大，且可被肩窥').toBe('');
  });

  it('主密码尚未设置时收到过期广播：不落到解锁视图，也不留明文', async () => {
    storage.hasMasterPassword.mockResolvedValue(false);
    const flow = await loadFlow();

    await flow.checkAuth();
    flow.verifyForm.value.password = 'stale';
    await flow.handleSessionExpired();

    expect(flow.showMasterPasswordSetup.value).toBe(true);
    expect(flow.showPasswordVerify.value).toBe(false);
    expect(flow.verifyForm.value.password).toBe('');
  });
});

/**
 * 另一半口径：`checkAuth` 是「重新问一次认证状态」，不是会话终止。
 * 这两条断言锁的是 397ed1c 里**应当保留**的那部分修复，防止把它连坐改回去。
 */
describe('重复 checkAuth 不抹掉用户正在输入的内容', () => {
  it('已在解锁页时再次 checkAuth：输入保留', async () => {
    const flow = await loadFlow();

    await flow.checkAuth();
    flow.verifyForm.value.password = 'half-typed';
    await flow.checkAuth();

    expect(flow.verifyForm.value.password).toBe('half-typed');
  });

  it('从认证态掉回解锁页时清空（进入新视图的第一次判定）', async () => {
    const flow = await loadFlow();

    // 先进入解锁页并完成解锁
    storage.isSessionValid.mockResolvedValue(true);
    await flow.checkAuth();
    flow.verifyForm.value.password = 'typed-while-authenticated';
    expect(flow.isAuthenticated.value).toBe(true);

    // 会话失效后重新判定：进入解锁视图的这一次应当清空
    storage.isSessionValid.mockResolvedValue(false);
    await flow.checkAuth();

    expect(flow.showPasswordVerify.value).toBe(true);
    expect(flow.verifyForm.value.password).toBe('');
  });
});
