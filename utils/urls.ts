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
 * 反馈与问题提交入口（GitHub Issues 模板选择页）
 *
 * 由 `REPO_GITHUB_URL` 派生而非另写一条：仓库改名或迁移时只有一处需要动。
 * 指向 `issues/new/choose` 而不是直接开 blank issue，是因为仓库配了模板
 * （`.github/ISSUE_TEMPLATE/`），其中安全问题那条明确要求走私密渠道。
 */
export const REPO_ISSUES_URL = `${REPO_GITHUB_URL}/issues/new/choose`;

/**
 * 许可证全文（仓库内的 `LICENSE`）
 *
 * 由 `REPO_GITHUB_URL` 派生，与 Issues 入口同一口径。GPL-3.0 要求被分发方
 * 能方便地读到许可条款，「关于」抽屉里那句许可说明因此配一个直达全文的出口，
 * 而不是让用户自己去仓库里找。
 */
export const REPO_LICENSE_URL = `${REPO_GITHUB_URL}/blob/main/LICENSE`;

/**
 * 隐私政策（GitHub Pages，中英各一份）
 *
 * 与 Chrome 应用商店后台填写的那条隐私政策 URL 指向同一份文档
 * （口径见 `docs/store/CWS_PUBLISHING_GUIDE.md`），插件内不得另起一个地址，
 * 否则用户在商店里和在插件里读到的政策会分成两份。
 */
export const PRIVACY_POLICY_URL = 'https://liaolongdong.github.io/account-password-helper/privacy.html';
export const PRIVACY_POLICY_URL_EN = 'https://liaolongdong.github.io/account-password-helper/privacy.en.html';

/**
 * 产品说明站（GitHub Pages）
 *
 * 完整使用说明与常见问题对外长文档的地址。插件内的入口（帮助弹窗横幅、
 * Options 文档中页顶/底、新手引导末步、设密页底部）统一引用本常量，
 * 避免同一地址在多处硬编码后各自漂移。
 */
export const PRODUCT_DOCS_URL = 'https://liaolongdong.github.io/account-password-helper/';

/**
 * 「分享给同事」专用地址
 *
 * 产品说明页负责讲清楚这是什么、凭什么值得装，商店页负责安装；两条链接共用同一组
 * UTM：`utm_source=about` 标记入口是「关于」抽屉，`utm_medium=share` 标记分享媒介，
 * `utm_campaign=teammate` 标记同事分享活动，便于把这条分享带来的访问与安装同自然流量分开。
 */
export const TEAMMATE_PRODUCT_URL = `${PRODUCT_DOCS_URL}?utm_source=about&utm_medium=share&utm_campaign=teammate`;
export const TEAMMATE_SHARE_URL = `${CHROME_WEB_STORE_URL}?utm_source=about&utm_medium=share&utm_campaign=teammate`;

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
