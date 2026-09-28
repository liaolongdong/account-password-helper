/**
 * 密码库导入边界的解析与校验（纯函数，零 i18n / 零 Vue / 零 chrome 依赖）
 *
 * 三条导入入口共用同一份边界口径（对标 `utils/identity/backup.ts` 的
 * `parseIdentityBackupData`）：
 * - 加密 `.aph` 备份：`importEncryptedBackup` 解密后 → {@link parseBackupContainer}
 *   校验 version 上界、count↔entries 交叉一致，再逐条 {@link validateAndBoundEntries}；
 * - 未加密 `{entries:[...]}` JSON：同走 {@link parseBackupContainer}；
 * - 裸数组 / 已按列名映射的行：走 {@link validateAndBoundEntries}。
 *
 * 校验点：条数上限（先于逐条校验，避免超大数组触发无界同步处理与内存分配）、
 * 字段白名单、逐字段类型与长度上限（对象/数组/布尔不再被 `String()` 悄悄变成
 * "[object Object]"/"true"），时间戳须为有限数（缺失回退当前时间），空用户名条目丢弃。
 *
 * 违规统一抛 {@link PasswordBackupError}（携带机器可读 `code`），由调用方映射为
 * 面向用户的 i18n 文案。
 */
import type { PasswordEntry } from '@/utils/types';
import {
  MAX_PASSWORD_IMPORT_ENTRIES,
  MAX_REMARK_LEN,
  MAX_TAG_LEN,
  MAX_TOTP_LEN,
  MAX_URL_LEN,
  MAX_USERNAME_LEN,
  MAX_PASSWORD_LEN,
  MAX_BACKUP_VERSION,
} from '@/utils/backup/constants';

/** 导入边界错误码（调用方据此映射文案） */
export type PasswordBackupErrorCode = 'TOO_MANY_ENTRIES' | 'INVALID_STRUCTURE' | 'INVALID_ENTRY';

/** 携带错误码的导入失败异常 */
export class PasswordBackupError extends Error {
  readonly code: PasswordBackupErrorCode;
  constructor(code: PasswordBackupErrorCode, cause?: unknown) {
    super(code);
    this.name = 'PasswordBackupError';
    this.code = code;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** 导入后的条目形状（与既有 parseCSV/parseJSON/importEncryptedBackup 契约一致） */
export type ImportedPasswordEntry = Omit<PasswordEntry, 'id' | 'order'>;

/**
 * 读取受限文本字段：仅接受字符串或有限数（其余类型视为损坏/伪造，抛 INVALID_ENTRY）。
 * null / undefined 归一为空串；trim 后超长抛 INVALID_ENTRY。
 */
export function readBoundedText(value: unknown, max: number): string {
  if (value === undefined || value === null) return '';
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    str = String(value);
  } else {
    throw new PasswordBackupError('INVALID_ENTRY');
  }
  const trimmed = str.trim();
  if (trimmed.length > max) throw new PasswordBackupError('INVALID_ENTRY');
  return trimmed;
}

/** 读取时间戳：有限数直接用；可解析字符串转数；其余回退当前时间（保持既有宽容行为） */
function readTimestamp(value: unknown, now: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return now;
}

/** 读取可选布尔：缺失合法，存在须为布尔，否则 INVALID_ENTRY */
function readOptionalBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  throw new PasswordBackupError('INVALID_ENTRY');
}

/** 校验条目总数上界：超限抛 TOO_MANY_ENTRIES（先于逐条校验，防无界同步处理） */
export function checkEntryCount(rows: unknown[]): void {
  if (rows.length > MAX_PASSWORD_IMPORT_ENTRIES) {
    throw new PasswordBackupError('TOO_MANY_ENTRIES');
  }
}

/**
 * 校验并收窄一批「原始条目」为可入库的 {@link ImportedPasswordEntry}
 *
 * 入参是磁盘 / 解密得到的不可信数组：先施条数上界，再逐条按字段白名单读取，
 * 丢弃空用户名行（与既有 parseCSV/parseJSON 行为一致）。
 */
export function validateAndBoundEntries(rows: unknown): ImportedPasswordEntry[] {
  if (!Array.isArray(rows)) throw new PasswordBackupError('INVALID_STRUCTURE');
  checkEntryCount(rows);

  const now = Date.now();
  const result: ImportedPasswordEntry[] = [];

  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new PasswordBackupError('INVALID_ENTRY');
    }
    const row = raw as Record<string, unknown>;
    const entry: ImportedPasswordEntry = {
      username: readBoundedText(row.username, MAX_USERNAME_LEN),
      password: readBoundedText(row.password, MAX_PASSWORD_LEN),
      url: readBoundedText(row.url, MAX_URL_LEN),
      tag: readBoundedText(row.tag, MAX_TAG_LEN),
      remark: readBoundedText(row.remark, MAX_REMARK_LEN),
      totp: readBoundedText(row.totp, MAX_TOTP_LEN),
      createTime: readTimestamp(row.createTime, now),
      updateTime: readTimestamp(row.updateTime, now),
    };
    const favorite = readOptionalBool(row.favorite);
    if (favorite !== undefined) entry.favorite = favorite;
    if (entry.username) result.push(entry);
  }

  return result;
}

/**
 * 解析备份容器 `{ version, count, entries }`
 *
 * @param json 已 JSON.parse 的容器对象
 * @param requireVersion `.aph`（自导出容器）为 true：强制 version 存在且为 [1, MAX_BACKUP_VERSION]
 *   的整数；对外部/手改 JSON 可传 false，仅在 version 存在时校验上界。
 *   count 存在时须与 entries.length 完全一致（缺失则跳过交叉校验，向后兼容旧导出）。
 */
export function parseBackupContainer(json: unknown, requireVersion = true): ImportedPasswordEntry[] {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new PasswordBackupError('INVALID_STRUCTURE');
  }
  const data = json as Record<string, unknown>;

  const version = data.version;
  if (version !== undefined) {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > MAX_BACKUP_VERSION) {
      throw new PasswordBackupError('INVALID_STRUCTURE');
    }
  } else if (requireVersion) {
    throw new PasswordBackupError('INVALID_STRUCTURE');
  }

  if (!Array.isArray(data.entries)) {
    throw new PasswordBackupError('INVALID_STRUCTURE');
  }

  // count↔entries 交叉校验：存在但与实际条数不符（截断/篡改）判为结构非法
  if (data.count !== undefined && data.count !== data.entries.length) {
    throw new PasswordBackupError('INVALID_STRUCTURE');
  }

  return validateAndBoundEntries(data.entries);
}
