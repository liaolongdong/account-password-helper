/**
 * 商店截图上传尺寸导出 —— 把 @2x 母版图降采样成 Chrome 应用商店要求的尺寸。
 *
 * 商店截图槽位只收 1280×800 或 640×400 的 JPEG / 24 位 PNG（**不接受 alpha 通道**），
 * 而 `capture.mjs` 产出的 `screen-*.png` 是 2560×1600 且带 alpha，直接上传会被拒。
 *
 * 母版画布的逻辑尺寸本来就是 1280×800、以 deviceScaleFactor 2 输出（见 `shot.mjs`），
 * 所以这里是严格的 2:1 整数倍降采样，不会出现非整数重采样导致的文字发虚。
 * 不依赖 Chrome：只读 `assets/cws-store/screen-*.png`，母版重截后随时复跑本脚本同步上传图。
 */
import { readdir, mkdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/cws-store');
const OUT_DIR = join(SRC_DIR, 'upload');

/** 商店官方规格「1280x800 或 640x400」中的大尺寸档，母版正好是它的 2 倍。 */
const UPLOAD_W = 1280;
const UPLOAD_H = 800;

/**
 * 由母版生成一张上传图：2:1 降采样、白底压平 alpha、写出 24 位 PNG。
 *
 * @param {string} src 母版 PNG 绝对路径
 * @param {string} dest 上传图绝对路径
 * @throws 母版尺寸不是目标尺寸的 2 倍时中止，避免静默产出比例失真的商店素材
 */
async function toUploadSize(src, dest) {
  const meta = await sharp(src).metadata();
  if (meta.width !== UPLOAD_W * 2 || meta.height !== UPLOAD_H * 2) {
    throw new Error(
      `${basename(src)} 母版尺寸为 ${meta.width}×${meta.height}，` +
        `期望 ${UPLOAD_W * 2}×${UPLOAD_H * 2}：请先确认 capture.mjs 的输出规格，再同步本脚本的尺寸常量`,
    );
  }
  await sharp(src)
    .resize(UPLOAD_W, UPLOAD_H, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toFile(dest);
}

const masters = (await readdir(SRC_DIR))
  .filter(f => /^screen-.+\.png$/.test(f))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

if (!masters.length) {
  throw new Error(`${SRC_DIR} 下找不到 screen-*.png 母版，请先跑 scripts/store-shots/capture.mjs`);
}

await mkdir(OUT_DIR, { recursive: true });

for (const name of masters) {
  const dest = join(OUT_DIR, name.replace(/\.png$/, `-${UPLOAD_W}x${UPLOAD_H}.png`));
  await toUploadSize(join(SRC_DIR, name), dest);
  const { width, height, channels, hasAlpha } = await sharp(dest).metadata();
  if (hasAlpha) throw new Error(`${name} 导出后仍带 alpha 通道，商店会拒绝`);
  console.log(`wrote ${relative(SRC_DIR, dest)} ${width}x${height} ${channels}ch`);
}
