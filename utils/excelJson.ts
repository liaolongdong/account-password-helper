import type { PasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';

/**
 * JSON 导入解析
 *
 * 从 excel.ts 拆分而来。支持数组或 `{ entries: [...] }` 包裹格式，
 * 字段映射兼容中英文列名。`ExcelUtils.parseJSON` 委托本模块的
 * {@link parsePasswordJSON}，公开契约保持不变。
 */

/**
 * 解析 JSON 文本为密码数据
 * 支持数组格式或 `{ entries: [...] }` 包裹格式，字段映射兼容中英文列名。
 *
 * @param text JSON 文本内容
 * @returns 解析后的密码数据数组
 */
export function parsePasswordJSON(text: string): Omit<PasswordEntry, 'id' | 'order'>[] {
  const now = Date.now();

  /** 解析时间字段，兼容 number / string */
  const parseTimestamp = (v: unknown): number | undefined => {
    if (v == null || v === '') return undefined;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? undefined : t;
  };

  try {
    const raw = JSON.parse(text);

    // 支持数组 或 { entries: [...] } 包裹格式
    const entries: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];

    if (entries.length === 0) {
      logger.warn('JSON 文件中未发现有效数据条目');
      return [];
    }

    return entries
      .map((row: any) => {
        const username = row.username || row['用户名'] || row['账号'] || '';
        const password = row.password || row['密码'] || '';
        const url = row.url || row['网址'] || row['网站地址'] || row['链接'] || '';
        const tag = row.tag || row['标签'] || row['分类'] || '';
        const remark = row.remark || row['备注'] || row['说明'] || '';
        const totp = row.totp || row['两步验证'] || row.otpauth || '';

        const cTime = parseTimestamp(row.createTime ?? row['创建时间'] ?? row.CreateTime);
        const uTime = parseTimestamp(
          row.updateTime ?? row['更新时间'] ?? row.UpdateTime ?? row.modifyTime ?? row['修改时间'],
        );
        const createTime = cTime ?? uTime ?? now;
        const updateTime = uTime ?? cTime ?? now;

        return {
          username: String(username).trim(),
          password: String(password).trim(),
          url: String(url).trim(),
          tag: String(tag).trim(),
          remark: String(remark).trim(),
          totp: String(totp).trim(),
          createTime,
          updateTime,
        };
      })
      .filter(item => item.username);
  } catch (error) {
    logger.error('解析 JSON 文件失败:', error);
    const err = new Error('JSON 文件格式不正确');
    (err as any).cause = error;
    throw err;
  }
}
