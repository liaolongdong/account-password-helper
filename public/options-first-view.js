/* global document, location, sessionStorage, URLSearchParams */
/**
 * Options 首屏骨架的同步预判
 *
 * 必须放在 <head> 里同步执行：模块脚本要等依赖下载，那时首帧已经画完，
 * 会先闪一屏错误的「验证主密码」或「已解锁表格」骨架。
 *
 * 只读两个同步来源，都是非敏感视图名：
 * - 同标签页上一次解析出的视图（sessionStorage，刷新时有效，且会随页面内锁定 / 解锁更新）；
 * - URL 的 first-view 参数（后台从有效期胶囊创建新标签页时写入，只是首次打开的提示）。
 * sessionStorage 优先：URL 参数会一直留在地址栏，不能盖过页面内已经发生的锁定 / 解锁。
 * 都没有时落到中性 boot 形态，不猜测任何认证状态。
 *
 * 键名与 `utils/optionsFirstView.ts` 保持一致，由 `tests/architecture/optionsSkeletonView.test.ts` 守卫。
 */
(() => {
  const ALLOWED = ['setup', 'verify', 'vault'];
  let view = 'boot';
  try {
    const fromStorage = sessionStorage.getItem('aph-options-first-view');
    const fromQuery = new URLSearchParams(location.search).get('first-view');
    if (ALLOWED.includes(fromStorage)) view = fromStorage;
    else if (ALLOWED.includes(fromQuery)) view = fromQuery;
  } catch {
    // URL / 存储不可用：保持中性 boot
  }
  document.documentElement.dataset.optionsFirstView = view;
})();
