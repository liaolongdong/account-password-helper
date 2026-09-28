import type { Locale } from '@/utils/i18n';
import type { PasswordEntry } from '@/utils/types';

/**
 * 分享卡片文本构造（纯函数，无 DOM / 无 i18n 运行时依赖）
 *
 * 把单条凭据编排为「用户名 / 密码 / 网址」一段纯文本（网址为空时省略该行，实际 2~3 行），
 * 供侧边栏与管理页详情抽屉两套彼此独立的剪贴板自动清除实现共用（前者在
 * `composables/useSidepanelFill.ts` 内持有定时器，后者为 `utils/clipboard.ts`，
 * 混用会产生两个互不知情的清除器）。
 *
 * 设计约定：
 * - 标签与语言由调用方注入。本模块不自行调用 `t()`，以免耦合 `utils/i18n/bundles/`
 *   的命名空间注册，并保持在 `tests/utils/i18nBundles.test.ts` 静态扫描范围之外
 *   （该测试只扫入口依赖图文件，工具模块属盲区）。
 * - 本模块产物含明文密码，**严禁**在此处或调用方写入日志。
 *
 * @module utils/shareCard
 */

/** 卡片字段来源：仅取卡片所需字段，备注 / 标签 / TOTP 在类型层即不可见 */
export type ShareCardSource = Pick<PasswordEntry, 'username' | 'password' | 'url'>;

/** 已翻译的字段标签，由调用方经 `t('common.username')` 等既有词条解析后传入 */
export interface ShareCardLabels {
  /** 用户名字段标签 */
  username: string;
  /** 密码字段标签 */
  password: string;
  /** 网址字段标签 */
  url: string;
}

/** 简体中文用全角冒号且其后不加空格（CJK 排版），其他语言用 ASCII 冒号加空格 */
const FIELD_SEPARATOR: Record<Locale, string> = {
  'zh-CN': '：',
  en: ': ',
};

/**
 * 折叠值内的换行为空格
 *
 * 存储字段属不可信输入，值内换行会破坏「一行一字段」的结构、造成行注入，
 * 使接收方粘到的内容多出未知行。仅折叠换行，**不 trim、不转义**：
 * 用户名与密码需逐字保真，否则复制出的凭据不可用。
 *
 * @param value 字段原始值
 * @returns 单行化后的值
 */
const flattenFieldValue = (value: string): string => value.replace(/\r?\n/g, ' ');

/**
 * 判断卡片是否真的带上明文密码
 *
 * 「卡片含明文密码」既是安全前提也是提示语义：条目密码为空（含纯空白）时密码行是个
 * 空值，卡片交付不了可用凭据，此时仍提示「分享卡片已复制」会让分享者以为已经分享完整。
 * 判空口径与网址行的 `trim()` 规则保持一致。
 *
 * @param source 条目的三个待分享字段
 * @returns 密码字段是否有实际内容
 */
export function hasShareCardPassword(source: ShareCardSource): boolean {
  return source.password.trim() !== '';
}

/**
 * 构造分享卡片文本
 *
 * 行序固定为用户名、密码、网址；网址为空（含纯空白）时整行省略，
 * 与管理页详情抽屉「匹配所有站点」的空 URL 语义保持一致。
 * 输出不含表头与尾随换行——尾随换行粘贴进聊天框会触发误发送。
 *
 * @param source 条目的三个待分享字段
 * @param labels 已翻译的字段标签
 * @param locale 当前界面语言，决定冒号排版
 * @returns 2~3 行纯文本卡片
 */
export function buildShareCard(source: ShareCardSource, labels: ShareCardLabels, locale: Locale): string {
  const sep = FIELD_SEPARATOR[locale];
  const lines = [
    `${labels.username}${sep}${flattenFieldValue(source.username)}`,
    `${labels.password}${sep}${flattenFieldValue(source.password)}`,
  ];

  // 逐字输出 URL：卡片是可粘贴文本、不构成导航 sink，故无协议注入面；
  // 若改用 utils/domain 的 toNavigableUrl 会补协议、改写本地域名并对 javascript: 返回 null，
  // 等于静默篡改用户存储的原始值甚至丢整行。
  if (source.url.trim() !== '') {
    lines.push(`${labels.url}${sep}${flattenFieldValue(source.url)}`);
  }

  return lines.join('\n');
}
