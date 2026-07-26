/**
 * SidePanel 入口语言包注册模块
 *
 * 仅静态内置侧边栏依赖图实际使用的命名空间（common/message/sidepanel/fill/totp，
 * 约 100 个 key），替代全量语言包（575 key）静态打包：侧边栏首屏关键 JS
 * 减少约 100KB（gzip ~35KB），Windows 冷启动的读取/杀软扫描/V8 编译量同步下降。
 *
 * help 命名空间由 HelpDialog.vue 经 bundles/help 在自身懒加载 chunk 中注册，
 * 不占用首屏体积。新增侧边栏文案时若引入新命名空间，必须同步在此注册
 * （tests/utils/i18nBundles.test.ts 会静态扫描侧边栏源码校验 key 覆盖率）。
 *
 * @module utils/i18n/bundles/sidepanel
 */
import { registerMessages, type Messages } from '@/utils/i18n';
import zhCommon from '@/utils/i18n/locales/zh-CN/common.json';
import zhMessage from '@/utils/i18n/locales/zh-CN/message.json';
import zhSidepanel from '@/utils/i18n/locales/zh-CN/sidepanel.json';
import zhFill from '@/utils/i18n/locales/zh-CN/fill.json';
import zhTotp from '@/utils/i18n/locales/zh-CN/totp.json';
import enCommon from '@/utils/i18n/locales/en/common.json';
import enMessage from '@/utils/i18n/locales/en/message.json';
import enSidepanel from '@/utils/i18n/locales/en/sidepanel.json';
import enFill from '@/utils/i18n/locales/en/fill.json';
import enTotp from '@/utils/i18n/locales/en/totp.json';

registerMessages('zh-CN', zhCommon, zhMessage, zhSidepanel, zhFill, zhTotp as Messages);
registerMessages('en', enCommon, enMessage, enSidepanel, enFill, enTotp as Messages);
