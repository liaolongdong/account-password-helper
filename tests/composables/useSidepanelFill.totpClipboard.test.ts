/** @vitest-environment jsdom */

/**
 * 验证码复制与「密码自动清除定时器」的互斥回归测试（useSidepanelFill）
 *
 * 回归背景：复制密码会记录一份明文快照并起一个自动清除定时器；复制用户名早已调用
 * `cancelPendingClear()` 来避免定时器误伤刚复制的内容，但复制验证码这条路漏了。
 * 于是「复制密码 → 复制验证码 → 定时器到点」这条真实序列会翻车：
 * 侧边栏此刻通常失焦，`clearClipboard` 读不到剪贴板便走「尽力清除」分支（宁可误清也不留密码），
 * 把用户正要粘贴的那枚验证码一起抹掉——表现为「验证码复制了但粘贴是空的」。
 *
 * 这里断言的是可观察结果，而不是内部调用：
 * - 复制成功后定时器不得再动剪贴板（剪贴板末值仍是验证码）；
 * - 复制失败时定时器必须照常生效（那条密码仍要被判清），
 *   即撤销只发生在「确认写入成功」之后，不能顺手削弱既有的密码清除承诺。
 *
 * 打桩口径与 `usePasswordManagement.delete.test.ts` 一致：`WxtVitest()` 不套用构建期的
 * Element Plus 自动导入，故 `ElMessage` 只能挂到 `globalThis`。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PasswordEntry } from '@/utils/types';

/** 由 `vi.hoisted` 提前建好的 TOTP 桩，供 `vi.mock` 工厂与用例共享（工厂在导入期执行） */
const generateTOTP = vi.hoisted(() => vi.fn());

vi.mock('@/utils/totp', () => ({
  generateTOTP: (...args: unknown[]) => generateTOTP(...args),
}));

vi.mock('@/utils/storage/configManager', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/storage/configManager')>()),
  // 固定 1 秒自动清除：既让「定时器在验证码之后到点」可被假时钟精确复现，也避开真实 storage 读
  getClipboardConfig: vi.fn(async () => ({ autoClear: true, clearAfterSeconds: 1 })),
}));

/** 可编程剪贴板：记录写入序列，并让 `readText` 恒失败以复现「侧边栏失焦」这条真实分支 */
interface ClipboardStub {
  writes: string[];
  writeText: Mock;
  readText: Mock;
}

const CODE = '123456';
const PASSWORD_PLAINTEXT = 'plain-text-password';

let clipboard: ClipboardStub;

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

describe('useSidepanelFill 验证码复制与密码自动清除', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    generateTOTP.mockReset().mockResolvedValue(CODE);

    clipboard = {
      writes: [],
      writeText: vi.fn(async (value: string) => {
        clipboard.writes.push(value);
      }),
      readText: vi.fn(async () => {
        throw new Error('Document is not focused');
      }),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboard,
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

  /** 重新取用 composable：模块级的定时器与快照需要在每个用例前彻底复位 */
  const useFill = async () => {
    const { useSidepanelFill } = await import('@/composables/useSidepanelFill');
    return useSidepanelFill();
  };

  it('复制验证码后，待执行的密码自动清除不得抹掉剪贴板里的验证码', async () => {
    const fill = await useFill();

    await fill.copyPassword(PASSWORD_PLAINTEXT);
    expect(clipboard.writes).toEqual([PASSWORD_PLAINTEXT]);

    await fill.copyTotp(entryWithTotp());
    expect(clipboard.writes).toEqual([PASSWORD_PLAINTEXT, CODE]);

    // 定时器到点：修复前这里会走「尽力清除」分支再写一次空值，把验证码抹掉
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clipboard.writes, '验证码被密码自动清除定时器抹掉了').toEqual([PASSWORD_PLAINTEXT, CODE]);
    expect(elMessage.info, '弹出了「剪贴板已清除」提示').not.toHaveBeenCalled();
  });

  it('验证码复制失败时，密码自动清除定时器仍照常判清那条密码', async () => {
    const fill = await useFill();

    await fill.copyPassword(PASSWORD_PLAINTEXT);

    // Async Clipboard 与 execCommand 双双失败（jsdom 无 execCommand）⇒ 剪贴板里还是密码
    clipboard.writeText.mockRejectedValueOnce(new Error('Document is not focused'));
    await fill.copyTotp(entryWithTotp());
    expect(clipboard.writes).toEqual([PASSWORD_PLAINTEXT]);

    // 此时不得撤销定时器：明文密码仍在剪贴板上，清除承诺必须保留
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clipboard.writes[clipboard.writes.length - 1], '定时器没有把密码判清').toBe('');
  });

  it('复制用户名仍会取消待执行的密码清除（既有不变量未被改动）', async () => {
    const fill = await useFill();

    await fill.copyPassword(PASSWORD_PLAINTEXT);
    await fill.copyUsername('new-username');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(clipboard.writes).toEqual([PASSWORD_PLAINTEXT, 'new-username']);
  });

  it('验证码经 execCommand 兜底复制成功时，同样取消待执行的密码清除', async () => {
    const fill = await useFill();

    await fill.copyPassword(PASSWORD_PLAINTEXT);
    clipboard.writeText.mockRejectedValueOnce(new Error('Document is not focused'));
    // 兜底路径的写入发生在 textarea + execCommand 上，桩剪贴板观测不到，只能断言「定时器没再动它」
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });

    await fill.copyTotp(entryWithTotp());
    expect(execCommand).toHaveBeenCalledWith('copy');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(clipboard.writes, '兜底复制成功仍被定时器抹掉').toEqual([PASSWORD_PLAINTEXT]);
  });
});
