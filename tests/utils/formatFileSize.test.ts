/**
 * `utils/formatFileSize.ts` 边界测试
 *
 * 该函数从 `ImportDialog` / `BackupImportDialog` 组件内上移为单一事实来源，
 * 现在同时服务「文件信息展示」与「导入字节闸门的拒绝文案」——后者会把上限
 * 直接报给用户，故档位边界与一位小数取整口径必须钉住。
 */
import { describe, expect, it } from 'vitest';
import { formatFileSize } from '@/utils/formatFileSize';

describe('formatFileSize', () => {
  it('B 档：小于 1 KiB 取整显示', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('KB 档：恰好 1 KiB 进位，保留一位小数', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024.0 KB');
  });

  it('MB 档：恰好 1 MiB 进位，保留一位小数', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(4 * 1024 * 1024)).toBe('4.0 MB');
    expect(formatFileSize(32 * 1024 * 1024)).toBe('32.0 MB');
  });
});
