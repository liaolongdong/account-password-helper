/** @vitest-environment jsdom */
/**
 * 动态码取码时机守卫
 *
 * 复现的缺陷：`generateTOTP` 按当前 Unix 时间片算码，而点击到码落地之间隔着异步跳
 * （填充链路要走 `tabs.query` → 取可填 frame → 必要时注入 content script → 发送复检，
 * 复制链路还要等用户粘贴）。在时间窗末尾点一下，剩余可能只有几百毫秒，码在落地前就翻篇，
 * 回执却照样报「已填充」「已复制」。显示侧一直有倒计时（`TotpCode.vue` 剩余 ≤5s 标
 * `is-expiring`），唯独取码这两条路径此前从不读它。
 *
 * 判据形状刻意选「推进假时钟之前不得调用 `generateTOTP`」——把等待逻辑整段删掉，
 * 这条会立刻红；只断言最终取到码则删掉等待照样绿，那等于没守。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PasswordEntry } from '@/utils/types';
import { readSource } from '../helpers/architectureScan';

const generateTOTP = vi.hoisted(() => vi.fn());
const getTotpPeriod = vi.hoisted(() => vi.fn());
const getTotpRemaining = vi.hoisted(() => vi.fn());

vi.mock('@/utils/totp', () => ({
  generateTOTP: (...args: unknown[]) => generateTOTP(...args),
  getTotpPeriod: (...args: unknown[]) => getTotpPeriod(...args),
  getTotpRemaining: (...args: unknown[]) => getTotpRemaining(...args),
}));

vi.mock('@/utils/storage/configManager', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/storage/configManager')>()),
  getClipboardConfig: vi.fn(async () => ({ autoClear: false, clearAfterSeconds: 30 })),
}));

const SECRET = 'JBSWY3DPEHPK3PXP';
const CODE = '654321';

let clipboardWrites: string[];

const entry = (): PasswordEntry => ({
  id: 'e1',
  username: 'user',
  password: 'p',
  url: '',
  tag: '',
  remark: '',
  totp: SECRET,
  createTime: 1_000_000,
  updateTime: 1_000_000,
  order: 0,
});

describe('取码前先看剩余时间', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    generateTOTP.mockReset().mockResolvedValue(CODE);
    getTotpPeriod.mockReset().mockReturnValue(30);
    getTotpRemaining.mockReset().mockReturnValue(25);
    clipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(async (value: string) => {
          clipboardWrites.push(value);
        }),
        readText: vi.fn(async () => {
          throw new Error('Document is not focused');
        }),
      },
      configurable: true,
      writable: true,
    });
    Object.assign(globalThis, {
      ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    delete (globalThis as { ElMessage?: unknown }).ElMessage;
  });

  const useFill = async () => {
    const { useSidepanelFill } = await import('@/composables/useSidepanelFill');
    return useSidepanelFill();
  };

  it('周期按密钥自己的 period 取，而不是写死 30', async () => {
    getTotpPeriod.mockReturnValue(60);
    getTotpRemaining.mockReturnValue(45);
    const fill = await useFill();

    await fill.copyTotp(entry());

    expect(getTotpPeriod).toHaveBeenCalledWith(SECRET);
    expect(getTotpRemaining).toHaveBeenCalledWith(60);
    expect(generateTOTP).toHaveBeenCalledTimes(1);
  });

  it('剩余时间充足时立刻取码，不多等一拍', async () => {
    const fill = await useFill();

    await fill.copyTotp(entry());

    expect(generateTOTP).toHaveBeenCalledTimes(1);
    expect(clipboardWrites).toEqual([CODE]);
  });

  it('剩余不足 2 秒时先等到下一个时间窗，再取码', async () => {
    getTotpRemaining.mockReturnValue(1);
    const fill = await useFill();

    const done = vi.fn();
    const running = fill.copyTotp(entry()).then(done);

    // 推进之前不得取码——把等待逻辑删掉，这一条立刻红
    await vi.advanceTimersByTimeAsync(500);
    expect(generateTOTP, '剩余 1 秒还直接取码：码会在粘贴前翻篇').not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1200);
    await running;

    expect(generateTOTP).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(clipboardWrites).toEqual([CODE]);
  });

  it('恰好卡在阈值上（剩余 2 秒）也要等', async () => {
    getTotpRemaining.mockReturnValue(2);
    const fill = await useFill();

    const running = fill.copyTotp(entry());
    await vi.advanceTimersByTimeAsync(2300);
    await running;

    expect(generateTOTP).toHaveBeenCalledTimes(1);
    expect((getTotpRemaining as Mock).mock.calls.length).toBe(1);
  });

  it('填充与复制两条取码路径共用同一套等待逻辑', () => {
    const source = readSource('composables/useSidepanelFill.ts');
    expect(source).toContain('const generateTotpCode = async');
    // 两处调用点都在，且模块里没有第二处裸算码入口（绕过等待的那条路必须不存在）
    expect([...source.matchAll(/await generateTotpCode\(/g)].length).toBe(2);
    // 全模块只允许 helper 内部这一处真算码：出现第二处就意味着有条路绕过了等待
    expect([...source.matchAll(/mod\.generateTOTP\(/g)].length).toBe(1);
  });
});
