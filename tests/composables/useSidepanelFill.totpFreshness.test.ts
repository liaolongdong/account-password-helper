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
import { MessageType } from '@/utils/types';
import type { PasswordEntry } from '@/utils/types';
import { readSource } from '../helpers/architectureScan';

const generateTOTP = vi.hoisted(() => vi.fn());
const getTotpPeriod = vi.hoisted(() => vi.fn());
const getTotpRemaining = vi.hoisted(() => vi.fn());
/**
 * 调用顺序记录表：取码（`generate`）必须落在跨入口往返（`frames` / `ready`）之后、
 * 投递（`send`）之前。用例开始前清空。
 */
const order = vi.hoisted(() => [] as string[]);

vi.mock('@/utils/totp', () => ({
  generateTOTP: (...args: unknown[]) => {
    order.push('generate');
    return generateTOTP(...args);
  },
  getTotpPeriod: (...args: unknown[]) => getTotpPeriod(...args),
  getTotpRemaining: (...args: unknown[]) => getTotpRemaining(...args),
}));

// 填充链路的两次往返：只登记顺序，真实实现要读 webNavigation / 注入 content script，测试里不必跑
vi.mock('@/utils/frameFill', () => ({
  getFillableFrameIds: vi.fn(async () => {
    order.push('frames');
    return [0];
  }),
  fillPasswordInFrames: vi.fn(),
}));

vi.mock('@/utils/contentScriptReadiness', () => ({
  ensureContentScriptReady: vi.fn(async () => {
    order.push('ready');
    return {
      response: {
        success: true,
        ready: true,
        fieldsDetected: { username: 0, password: 0, mobile: 0, verifyCode: 1 },
      },
    };
  }),
}));

vi.mock('@/utils/storage/configManager', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/storage/configManager')>()),
  getClipboardConfig: vi.fn(async () => ({ autoClear: false, clearAfterSeconds: 30 })),
}));

const SECRET = 'JBSWY3DPEHPK3PXP';
const CODE = '654321';

let clipboardWrites: string[];
/** 挂到 `globalThis` 的 ElMessage 桩（与 `totpOutcome.test.ts` 同一打桩口径） */
let elMessage: Record<'success' | 'error' | 'warning' | 'info', Mock>;

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
    elMessage = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
    Object.assign(globalThis, { ElMessage: elMessage });
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

  it('取码排在跨入口往返之后、投递之前：明文窗口不被拉长', () => {
    // 判据形状：`frames → ready → generate → send`。
    // 为什么顺序也要守：等窗只保证「算出来那一刻还剩 ≥2 秒」，可如果算完还要去
    // 查 tab、取可填 frame、必要时注入 content script（注入可达数百毫秒到秒级），
    // 这 2 秒预算就被往返吃回去，边界上照样把旧码填进表单——正是本文件要防的缺陷。
    // 同一趟往返还把密钥派生的明码留在内存里多走一段，`fillPassword` 一支的做法是
    // 把所有跳数走完、步骤4 才组装明文并立刻发送，这里与之对齐。
    order.length = 0;
    const sendMessage = vi.fn(async (_tabId: number, message: { type: MessageType }) => {
      if (message.type === MessageType.FILL_TOTP) order.push('send');
      return {
        success: true,
        message: '',
        outcome: 'verified',
        details: {
          usernameField: { found: false, filled: false, verified: false },
          passwordField: { found: false, filled: false, verified: false },
          strategy: 'native',
        },
      };
    });
    (chrome as unknown as { tabs: unknown }).tabs = {
      query: vi.fn(async () => [{ id: 42 }]),
      sendMessage,
    };
    (chrome as unknown as { runtime: unknown }).runtime = {
      sendMessage: vi.fn(async () => undefined),
    };

    return useFill().then(fill =>
      fill.fillTotp(entry()).then(() => {
        expect(order, '取码与投递之间还夹着跨入口往返，等到的那 2 秒会被吃掉').toEqual([
          'frames',
          'ready',
          'generate',
          'send',
        ]);
        expect(sendMessage).toHaveBeenCalled();
        expect(elMessage.success).toHaveBeenCalledTimes(1);
      }),
    );
  });
});
