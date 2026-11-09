import type { PasswordEntry } from '@/utils/types';
import { logger } from '@/utils/logger';
import { type CsvColumnMapping, FORMAT_COLUMN_MAP, type ImportFormat } from '@/utils/excelFormatMap';
import { validateAndBoundEntries } from '@/utils/backup/parseBackupEntries';

/**
 * CSV 导入解析
 *
 * 从 excel.ts 拆分而来，负责将上传的 CSV 字节解析为密码数据。
 * 支持多编码回退（UTF-8 → GBK）、格式自动检测与显式格式列映射。
 * `ExcelUtils.parseCSV` 委托本模块的 {@link parseCSVBuffer}。
 */

/**
 * 一行没能带出来的原因
 *
 * 只有这两种是「静默丢行」能解释的：列数不足（多半是单列文本被当成表格）、
 * 账号列为空（表头没被认成账号列，或那一行确实没填账号）。
 */
export type ImportSkipReason = 'too-few-columns' | 'missing-username';

/**
 * 逐行跳过记录
 *
 * 只允许 `row`（数据行序号，表头不算、空行不占号）与 `reason` 两个键：导入文件里被丢掉的那一列
 * 很可能就是明文口令，把原值回显到界面或留在内存对象里都是新的泄漏面。
 */
export interface ImportSkippedRow {
  row: number;
  reason: ImportSkipReason;
}

/** CSV 解析结果：可入库的条目 + 未能带出的行 */
export interface CsvParseResult {
  entries: Omit<PasswordEntry, 'id' | 'order'>[];
  skipped: ImportSkippedRow[];
}

/** 一组同原因的跳过行 */
export interface ImportSkippedGroup {
  reason: ImportSkipReason;
  /** 用于展示的行号（已按上限截断） */
  rows: number[];
  /** 没列出来的剩余行数，0 表示已全部列出 */
  more: number;
}

/**
 * 把逐行跳过记录按原因归组，供界面成句展示
 *
 * 抽成纯函数有两个理由：界面只该管「怎么说」，不该管「怎么算」；而整份文件表头错位时会有
 * 几千行被跳过，全部列出来等于把对话框变成滚动条，所以行号在这里就截断。
 *
 * @param skipped 解析层给出的逐行记录
 * @param limit 每组最多列几个行号
 */
export function groupSkippedRows(skipped: ImportSkippedRow[], limit = 10): ImportSkippedGroup[] {
  const byReason = new Map<ImportSkipReason, number[]>();
  for (const row of skipped) {
    const list = byReason.get(row.reason);
    if (list) list.push(row.row);
    else byReason.set(row.reason, [row.row]);
  }

  return [...byReason.entries()].map(([reason, rows]) => ({
    reason,
    rows: rows.slice(0, limit),
    more: Math.max(0, rows.length - limit),
  }));
}

/**
 * 解析 CSV 文件为密码数据，支持多编码自动回退
 * @param buffer CSV 文件原始字节
 * @param format 导入格式，'auto' 时自动检测
 */
export function parseCSVBuffer(buffer: ArrayBuffer, format: ImportFormat = 'auto'): CsvParseResult {
  // 优先使用 UTF-8 解码
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  let parsed = parseCSVFromText(utf8Text, format);

  if (parsed.entries.length === 0) {
    // UTF-8 无结果时尝试 GBK 解码（WPS / 中文 Excel 常见编码）
    try {
      const gbkText = new TextDecoder('gbk', { fatal: false }).decode(buffer);
      // 仅在解码结果不同时才重试（避免相同文本重复解析）
      if (gbkText !== utf8Text) {
        logger.info('UTF-8 解析无结果，尝试 GBK 编码回退');
        const alt = parseCSVFromText(gbkText, format);
        if (alt.entries.length > 0) {
          logger.info(`GBK 编码回退成功，解析出 ${alt.entries.length} 条数据`);
          parsed = alt;
        }
      }
    } catch {
      // 当前环境不支持 GBK 解码器，忽略
    }
  }

  if (parsed.entries.length === 0) {
    logger.warn('CSV 解析结果为空，请检查文件编码和格式');
  }

  // B4：与 JSON / .aph 导入共用同一份边界口径（条数上界 + 逐字段长度上限）。
  // 跳过记录跟着**被采纳的那一次解析**走：编码回退成功后不能留下上一轮的陈旧原因。
  return { entries: validateAndBoundEntries(parsed.entries), skipped: parsed.skipped };
}

/**
 * 从文本解析 CSV（已处理 BOM 和编码）
 */
function parseCSVFromText(text: string, format: ImportFormat): CsvParseResult {
  // 去除 BOM，防止首个表头字段被污染（如 \uFEFF用户名(必填)）
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return { entries: [], skipped: [] }; // 至少需要表头 + 1行数据

  // 解析表头
  const headers = parseCSVLine(lines[0]);
  logger.info('CSV 解析表头:', headers);

  // 确定使用哪个列映射
  let mapping: CsvColumnMapping;
  let detectedFormatName: string;
  if (format === 'auto') {
    mapping = detectFormat(headers);
    detectedFormatName = getDetectedFormatName(mapping);
    logger.info(`CSV 自动检测格式: ${detectedFormatName}`);
  } else {
    mapping = FORMAT_COLUMN_MAP[format];
    detectedFormatName = format;
  }

  let parsed = parseRowsWithMapping(lines, headers, mapping);

  // 格式回退：auto 模式下若首轮解析无结果，遍历其他格式尝试
  if (format === 'auto' && parsed.entries.length === 0) {
    const allFormats = Object.keys(FORMAT_COLUMN_MAP) as Exclude<ImportFormat, 'auto'>[];
    for (const fmt of allFormats) {
      if (FORMAT_COLUMN_MAP[fmt] === mapping) continue; // 跳过已尝试的格式
      const alt = parseRowsWithMapping(lines, headers, FORMAT_COLUMN_MAP[fmt]);
      if (alt.entries.length > 0) {
        logger.info(
          `自动检测格式 '${detectedFormatName}' 无结果，回退到 '${fmt}' 格式，解析出 ${alt.entries.length} 条数据`,
        );
        parsed = alt;
        break;
      }
    }
  }

  if (parsed.entries.length === 0) {
    logger.warn('CSV 解析无有效数据，表头:', headers, '检测格式:', detectedFormatName);
  }

  return parsed;
}

/**
 * 使用指定列映射解析数据行
 */
function parseRowsWithMapping(lines: string[], headers: string[], mapping: CsvColumnMapping): CsvParseResult {
  const now = Date.now();
  const entries: Omit<PasswordEntry, 'id' | 'order'>[] = [];
  const skipped: ImportSkippedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 2) {
      skipped.push({ row: i, reason: 'too-few-columns' });
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });

    const username = findColumn(row, mapping.username);
    if (!username) {
      skipped.push({ row: i, reason: 'missing-username' });
      continue;
    }

    entries.push({
      username: username.trim(),
      password: (findColumn(row, mapping.password) || '').trim(),
      url: (findColumn(row, mapping.url) || '').trim(),
      tag: (findColumn(row, mapping.tag) || '').trim(),
      remark: (findColumn(row, mapping.remark) || '').trim(),
      totp: (findColumn(row, mapping.totp) || '').trim(),
      createTime: now,
      updateTime: now,
    });
  }

  return { entries, skipped };
}

/**
 * 根据映射对象反查格式名称（用于日志）
 */
function getDetectedFormatName(mapping: CsvColumnMapping): string {
  const entries = Object.entries(FORMAT_COLUMN_MAP) as [Exclude<ImportFormat, 'auto'>, CsvColumnMapping][];
  for (const [name, map] of entries) {
    if (map === mapping) return name;
  }
  return 'chrome';
}

/**
 * 解析单行 CSV（支持引号包裹的字段）
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * 根据表头自动检测格式
 */
function detectFormat(headers: string[]): CsvColumnMapping {
  const headerSet = new Set(headers.map(h => h.toLowerCase()));

  // Chrome: name,url,username,password
  if (headerSet.has('origin') || (headerSet.has('name') && headerSet.has('username') && headerSet.has('password'))) {
    return FORMAT_COLUMN_MAP.chrome;
  }
  // 自有模板：英文表头（英文导出含 TOTP 列，需早于 LastPass 的 totp 判定，避免标签/备注列丢失）
  if (headerSet.has('username (required)') || (headerSet.has('tag') && headerSet.has('remark'))) {
    return FORMAT_COLUMN_MAP.native;
  }
  // LastPass: url,username,password,totp,extra,name,grouping,fav
  if (headerSet.has('grouping') || headerSet.has('totp')) {
    return FORMAT_COLUMN_MAP.lastpass;
  }
  // Bitwarden: folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password
  if (headerSet.has('login_uri') || headerSet.has('login_username') || headerSet.has('reprompt')) {
    return FORMAT_COLUMN_MAP.bitwarden;
  }
  // 1Password: Title,Url,Username,Password,Notes
  if (headerSet.has('title') && headerSet.has('notes')) {
    return FORMAT_COLUMN_MAP['1password'];
  }
  // 自有模板：中文表头（用户名(必填)、用户名、账号、密码 等）
  if (headerSet.has('用户名(必填)') || headerSet.has('用户名') || headerSet.has('账号')) {
    return FORMAT_COLUMN_MAP.native;
  }

  // 默认使用 Chrome 映射
  return FORMAT_COLUMN_MAP.chrome;
}

/**
 * 根据列映射配置查找对应列值
 */
function findColumn(row: Record<string, string>, candidates: string[]): string {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
    // 大小写不敏感回退
    const lowerKey = key.toLowerCase();
    for (const rowKey of Object.keys(row)) {
      if (rowKey.toLowerCase() === lowerKey && row[rowKey] !== '') return row[rowKey];
    }
  }
  return '';
}
