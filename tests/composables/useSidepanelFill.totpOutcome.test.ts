/** @vitest-environment jsdom */

/**
 * 验证码填充「可信度分档」回归测试（useSidepanelFill.fillTotp）
 *
 * 缺陷背景：账号密码填充一支早已按 `FillResult.outcome` 分档——写后复检未通过
 * （`'unverified'`）时报「填充完成，请检查」而非乐观的「填充成功」。验证码填充一支却
 * 恒定上报 `fill.totpFillSuccess`，把 content script 回传的 `outcome` 直接丢弃。
 * 动态码时效极短，误报「成功」会让用户在码过期后才发觉表单其实没填上，最不该给虚假确定感。
 *
 * 这里断言的是可观察结果（ElMessage 收到的文案 key），而非内部调用：
 * - outcome==='unverified' → 'fill.totpFillCheck'
 * - outcome==='verified'   → 'fill.totpFillSuccess'
 *
 * 打桩口径与 `useSidepanelFill.totpClipboard.test.ts` 一致：`WxtVitest()` 不套用构建期的
 * Element Plus 自动导入，故 `ElMessage` 只能挂到 `globalThis`；`t()` mock 成恒等返回 key，
 * 让断言锁定「选中了哪个文案」而不是具体语言的字串。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FillResult, PasswordEntry, PingResponse } from '@/utils/types';
import { MessageType } from '@/utils/types';
import { getFillableFrameIds } from '@/utils/frameFill';

/** 由 `vi.hoisted` 提前建好的 TOTP 桩，供 `vi.mock` 工厂与用例共享（工厂在导入期执行） */
const generateTOTP = vi.hoisted(() => vi.fn());

vi.mock('@/utils/totp', () => ({
  generateTOTP: (...args: unknown[]) => generateTOTP(...args),
  // 剩余时间给满：本文件只关心「回执选了哪个 i18n key」，不掺入等窗逻辑
  getTotpPeriod: () => 30,
  getTotpRemaining: () => 30,
}));

// 文案 mock 成恒等返回 key，使断言只关心「选中了哪个 i18n key」，与语言包字串解耦
vi.mock('@/utils/i18n', () => ({
  t: (key: string) => key,
  currentLocale: { value: 'zh-CN' },
}));

vi.mock('@/utils/frameFill', () => ({
  getFillableFrameIds: vi.fn(async () => [0]),
  fillPasswordInFrames: vi.fn(),
}));

vi.mock('@/utils/contentScriptReadiness', () => ({
  // 返回一个形状合法的非空 PingResponse，让 fillTotp 走「content script 已就绪」的正常分支；
  // 严格对齐真实契约，未来若 fillTotp 复用 fieldsDetected 也不会被宽松桩掩盖。
  ensureContentScriptReady: vi.fn(async (): Promise<{ response: PingResponse | null }> => ({
    response: {
      success: true,
      ready: true,
      fieldsDetected: { username: 0, password: 0, mobile: 0, verifyCode: 1 },
    },
  })),
}));

const CODE = '123456';
const TAB_ID = 42;

/** 挂到 `globalThis` 的 ElMessage 桩（本文件唯一可类型安全引用它的方式） */
let elMessage: Record<'success' | 'error' | 'warning' | 'info', Mock>;

/** 造一条带 TOTP 密钥的条目（其余字段与本用例无关，取最小可用形状） */
const entryWithTotp = (): PasswordEntry => ({
  id: 'e1',
  username: 'user',
  password: 'p',
  url: '',
  tag: '',
  remark: '',
  totp: 'JBSWY3DPEHPK3PXP',
  createTime: 1_000_000,
  updateTime: 1_000_000,
  order: 0,
});

/** 构造一个成功填充的 FillResult，outcome 由用例指定 */
const fillResultWith = (outcome: FillResult['outcome']): FillResult => ({
  success: true,
  message: '',
  outcome,
  details: {
    usernameField: { found: false, filled: false, verified: false },
    passwordField: { found: false, filled: false, verified: false },
    strategy: 'native',
  },
});

/** 构造一个失败的 FillResult，reason 由用例指定（可为不可信的任意值） */
const fillFailureWith = (reason: unknown): FillResult => ({
  success: false,
  message: '',
  reason: reason as FillResult['reason'],
  details: {
    usernameField: { found: false, filled: false, verified: false },
    passwordField: { found: false, filled: false, verified: false },
    strategy: 'native',
  },
});

describe('useSidepanelFill 验证码填充可信度分档', () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    generateTOTP.mockReset().mockResolvedValue(CODE);

    elMessage = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
    Object.assign(globalThis, { ElMessage: elMessage });

    // FILL_TOTP 的响应由用例通过 sendMessage 的返回值控制（取首个成功响应）
    sendMessage.mockReset();

    (chrome as any).tabs = {
      query: vi.fn(async () => [{ id: TAB_ID }]),
      sendMessage,
    };
    (chrome as any).runtime = {
      ...((chrome as any).runtime ?? {}),
      sendMessage: vi.fn(async () => undefined),
    };
  });

  afterEach(() => {
    vi.resetModules();
    delete (globalThis as { ElMessage?: unknown }).ElMessage;
  });

  /** 重新取用 composable：模块级状态需在每个用例前彻底复位 */
  const useFill = async () => {
    const { useSidepanelFill } = await import('@/composables/useSidepanelFill');
    return useSidepanelFill();
  };

  it('写后复检未通过（unverified）时上报「请核对」而非乐观的「填充成功」', async () => {
    sendMessage.mockResolvedValue(fillResultWith('unverified'));
    const fill = await useFill();

    await fill.fillTotp(entryWithTotp());

    expect(elMessage.success).toHaveBeenCalledTimes(1);
    expect(elMessage.success.mock.calls[0][0]).toBe('fill.totpFillCheck');
  });

  it('写后复检通过（verified）时仍上报「填充成功」', async () => {
    sendMessage.mockResolvedValue(fillResultWith('verified'));
    const fill = await useFill();

    await fill.fillTotp(entryWithTotp());

    expect(elMessage.success).toHaveBeenCalledTimes(1);
    expect(elMessage.success.mock.calls[0][0]).toBe('fill.totpFillSuccess');
  });

  it('老版 content script 不带 outcome 时默认乐观上报「填充成功」（保持既有兜底行为）', async () => {
    sendMessage.mockResolvedValue(fillResultWith(undefined));
    const fill = await useFill();

    await fill.fillTotp(entryWithTotp());

    expect(elMessage.success).toHaveBeenCalledTimes(1);
    expect(elMessage.success.mock.calls[0][0]).toBe('fill.totpFillSuccess');
  });

  it('填充成功先弹层、后发隐藏消息（分档未改动副作用时序）', async () => {
    sendMessage.mockResolvedValue(fillResultWith('unverified'));
    const runtimeSend = (chrome as any).runtime.sendMessage as Mock;
    const fill = await useFill();

    await fill.fillTotp(entryWithTotp());

    expect(runtimeSend).toHaveBeenCalledWith({
      type: MessageType.HIDE_SIDEPANEL,
      data: { tabId: TAB_ID },
    });
    // 严格断言「先 toast 后 hide」的相对顺序，避免未来有人在 unverified 分支提前 return
    // 跳过 hide、或把 hide 提到 toast 之前——这类回归只有比对调用序号才能捕获。
    expect(elMessage.success.mock.invocationCallOrder[0]).toBeLessThan(runtimeSend.mock.invocationCallOrder[0]);
  });

  it('多 frame 聚合时取首个成功响应的 outcome（顶层 unverified 优先于 iframe verified）', async () => {
    // fillTotpInAllFrames 按 frameIds 顺序返回首个 success；outcome 已升级为用户可见文案，
    // 误选出的代价从「不可见」变成「给用户错误确定感」，故对选中策略补显式守卫。
    (getFillableFrameIds as Mock).mockResolvedValueOnce([0, 1]);
    sendMessage.mockImplementation((_tabId: number, _msg: unknown, opts: { frameId: number }) =>
      Promise.resolve(fillResultWith(opts.frameId === 0 ? 'unverified' : 'verified')),
    );
    const fill = await useFill();

    await fill.fillTotp(entryWithTotp());

    expect(elMessage.success.mock.calls[0][0]).toBe('fill.totpFillCheck');
  });

  it('content script 回传非法 reason 时降级到兜底文案，不把裸 key 弹给用户', async () => {
    sendMessage.mockResolvedValue(fillFailureWith('bogus_reason'));
    const fill = await useFill();

    await fill.fillTotp(entryWithTotp());

    expect(elMessage.warning).toHaveBeenCalledWith('fill.totpFillFailed');
  });

  it('合法 reason 仍命中对应文案（白名单收窄未误伤枚举值）', async () => {
    sendMessage.mockResolvedValue(fillFailureWith('no_totp_input'));
    const fill = await useFill();

    await fill.fillTotp(entryWithTotp());

    expect(elMessage.warning).toHaveBeenCalledWith('fill.noTotpInput');
  });
});
