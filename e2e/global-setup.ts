/**
 * E2E 全局准备：确保被测的 MV3 构建产物存在且新鲜
 *
 * 扩展测试必须跑在 `chrome-extension://` 源上，因此不能像普通 Web 应用那样依赖
 * `webServer` + dev server：dev server 只提供模块源，扩展页面的权威上下文是已加载的扩展包。
 * 这里默认每次重跑 `pnpm build`（约 15s），避免测到过期产物导致的假绿/假红；
 * 本地反复调试同一份产物时可用 `E2E_SKIP_BUILD=1` 跳过。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** ESM 下没有 __dirname，用模块自身位置定位仓库根 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXTENSION_PATH = path.join(REPO_ROOT, '.output', 'chrome-mv3');

export default function globalSetup(): void {
  const manifest = path.join(EXTENSION_PATH, 'manifest.json');
  if (process.env.E2E_SKIP_BUILD === '1') {
    if (!fs.existsSync(manifest)) {
      throw new Error('E2E_SKIP_BUILD=1 但缺少 .output/chrome-mv3/manifest.json，请先执行 pnpm build');
    }
    return;
  }

  execFileSync('pnpm', ['build'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (!fs.existsSync(manifest)) {
    throw new Error(`构建后仍未生成扩展产物：${manifest}`);
  }
}
