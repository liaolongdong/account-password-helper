/**
 * 侧边栏快速添加条目（QUICK_ADD_PASSWORD）回归测试
 *
 * 覆盖：字段边界校验（空/超长/非法类型）、会话锁定降级、加密落盘委托、
 * 缓存失效与 sidepanel port 通知（含 port 异常容错）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleQuickAddPassword } from '@/entrypoints/background/quickAddHandler';

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
import { MessageType } from '@/utils/types';

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

  it('成功后失效密码缓存并通过 port 通知侧边栏刷新', async () => {
    const postMessage = vi.fn();
    mockedPorts.mockReturnValue([{ postMessage } as unknown as chrome.runtime.Port]);

    await handleQuickAddPassword(validData);

    expect(mockedInvalidate).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: MessageType.URL_CHANGED });
  });

  it('port 断开（postMessage 抛错）不影响保存结果', async () => {
    mockedPorts.mockReturnValue([
      {
        postMessage: vi.fn(() => {
          throw new Error('port disconnected');
        }),
      } as unknown as chrome.runtime.Port,
    ]);

    const result = await handleQuickAddPassword(validData);
    expect(result.success).toBe(true);
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
