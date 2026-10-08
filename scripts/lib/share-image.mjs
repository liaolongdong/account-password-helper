/**
 * 社交分享卡图片的单一口径：1200×630（1.91:1），中英各一张。
 *
 * 不复用商店 marquee（1400×560，2.5:1）：微信 / X / Telegram / Slack 一律按 1.91:1 取图，
 * 2.5:1 会被裁掉上下两条信息；反过来 1200×630 也不能替商店用，那是应用商店的硬规格。
 * 矢量源在 `imgs/store-creatives/og*.svg`，改完跑 `pnpm store-creatives:render` 栅格化到
 * `assets/cws-store/`。英文页必须用英文那张——此前 8 个已发布页面的 `og:image` 全都是中文
 * marquee，英文链接分享出去带的是一整张中文卡片。
 *
 * @file scripts/lib/share-image.mjs
 */

/** 站点绝对前缀（与各生成脚本里的 `SITE` 同值） */
const SITE = 'https://liaolongdong.github.io/account-password-helper';

/** 中文分享卡 */
export const OG_IMAGE_ZH = `${SITE}/assets/cws-store/og-1200x630.png`;

/** 英文分享卡 */
export const OG_IMAGE_EN = `${SITE}/assets/cws-store/og-en-1200x630.png`;
