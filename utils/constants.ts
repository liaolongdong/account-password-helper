/**
 * 项目级常量定义
 * 统一管理硬编码的 URL 等常量，避免多处重复定义
 */

const REPO_OWNER = 'liaolongdong';
const REPO_NAME = 'account-password-helper';

/** GitHub 仓库首页地址 */
export const REPO_GITHUB_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

/** GitHub Releases API 地址（用于版本更新检测） */
export const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

/** GitHub Releases 页面地址（用户点击更新提示后跳转） */
export const GITHUB_RELEASES_PAGE_URL = `${REPO_GITHUB_URL}/releases/latest`;
