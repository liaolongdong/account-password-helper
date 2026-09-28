import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordEntry } from '@/utils/types';
import { exportEncryptedBackup } from '@/utils/backupExport';

/**
 * 加密备份导出（.aph）round-trip 完整性自检测试
 *
 * 覆盖 exportEncryptedBackup 的新增契约：
 * - 正常导出：加密 → 用同一 salt 重新解密并核对 version/count/entries → 通过后才下载，
 *   下载成功后落「最近成功备份」时间戳；
 * - 自检不通过（解密回的结构与源数据条数不符）：抛 BackupVerifyError（携带专属文案），
 *   且不下载、不落时间戳；
 * - 时间戳落库失败：备份文件已产出，视为非致命，导出仍成功返回。
 *
 * markVerifiedBackupAt 以 mock 替身注入，隔离真实 chrome.storage；导出内部执行两次
 * PBKDF2-SHA256/600k（加密密钥 + 自检验密钥），单次约 4s，显式放宽超时并与其它
 * 加密用例错峰，避免并行抢 CPU 误判超时。document 以最小桩模拟下载落地，URL 仅补
 * 两个静态方法（保留构造能力，供模块内部 new URL 使用）。
 */

const markVerifiedBackupAt = vi.fn();

vi.mock('@/utils/storage/configManager', () => ({
  markVerifiedBackupAt: (...args: unknown[]) => markVerifiedBackupAt(...args),
}));

const entry = (id: string): PasswordEntry => ({
  id,
  username: `user-${id}`,
  password: `pw-${id}`,
  url: 'https://example.com',
  tag: 'demo',
  remark: '',
  createTime: 1,
  updateTime: 2,
  order: 0,
});

/** 记录一次下载的锚点对象，便于断言 click 是否发生 */
let clickedAnchors: { click: ReturnType<typeof vi.fn>; href: string; download: string }[];
let createObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  markVerifiedBackupAt.mockReset();
  markVerifiedBackupAt.mockResolvedValue(undefined);
  clickedAnchors = [];

  createObjectURL = vi.fn(() => 'blob:mock-url');
  // 仅补静态方法，保留全局 URL 构造能力（勿整体替换 globalThis.URL）
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const anchor = { click: vi.fn(), href: '', download: '' };
      clickedAnchors.push(anchor);
      return anchor;
    }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

describe('exportEncryptedBackup 完整性自检', () => {
  it('自检通过：下载 .aph 并记录成功备份时间戳', async () => {
    const passwords = [entry('a'), entry('b')];

    await exportEncryptedBackup(passwords, 'master-pw');

    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].click).toHaveBeenCalledTimes(1);
    expect(clickedAnchors[0].download).toMatch(/^backup_.*\.aph$/);
    expect(markVerifiedBackupAt).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('自检不通过（解密回条数与源不符）：抛 BackupVerifyError，且不下载、不落时间戳', async () => {
    // 篡改自检解密结果：count 与源数据（1 条）不一致 → 判为结构损坏
    const mismatch = new TextEncoder().encode(JSON.stringify({ version: 1, exportedAt: 0, count: 999, entries: [] }));
    vi.spyOn(crypto.subtle, 'decrypt').mockResolvedValueOnce(mismatch.buffer as ArrayBuffer);

    const err = await exportEncryptedBackup([entry('a')], 'master-pw').catch(e => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('BackupVerifyError');
    // 未注册语言包时 t() 原样返回 key，验证调用方据 name 差异化提示的锚点
    expect((err as Error).message).toBe('backup.exportVerifyFailed');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickedAnchors).toHaveLength(0);
    expect(markVerifiedBackupAt).not.toHaveBeenCalled();
  }, 30_000);

  it('时间戳落库失败不影响导出成功（备份文件已产出，仅提醒元数据缺失）', async () => {
    markVerifiedBackupAt.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(exportEncryptedBackup([entry('a')], 'master-pw')).resolves.toBeUndefined();

    expect(clickedAnchors).toHaveLength(1);
    expect(markVerifiedBackupAt).toHaveBeenCalledTimes(1);
  }, 30_000);
});
