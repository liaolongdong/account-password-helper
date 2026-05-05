/**
 * 环境判断常量
 *
 * - `isDev`: `npm run dev` 启动（WXT dev server）时为 true
 * - `isProd`: `npm run build` 打包时为 true
 *
 * Vite 会在构建期将 `import.meta.env.DEV` / `import.meta.env.PROD`
 * 静态替换为字面量 `true` / `false`，因此基于这两个常量的
 * `v-if` / `if` 分支会在生产构建中被 tree-shake 掉。
 */
export const isDev: boolean = import.meta.env.DEV;
export const isProd: boolean = import.meta.env.PROD;
