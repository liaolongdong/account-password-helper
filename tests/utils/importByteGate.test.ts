/**
 * 导入字节闸门（读盘前的第一道边界）回归测试
 *
 * 条数与逐字段长度上限都要等整份文件解码/解密并逐条 parse 之后才生效，
 * 因此它们**防不住**「一次 `arrayBuffer()` 把任意大的输入拉进内存」。
 * 本文件钉住 `.aph` 恢复链路上那道先于取字节的闸门：
 * - 超限文件直接抛错，且**一次都不读**字节（闸门确实在读盘之前，不是读完再判）；
 * - 未超限文件照常进入解密与结构校验（闸门不是无差别拒绝）；
 * - 文案里的上限值来自 `MAX_PASSWORD_IMPORT_INPUT_BYTES` 经 `formatFileSize` 渲染，
 *   不是一处写死的字符串。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importEncryptedBackup } from '@/utils/backupExport';
import { MAX_PASSWORD_IMPORT_INPUT_BYTES } from '@/utils/backup/constants';
import { formatFileSize } from '@/utils/formatFileSize';
import { registerMessages, type Messages } from '@/utils/i18n';
import zhBackup from '@/utils/i18n/locales/zh-CN/backup.json';
import enBackup from '@/utils/i18n/locales/en/backup.json';

registerMessages('zh-CN', zhBackup as Messages);
registerMessages('en', enBackup as Messages);

// 「未超限但内容过短」用例会走 logger.error（预期路径），静默 console 保持输出整洁
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 构造只暴露 `size` 与 `arrayBuffer` 的最小 File 替身
 *
 * 断言依赖「读字节必留痕」，故把 `arrayBuffer` 做成 spy；`as unknown as File`
 * 只是绕开 DOM 结构断言，不改变被测代码实际拿到的形状。
 */
const fakeFile = (size: number, bytes = new Uint8Array(8)): { file: File; read: ReturnType<typeof vi.fn> } => {
  const read = vi.fn(async () => bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer);
  return { file: { name: 'backup.aph', size, type: '', arrayBuffer: read } as unknown as File, read };
};

describe('importEncryptedBackup 的字节闸门', () => {
  it('超限文件抛错，且一次都不读字节', async () => {
    const { file, read } = fakeFile(MAX_PASSWORD_IMPORT_INPUT_BYTES + 1);

    const err = await importEncryptedBackup(file, 'master-pw').catch(e => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(
      `备份文件过大（上限 ${formatFileSize(MAX_PASSWORD_IMPORT_INPUT_BYTES)}），请确认这是完整的备份文件`,
    );
    expect(read, '闸门必须设在取字节之前，否则超大文件已经进内存了').not.toHaveBeenCalled();
  });

  it('未超限但内容过短：仍按原有口径报「格式无效」，闸门不做无差别拒绝', async () => {
    const { file, read } = fakeFile(8);

    const err = await importEncryptedBackup(file, 'master-pw').catch(e => e);

    expect(err.message).toBe('备份文件格式无效');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('恰好等于上限的字节数放行，超限一个字节才拒（边界不夹错方向）', async () => {
    const atLimit = fakeFile(MAX_PASSWORD_IMPORT_INPUT_BYTES);
    await importEncryptedBackup(atLimit.file, 'master-pw').catch(() => undefined);
    expect(atLimit.read, '等于上限属合法输入，不许被闸门挡掉').toHaveBeenCalledTimes(1);

    const overLimit = fakeFile(MAX_PASSWORD_IMPORT_INPUT_BYTES + 1);
    await importEncryptedBackup(overLimit.file, 'master-pw').catch(() => undefined);
    expect(overLimit.read).not.toHaveBeenCalled();
  });

  it('上限值取自常量而非写死（32 MiB）', () => {
    expect(MAX_PASSWORD_IMPORT_INPUT_BYTES).toBe(32 * 1024 * 1024);
  });
});
