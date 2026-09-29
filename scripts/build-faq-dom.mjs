#!/usr/bin/env node
/**
 * 依据页面可见 `FAQS` 数组，重新生成 `index.html` 的中文 FAQ 静态 DOM 生成区。
 *
 * 可见 FAQ 原先完全由脚本运行时注入，`FAQS` 里一个语法错误就能让 41 条问答在返回字节里消失；
 * 现在中文页直接带静态 DOM（问答列表，以及由同一数组推导出的「分类直达」右栏），`en.html` 的
 * 英文 DOM 由 `build-en-page.mjs` 用同一模块生成。
 *
 * 改动 `FAQS`（其中进入 JSON-LD 的那部分由 `scripts/lib/faq-schema.mjs` 的白名单决定）后执行：
 *   pnpm gen:faq && pnpm gen:faq-dom && pnpm gen:en
 * 并运行 `pnpm test:run -- tests/docs/landingFaqDom.test.ts` 确认生成区没滞后。
 *
 * @file scripts/build-faq-dom.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncFaqDom } from './lib/faq-dom.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcPath = path.join(root, 'index.html');

const source = readFileSync(srcPath, 'utf8');
const { html, changed, count, sections } = syncFaqDom(source, 'zh');

const tally = `${count} 条问答 / ${sections} 个分类`;
if (changed) {
  writeFileSync(srcPath, html);
  console.log(`index.html FAQ 静态 DOM 已更新（${tally}）`);
} else {
  console.log(`index.html FAQ 静态 DOM 已是最新（${tally}）`);
}
