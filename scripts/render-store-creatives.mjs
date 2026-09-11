/**
 * 商店创意图渲染脚本
 *
 * 把 `imgs/store-creatives/<name>-<W>x<H>.svg` 栅格化为 `assets/cws-store/<name>-<W>x<H>.png`，
 * 供 Chrome 应用商店的宣传图（marquee 1400×560）与小推广图（440×280）使用，
 * 尺寸口径见 `docs/CWS_FILL_CONTENT.md`「第三步：图形资产」。
 *
 * 约定：
 * - 尺寸写进文件名：脚本按文件名声明的宽高校验 SVG 画布，不一致直接报错——
 *   商店对这两类图是硬尺寸要求，尺寸错了在 Dashboard 会被拒，比上传后才发现便宜得多；
 * - 2× 超采样渲染后缩到目标尺寸，保证中文标题与细描边的边缘质量；
 * - 只处理 `imgs/store-creatives/*.svg`，产物只落到 `assets/cws-store/`，不进入扩展运行时包。
 *
 * 使用方式：
 *   pnpm store-creatives:render          # 渲染全部创意图
 *   pnpm store-creatives:render 440      # 只渲染文件名包含 440 的图（不要加 `--`，它会被原样传进 argv）
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { readdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const SOURCE_DIR = resolve(projectRoot, 'imgs/store-creatives');
const OUTPUT_DIR = resolve(projectRoot, 'assets/cws-store');
/** libvips 以 72dpi 为 SVG 密度基准，144 即 2× 超采样后再下采样到目标尺寸 */
const DENSITY = 144;
/** 文件名即规格：`<name>-<宽>x<高>.svg` */
const NAME_PATTERN = /^(.+?)-(\d+)x(\d+)\.svg$/;

const rawArgs = process.argv.slice(2);
const unknownOptions = rawArgs.filter(arg => arg.startsWith('-'));
if (unknownOptions.length > 0) {
  // 未知 flag 必须报错：静默丢弃会让「只渲染 1 张」退化成「全量渲染并覆盖全部 PNG」
  console.error(`✗ unknown option(s): ${unknownOptions.join(' ')}；只接受按文件名过滤的位置参数`);
  process.exit(1);
}
const filters = rawArgs;

/**
 * 渲染单个创意图源。
 * @param {string} name `imgs/store-creatives/` 下的 SVG 文件名
 * @returns {Promise<string>} 供日志输出的成功描述
 */
async function renderOne(name) {
  const matched = NAME_PATTERN.exec(name);
  if (!matched) {
    throw new Error(`文件名需为 <name>-<宽>x<高>.svg，实际 ${name}`);
  }
  const [, , widthText, heightText] = matched;
  const expectedWidth = Number(widthText);
  const expectedHeight = Number(heightText);
  const sourcePath = resolve(SOURCE_DIR, name);
  const outputPath = resolve(OUTPUT_DIR, basename(name, '.svg') + '.png');
  const { width, height } = await sharp(sourcePath).metadata();
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`文件名声明 ${expectedWidth}×${expectedHeight}，SVG 画布实测 ${width}×${height}`);
  }
  const buffer = await sharp(sourcePath, { density: DENSITY })
    .resize(expectedWidth, expectedHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await writeFile(outputPath, buffer);
  return `${name} → ${outputPath.replace(`${projectRoot}/`, '')} (${expectedWidth}×${expectedHeight}, ${(buffer.length / 1024).toFixed(0)}KB)`;
}

async function render() {
  const entries = await readdir(SOURCE_DIR);
  const sources = entries.filter(
    name => name.endsWith('.svg') && (filters.length === 0 || filters.some(filter => name.includes(filter))),
  );

  if (sources.length === 0) {
    // 匹配不到属于调用错误，必须非零退出，避免把「一张都没渲染」当成成功
    console.error(
      `✗ no creative SVG matched in ${SOURCE_DIR}${filters.length ? ` (filters: ${filters.join(', ')})` : ''}`,
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
  console.error('✗ Failed to render store creatives:', err);
  process.exit(1);
});
