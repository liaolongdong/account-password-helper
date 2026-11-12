/**
 * 自动保存载荷边界（background/autoSaveHandler）回归测试
 *
 * 回归背景：AUTO_SAVE_PASSWORD 的 username / url / remark 由内容脚本从宿主页面 DOM 采集，
 * 此前直接透传到落盘。超出条目容量（`PASSWORD_FIELD_LIMITS`，与 Options 表单同源）的账号一旦
 * 进了库，表单在编辑态必然按同一组容量拒绝保存——条目变成「只能删掉重建」的死数据，而用户
 * 当时收到的是「已保存」。
 *
 * 现在断言：超容量在写入前拒收并回可读文案（存储层完全不被触达）；字段类型异常同样拒收，
 * 但走通用失败文案而非「过长」；`tag` 不设长度上界，原样透传（原因见 `validateAutoSavePayload`）。
 * 另覆盖 `handleCheckCredentialStatus` 的透传契约：预检响应（含保存去向提示）原样回给内容脚本，
 * 存储层抛错时保底回 `new`，不阻断弹窗流程。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleAutoSavePassword, handleCheckCredentialStatus } from '@/entrypoints/background/autoSaveHandler';
import { PASSWORD_FIELD_LIMITS } from '@/utils/constants';
import type { CredentialStatusResponse } from '@/utils/types';

vi.mock('@/entrypoints/background/passwordCache', () => ({
  ensureCredentialAccessAfterStartupRelock: vi.fn(async () => true),
  invalidatePasswordCache: vi.fn(),
}));

vi.mock('@/utils/storage', () => ({
  StorageUtils: {
    autoSavePassword: vi.fn(async () => ({ success: true, message: 'bg.autoSave.savedNew' })),
    checkCredentialStatus: vi.fn(),
  },
}));

// 走真实文案：容量拒收现在按字段组合「实际/上限」，identity 桩会把这层组合整个遮掉
vi.mock('@/utils/i18n-lite', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/i18n-lite')>();
  return { tl: vi.fn((key: string, params?: Record<string, string | number>) => actual.tl(key, params)) };
});

import { ensureCredentialAccessAfterStartupRelock } from '@/entrypoints/background/passwordCache';
import { StorageUtils } from '@/utils/storage';
import { tl } from '@/utils/i18n-lite';

const mockedEnsure = vi.mocked(ensureCredentialAccessAfterStartupRelock);
const mockedAutoSave = vi.mocked(StorageUtils.autoSavePassword);
const mockedCheck = vi.mocked(StorageUtils.checkCredentialStatus);

/** 页面 DOM 采集出的典型载荷（url 已由 messageRouter 的 sender 校验放行） */
const makePayload = (overrides: Partial<Parameters<typeof handleAutoSavePassword>[0]> = {}) => ({
  username: 'alice',
  password: 'p@ssw0rd',
  url: 'example.com',
  tag: '示例站点',
  remark: '自动保存',
  tagEdited: false,
  remarkEdited: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedEnsure.mockResolvedValue(true);
  mockedAutoSave.mockResolvedValue({ success: true, message: 'bg.autoSave.savedNew' });
});

describe('handleAutoSavePassword 字段容量边界', () => {
  it('合法载荷原样透传给存储层', async () => {
    const result = await handleAutoSavePassword(makePayload());

    expect(result).toEqual({ success: true, message: 'bg.autoSave.savedNew' });
    expect(mockedAutoSave).toHaveBeenCalledTimes(1);
    expect(mockedAutoSave.mock.calls[0][0]).toEqual(makePayload());
    expect(mockedEnsure).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['字符串真值', 'yes'],
    ['数字 1', 1],
    ['空串', ''],
    ['undefined', undefined],
  ] as const)('mobileLogin 是 %s 时按「未声明」处理，整个键省略（写入授权位不认非布尔真值）', (_label, value) => {
    return handleAutoSavePassword(makePayload({ mobileLogin: value as never })).then(() => {
      expect(mockedAutoSave.mock.calls[0][0]).not.toHaveProperty('mobileLogin');
    });
  });

  it('mobileLogin 为严格 true 时原样带上，存储层才拿得到空口令的写入授权', async () => {
    await handleAutoSavePassword(makePayload({ password: '', mobileLogin: true }));

    expect(mockedAutoSave.mock.calls[0][0]).toMatchObject({ password: '', mobileLogin: true });
  });

  it('mobileLogin 为 true 却带非空口令：拒收且不触达存储层（授权位与口令必须同源）', async () => {
    // 存储层的两道闸门（空字段拒写、空口令不许覆盖已有真口令）都以 !data.password 为键，
    // 非空即全部绕过。载荷来自宿主页面 DOM，属不可信输入，这条不变量必须在边界上收口，
    // 不能只依赖内容脚本自己守规矩。
    const result = await handleAutoSavePassword(makePayload({ password: 'PAGE-CONTROLLED-VALUE', mobileLogin: true }));

    expect(result).toEqual({ success: false, message: tl('bg.autoSave.mobileLoginPasswordConflict') });
    expect(mockedAutoSave).not.toHaveBeenCalled();
  });

  it.each([
    ['username', PASSWORD_FIELD_LIMITS.username],
    ['url', PASSWORD_FIELD_LIMITS.url],
    ['remark', PASSWORD_FIELD_LIMITS.remark],
    ['password', PASSWORD_FIELD_LIMITS.password],
  ] as const)('%s 超容量 1 个字符即拒收，文案指明该字段与实际/上限，且不触达存储层', (field, limit) => {
    return handleAutoSavePassword(makePayload({ [field]: 'x'.repeat(limit + 1) })).then(result => {
      expect(result.success).toBe(false);
      expect(result.message).toContain(tl(`bg.autoSave.field.${field}`));
      expect(result.message).toContain(`${limit + 1}/${limit}`);
      expect(mockedAutoSave).not.toHaveBeenCalled();
    });
  });

  it('多个字段同时越限时逐个点名，不让用户猜嫌疑字段', async () => {
    const result = await handleAutoSavePassword(makePayload({ username: 'u'.repeat(51), remark: 'r'.repeat(1001) }));

    expect(result.success).toBe(false);
    expect(result.message).toContain(tl('bg.autoSave.field.username'));
    expect(result.message).toContain(tl('bg.autoSave.field.remark'));
    expect(result.message).toContain('51/50');
    expect(result.message).toContain('1001/1000');
  });

  it.each([
    ['username', PASSWORD_FIELD_LIMITS.username],
    ['remark', PASSWORD_FIELD_LIMITS.remark],
    ['password', PASSWORD_FIELD_LIMITS.password],
  ] as const)('%s 正好等于容量上限时放行', (field, limit) => {
    return handleAutoSavePassword(makePayload({ [field]: 'x'.repeat(limit) })).then(result => {
      expect(result.success).toBe(true);
      expect(mockedAutoSave).toHaveBeenCalledTimes(1);
    });
  });

  it('超长 tag 原样透传，不被静默改短', async () => {
    // tag 的容量口径是 Options 标签编辑器（MAX_TAG_COUNT × MAX_TAG_LENGTH，序列化串可长于 50），
    // 而自动保存载荷在「密码已变更」分支预填的正是条目已有串：按快速添加通道的 50 截断落盘，
    // 用户编辑一次标签就永久丢掉尾部，且弹窗显示与列表不一致。
    const longTag = 'T'.repeat(PASSWORD_FIELD_LIMITS.tag + 120);

    const result = await handleAutoSavePassword(makePayload({ tag: longTag, tagEdited: true }));

    expect(result.success).toBe(true);
    expect(mockedAutoSave.mock.calls[0][0].tag).toBe(longTag);
  });

  it('字段类型异常按通用失败拒收，不误报成「过长」', async () => {
    const result = await handleAutoSavePassword(makePayload({ username: 12345 as unknown as string }));

    expect(result).toEqual({ success: false, message: tl('bg.autoSave.failedGeneric') });
    expect(mockedAutoSave).not.toHaveBeenCalled();
  });

  it('会话锁定优先于载荷校验，直接回锁定失败', async () => {
    mockedEnsure.mockResolvedValue(false);

    const result = await handleAutoSavePassword(makePayload({ username: 'x'.repeat(999) }));

    expect(result).toEqual({ success: false, message: tl('bg.autoSave.failedGeneric') });
    expect(mockedAutoSave).not.toHaveBeenCalled();
  });
});

/**
 * 预检响应的透传契约
 *
 * 内容脚本按 `status` 决定是否弹窗、按 `risk` / `targetNote` 渲染内联提示，
 * 后台这一层只做会话闸门与保底，不裁剪、不改写响应字段。
 */
describe('handleCheckCredentialStatus 透传与保底', () => {
  const request = { username: 'alice', password: 'p@ssw0rd', url: 'mail.qq.com' };

  it('预检响应原样回给内容脚本，去向提示不被裁剪或改写', async () => {
    const response: CredentialStatusResponse = {
      status: 'password_changed',
      existing: { tag: 'work', remark: 'note' },
      risk: { reusedCount: 1 },
      targetNote: { kind: 'updateOtherHost', url: 'qq.com' },
    };
    mockedCheck.mockResolvedValue(response);

    expect(await handleCheckCredentialStatus(request)).toBe(response);
    expect(mockedCheck).toHaveBeenCalledWith(request);
  });

  it('会话锁定直接回 locked，不触达存储层', async () => {
    mockedEnsure.mockResolvedValue(false);

    expect(await handleCheckCredentialStatus(request)).toEqual({ status: 'locked' });
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('存储层抛错时保底回 new（不带任何提示字段），不阻断弹窗流程', async () => {
    mockedCheck.mockRejectedValue(new Error('boom'));

    expect(await handleCheckCredentialStatus(request)).toEqual({ status: 'new' });
  });
});

/**
 * OS 通知的标题与正文分工
 *
 * 缺陷本体：标题写死成「账号密码已保存」（原 `bg.autoSave.savedTitle`，已更名为不承诺结局的
 * `bg.autoSave.title`），而存储层的
 * `success: true` 有三种结局，其中「该账号已存有密码，本次未改动」一条字节都没写
 * （`utils/storage/autoSaveManager.ts:352-354`）。标题断言「存好了」、正文却说「没动」，
 * 用户读的是标题。
 *
 * 口径：标题只标事件（自动保存），结局由正文里的存储层文案承担——三种 success 共用同一标题，
 * 标题因此不可能对任何一种结局说谎。正文必须带上这份结局文案，否则收口失去意义。
 */
describe('handleAutoSavePassword 的桌面通知', () => {
  /** `chrome.notifications` 的调用记录（fakeBrowser 不一定提供该 API，逐用例装桩） */
  let create: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    create = vi.fn(async () => 'notification-id');
    Object.defineProperty(chrome, 'notifications', { value: { create }, configurable: true, writable: true });
    Object.defineProperty(chrome.runtime, 'getURL', {
      value: (p: string) => `chrome-extension://test/${p}`,
      configurable: true,
      writable: true,
    });
  });

  /** 取最近一次通知的参数（`.at()` 属 ES2022，本仓 lib 目标还没有，按下标取） */
  const notified = () => {
    expect(create.mock.calls.length, '保存成功却没有发出桌面通知').toBeGreaterThan(0);
    return create.mock.calls[create.mock.calls.length - 1][1] as { title: string; message: string };
  };

  it.each([
    ['新存一条', 'bg.autoSave.savedNew'],
    ['更新已有', 'bg.autoSave.updated'],
    ['本次未改动', 'bg.autoSave.passwordKept'],
  ] as const)('%s 的标题用同一个不承诺结局的 key（标题不许对正文反悔）', async (_label, outcome) => {
    mockedAutoSave.mockResolvedValue({ success: true, message: outcome });

    await handleAutoSavePassword(makePayload({ password: '', mobileLogin: true }));

    expect(create, '保存成功却没有发出桌面通知').toHaveBeenCalledTimes(1);
    expect(notified().title).toBe(tl('bg.autoSave.title'));
    expect(notified().message).toContain(outcome);
  });

  it('系统通知权限未开启时静默降级，仍把存储层结果回给内容脚本', async () => {
    create.mockRejectedValue(new Error('notifications not allowed'));

    const result = await handleAutoSavePassword(makePayload());

    expect(result).toEqual({ success: true, message: 'bg.autoSave.savedNew' });
  });

  it('存储层判失败时不发「已保存」通知', async () => {
    mockedAutoSave.mockResolvedValue({ success: false, message: 'bg.autoSave.sessionExpired' });

    await handleAutoSavePassword(makePayload());

    expect(create).not.toHaveBeenCalled();
  });
});
