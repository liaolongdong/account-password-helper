import type { PasswordEntry } from '@/utils/types';
import { ExcelUtils } from '@/utils/excel';
import { formatDateTime, formatDate, formatTimestampCompact } from '@/utils/dateFormat';
import { t } from '@/utils/i18n';

/**
 * 邮箱备份工具类
 * 负责生成 Excel 文件并通过 mailto 协议唤起邮件客户端完成备份
 */
export class EmailBackupUtils {
  /**
   * 将密码列表备份到邮箱
   * 流程：生成 Excel 下载到本地 -> 构造 mailto 链接并打开邮件客户端
   *
   * @param passwords 待备份的密码列表
   * @param email     目标邮箱地址
   */
  static async backupToEmail(passwords: PasswordEntry[], email: string): Promise<void> {
    if (!email || !email.trim()) {
      throw new Error('目标邮箱地址不能为空');
    }
    if (passwords.length === 0) {
      throw new Error('没有可备份的密码数据');
    }

    // 生成带日期后缀的文件名：passwords_YYYYMMDD_HHmmss.csv
    const now = new Date();
    const filename = `passwords_${formatTimestampCompact(now)}.csv`;

    // 生成并下载 CSV 文件
    ExcelUtils.exportToCSV(passwords, filename);

    // 构造 mailto 链接，唤起邮件客户端
    const subject = t('form.emailSubject', { date: formatDate(now) });
    const body = [
      t('form.emailBodyTime', { time: formatDateTime(now) }),
      t('form.emailBodyCount', { count: passwords.length }),
      t('form.emailBodyFile', { filename }),
      '',
      t('form.emailBodySendCsv'),
    ].join('\n');

    const mailtoUrl = this.buildMailtoUrl(email, subject, body);
    window.open(mailtoUrl, '_blank');
  }

  /**
   * 构造 mailto URL
   *
   * @param email   收件人邮箱
   * @param subject 邮件主题
   * @param body    邮件正文
   * @returns 完整的 mailto 链接
   */
  static buildMailtoUrl(email: string, subject: string, body: string): string {
    const params = new URLSearchParams({
      subject,
      body,
    });
    return `mailto:${encodeURIComponent(email)}?${params.toString()}`;
  }

  /**
   * 验证邮箱格式是否合法
   *
   * @param email 待验证的邮箱地址
   * @returns 是否为合法邮箱格式
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
