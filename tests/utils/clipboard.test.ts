import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * utils/clipboard 单元测试
 *
 * 该模块是「复制密码后按配置限时自动清除」安全承诺的纯机制层，UI 无关。
 * 测试环境为 node（无 DOM），故对 `navigator.clipboard` 与 `document` 打桩，
 * 并用 fake timers 驱动自动清除定时器；配置读取 `getClipboardConfig` 被 mock。
 */
vi.mock('@/utils/storage/configManager', () => ({
  getClipboardConfig: vi.fn(),
}));

import { getClipboardConfig } from '@/utils/storage/configManager';
import { cancelPendingClipboardClear, copySecretToClipboard, copyTextToClipboard } from '@/utils/clipboard';

const mockGetConfig = vi.mocked(getClipboardConfig);

const SECRET = 'p@ssw0rd-secret';
const PLAIN = 'user@example.com';

let writeText: ReturnType<typeof vi.fn>;
let readText: ReturnType<typeof vi.fn>;
let execCommand: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  writeText = vi.fn().mockResolvedValue(undefined);
  readText = vi.fn().mockResolvedValue(SECRET);
  execCommand = vi.fn().mockReturnValue(true);
  const textareaStub = { value: '', style: {} as Record<string, string>, select: vi.fn() };
  vi.stubGlobal('navigator', { clipboard: { writeText, readText } });
  vi.stubGlobal('document', {
    createElement: vi.fn(() => textareaStub),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    execCommand,
  });
  mockGetConfig.mockResolvedValue({ autoClear: true, clearAfterSeconds: 30 });
});

afterEach(() => {
  // 复位模块级定时器/快照，避免跨用例串扰
  cancelPendingClipboardClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('copySecretToClipboard', () => {
  it('空值直接返回 false 且不写入剪贴板', async () => {
    await expect(copySecretToClipboard('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('写入密码并按配置在到时后自动清除', async () => {
    const onCleared = vi.fn();
    await expect(copySecretToClipboard(SECRET, onCleared)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(onCleared).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(readText).toHaveBeenCalledWith(); // 清除前校验内容是否被替换
    expect(writeText).toHaveBeenCalledWith(''); // 到时清空
    expect(onCleared).toHaveBeenCalledWith(true);
  });

  it('autoClear 关闭时不排程清除', async () => {
    mockGetConfig.mockResolvedValue({ autoClear: false, clearAfterSeconds: 30 });
    const onCleared = vi.fn();
    await copySecretToClipboard(SECRET, onCleared);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writeText).toHaveBeenCalledTimes(1); // 仅初始写入
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('剪贴板内容已被替换时跳过清除（回调成功但不再写空）', async () => {
    readText.mockResolvedValue('用户期间新复制的内容');
    const onCleared = vi.fn();
    await copySecretToClipboard(SECRET, onCleared);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeText).toHaveBeenCalledTimes(1); // 未写空
    expect(writeText).not.toHaveBeenCalledWith('');
    expect(onCleared).toHaveBeenCalledWith(true);
  });

  it('失焦无法校验时尽力清除（readText 抛错仍写空）', async () => {
    readText.mockRejectedValue(new Error('Document is not focused'));
    const onCleared = vi.fn();
    await copySecretToClipboard(SECRET, onCleared);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeText).toHaveBeenCalledWith('');
    expect(onCleared).toHaveBeenCalledWith(true);
  });

  it('Async Clipboard 写空失败时降级 execCommand 覆写', async () => {
    writeText.mockImplementation((v: string) => (v === '' ? Promise.reject(new Error('blur')) : Promise.resolve()));
    const onCleared = vi.fn();
    await copySecretToClipboard(SECRET, onCleared);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(onCleared).toHaveBeenCalledWith(true);
  });

  it('execCommand 也失败时回调 false（提示手动清除）', async () => {
    writeText.mockImplementation((v: string) => (v === '' ? Promise.reject(new Error('blur')) : Promise.resolve()));
    execCommand.mockReturnValue(false);
    const onCleared = vi.fn();
    await copySecretToClipboard(SECRET, onCleared);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onCleared).toHaveBeenCalledWith(false);
  });

  it('写入失败时返回 false 且不排程清除', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const onCleared = vi.fn();
    await expect(copySecretToClipboard(SECRET, onCleared)).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onCleared).not.toHaveBeenCalled();
  });
});

describe('copyTextToClipboard', () => {
  it('空值直接返回 false 且不写入剪贴板', async () => {
    await expect(copyTextToClipboard('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('写入普通文本并返回 true', async () => {
    await expect(copyTextToClipboard(PLAIN)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(PLAIN);
  });

  it('复制普通文本会取消待执行的密码自动清除', async () => {
    const onCleared = vi.fn();
    await copySecretToClipboard(SECRET, onCleared); // 排程清除
    await copyTextToClipboard(PLAIN); // 复制用户名 → 取消清除
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeText).not.toHaveBeenCalledWith(''); // 用户名未被误清
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('写入失败时返回 false', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    await expect(copyTextToClipboard(PLAIN)).resolves.toBe(false);
  });
});

describe('cancelPendingClipboardClear', () => {
  it('取消后到时不再触发清除回调', async () => {
    const onCleared = vi.fn();
    await copySecretToClipboard(SECRET, onCleared);
    cancelPendingClipboardClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onCleared).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
