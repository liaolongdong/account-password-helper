#!/usr/bin/env node
/**
 * 为官网按需生成 WebP 伴生图，原 PNG 保留给商店上传与 README 引用。
 *
 * 落地页的 14 张截图与博客的 3 张信息图是当前静态站点最重的资源；
 * PNG 原图（2560×1600 / 1792×1024）合计约 25MB，WebP(q=80) 通常只有几十 KB。
 * 生成物与源文件同目录、同名不同扩展名，页面只需把引用从 .png 换成 .webp。
 *
 * 运行：pnpm assets:webp
 *
 * @file scripts/build-webp-assets.mjs
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CWS_DIR = path.join(root, 'assets/cws-store');
const IMGS_DIR = path.join(root, 'imgs');

/** 需要生成 WebP 伴生图的源文件：商店截图 + 博客三张信息图 */
function collectSources() {
  const screenshots = readdirSync(CWS_DIR)
    .filter(name => /^screen-.*\.png$/.test(name))
    .map(name => path.join(CWS_DIR, name));
  const infographics = readdirSync(IMGS_DIR)
    .filter(name => /^0[123]-.*\.png$/.test(name))
    .map(name => path.join(IMGS_DIR, name));
  return [...screenshots, ...infographics];
}

async function main() {
  const sources = collectSources();
  if (!sources.length) throw new Error('没有找到需要转换的 PNG');

  let sourceBytes = 0;
  let outputBytes = 0;
  for (const source of sources) {
    const output = source.replace(/\.png$/, '.webp');
    await sharp(source).webp({ quality: 80, effort: 5 }).toFile(output);
    sourceBytes += statSync(source).size;
    outputBytes += statSync(output).size;
    console.log(`${path.relative(root, source)} -> ${path.relative(root, output)}`);
  }

  const saved = ((1 - outputBytes / sourceBytes) * 100).toFixed(1);
  console.log(
    `WebP generated: ${sources.length} files, ${(sourceBytes / 1024 / 1024).toFixed(1)}MB -> ${(outputBytes / 1024 / 1024).toFixed(1)}MB (-${saved}%)`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
