import * as XLSX from 'xlsx';
import type { PasswordEntry } from './types';

export class ExcelUtils {
  /**
   * 导出密码数据到Excel
   */
  static exportToExcel(passwords: PasswordEntry[], filename: string = 'passwords.xlsx'): void {
    try {
      // 准备导出数据
      const exportData = passwords.map(p => ({
        用户名: p.username,
        密码: p.password,
        URL: p.url,
        标签: p.tag,
        备注: p.remark,
        创建时间: new Date(p.createTime || Date.now()).toLocaleString(),
        更新时间: new Date(p.updateTime || Date.now()).toLocaleString(),
      }));

      // 创建工作簿
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);

      // 设置列宽
      ws['!cols'] = [
        { wch: 20 }, // 用户名
        { wch: 20 }, // 密码
        { wch: 30 }, // URL
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
      console.error('导出Excel失败:', error);
      throw new Error('导出Excel失败');
    }
  }

  /**
   * 从Excel文件导入密码数据
   */
  static async importFromExcel(file: File): Promise<Omit<PasswordEntry, 'id' | 'order'>[]> {
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
            console.error('解析Excel文件失败:', error);
            reject(new Error('Excel文件格式不正确'));
          }
        };

        reader.onerror = () => {
          reject(new Error('读取文件失败'));
        };

        reader.readAsBinaryString(file);
      } catch (error) {
        console.error('导入Excel失败:', error);
        reject(new Error('导入Excel失败'));
      }
    });
  }

  /**
   * 下载模板文件
   */
  static downloadTemplate(): void {
    try {
      const templateData = [
        {
          '用户名(必填)': 'example@email.com',
          密码: 'password123',
          URL: 'https://example.com',
          标签: '工作',
          备注: '示例账号',
          创建时间: new Date().toLocaleDateString(),
          更新时间: new Date().toLocaleDateString(),
        },
      ];

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(templateData);

      // 设置列宽
      ws['!cols'] = [
        { wch: 20 }, // 用户名
        { wch: 20 }, // 密码
        { wch: 30 }, // URL
        { wch: 15 }, // 标签
        { wch: 30 }, // 备注
        { wch: 20 }, // 创建时间
        { wch: 20 }, // 更新时间
      ];

      XLSX.utils.book_append_sheet(wb, ws, '密码模板');
      XLSX.writeFile(wb, 'password_template.xlsx');
    } catch (error) {
      console.error('下载模板失败:', error);
      throw new Error('下载模板失败');
    }
  }
}
