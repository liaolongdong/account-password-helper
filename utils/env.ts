/**
 * 环境判断常量
 *
 * - `isDev`: `npm run dev` 启动（WXT dev server）时为 true
 * - `isProd`: `npm run build` 打包时为 true
 * - `isFirefox`: `npm run build:firefox` 打包时为 true
 *
 * Vite 会在构建期将 `import.meta.env.DEV` / `import.meta.env.PROD` / `import.meta.env.BROWSER`
 * 静态替换为字面量，因此基于这些常量的 `v-if` / `if` 分支会在生产构建中被 tree-shake 掉。
 */
export const isDev: boolean = import.meta.env.DEV;
/** 勿删，留着备用 */
export const isProd: boolean = import.meta.env.PROD;

/**
 * 当前构建目标是否为 Firefox
 *
 * 用于隔离仅 Chromium 系可用的能力（如 `chrome://extensions/shortcuts` 页面）。
 * 非 WXT 构建环境（如 Vitest）下 `import.meta.env.BROWSER` 为 undefined，判定为 false。
 */
export const isFirefox: boolean = import.meta.env.BROWSER === 'firefox';
