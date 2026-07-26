/**
 * 一次性迁移脚本：将全量语言包按命名空间拆分为独立 JSON 文件
 *
 * 背景：utils/i18n/locales/{zh-CN,en}.json 全量静态打包进每个入口（gzip 后 ~52KB），
 * 其中 options 命名空间占 40%，对 sidepanel/popup 是死重。拆分后各入口按需注册
 * 命名空间语言包（见 utils/i18n/bundles/），侧边栏首屏 JS 显著瘦身。
 *
 * 同时将跨入口共享的 6 个 key 迁移至 common 命名空间（调用方同步更新）：
 * - options.table.favorite    → common.favorite
 * - options.table.unfavorite  → common.unfavorite
 * - options.header.settings   → common.settings
 * - options.validity.required → common.validityRequired
 * - options.changePwd.mismatch→ common.pwdMismatch
 * - popup.quickFill           → common.quickFill
 *
 * 用法：node scripts/split-locales.mjs（幂等，拆分完成后原全量 JSON 由人工删除）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(__dirname, '../utils/i18n/locales');

/** 跨入口共享 key 迁移映射（旧 key → 新 common key） */
const KEY_MOVES = {
  'options.table.favorite': 'common.favorite',
  'options.table.unfavorite': 'common.unfavorite',
  'options.header.settings': 'common.settings',
  'options.validity.required': 'common.validityRequired',
  'options.changePwd.mismatch': 'common.pwdMismatch',
  'popup.quickFill': 'common.quickFill',
};

for (const locale of ['zh-CN', 'en']) {
  const srcFile = path.join(localesDir, `${locale}.json`);
  if (!existsSync(srcFile)) {
    console.log(`跳过 ${locale}：全量文件不存在（可能已完成拆分）`);
    continue;
  }
  const messages = JSON.parse(readFileSync(srcFile, 'utf-8'));

  // 应用 key 迁移（保值改名）
  for (const [oldKey, newKey] of Object.entries(KEY_MOVES)) {
    if (oldKey in messages) {
      messages[newKey] = messages[oldKey];
      delete messages[oldKey];
    }
  }

  // 按命名空间（首个 . 前缀）分组；无 . 的 key（appName）归入 common
  const byNamespace = {};
  for (const [key, value] of Object.entries(messages)) {
    const ns = key.includes('.') ? key.split('.')[0] : 'common';
    (byNamespace[ns] ??= {})[key] = value;
  }

  const outDir = path.join(localesDir, locale);
  mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const [ns, nsMessages] of Object.entries(byNamespace)) {
    writeFileSync(path.join(outDir, `${ns}.json`), JSON.stringify(nsMessages, null, 2) + '\n');
    total += Object.keys(nsMessages).length;
  }
  console.log(`${locale}: 拆分为 ${Object.keys(byNamespace).length} 个命名空间文件，共 ${total} 个 key`);
}
