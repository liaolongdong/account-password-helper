import type { PasswordGroup } from '@/utils/types';
import { ROOT_GROUP_CODE } from '@/utils/types';
import type { ImportedPasswordEntry, ParsedImportData } from '@/utils/groupTree';
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
 * @returns 解析后的条目与文件内分组树
 */
export function parsePasswordJSON(text: string): ParsedImportData {
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
      return { entries: [], groups: parseGroups(raw) };
    }

    const parsedEntries: ImportedPasswordEntry[] = entries
      .map((row: any) => {
        const username = row.username || row['用户名'] || row['账号'] || '';
        const password = row.password || row['密码'] || '';
        const url = row.url || row['网址'] || row['网站地址'] || row['链接'] || '';
        const tag = row.tag || row['标签'] || row['分类'] || '';
        const remark = row.remark || row['备注'] || row['说明'] || '';
        const totp = row.totp || row['两步验证'] || row.otpauth || '';
        const groupPath = row.groupPath || row['分组'] || '';
        const groupId = typeof row.groupId === 'string' ? row.groupId : undefined;

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
          groupPath: String(groupPath).trim(),
          ...(groupId ? { groupId } : {}),
          createTime,
          updateTime,
        };
      })
      .filter(item => item.username);

    return { entries: parsedEntries, groups: parseGroups(raw) };
  } catch (error) {
    logger.error('解析 JSON 文件失败:', error);
    const err = new Error('JSON 文件格式不正确');
    (err as any).cause = error;
    throw err;
  }
}

/**
 * 解析 JSON 文件内自带的分组树。
 *
 * 文件属于不可信输入：逐项校验字段类型，非法项丢弃，整体非数组时降级为空树，
 * 不阻断条目导入。
 */
function parseGroups(raw: any): PasswordGroup[] {
  const list = Array.isArray(raw?.groups) ? raw.groups : [];
  const result: PasswordGroup[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const { code, name, parentCode, order } = item as Record<string, unknown>;
    if (typeof code !== 'string' || code === '') continue;
    if (typeof name !== 'string' || name.trim() === '') continue;
    result.push({
      code,
      name: name.trim(),
      parentCode: typeof parentCode === 'string' && parentCode !== '' ? parentCode : ROOT_GROUP_CODE,
      order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
    });
  }
  return result;
}
