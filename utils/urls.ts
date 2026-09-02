/**
 * 项目级 URL 常量
 *
 * 纯字符串常量，零外部依赖。从 constants.ts 拆分出来，
 * 避免 SidePanel 等其他轻量入口因导入 URL 而被迫拉入重依赖模块。
 */
export const REPO_GITHUB_URL = 'https://github.com/liaolongdong/account-password-helper';
export const GITHUB_RELEASES_API_URL =
  'https://api.github.com/repos/liaolongdong/account-password-helper/releases/latest';
export const GITHUB_RELEASES_PAGE_URL = `${REPO_GITHUB_URL}/releases/latest`;
export const CHROME_WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/account-password-helper/fgimkdodpjfkddmildjieojpfakpanli';

/**
 * CWS 可访问性探测 URL（轻量 HEAD 请求目标）
 *
 * 使用 CWS 首页而非具体扩展页面，减少请求载荷；
 * 仅用于判断用户是否能访问 Chrome 应用商店（被墙/网络不可达时返回失败）。
 */
export const CHROME_WEB_STORE_CHECK_URL = 'https://chromewebstore.google.com/';

/**
 * 浏览器内置的扩展快捷键管理页
 *
 * Chrome `commands` API 仅提供 `getAll()` / `onCommand`，扩展无法自行改键，
 * 用户修改快捷键的唯一合法入口即此页面。仅 Chromium 系有效，
 * Firefox 需改走 `about:addons`，调用方应先判断 `isFirefox` 降级为文案提示。
 */
export const CHROME_SHORTCUTS_PAGE_URL = 'chrome://extensions/shortcuts';
