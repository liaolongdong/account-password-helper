import type { PasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { checkEntryCount, validateAndBoundEntries, PasswordBackupError } from '@/utils/backup/parseBackupEntries';
import { MAX_BACKUP_VERSION } from '@/utils/backup/constants';

/**
 * JSON 导入解析
 *
 * 从 excel.ts 拆分而来。支持数组或 `{ entries: [...] }` 包裹格式，
 * 字段映射兼容中英文列名。`ExcelUtils.parseJSON` 委托本模块的
 * {@link parsePasswordJSON}，公开契约保持不变。
 */

/** 取第一个「存在且非空」的候选原始值（不归一化类型，交由边界校验器读取） */
function firstPresent(...candidates: unknown[]): unknown {
  for (const value of candidates) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

/**
 * 解析 JSON 文本为密码数据
 * 支持数组格式或 `{ entries: [...] }` 包裹格式，字段映射兼容中英文列名。
 *
 * @param text JSON 文本内容
 * @returns 解析后的密码数据数组
 */
export function parsePasswordJSON(text: string): Omit<PasswordEntry, 'id' | 'order'>[] {
  try {
    const raw: unknown = JSON.parse(text);

    // 支持数组 或 { entries: [...] } 包裹格式
    const containerEntries = Array.isArray(raw) ? undefined : (raw as { entries?: unknown })?.entries;
    const entries: unknown[] = Array.isArray(raw) ? raw : Array.isArray(containerEntries) ? containerEntries : [];

    // 容器带 version 时校验上界（前向不兼容文件拒绝），并做 count↔entries 交叉校验
    if (!Array.isArray(raw) && raw && typeof raw === 'object') {
      const container = raw as { version?: unknown; count?: unknown };
      if (typeof container.version === 'number' && container.version > MAX_BACKUP_VERSION) {
        throw new PasswordBackupError('INVALID_STRUCTURE');
      }
      if (typeof container.count === 'number' && container.count !== entries.length) {
        throw new PasswordBackupError('INVALID_STRUCTURE');
      }
    }

    if (entries.length === 0) {
      logger.warn('JSON 文件中未发现有效数据条目');
      return [];
    }

    // 条数上界先于逐条映射，避免超大文件触发无界同步处理与内存分配
    checkEntryCount(entries);

    const now = Date.now();
    /** 解析时间字段为有限数，兼容 number / 可解析 string，否则 undefined */
    const parseTs = (v: unknown): number | undefined => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Date.parse(v);
        return Number.isNaN(parsed) ? undefined : parsed;
      }
      return undefined;
    };

    // 按中/英文列别名映射到规范字段（文本保留原始类型，交由边界校验器做类型/长度检查；
    // 时间戳在此解析并保留「缺失时回退对侧、再回退当前时间」的既有语义）
    const mapped = entries.map((row: unknown) => {
      const r = (row ?? {}) as Record<string, unknown>;
      const cTime = parseTs(r.createTime ?? r['创建时间'] ?? r.CreateTime);
      const uTime = parseTs(r.updateTime ?? r['更新时间'] ?? r.UpdateTime ?? r.modifyTime ?? r['修改时间']);
      const entry: Record<string, unknown> = {
        username: firstPresent(r.username, r['用户名'], r['账号']),
        password: firstPresent(r.password, r['密码']),
        url: firstPresent(r.url, r['网址'], r['网站地址'], r['链接']),
        tag: firstPresent(r.tag, r['标签'], r['分类']),
        remark: firstPresent(r.remark, r['备注'], r['说明']),
        totp: firstPresent(r.totp, r['两步验证'], r.otpauth),
        createTime: cTime ?? uTime ?? now,
        updateTime: uTime ?? cTime ?? now,
      };
      if (typeof r.favorite === 'boolean') entry.favorite = r.favorite;
      return entry;
    });

    // 复用统一边界：逐字段类型/长度校验、时间戳回退、空用户名条目过滤
    return validateAndBoundEntries(mapped);
  } catch (error) {
    logger.error('解析 JSON 文件失败:', error);
    const err = new Error('JSON 文件格式不正确');
    (err as any).cause = error;
    throw err;
  }
}
