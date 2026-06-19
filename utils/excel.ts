// import * as XLSX from 'xlsx';
import type { PasswordEntry } from '@/utils/types';
import { formatDate } from '@/utils/dateFormat';
import { logger } from '@/utils/logger';

/** 导入格式类型 */
export type ImportFormat = 'auto' | 'chrome' | 'lastpass' | 'bitwarden' | '1password';

/** CSV 列映射配置 */
interface CsvColumnMapping {
  username: string[];
  password: string[];
  url: string[];
  tag: string[];
  remark: string[];
}

/** 各格式列映射配置 */
const FORMAT_COLUMN_MAP: Record<Exclude<ImportFormat, 'auto'>, CsvColumnMapping> = {
  chrome: {
    username: ['username', 'Username'],
    password: ['password', 'Password'],
    url: ['url', 'URL', 'origin'],
    tag: ['name', 'Name'],
    remark: ['note', 'Note'],
  },
  lastpass: {
    username: ['username', 'Username'],
    password: ['password', 'Password'],
    url: ['url', 'URL'],
    tag: ['grouping', 'Grouping'],
    remark: ['extra', 'Extra'],
  },
  bitwarden: {
    username: ['login_username', 'Login Username'],
    password: ['login_password', 'Login Password'],
    url: ['login_uri', 'Login URI'],
    tag: ['folder', 'Folder'],
    remark: ['notes', 'Notes'],
  },
  '1password': {
    username: ['Username', 'username'],
    password: ['Password', 'password'],
    url: ['Url', 'URL', 'url'],
    tag: ['Title', 'title'],
    remark: ['Notes', 'notes'],
  },
};

export class ExcelUtils {
  /**
   * 导出密码数据到Excel
   */
  static async exportToExcel(passwords: PasswordEntry[], filename: string = 'passwords.xlsx'): Promise<void> {
    const XLSX = await import('xlsx');
    try {
      // 准备导出数据
      const exportData = passwords.map(p => ({
        用户名: p.username,
        密码: p.password,
        网站地址: p.url,
        标签: p.tag,
        备注: p.remark,
        创建时间: formatDate(p.createTime || Date.now()),
        更新时间: formatDate(p.updateTime || Date.now()),
      }));

      // 创建工作簿
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);

      // 设置列宽
      ws['!cols'] = [
        { wch: 20 }, // 用户名
        { wch: 20 }, // 密码
        { wch: 30 }, // 网站地址
        { wch: 15 }, // 标签
        { wch: 30 }, // 备注
        { wch: 20 }, // 创建时间
        { wch: 20 }, // 更新时间
      ];

      // 添加工作表到工作簿
      XLSX.utils.book_append_sheet(wb, ws, '密码数据');

      // 导出文件
      XLSX.writeFile(wb, filename);
    } catch (error) {
      logger.error('导出Excel失败:', error);
      const err = new Error('导出Excel失败');
      (err as any).cause = error;
      throw err;
    }
  }

  /**
   * 从Excel文件导入密码数据
   */
  static async importFromExcel(file: File): Promise<Omit<PasswordEntry, 'id' | 'order'>[]> {
    const XLSX = await import('xlsx');
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();

        reader.onload = e => {
          try {
            const data = e.target?.result;
            const workbook = XLSX.read(data, { type: 'binary' });

            // 读取第一个工作表
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // 转换为JSON
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            // 解析时间戳：支持 number 或可被 Date.parse 解析的字符串
            const parseTimestamp = (v: unknown): number | undefined => {
              if (v == null || v === '') return undefined;
              if (typeof v === 'number' && Number.isFinite(v)) return v;
              const t = Date.parse(String(v));
              return Number.isNaN(t) ? undefined : t;
            };

            // 解析数据
            const passwords = jsonData
              .map((row: any) => {
                // 支持多种列名格式
                const username =
                  row['用户名(必填)'] || row['用户名'] || row['username'] || row['Username'] || row['账号'] || '';
                const password = row['密码'] || row['password'] || row['Password'] || '';
                const url = row['URL'] || row['url'] || row['网址'] || row['链接'] || '';
                const tag = row['标签'] || row['tag'] || row['Tag'] || row['分类'] || '';
                const remark = row['备注'] || row['remark'] || row['Remark'] || row['说明'] || '';

                // 时间字段策略：保留原表时间，仅缺失时统一为同一时间戳
                const cTime = parseTimestamp(row['创建时间'] ?? row['createTime'] ?? row['CreateTime']);
                const uTime = parseTimestamp(
                  row['更新时间'] ?? row['updateTime'] ?? row['UpdateTime'] ?? row['修改时间'] ?? row['modifyTime'],
                );
                const now = Date.now();
                let createTime: number;
                let updateTime: number;
                if (cTime != null && uTime != null) {
                  createTime = cTime;
                  updateTime = uTime;
                } else if (cTime != null) {
                  createTime = cTime;
                  updateTime = cTime;
                } else if (uTime != null) {
                  createTime = uTime;
                  updateTime = uTime;
                } else {
                  createTime = now;
                  updateTime = now;
                }

                return {
                  username: String(username).trim(),
                  password: String(password).trim(),
                  url: String(url).trim(),
                  tag: String(tag).trim(),
                  remark: String(remark).trim(),
                  createTime,
                  updateTime,
                };
              })
              .filter(item => item.username); // 过滤掉没有用户名的条目

            resolve(passwords);
          } catch (error) {
            logger.error('解析Excel文件失败:', error);
            reject(new Error('Excel文件格式不正确'));
          }
        };

        reader.onerror = () => {
          reject(new Error('读取文件失败'));
        };

        reader.readAsBinaryString(file);
      } catch (error) {
        logger.error('导入Excel失败:', error);
        reject(new Error('导入Excel失败'));
      }
    });
  }

  /**
   * 解析 CSV 文本为密码数据
   * @param text CSV 文本内容
   * @param format 导入格式，'auto' 时自动检测
   */
  static parseCSV(text: string, format: ImportFormat = 'auto'): Omit<PasswordEntry, 'id' | 'order'>[] {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return []; // 至少需要表头 + 1行数据

    // 解析表头
    const headers = this.parseCSVLine(lines[0]);

    // 确定使用哪个列映射
    let mapping: CsvColumnMapping;
    if (format === 'auto') {
      mapping = this.detectFormat(headers);
    } else {
      mapping = FORMAT_COLUMN_MAP[format];
    }

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
        createTime: now,
        updateTime: now,
      });
    }

    return results;
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
  static async downloadTemplate(): Promise<void> {
    const XLSX = await import('xlsx');
    try {
      const templateData = [
        {
          '用户名(必填)': 'example@email.com',
          密码: 'password123',
          网站地址: 'https://example.com',
          标签: '工作',
          备注: '示例账号',
          创建时间: formatDate(Date.now()),
          更新时间: formatDate(Date.now()),
        },
      ];

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(templateData);

      // 设置列宽
      ws['!cols'] = [
        { wch: 20 }, // 用户名
        { wch: 20 }, // 密码
        { wch: 30 }, // 网站地址
        { wch: 15 }, // 标签
        { wch: 30 }, // 备注
        { wch: 20 }, // 创建时间
        { wch: 20 }, // 更新时间
      ];

      XLSX.utils.book_append_sheet(wb, ws, '密码模板');
      XLSX.writeFile(wb, 'password_template.xlsx');
    } catch (error) {
      logger.error('下载模板失败:', error);
      const err = new Error('下载模板失败');
      (err as any).cause = error;
      throw err;
    }
  }
}
