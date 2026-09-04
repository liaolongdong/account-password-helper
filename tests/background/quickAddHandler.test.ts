/**
 * 侧边栏快速添加条目（QUICK_ADD_PASSWORD）回归测试
 *
 * 覆盖：字段边界校验（空/超长/非法类型）、会话锁定降级、加密落盘委托、
 * 缓存失效，以及「不通过 port 通知侧边栏」的回归守卫。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleQuickAddPassword } from '@/entrypoints/background/quickAddHandler';

// 保留 sidePanelManager 桩：handler 已不再向其发送刷新通知，
// 该桩用于断言「不通过 port 通知」的回归守卫（见下方成功路径用例）
vi.mock('@/entrypoints/background/sidePanelManager', () => ({
  getSidePanelPorts: vi.fn(() => []),
}));

vi.mock('@/entrypoints/background/passwordCache', () => ({
  ensureCredentialAccessAfterStartupRelock: vi.fn(async () => true),
  invalidatePasswordCache: vi.fn(),
}));

vi.mock('@/utils/storage', () => ({
  StorageUtils: {
    savePassword: vi.fn(async () => ({})),
  },
}));

vi.mock('@/utils/i18n-lite', () => ({
  tl: vi.fn((key: string) => key),
}));

import { getSidePanelPorts } from '@/entrypoints/background/sidePanelManager';
import {
  ensureCredentialAccessAfterStartupRelock,
  invalidatePasswordCache,
} from '@/entrypoints/background/passwordCache';
import { StorageUtils } from '@/utils/storage';

const mockedPorts = vi.mocked(getSidePanelPorts);
const mockedEnsure = vi.mocked(ensureCredentialAccessAfterStartupRelock);
const mockedInvalidate = vi.mocked(invalidatePasswordCache);
const mockedSave = vi.mocked(StorageUtils.savePassword);

const validData = {
  username: '  user@example.com  ',
  password: 'p@ssw0rd',
  url: ' example.com ',
  tag: ' 工作 ',
  remark: ' 备注 ',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedEnsure.mockResolvedValue(true);
  mockedSave.mockResolvedValue({} as never);
  mockedPorts.mockReturnValue([]);
});

describe('handleQuickAddPassword 成功路径', () => {
  it('字段去除首尾空白后加密落盘，并带创建/更新时间', async () => {
    const result = await handleQuickAddPassword(validData);

    expect(result).toEqual({ success: true, message: 'bg.quickAdd.success' });
    expect(mockedSave).toHaveBeenCalledTimes(1);
    const entry = mockedSave.mock.calls[0][0];
    expect(entry.username).toBe('user@example.com');
    expect(entry.password).toBe('p@ssw0rd');
    expect(entry.url).toBe('example.com');
    expect(entry.tag).toBe('工作');
    expect(entry.remark).toBe('备注');
    expect(entry.createTime).toBeTypeOf('number');
    expect(entry.updateTime).toBe(entry.createTime);
  });

  it('密码保持原样（含首尾空格，避免破坏真实密码）', async () => {
    await handleQuickAddPassword({ ...validData, password: ' leading-and-trailing ' });
    expect(mockedSave.mock.calls[0][0].password).toBe(' leading-and-trailing ');
  });

  it('tag/remark 缺省时落盘为空字符串', async () => {
    await handleQuickAddPassword({ username: 'u', password: 'p', url: '' });
    const entry = mockedSave.mock.calls[0][0];
    expect(entry.tag).toBe('');
    expect(entry.remark).toBe('');
    expect(entry.url).toBe('');
  });

  it('成功后失效密码缓存', async () => {
    await handleQuickAddPassword(validData);

    expect(mockedInvalidate).toHaveBeenCalledTimes(1);
  });

  /**
   * 回归守卫：保存成功后不得向 sidepanel port 发送刷新通知
   *
   * 侧边栏列表刷新的唯一路径是 storage watcher——它独有 isMetadataOnlyChange 零解密
   * 快路径与 _sessionKnownExpired / 本地操作守卫。此前这里会额外 postMessage 一条
   * 不带 data 的 URL_CHANGED（违反 utils/types.ts 判别联合契约），而 useSidepanelData
   * 的 bgPort.onMessage 只处理 CLOSE_SIDEPANEL 与 SESSION_EXPIRED，该通知从未被消费；
   * 若将来接上，同一次保存会跑两遍全量 AES-GCM 解密。
   * URL_CHANGED 的合法生产者是 content script 导航检测（携带真实 data.url）。
   */
  it('不通过 port 通知侧边栏（避免与 storage watcher 重复全量解密）', async () => {
    const postMessage = vi.fn();
    mockedPorts.mockReturnValue([{ postMessage } as unknown as chrome.runtime.Port]);

    const result = await handleQuickAddPassword(validData);

    expect(result.success).toBe(true);
    expect(mockedPorts).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('handleQuickAddPassword 字段校验（边界不可信输入）', () => {
  it('用户名为空或仅空白时拒绝保存', async () => {
    expect(await handleQuickAddPassword({ ...validData, username: '' })).toEqual({
      success: false,
      message: 'bg.quickAdd.invalidFields',
    });
    expect(await handleQuickAddPassword({ ...validData, username: '   ' })).toEqual({
      success: false,
      message: 'bg.quickAdd.invalidFields',
    });
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('密码为空时允许保存（与密码管理页添加条目行为一致）', async () => {
    const result = await handleQuickAddPassword({ ...validData, password: '' });
    expect(result).toEqual({ success: true, message: 'bg.quickAdd.success' });
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave.mock.calls[0][0].password).toBe('');
  });

  it('超长字段被拒绝，各字段按自身上限校验（与前端 maxlength 一致）', async () => {
    expect(await handleQuickAddPassword({ ...validData, username: 'x'.repeat(51) })).toEqual({
      success: false,
      message: 'bg.quickAdd.tooLong',
    });
    expect(await handleQuickAddPassword({ ...validData, password: 'x'.repeat(51) })).toEqual({
      success: false,
      message: 'bg.quickAdd.tooLong',
    });
    expect(await handleQuickAddPassword({ ...validData, url: 'x'.repeat(101) })).toEqual({
      success: false,
      message: 'bg.quickAdd.tooLong',
    });
    expect(await handleQuickAddPassword({ ...validData, tag: 'x'.repeat(51) })).toEqual({
      success: false,
      message: 'bg.quickAdd.tooLong',
    });
    expect(await handleQuickAddPassword({ ...validData, remark: 'x'.repeat(1001) })).toEqual({
      success: false,
      message: 'bg.quickAdd.tooLong',
    });
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('各字段恰好在上限长度时允许保存', async () => {
    await handleQuickAddPassword({
      ...validData,
      username: 'x'.repeat(50),
      password: 'x'.repeat(50),
      url: 'x'.repeat(100),
      tag: 'x'.repeat(50),
      remark: 'x'.repeat(1000),
    });
    expect(mockedSave).toHaveBeenCalledTimes(1);
  });

  it('非法类型载荷（非字符串/缺失）安全降级为校验失败', async () => {
    expect((await handleQuickAddPassword({} as never)).success).toBe(false);
    expect((await handleQuickAddPassword({ username: 123, password: null, url: undefined } as never)).success).toBe(
      false,
    );
    expect(mockedSave).not.toHaveBeenCalled();
  });
});

describe('handleQuickAddPassword 会话与异常降级', () => {
  it('会话锁定时不落盘，返回锁定提示', async () => {
    mockedEnsure.mockResolvedValue(false);

    const result = await handleQuickAddPassword(validData);

    expect(result).toEqual({ success: false, message: 'bg.quickAdd.locked' });
    expect(mockedSave).not.toHaveBeenCalled();
    expect(mockedInvalidate).not.toHaveBeenCalled();
  });

  it('存储层抛错时返回通用失败提示而非崩溃', async () => {
    mockedSave.mockRejectedValue(new Error('storage write failed'));

    const result = await handleQuickAddPassword(validData);

    expect(result).toEqual({ success: false, message: 'bg.quickAdd.failed' });
    expect(mockedInvalidate).not.toHaveBeenCalled();
  });
});
