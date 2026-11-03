/**
 * Options 首个真实视图（首屏骨架形态）
 *
 * 认证结论要等 storage 异步读取才知道，静态骨架只能在首帧先挑一个形态。为了让「刷新」和
 * 「从有效期入口新开标签页」直接落到正确形态，这两条信息各有一个同步可读的来源：
 * - URL 查询参数 `first-view`：后台从有效期胶囊创建新标签页时写入；
 * - sessionStorage `aph-options-first-view`：同一标签页上一次解析出的视图，刷新时仍保留。
 * sessionStorage 是页面内最新的状态，优先于可能长期留在地址栏的 URL 参数；
 * 两者都不可用时落到中性的 `boot`，绝不猜「已解锁」或「待验证」。
 */
export type OptionsFirstView = 'setup' | 'verify' | 'vault';

/** 新标签页打开时可用于骨架预判的查询参数 */
export const OPTIONS_FIRST_VIEW_PARAM = 'first-view';

/** 同标签页刷新时的骨架预判键（sessionStorage，只存视图名） */
export const OPTIONS_FIRST_VIEW_STORAGE_KEY = 'aph-options-first-view';
