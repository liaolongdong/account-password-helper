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
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** 站点绝对前缀（与各生成脚本里的 `SITE` 同值） */
const SITE = 'https://liaolongdong.github.io/account-password-helper';

/** 中文分享卡 */
export const OG_IMAGE_ZH = `${SITE}/assets/cws-store/og-1200x630.png`;

/** 英文分享卡 */
export const OG_IMAGE_EN = `${SITE}/assets/cws-store/og-en-1200x630.png`;

/**
 * 分享卡的 `og:image:alt`，按语言分流。
 *
 * 描述的是**卡片画面本身**而不是页面摘要：读屏用户与图片加载失败时看到的就是这张图，
 * 文字取自矢量源 `imgs/store-creatives/og*.svg` 里的三条卖点，不引入新事实。
 */
export const OG_IMAGE_ALT = {
  zh: '账号密码管理助手分享卡：逐字段本地加密、一键填充并登录、多环境账号互不串味，开源免费 GPL-3.0',
  en: 'Account Password Helper share card: field-by-field local encryption, one-click fill and sign-in, environments never mix — free and open source under GPL-3.0',
};

/**
 * 从 PNG 的 IHDR 头读宽高，供 `og:image:width` / `og:image:height` 取真实值。
 *
 * 为什么要读文件而不是写死：博客封面是 1600×900、品牌卡是 1200×630，两种规格并存，
 * 写死一份会让其中一族说假话；而这两个字段的作用正是让社交平台**不必先下载图片**
 * 就能预留正确比例的位置，值错了比不写更糟。
 *
 * @param {string} absPath PNG 的绝对路径
 * @returns {{ width: number, height: number }} 像素宽高
 */
export function pngSize(absPath) {
  const buf = readFileSync(absPath);
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(magic) || buf.subarray(12, 16).toString('latin1') !== 'IHDR') {
    throw new Error(`不是可解析的 PNG，无法取 og:image 尺寸：${absPath}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * 把站点绝对图片 URL 换成本地文件路径并读出尺寸。
 *
 * @param {string} imageUrl `${SITE}/...` 形态的绝对地址
 * @param {string} root 仓库根目录
 * @returns {{ width: number, height: number }} 像素宽高
 */
export function imageSizeOf(imageUrl, root) {
  if (!imageUrl.startsWith(`${SITE}/`)) throw new Error(`图片不在本站前缀下：${imageUrl}`);
  return pngSize(path.join(root, imageUrl.slice(SITE.length + 1)));
}
