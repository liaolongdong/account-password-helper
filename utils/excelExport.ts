import type { PasswordEntry } from '@/utils/types';
import { formatDate } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';

/**
 * CSV/JSON 导出与模板下载
 *
 * 从 excel.ts 拆分而来。`ExcelUtils` 的 exportToCSV / downloadTemplate /
 * exportToJSON 委托本模块，公开契约保持不变。
 */

/** CSV 导出表头 */
const CSV_EXPORT_HEADERS = ['用户名', '密码', '网址', '标签', '备注', '两步验证', '创建时间', '更新时间'];

/**
 * 将二维行数据序列化为 CSV 文本
 *
 * 每个字段用双引号包裹并转义内部双引号（`"` → `""`），行以 `\r\n` 分隔。
 */
function serializeCsvRows(rows: unknown[][]): string {
  return rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

/**
 * 通用 Blob 下载触发器
 *
 * @param parts        Blob 内容分片
 * @param type         MIME 类型
 * @param filename     下载文件名
 * @param appendToBody 是否将锚点挂载到 document.body 后再点击（部分浏览器的 JSON 下载需要）
 */
function downloadBlob(parts: BlobPart[], type: string, filename: string, appendToBody = false): void {
  const blob = new Blob(parts, { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  if (appendToBody) document.body.appendChild(a);
  a.click();
  if (appendToBody) document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导出密码数据到 CSV（带 BOM，Excel 可直接双击打开且中文不乱码）
 */
export function exportToCSV(passwords: PasswordEntry[], filename: string = 'passwords.csv'): void {
  try {
    const rows = passwords.map(p => [
      p.username,
      p.password,
      p.url,
      p.tag || '',
      p.remark || '',
      p.totp || '',
      formatDate(p.createTime || Date.now()),
      formatDate(p.updateTime || Date.now()),
    ]);
    const csv = serializeCsvRows([CSV_EXPORT_HEADERS, ...rows]);
    downloadBlob(['\uFEFF' + csv], 'text/csv;charset=utf-8', filename);
  } catch (error) {
    logger.error('导出CSV失败:', error);
    const err = new Error('导出CSV失败');
    (err as any).cause = error;
    throw err;
  }
}

/**
 * 下载 CSV 模板（Excel 可直接打开）
 */
export function downloadTemplate(): void {
  const now = formatDate(Date.now());
  const csv = serializeCsvRows([
    ['用户名(必填)', '密码', '网址', '标签', '备注', '两步验证', '创建时间', '更新时间'],
    ['example@email.com', 'password123', 'https://example.com', '工作', '示例账号', '', now, now],
  ]);
  downloadBlob(['\uFEFF' + csv], 'text/csv;charset=utf-8', 'password_template.csv');
}

/**
 * 导出密码数据为 JSON 文件
 * 导出结构：`{ version, exportedAt, count, entries }`
 *
 * @param passwords 待导出的密码列表
 * @param filename  导出文件名，默认 `passwords.json`
 */
export function exportToJSON(passwords: PasswordEntry[], filename: string = 'passwords.json'): void {
  try {
    const exportData = {
      version: 1,
      exportedAt: Date.now(),
      count: passwords.length,
      entries: passwords.map(p => ({
        username: p.username,
        password: p.password,
        url: p.url,
        tag: p.tag,
        remark: p.remark,
        totp: p.totp,
        createTime: p.createTime,
        updateTime: p.updateTime,
      })),
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    downloadBlob([jsonStr], 'application/json;charset=utf-8', filename, true);
  } catch (error) {
    logger.error('导出 JSON 失败:', error);
    const err = new Error('导出 JSON 失败');
    (err as any).cause = error;
    throw err;
  }
}
