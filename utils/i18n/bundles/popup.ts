/**
 * Popup 入口语言包注册模块
 *
 * 静态内置 popup 依赖图使用的命名空间（common/message/popup/auth/session/verify，
 * 约 110 个 key），替代全量语言包静态打包，加速 popup 首帧。
 * 新增 popup 文案若引入新命名空间，必须同步在此注册。
 *
 * @module utils/i18n/bundles/popup
 */
import { registerMessages, type Messages } from '@/utils/i18n';
import zhCommon from '@/utils/i18n/locales/zh-CN/common.json';
import zhMessage from '@/utils/i18n/locales/zh-CN/message.json';
import zhPopup from '@/utils/i18n/locales/zh-CN/popup.json';
import zhAuth from '@/utils/i18n/locales/zh-CN/auth.json';
import zhSession from '@/utils/i18n/locales/zh-CN/session.json';
import zhVerify from '@/utils/i18n/locales/zh-CN/verify.json';
import enCommon from '@/utils/i18n/locales/en/common.json';
import enMessage from '@/utils/i18n/locales/en/message.json';
import enPopup from '@/utils/i18n/locales/en/popup.json';
import enAuth from '@/utils/i18n/locales/en/auth.json';
import enSession from '@/utils/i18n/locales/en/session.json';
import enVerify from '@/utils/i18n/locales/en/verify.json';

registerMessages('zh-CN', zhCommon, zhMessage, zhPopup, zhAuth, zhSession, zhVerify as Messages);
registerMessages('en', enCommon, enMessage, enPopup, enAuth, enSession, enVerify as Messages);
