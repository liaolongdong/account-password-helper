import { test } from './harness';

/**
 * 侧边栏 —— 原有用例已整体作废，仅保留待办清单
 *
 * 旧实现把被测对象当成 http://localhost:8899 上的普通 Web 应用：那是 WXT dev server 的模块源，
 * 扩展从未被加载，`chrome.*` 不存在，`beforeEach` 里等 `.header` 必然超时，
 * 所以没有一条用例真正跑到过断言（`page.selectOption`、`.site-rules-table` 等选择器
 * 在仓库里也根本不存在）。请按 e2e/site-rules.spec.ts 的写法，用 fixtures 的
 * optionsPage / extContext 夹具补回，清单如下。
 */
test.describe('侧边栏（待按扩展夹具重写）', () => {
  test.skip(true, 'TODO: 需按 e2e/harness.ts 的扩展夹具重写后才能运行');
  // TODO: should open side panel and display passwords
  // TODO: should filter passwords in side panel
  // TODO: should auto-fill password from side panel
});
