/**
 * 身份信息备份（.aphid 容器，自带实现，不 import backupExport）
 *
 * 与密码库 `.aph` 的参数对齐但实现独立：SALT=16 / IV=12 / PBKDF2-SHA256
 * 600k / AES-256-GCM，布局 `salt ‖ iv ‖ ciphertext`（对标 backupExport.ts）。
 *
 * 与 `.aph` 的一处刻意差异：`records` **保留 `id`**。密码库能剥 id 是因为它有
 * removeDuplicates 兜底且导入常视为新条目；身份库一期无去重工具，最可能的场景是
 * 同一用户重复导入同一份备份（换机/误操作/验证可用性）——若剥 id，30 条 PII 会
 * 变成 60 条重复记录，且 category 与全部字段都在密文里，用户无法肉眼去重。
 * 故 `.aphid` 以 id 作为跨备份的稳定身份，导入时按 id 合并。
 *
 * 除加密 `.aphid` 外，本模块另提供**可选的明文 JSON 导出/导入**（`buildIdentityPlaintextJson`
 * / `exportIdentityPlaintext` / `parseIdentityPlaintextJson`）：明文 `.json` 复用的正是 `.aphid`
 * 解密后的 `IdentityBackupData` 结构，故导入走同一份 `parseIdentityBackupData` 校验、按 id 合并；
 * 但它把 PII 原文写盘/读盘，属隐私边界的例外通道——导出与导入都必须由 UI 层施加主密码复验 +
 * 风险确认双重门槛，默认不作为导出首选路径。
 *
 * 错误一律携带机器可读 `code`（`INVALID_FILE` / `WRONG_PASSWORD` / `NOT_APHID` /
 * `INVALID_STRUCTURE` / `EXPORT_FAILED`），由 Options UI 映射为 i18n 文案，本模块
 * 零 i18n / 零 Vue 依赖（对标 validators 的口径），可在 Node 环境直接单测。
 */
import type { IdentityEntry, IdentityPayload } from './types';
import {
  APHID_KIND,
  APHID_VERSION,
  CATEGORY_ORDER,
  MAX_CUSTOM_FIELDS,
  MAX_FIELD_VALUE_LEN,
  MAX_IDENTITIES,
  MAX_LABEL_LEN,
  MAX_REMARK_LEN,
} from './constants';
import { logger } from '@/utils/logger';
import { formatTimestampCompact } from '@/utils/dateFormat';

/** AES-GCM IV 长度 */
const IV_LENGTH = 12;
/** PBKDF2 迭代次数（与主加密体系一致的 600K） */
const PBKDF2_ITERATIONS = 600_000;
/** Salt 长度 */
const SALT_LENGTH = 16;

/** 备份错误码（UI 据此映射 i18n 文案） */
export type IdentityBackupErrorCode =
  'INVALID_FILE' | 'WRONG_PASSWORD' | 'NOT_APHID' | 'INVALID_STRUCTURE' | 'EXPORT_FAILED';

/** 备份中的单条记录（明文 payload，容器整体加密后 payload 不另加密） */
export interface IdentityBackupRecord {
  id: string;
  createTime: number;
  updateTime: number;
  payload: IdentityPayload;
}

/** .aphid 明文 JSON 结构 */
export interface IdentityBackupData {
  kind: typeof APHID_KIND;
  version: number;
  exportedAt: number;
  count: number;
  records: IdentityBackupRecord[];
}

/** 按 id 合并的结果（records 为完整合并后列表，含原有序与新增/更新） */
export interface IdentityMergeResult {
  records: IdentityBackupRecord[];
  added: number;
  updated: number;
  skipped: number;
}

/** 构造带 `code` 的错误，供 UI 精确分流 */
function backupError(code: IdentityBackupErrorCode, cause?: unknown): Error {
  const err = new Error(code) as Error & { code: IdentityBackupErrorCode; cause?: unknown };
  err.code = code;
  if (cause !== undefined) err.cause = cause;
  return err;
}

/** 从任意错误里取出备份错误码（无则返回 undefined） */
export function getIdentityBackupErrorCode(error: unknown): IdentityBackupErrorCode | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code as IdentityBackupErrorCode;
  }
  return undefined;
}

/** 从主密码派生 AES-GCM 密钥（与 backupExport 同参数） */
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** 从解密后的内存条目构造 .aphid 明文数据 */
export function buildIdentityBackupData(entries: IdentityEntry[]): IdentityBackupData {
  return {
    kind: APHID_KIND,
    version: APHID_VERSION,
    exportedAt: Date.now(),
    count: entries.length,
    records: entries.map(e => ({
      id: e.id,
      createTime: e.createTime,
      updateTime: e.updateTime,
      payload: e.payload,
    })),
  };
}

/**
 * 解析导出范围（纯函数，供加密/明文导出共用）
 *
 * 未勾选任何条目时返回全部（保持「直接点导出即导出全库」的既有行为）；
 * 勾选后仅返回被选中的条目。调用方据此把实际条数回显在确认文案里，
 * 避免「以为导了全部、其实只导了子集」这类静默歧义。
 */
export function resolveExportEntries(all: IdentityEntry[], selectedIds: ReadonlySet<string>): IdentityEntry[] {
  if (selectedIds.size === 0) return all;
  return all.filter(entry => selectedIds.has(entry.id));
}

/** 构造明文导出 JSON（不加密；结构复用 .aphid 数据形状，仅供迁移到其他工具查看） */
export function buildIdentityPlaintextJson(entries: IdentityEntry[]): string {
  return JSON.stringify(buildIdentityBackupData(entries), null, 2);
}

/** 备份 payload 中受长度上限约束的内置文本字段（导入文件为不可信输入，须逐字段限长） */
const BOUNDED_TEXT_FIELDS = [
  'name',
  'idNumber',
  'phone',
  'email',
  'address',
  'cardNo',
  'cardBank',
  'cardHolder',
  'cardExpiry',
  'cardCvv',
] as const;

/**
 * 合法 category 枚举集合（导入文件为不可信输入）
 *
 * 单一事实来源为 `CATEGORY_ORDER`：`IdentityCategory` 无兜底成员，若放行任意字符串，
 * `t('identity.category.<x>')` 会把裸 key 直接渲染到界面。故导入记录的 category 必须
 * 命中该集合，否则整份文件判为 INVALID_STRUCTURE（与逐记录形状校验的 fail-closed 口径一致）。
 */
const VALID_CATEGORIES: ReadonlySet<string> = new Set<string>(CATEGORY_ORDER);

/** 可选字符串字段：缺失合法；存在则须为不超 max 的字符串 */
function isBoundedOptionalString(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max);
}

/** 单个自定义字段：id/label/value 为字符串（label/value 限长）、secret 为布尔 */
function isIdentityCustomFieldShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.id === 'string' &&
    typeof f.label === 'string' &&
    f.label.length <= MAX_LABEL_LEN &&
    typeof f.value === 'string' &&
    f.value.length <= MAX_FIELD_VALUE_LEN &&
    typeof f.secret === 'boolean'
  );
}

/** 校验单条备份记录的结构（导入文件为不可信输入，边界处校验形状与长度上限） */
function isIdentityBackupRecord(value: unknown): value is IdentityBackupRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const payload = r.payload as Record<string, unknown> | null | undefined;
  if (
    typeof r.id !== 'string' ||
    typeof r.createTime !== 'number' ||
    typeof r.updateTime !== 'number' ||
    typeof payload !== 'object' ||
    payload === null ||
    !(typeof payload.category === 'string' && VALID_CATEGORIES.has(payload.category))
  ) {
    return false;
  }
  if (!BOUNDED_TEXT_FIELDS.every(key => isBoundedOptionalString(payload[key], MAX_FIELD_VALUE_LEN))) {
    return false;
  }
  if (!isBoundedOptionalString(payload.remark, MAX_REMARK_LEN)) {
    return false;
  }
  const customFields = payload.customFields;
  if (
    customFields !== undefined &&
    (!Array.isArray(customFields) ||
      customFields.length > MAX_CUSTOM_FIELDS ||
      !customFields.every(isIdentityCustomFieldShape))
  ) {
    return false;
  }
  return true;
}

/**
 * 校验并收窄解析后的 JSON 为 IdentityBackupData
 *
 * - `kind` 缺失或非 `'aphid'`（如把 .aph 密码备份喂进来）→ NOT_APHID；
 * - `version` 不等于当前 `APHID_VERSION`（缺失、非数字、或更高版本的前向不兼容文件）
 *   或 `records` 非数组 / **条数超过 `MAX_IDENTITIES`** / 记录形状非法（含 category 非已知枚举）
 *   → INVALID_STRUCTURE。
 *
 * 条数上限在逐记录形状校验之前拦截：导入文件为不可信输入，若先把 `records.every` 跑完
 * 再交给 UI 判上限，恶意/损坏的超大数组会触发一次无界的同步校验与内存分配。合法备份
 * （单次导出不超过全库 30 条上限）恒不触发此分支。
 */
export function parseIdentityBackupData(json: unknown): IdentityBackupData {
  const data = json as { kind?: unknown; version?: unknown; records?: unknown } | null;
  if (typeof data !== 'object' || data === null || data.kind !== APHID_KIND) {
    throw backupError('NOT_APHID');
  }
  if (
    data.version !== APHID_VERSION ||
    !Array.isArray(data.records) ||
    data.records.length > MAX_IDENTITIES ||
    !data.records.every(isIdentityBackupRecord)
  ) {
    throw backupError('INVALID_STRUCTURE');
  }
  return data as IdentityBackupData;
}

/**
 * 将 .aphid 明文数据加密为 `salt ‖ iv ‖ ciphertext` 字节
 *
 * @param data 明文备份数据
 * @param masterPassword 主密码（导出时的密码，与当前主密码无关）
 */
export async function encryptIdentityBackup(
  data: IdentityBackupData,
  masterPassword: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(masterPassword, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  const output = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  output.set(salt, 0);
  output.set(iv, salt.length);
  output.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return output;
}

/**
 * 解密并校验 .aphid 容器字节
 *
 * @param bytes 容器字节（salt ‖ iv ‖ ciphertext）
 * @param masterPassword 导出时使用的主密码
 * @throws INVALID_FILE / WRONG_PASSWORD / NOT_APHID / INVALID_STRUCTURE
 */
export async function decryptIdentityBackup(
  bytes: Uint8Array<ArrayBuffer>,
  masterPassword: string,
): Promise<IdentityBackupData> {
  if (bytes.length < SALT_LENGTH + IV_LENGTH + 1) {
    throw backupError('INVALID_FILE');
  }

  const salt = bytes.slice(0, SALT_LENGTH);
  const iv = bytes.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = bytes.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(masterPassword, salt);
  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch (error) {
    throw backupError('WRONG_PASSWORD', error);
  }

  const jsonStr = new TextDecoder().decode(decrypted);
  let json: unknown;
  try {
    json = JSON.parse(jsonStr);
  } catch (error) {
    // 能解出但非 JSON：结构损坏，归属 INVALID_STRUCTURE
    throw backupError('INVALID_STRUCTURE', error);
  }

  return parseIdentityBackupData(json);
}

/**
 * 导出身份信息备份（下载 .aphid 文件）
 *
 * @param entries 解密后的身份条目（含 id/createTime/updateTime/payload）
 * @param masterPassword 用于派生备份密钥的主密码
 */
export async function exportIdentityBackup(entries: IdentityEntry[], masterPassword: string): Promise<void> {
  try {
    const data = buildIdentityBackupData(entries);
    const output = await encryptIdentityBackup(data, masterPassword);

    const blob = new Blob([output], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = formatTimestampCompact();
    a.href = url;
    a.download = `identity_backup_${dateStr}.aphid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    logger.error('导出身份信息备份失败:', error);
    throw backupError('EXPORT_FAILED', error);
  }
}

/**
 * 导出身份信息明文备份（下载 .json，**不加密**）
 *
 * 仅供「迁移到其他工具 / 肉眼核对」使用：文件里是姓名、证件号、银行卡号、CVV
 * 等 PII 的原文，任何能访问该文件的人都能直接读取。调用方必须在 UI 层设置
 * 主密码复验 + 风险二次确认双重门槛。该明文 .json 复用 `.aphid` 数据结构，
 * 可经 {@link parseIdentityPlaintextJson} 在导入侧回导（同样须双门槛），但仍是
 * 长期留存的首选之外的例外通道——优先用加密 `.aphid` 备份。本函数不落任何密钥、
 * 不打印明文（catch 仅记 error 对象）。
 */
export function exportIdentityPlaintext(entries: IdentityEntry[]): void {
  try {
    const json = buildIdentityPlaintextJson(entries);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = formatTimestampCompact();
    a.href = url;
    a.download = `identity_export_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    logger.error('导出身份信息明文失败:', error);
    throw backupError('EXPORT_FAILED', error);
  }
}

/**
 * 导入身份信息备份（解密并校验，返回明文记录）
 *
 * 扩展名校验在 UI 层（el-upload accept + 二次校验，对标 BackupImportDialog）。
 *
 * @param file .aphid 文件
 * @param masterPassword 导出时使用的主密码
 * @throws INVALID_FILE / WRONG_PASSWORD / NOT_APHID / INVALID_STRUCTURE
 */
export async function importIdentityBackup(file: File, masterPassword: string): Promise<IdentityBackupData> {
  const buffer = await file.arrayBuffer();
  return decryptIdentityBackup(new Uint8Array(buffer), masterPassword);
}

/**
 * 解析明文导出 JSON 文本为备份数据（不解密，是 decryptIdentityBackup 的明文对偶）
 *
 * 复用 {@link parseIdentityBackupData}：同样强制 `kind === 'aphid'`、`version === APHID_VERSION`、
 * 记录形状/长度上限，以及 `category` 命中已知枚举，
 * 因此喂入密码库 `.aph` 或非身份库 JSON 会抛 NOT_APHID，结构损坏抛 INVALID_STRUCTURE。
 * 入参是磁盘上的不可信 PII 文本——调用方必须在解析前施加主密码复验 + 风险确认门槛，
 * 并在解析后走 mergeIdentityRecords 显式报告合并计数。
 */
export function parseIdentityPlaintextJson(text: string): IdentityBackupData {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw backupError('INVALID_STRUCTURE', error);
  }
  return parseIdentityBackupData(json);
}

/**
 * 按 id 合并（纯函数，不涉及加解密）
 *
 * 同 id 取较新 updateTime（更新时保留原有 createTime），其余追加；较旧的同 id
 * 记录计入 skipped。调用方据此显式报告「新增 N / 更新 M / 跳过 K」，不得静默合并。
 *
 * @param current 当前存储（解密后）的记录
 * @param incoming 备份导入的记录
 */
export function mergeIdentityRecords(
  current: IdentityBackupRecord[],
  incoming: IdentityBackupRecord[],
): IdentityMergeResult {
  const records = [...current];
  const indexById = new Map<string, number>(current.map((r, i) => [r.id, i]));

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const inc of incoming) {
    const idx = indexById.get(inc.id);
    if (idx === undefined) {
      indexById.set(inc.id, records.length);
      records.push(inc);
      added++;
    } else if (inc.updateTime > records[idx].updateTime) {
      records[idx] = { ...inc, createTime: records[idx].createTime };
      updated++;
    } else {
      skipped++;
    }
  }

  return { records, added, updated, skipped };
}
