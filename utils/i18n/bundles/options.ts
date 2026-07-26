/**
 * Options 入口语言包注册模块（全量）
 *
 * Options 页面覆盖密码管理、导入导出、健康检测、备份等全部功能域，
 * 使用全部命名空间语言包；页面非高频打开且无冷启动白屏诉求，
 * 全量静态内置以保证任何功能路径下文案完整。
 *
 * @module utils/i18n/bundles/options
 */
import { registerMessages, type Messages } from '@/utils/i18n';
import zhAuth from '@/utils/i18n/locales/zh-CN/auth.json';
import zhBackup from '@/utils/i18n/locales/zh-CN/backup.json';
import zhCommon from '@/utils/i18n/locales/zh-CN/common.json';
import zhExcel from '@/utils/i18n/locales/zh-CN/excel.json';
import zhFill from '@/utils/i18n/locales/zh-CN/fill.json';
import zhForm from '@/utils/i18n/locales/zh-CN/form.json';
import zhHealth from '@/utils/i18n/locales/zh-CN/health.json';
import zhHelp from '@/utils/i18n/locales/zh-CN/help.json';
import zhMessage from '@/utils/i18n/locales/zh-CN/message.json';
import zhOptions from '@/utils/i18n/locales/zh-CN/options.json';
import zhPopup from '@/utils/i18n/locales/zh-CN/popup.json';
import zhSession from '@/utils/i18n/locales/zh-CN/session.json';
import zhSidepanel from '@/utils/i18n/locales/zh-CN/sidepanel.json';
import zhStrength from '@/utils/i18n/locales/zh-CN/strength.json';
import zhTotp from '@/utils/i18n/locales/zh-CN/totp.json';
import zhValidity from '@/utils/i18n/locales/zh-CN/validity.json';
import zhVerify from '@/utils/i18n/locales/zh-CN/verify.json';
import enAuth from '@/utils/i18n/locales/en/auth.json';
import enBackup from '@/utils/i18n/locales/en/backup.json';
import enCommon from '@/utils/i18n/locales/en/common.json';
import enExcel from '@/utils/i18n/locales/en/excel.json';
import enFill from '@/utils/i18n/locales/en/fill.json';
import enForm from '@/utils/i18n/locales/en/form.json';
import enHealth from '@/utils/i18n/locales/en/health.json';
import enHelp from '@/utils/i18n/locales/en/help.json';
import enMessage from '@/utils/i18n/locales/en/message.json';
import enOptions from '@/utils/i18n/locales/en/options.json';
import enPopup from '@/utils/i18n/locales/en/popup.json';
import enSession from '@/utils/i18n/locales/en/session.json';
import enSidepanel from '@/utils/i18n/locales/en/sidepanel.json';
import enStrength from '@/utils/i18n/locales/en/strength.json';
import enTotp from '@/utils/i18n/locales/en/totp.json';
import enValidity from '@/utils/i18n/locales/en/validity.json';
import enVerify from '@/utils/i18n/locales/en/verify.json';

registerMessages(
  'zh-CN',
  zhAuth,
  zhBackup,
  zhCommon,
  zhExcel,
  zhFill,
  zhForm,
  zhHealth,
  zhHelp,
  zhMessage,
  zhOptions,
  zhPopup,
  zhSession,
  zhSidepanel,
  zhStrength,
  zhTotp,
  zhValidity,
  zhVerify as Messages,
);
registerMessages(
  'en',
  enAuth,
  enBackup,
  enCommon,
  enExcel,
  enFill,
  enForm,
  enHealth,
  enHelp,
  enMessage,
  enOptions,
  enPopup,
  enSession,
  enSidepanel,
  enStrength,
  enTotp,
  enValidity,
  enVerify as Messages,
);
