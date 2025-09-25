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
        创建时间: new Date(p.createTime).toLocaleString()
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
        { wch: 20 } // 创建时间
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
  static async importFromExcel(file: File): Promise<Omit<PasswordEntry, 'id' | 'createTime' | 'order'>[]> {
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

            // 解析数据
            const passwords = jsonData
              .map((row: any) => {
                // 支持多种列名格式
                const username = row['用户名'] || row['username'] || row['Username'] || row['账号'] || '';
                const password = row['密码'] || row['password'] || row['Password'] || '';
                const url = row['URL'] || row['url'] || row['网址'] || row['链接'] || '';
                const tag = row['标签'] || row['tag'] || row['Tag'] || row['分类'] || '';
                const remark = row['备注'] || row['remark'] || row['Remark'] || row['说明'] || '';

                return {
                  username: String(username).trim(),
                  password: String(password).trim(),
                  url: String(url).trim(),
                  tag: String(tag).trim(),
                  remark: String(remark).trim()
                };
              })
              .filter(item => item.username && item.password); // 过滤掉没有用户名或密码的条目

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
          用户名: 'example@email.com',
          密码: 'password123',
          URL: 'https://example.com',
          标签: '工作',
          备注: '示例账号'
        }
      ];

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(templateData);

      // 设置列宽
      ws['!cols'] = [
        { wch: 20 }, // 用户名
        { wch: 20 }, // 密码
        { wch: 30 }, // URL
        { wch: 15 }, // 标签
        { wch: 30 } // 备注
      ];

      XLSX.utils.book_append_sheet(wb, ws, '密码模板');
      XLSX.writeFile(wb, 'password_template.xlsx');
    } catch (error) {
      console.error('下载模板失败:', error);
      throw new Error('下载模板失败');
    }
  }
}
