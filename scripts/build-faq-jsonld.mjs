#!/usr/bin/env node
/**
 * 依据页面可见 `FAQS` 数组，重新生成 index.html 内的中文 FAQPage 结构化数据块。
 *
 * 可见 FAQ（运行时由 `FAQS` 渲染）与静态 JSON-LD 曾各自维护一份文案并发生漂移，导致
 * Google 要求的「结构化数据与可见内容一致」被破坏。现在 JSON-LD 的中文块由本脚本从
 * `FAQS` 生成，英文块由 `build-en-page.mjs` 用同一份条目生成，文案不再手写。
 *
 * 改动 `FAQS` 中进入结构化数据的问题后执行：
 *   pnpm gen:faq && pnpm gen:en
 * 并运行 `pnpm test:run -- tests/docs/faqSchemaParity.test.ts` 确认一致。
 *
 * @file scripts/build-faq-jsonld.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncIndexHtmlFaqJsonLd } from './lib/faq-schema.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcPath = path.join(root, 'index.html');

const source = readFileSync(srcPath, 'utf8');
const { html, count } = syncIndexHtmlFaqJsonLd(source);

if (html === source) {
  console.log(`index.html FAQPage 结构化数据已是最新（${count} 条）`);
} else {
  writeFileSync(srcPath, html);
  console.log(`index.html FAQPage 结构化数据已更新（${count} 条）`);
}
