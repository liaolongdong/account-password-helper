import type { PasswordEntry } from '@/utils/types';
import { formatDate } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';

/** 导入格式类型 */
export type ImportFormat = 'auto' | 'native' | 'chrome' | 'lastpass' | 'bitwarden' | '1password';

/** CSV 列映射配置 */
interface CsvColumnMapping {
  username: string[];
  password: string[];
  url: string[];
  tag: string[];
  remark: string[];
  totp: string[];
}

/** 各格式列映射配置 */
const FORMAT_COLUMN_MAP: Record<Exclude<ImportFormat, 'auto'>, CsvColumnMapping> = {
  native: {
    username: ['用户名(必填)', '用户名', '账号', 'username', 'Username'],
    password: ['密码', 'password', 'Password'],
    url: ['网址', 'URL', 'url', '网站地址', '链接'],
    tag: ['标签', 'tag', 'Tag', '分类'],
    remark: ['备注', 'remark', 'Remark', '说明'],
    totp: ['两步验证', 'TOTP', 'totp', '密钥'],
  },
  chrome: {
    username: ['username', 'Username'],
    password: ['password', 'Password'],
    url: ['url', 'URL', 'origin'],
    tag: ['name', 'Name'],
    remark: ['note', 'Note'],
    totp: ['otpauth', 'otp_auth'],
  },
  lastpass: {
    username: ['username', 'Username'],
    password: ['password', 'Password'],
    url: ['url', 'URL'],
    tag: ['grouping', 'Grouping'],
    remark: ['extra', 'Extra'],
    totp: ['totp', 'TOTP'],
  },
  bitwarden: {
    username: ['login_username', 'Login Username'],
    password: ['login_password', 'Login Password'],
    url: ['login_uri', 'Login URI'],
    tag: ['folder', 'Folder'],
    remark: ['notes', 'Notes'],
    totp: ['login_totp', 'Login TOTP'],
  },
  '1password': {
    username: ['Username', 'username'],
    password: ['Password', 'password'],
    url: ['Url', 'URL', 'url'],
    tag: ['Title', 'title'],
    remark: ['Notes', 'notes'],
    totp: ['OTPAuth', 'otpauth', 'totp'],
  },
};

export class ExcelUtils {
  /**
   * 导出密码数据到 CSV（带 BOM，Excel 可直接双击打开且中文不乱码）
   */
  static exportToCSV(passwords: PasswordEntry[], filename: string = 'passwords.csv'): void {
    try {
      const headers = ['用户名', '密码', '网址', '标签', '备注', '两步验证', '创建时间', '更新时间'];
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
      const csv = [headers, ...rows]
        .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('导出CSV失败:', error);
      const err = new Error('导出CSV失败');
      (err as any).cause = error;
      throw err;
    }
  }

  /**
   * 解析 CSV 文件为密码数据，支持多编码自动回退
   * @param buffer CSV 文件原始字节
   * @param format 导入格式，'auto' 时自动检测
   */
  static parseCSV(buffer: ArrayBuffer, format: ImportFormat = 'auto'): Omit<PasswordEntry, 'id' | 'order'>[] {
    // 优先使用 UTF-8 解码
    const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    let results = this.parseCSVFromText(utf8Text, format);

    if (results.length === 0) {
      // UTF-8 无结果时尝试 GBK 解码（WPS / 中文 Excel 常见编码）
      try {
        const gbkText = new TextDecoder('gbk', { fatal: false }).decode(buffer);
        // 仅在解码结果不同时才重试（避免相同文本重复解析）
        if (gbkText !== utf8Text) {
          logger.info('UTF-8 解析无结果，尝试 GBK 编码回退');
          results = this.parseCSVFromText(gbkText, format);
          if (results.length > 0) {
            logger.info(`GBK 编码回退成功，解析出 ${results.length} 条数据`);
          }
        }
      } catch {
        // 当前环境不支持 GBK 解码器，忽略
      }
    }

    if (results.length === 0) {
      logger.warn('CSV 解析结果为空，请检查文件编码和格式');
    }

    return results;
  }

  /**
   * 从文本解析 CSV（内部方法，已处理 BOM 和编码）
   */
  private static parseCSVFromText(text: string, format: ImportFormat): Omit<PasswordEntry, 'id' | 'order'>[] {
    // 去除 BOM，防止首个表头字段被污染（如 \uFEFF用户名(必填)）
    const cleanText = text.replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return []; // 至少需要表头 + 1行数据

    // 解析表头
    const headers = this.parseCSVLine(lines[0]);
    logger.info('CSV 解析表头:', headers);

    // 确定使用哪个列映射
    let mapping: CsvColumnMapping;
    let detectedFormatName: string;
    if (format === 'auto') {
      mapping = this.detectFormat(headers);
      detectedFormatName = this.getDetectedFormatName(mapping);
      logger.info(`CSV 自动检测格式: ${detectedFormatName}`);
    } else {
      mapping = FORMAT_COLUMN_MAP[format];
      detectedFormatName = format;
    }

    let results = this.parseRowsWithMapping(lines, headers, mapping);

    // 格式回退：auto 模式下若首轮解析无结果，遍历其他格式尝试
    if (format === 'auto' && results.length === 0) {
      const allFormats = Object.keys(FORMAT_COLUMN_MAP) as Exclude<ImportFormat, 'auto'>[];
      for (const fmt of allFormats) {
        if (FORMAT_COLUMN_MAP[fmt] === mapping) continue; // 跳过已尝试的格式
        const altResults = this.parseRowsWithMapping(lines, headers, FORMAT_COLUMN_MAP[fmt]);
        if (altResults.length > 0) {
          logger.info(
            `自动检测格式 '${detectedFormatName}' 无结果，回退到 '${fmt}' 格式，解析出 ${altResults.length} 条数据`,
          );
          results = altResults;
          break;
        }
      }
    }

    if (results.length === 0) {
      logger.warn('CSV 解析无有效数据，表头:', headers, '检测格式:', detectedFormatName);
    }

    return results;
  }

  /**
   * 使用指定列映射解析数据行
   */
  private static parseRowsWithMapping(
    lines: string[],
    headers: string[],
    mapping: CsvColumnMapping,
  ): Omit<PasswordEntry, 'id' | 'order'>[] {
    const now = Date.now();
    const results: Omit<PasswordEntry, 'id' | 'order'>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length < 2) continue;

      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });

      const username = this.findColumn(row, mapping.username);
      if (!username) continue;

      results.push({
        username: username.trim(),
        password: (this.findColumn(row, mapping.password) || '').trim(),
        url: (this.findColumn(row, mapping.url) || '').trim(),
        tag: (this.findColumn(row, mapping.tag) || '').trim(),
        remark: (this.findColumn(row, mapping.remark) || '').trim(),
        totp: (this.findColumn(row, mapping.totp) || '').trim(),
        createTime: now,
        updateTime: now,
      });
    }

    return results;
  }

  /**
   * 根据映射对象反查格式名称（用于日志）
   */
  private static getDetectedFormatName(mapping: CsvColumnMapping): string {
    const entries = Object.entries(FORMAT_COLUMN_MAP) as [Exclude<ImportFormat, 'auto'>, CsvColumnMapping][];
    for (const [name, map] of entries) {
      if (map === mapping) return name;
    }
    return 'chrome';
  }

  /**
   * 解析单行 CSV（支持引号包裹的字段）
   */
  private static parseCSVLine(line: string): string[] {
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
  private static detectFormat(headers: string[]): CsvColumnMapping {
    const headerSet = new Set(headers.map(h => h.toLowerCase()));

    // Chrome: name,url,username,password
    if (headerSet.has('origin') || (headerSet.has('name') && headerSet.has('username') && headerSet.has('password'))) {
      return FORMAT_COLUMN_MAP.chrome;
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
  private static findColumn(row: Record<string, string>, candidates: string[]): string {
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

  /**
   * 下载模板文件
   */
  /**
   * 下载 CSV 模板（Excel 可直接打开）
   */
  static downloadTemplate(): void {
    const now = formatDate(Date.now());
    const csv = [
      ['用户名(必填)', '密码', '网址', '标签', '备注', '两步验证', '创建时间', '更新时间'],
      ['example@email.com', 'password123', 'https://example.com', '工作', '示例账号', '', now, now],
    ]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'password_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==================== JSON 格式支持 ====================

  /**
   * 解析 JSON 文本为密码数据
   * 支持数组格式或 `{ entries: [...] }` 包裹格式，字段映射兼容中英文列名。
   *
   * @param text JSON 文本内容
   * @returns 解析后的密码数据数组
   */
  static parseJSON(text: string): Omit<PasswordEntry, 'id' | 'order'>[] {
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

  /**
   * 导出密码数据为 JSON 文件
   * 导出结构：`{ version, exportedAt, count, entries }`
   *
   * @param passwords 待导出的密码列表
   * @param filename  导出文件名，默认 `passwords.json`
   */
  static exportToJSON(passwords: PasswordEntry[], filename: string = 'passwords.json'): void {
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
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('导出 JSON 失败:', error);
      const err = new Error('导出 JSON 失败');
      (err as any).cause = error;
      throw err;
    }
  }
}
