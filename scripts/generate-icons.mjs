/**
 * 图标生成脚本
 *
 * 读取 assets/icons/icon.svg，使用 sharp 将其按 Chrome 扩展所需的多档尺寸
 * 渲染为 PNG 并写入 public/icon/ 目录。
 *
 * WXT 约定：public/icon/{16,32,48,96,128}.png 会被自动识别为
 *   - manifest.icons
 *   - action.default_icon
 * 因此 wxt.config.ts 无需再显式声明 icons 字段。
 *
 * 使用方式：
 *   npm run icons:build
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const SVG_SOURCE = resolve(projectRoot, 'assets/icons/icon.svg');
const OUTPUT_DIR = resolve(projectRoot, 'public/icon');
const SIZES = [16, 32, 48, 96, 128];

async function generate() {
  const svgBuffer = await readFile(SVG_SOURCE);

  await mkdir(OUTPUT_DIR, { recursive: true });

  await Promise.all(
    SIZES.map(async size => {
      const outputPath = resolve(OUTPUT_DIR, `${size}.png`);
      await sharp(svgBuffer, { density: Math.max(72, size * 4) })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toFile(outputPath);
      console.log(`✓ generated ${outputPath}`);
    }),
  );
}

generate().catch(err => {
  console.error('✗ Failed to generate icons:', err);
  process.exit(1);
});
