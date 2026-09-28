/**
 * 帮助文案语言包注册模块（懒加载）
 *
 * help 命名空间（全量语言包中体量最大的单一命名空间）仅被 HelpDialog 使用，
 * 由 HelpDialog.vue 静态引入本模块——随其懒加载 chunk 一同按需加载注册，
 * 不进入侧边栏首屏关键路径。
 *
 * @module utils/i18n/bundles/help
 */
import { registerMessages, type Messages } from '@/utils/i18n';
import zhHelp from '@/utils/i18n/locales/zh-CN/help.json';
import enHelp from '@/utils/i18n/locales/en/help.json';

registerMessages('zh-CN', zhHelp as Messages);
registerMessages('en', enHelp as Messages);
