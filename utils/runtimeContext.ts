/**
 * 运行时所在上下文判定
 *
 * 扩展自身上下文（Service Worker / Options / Popup / SidePanel）与内容脚本虽然共用同一份代码，
 * 但 **origin 不同**：内容脚本跑在宿主页面上，`navigator.locks` 按 origin 分组，因此它在扩展的
 * 写锁名（`aph-vault-key-transition`）上拿到的租约与扩展侧的独占换钥**互不相干**。
 * 凡是要覆写主密码校验配置或发布会话密钥材料的迁移/升级动作，都必须先避开这一上下文，
 * 否则会在换钥事务期间把刚提交的新值打回旧钥形态。
 */

/** 宿主页面可用的协议（内容脚本必然落在其中之一） */
const WEB_PAGE_PROTOCOLS = ['http:', 'https:', 'file:'] as const;

/**
 * 当前代码是否运行在宿主页面（内容脚本）上下文
 *
 * 判定刻意反向：只认出「这是网页」，其余一律按扩展自身上下文处理。这样 MV3 Service Worker
 * （无 `window`）、扩展页面，以及测试环境里的空白文档都不会被误判为宿主页面而错过本应执行的迁移。
 * @returns 内容脚本/宿主页面为 true；扩展自身上下文为 false
 */
export function isWebPageContext(): boolean {
  if (typeof window === 'undefined') return false;
  const protocol = window.location?.protocol;
  return WEB_PAGE_PROTOCOLS.includes(protocol as (typeof WEB_PAGE_PROTOCOLS)[number]);
}
