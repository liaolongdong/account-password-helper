import type { PasswordEntry, PasswordGroup } from '@/utils/types';
import { getGroupPath } from '@/utils/groupTree';
import { formatDate } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';

/**
 * CSV/JSON 导出与模板下载
 *
 * 从 excel.ts 拆分而来。`ExcelUtils` 的 exportToCSV / downloadTemplate /
 * exportToJSON 委托本模块，公开契约保持不变。
 */

/** CSV 表头 i18n key 列表（顺序即导出列顺序，用户名列可切换「必填」标注） */
const CSV_HEADER_KEYS = [
  'excel.header.password',
  'excel.header.url',
  'excel.header.tag',
  'excel.header.remark',
  'excel.header.totp',
  'excel.header.group',
  'excel.header.createTime',
  'excel.header.updateTime',
] as const;

/**
 * 按当前语言生成 CSV 表头（导出/模板共用，模板的用户名列带「必填」标注）
 * @param usernameRequired 用户名列是否使用「必填」标注文案
 */
function buildCsvHeaders(usernameRequired = false): string[] {
  const usernameKey = usernameRequired ? 'excel.header.usernameRequired' : 'excel.header.username';
  return [t(usernameKey), ...CSV_HEADER_KEYS.map(key => t(key))];
}

/**
 * 将二维行数据序列化为 CSV 文本
 *
 * 每个字段用双引号包裹并转义内部双引号（`"` → `""`），行以 `\r\n` 分隔。
 */
function serializeCsvRows(rows: unknown[][]): string {
  return rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

/**
 * 构造 CSV 数据行（不含表头）。
 *
 * @param passwords 待导出条目
 * @param groups 分组树
 */
export function buildCsvRows(passwords: readonly PasswordEntry[], groups: readonly PasswordGroup[] = []): string[][] {
  return passwords.map(p => [
    p.username,
    p.password,
    p.url,
    p.tag || '',
    p.remark || '',
    p.totp || '',
    getGroupPath(p.groupId, groups),
    formatDate(p.createTime || Date.now()),
    formatDate(p.updateTime || Date.now()),
  ]);
}

/**
 * 构造 JSON 导出载荷。
 *
 * 与 `.aph` v2 同口径：顶层包含 groups，条目包含 groupId。
 */
export function buildJsonPayload(passwords: readonly PasswordEntry[], groups: readonly PasswordGroup[] = []) {
  return {
    version: 2,
    exportedAt: Date.now(),
    count: passwords.length,
    groups: [...groups],
    entries: passwords.map(p => ({
      username: p.username,
      password: p.password,
      url: p.url,
      tag: p.tag,
      remark: p.remark,
      totp: p.totp,
      groupId: p.groupId,
      createTime: p.createTime,
      updateTime: p.updateTime,
    })),
  };
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
export function exportToCSV(
  passwords: PasswordEntry[],
  filename: string = 'passwords.csv',
  groups: readonly PasswordGroup[] = [],
): void {
  try {
    const csv = serializeCsvRows([buildCsvHeaders(), ...buildCsvRows(passwords, groups)]);
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
    buildCsvHeaders(true),
    [
      'example@email.com',
      'password123',
      'https://example.com',
      t('excel.template.exampleTag'),
      t('excel.template.exampleRemark'),
      '',
      t('excel.template.exampleGroup'),
      now,
      now,
    ],
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
export function exportToJSON(
  passwords: PasswordEntry[],
  filename: string = 'passwords.json',
  groups: readonly PasswordGroup[] = [],
): void {
  try {
    const jsonStr = JSON.stringify(buildJsonPayload(passwords, groups), null, 2);
    downloadBlob([jsonStr], 'application/json;charset=utf-8', filename, true);
  } catch (error) {
    logger.error('导出 JSON 失败:', error);
    const err = new Error('导出 JSON 失败');
    (err as any).cause = error;
    throw err;
  }
}
