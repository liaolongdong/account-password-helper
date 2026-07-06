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
