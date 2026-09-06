/**
 * 博客封面渲染脚本
 *
 * 把 imgs/blog-covers/blog-cover-*.svg 矢量源栅格化为 imgs/<basename>.png（1600×900），
 * 供 docs/blog/{zh,en}/*.md 的 frontmatter `image:` 与正文引用，
 * 最终由 scripts/build-blog-pages.mjs 重写为站点绝对 URL（og:image / BlogPosting.image）。
 *
 * 约定：
 * - 一一对应：`imgs/blog-covers/blog-cover-01-local-first.svg`
 *   → `imgs/blog-cover-01-local-first.png`，文件名不变，博客 HTML 无需同步改动；
 * - 只处理 `blog-cover-*.svg`，目录内的其它 SVG 一律跳过，避免静默覆盖 `imgs/` 下不相干的 PNG；
 * - 2× 超采样渲染后缩到目标尺寸，保证中文标题与细描边的边缘质量；源画布非 16:9 时直接报错；
 * - 封面是纯装饰插画，不参与扩展运行时包体积，故不进入 wxt build 产物。
 *
 * 使用方式：
 *   pnpm covers:render            # 渲染全部封面
 *   pnpm covers:render -- 01 03   # 只渲染文件名包含 01 / 03 的封面
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { readdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const SOURCE_DIR = resolve(projectRoot, 'imgs/blog-covers');
const OUTPUT_DIR = resolve(projectRoot, 'imgs');
const WIDTH = 1600;
const HEIGHT = 900;
/** 源画布宽高比容差，超出即视为改错了封面尺寸 */
const ASPECT_TOLERANCE = 0.01;
/** libvips 以 72dpi 为 SVG 密度基准，144 即 2× 超采样后再下采样到目标尺寸 */
const DENSITY = 144;
/** 封面命名约束：只认 blog-cover-*.svg */
const COVER_PATTERN = /^blog-cover-.+\.svg$/;

const rawArgs = process.argv.slice(2);
const unknownOptions = rawArgs.filter(arg => arg.startsWith('-'));
if (unknownOptions.length > 0) {
  // 未知 flag 必须报错：静默丢弃会让「只渲染 1 张」退化成「全量渲染并覆盖 4 张 PNG」
  console.error(`✗ unknown option(s): ${unknownOptions.join(' ')}；只接受按文件名过滤的位置参数`);
  process.exit(1);
}
const filters = rawArgs;

/**
 * 渲染单个封面源。
 * @param {string} name `imgs/blog-covers/` 下的 SVG 文件名
 * @returns {Promise<string>} 供日志输出的成功描述
 */
async function renderOne(name) {
  const sourcePath = resolve(SOURCE_DIR, name);
  const outputPath = resolve(OUTPUT_DIR, `${basename(name, '.svg')}.png`);
  const { width, height } = await sharp(sourcePath).metadata();
  const aspect = width && height ? width / height : 0;
  if (!aspect || Math.abs(aspect - WIDTH / HEIGHT) > ASPECT_TOLERANCE) {
    throw new Error(`源画布需为 ${WIDTH}×${HEIGHT}（16:9），实测 ${width}×${height}`);
  }
  const buffer = await sharp(sourcePath, { density: DENSITY })
    .resize(WIDTH, HEIGHT, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await writeFile(outputPath, buffer);
  return `${name} → ${outputPath.replace(`${projectRoot}/`, '')} (${(buffer.length / 1024).toFixed(0)}KB)`;
}

async function render() {
  const entries = await readdir(SOURCE_DIR);
  const sources = entries.filter(
    name => COVER_PATTERN.test(name) && (filters.length === 0 || filters.some(filter => name.includes(filter))),
  );

  if (sources.length === 0) {
    // 匹配不到属于调用错误，必须非零退出，避免上游脚本把「一张都没渲染」当成成功
    console.error(
      `✗ no cover SVG matched in ${SOURCE_DIR}${filters.length ? ` (filters: ${filters.join(', ')})` : ''}`,
    );
    process.exit(1);
  }

  // allSettled 而非 all：单张失败时其余仍能完成，但失败项按文件名归因并以非零退出收尾
  const results = await Promise.allSettled(sources.map(renderOne));
  let failed = 0;
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      console.log(`✓ ${result.value}`);
    } else {
      failed += 1;
      console.error(`✗ ${sources[index]}: ${result.reason?.message ?? result.reason}`);
    }
  }
  if (failed > 0) {
    process.exit(1);
  }
}

render().catch(err => {
  console.error('✗ Failed to render blog covers:', err);
  process.exit(1);
});
