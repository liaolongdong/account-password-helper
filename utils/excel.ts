import type { PasswordEntry } from '@/utils/types';
import type { ImportFormat } from '@/utils/excelFormatMap';
import { parseCSVBuffer, type CsvParseResult } from '@/utils/excelCsv';
import { parsePasswordJSON } from '@/utils/excelJson';
import {
  downloadTemplate as downloadCsvTemplate,
  exportToCSV as exportCsv,
  exportToJSON as exportJson,
} from '@/utils/excelExport';

/**
 * Excel / CSV / JSON 导入导出工具（门面）
 *
 * 具体实现按职责拆分到独立模块，本类只作为对外门面（方法名与语义保持稳定）：
 * - 列映射配置：`@/utils/excelFormatMap`
 * - CSV 导入解析：`@/utils/excelCsv`
 * - JSON 导入解析：`@/utils/excelJson`
 * - 导出与模板下载：`@/utils/excelExport`
 */
export class ExcelUtils {
  /**
   * 导出密码数据到 CSV（带 BOM，Excel 可直接双击打开且中文不乱码）
   */
  static exportToCSV(passwords: PasswordEntry[], filename: string = 'passwords.csv'): void {
    exportCsv(passwords, filename);
  }

  /**
   * 解析 CSV 文件为密码数据，支持多编码自动回退
   *
   * 返回 `{ entries, skipped }`：`skipped` 是没能带出的数据行及其原因，界面必须把它说出来——
   * 只回一个条数时，表头没被认出的用户看到的就只是「导入 0 条」这一句没用的话。
   * @param buffer CSV 文件原始字节
   * @param format 导入格式，'auto' 时自动检测
   */
  static parseCSV(buffer: ArrayBuffer, format: ImportFormat = 'auto'): CsvParseResult {
    return parseCSVBuffer(buffer, format);
  }

  /**
   * 下载 CSV 模板（Excel 可直接打开）
   */
  static downloadTemplate(): void {
    downloadCsvTemplate();
  }

  /**
   * 解析 JSON 文本为密码数据
   * 支持数组格式或 `{ entries: [...] }` 包裹格式，字段映射兼容中英文列名。
   */
  static parseJSON(text: string): Omit<PasswordEntry, 'id' | 'order'>[] {
    return parsePasswordJSON(text);
  }

  /**
   * 导出密码数据为 JSON 文件
   * 导出结构：`{ version, exportedAt, count, entries }`
   */
  static exportToJSON(passwords: PasswordEntry[], filename: string = 'passwords.json'): void {
    exportJson(passwords, filename);
  }
}
