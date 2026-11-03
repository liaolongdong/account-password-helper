/**
 * 图标生成脚本
 *
 * 读取 assets/icons/ 下的矢量源，使用 sharp 将其按 Chrome 扩展所需的多档尺寸
 * 渲染为 PNG 并写入 public/ 对应目录。
 *
 * WXT 约定：public/icon/{16,32,48,96,128}.png 会被自动识别为
 *   - manifest.icons
 *   - action.default_icon
 * 因此 wxt.config.ts 无需再显式声明 icons 字段。
 *
 * 锁定态图标刻意放在 public/icon/locked/ 子目录：WXT 只认 public/icon 下的
 * 那五个数字文件名，子目录不参与自动识别，因此它不会改动 manifest 图标，
 * 只由 background 经 chrome.action.setIcon 按会话状态切换。
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

const SIZES = [16, 32, 48, 96, 128];

/** 图标集：矢量源 → 输出目录（解锁态即 manifest 图标，锁定态供 setIcon 切换） */
const ICON_SETS = [
  { source: 'assets/icons/icon.svg', outputDir: 'public/icon' },
  { source: 'assets/icons/icon-locked.svg', outputDir: 'public/icon/locked' },
];

async function generate() {
  await Promise.all(
    ICON_SETS.map(async ({ source, outputDir }) => {
      const svgBuffer = await readFile(resolve(projectRoot, source));
      const dir = resolve(projectRoot, outputDir);

      await mkdir(dir, { recursive: true });

      await Promise.all(
        SIZES.map(async size => {
          const outputPath = resolve(dir, `${size}.png`);
          await sharp(svgBuffer, { density: Math.max(72, size * 4) })
            .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png({ compressionLevel: 9 })
            .toFile(outputPath);
          console.log(`✓ generated ${outputPath}`);
        }),
      );
    }),
  );
}

generate().catch(err => {
  console.error('✗ Failed to generate icons:', err);
  process.exit(1);
});
