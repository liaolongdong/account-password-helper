import type { BrowserContext, Page } from '@playwright/test';

import { expect, onboardAndUnlock, test, toast, verifyMasterPassword } from './harness';
import { textOf } from './i18n';
import {
  addIdentity,
  cards,
  closeVault,
  openVaultFromHeader,
  searchInput,
  verifyDialog,
  vaultDialog,
} from './identityVaultDom';
import { MessageType } from '../utils/types';
import { IDENTITY_SUMMON_TTL_MS } from '../utils/identity/summonIntent';

/**
 * 锁定态身份库召唤「解锁后续接」的真机回归
 *
 * 这条链的三段各自只有一种证法，而 `.vue` 的 `<script setup>` 对 typecheck / lint / 单测三道人眼
 * 都是透明的（本仓既有结论：未定义标识符能一路绿到真浏览器才白屏），所以接线是否真的落地、
 * 复验弹窗是否真的排在开库之前，只能让真 Chrome 说。钉四件：
 *
 * 1. **锁定态的召唤不再被丢在原地**：门禁挡下时给出 `identity.needUnlock` 反馈，且**什么都不开**
 *    （开库只会得到空列表），这一次点击被记了下来。
 * 2. **解锁那一刻自动续上**：`isAuthenticated` 转真后库自己走到用户面前，检索词照旧预填、
 *    列表照旧筛到那一条。
 * 3. **续接不省任何一道验证**：默认 `perSession` 档下，解锁后的第一次打开仍索要主密码——
 *    这条如果被做歪（把复验得到的密码透传给身份库解密），第 2 步会「少一个弹窗」，
 *    而这里量的正是那个弹窗必须在。
 * 4. **只兑现一次**：同一条记录不会在之后的每一次解锁上重放（TTL 是 60 秒，第二段离第一段
 *    不到 60 秒，所以这条量的确实是「单次消费」而不是「过期」）。
 *
 * 投递为什么由 Service Worker 代发：锁定态还能触发这条指令的两个入口——输入框右键菜单
 * （`chrome.contextMenus.onClicked` 无法由测试驱动）与「气泡残留与会话恰好过期的竞态」
 * （时序不可复现）——而它们最终都汇到同一个跨上下文消息上。消息类型与载荷形状与后台
 * `openOptionsAndSendMessage` 转发的完全一致，收口与门槛都在选项页这一侧，正是本用例的标的。
 */

/** 合成品姓名：只用来证明检索词落地，与任何真实身份无关 */
const SELF_NAME = 'e2e-summon-holder';

/** 合成品手机号：`addIdentity` 需要第二个非空字段才能保存 */
const SELF_PHONE = '13800006666';

/** 扩展自己的 Service Worker：类型从上下文推导，不另抄一份 Playwright 的导出名 */
type ExtensionWorker = ReturnType<BrowserContext['serviceWorkers']>[number];

/** 从扩展侧把召唤投给选项页（载荷形状同后台转发：`{ keyword }`） */
async function summonFromServiceWorker(sw: ExtensionWorker, keyword: string): Promise<void> {
  await sw.evaluate(
    async payload => {
      await chrome.runtime.sendMessage(payload);
    },
    { type: MessageType.OPEN_OPTIONS_AND_IDENTITY, data: { keyword } },
  );
}

/**
 * 点头部那颗「立即锁定」，并等锁定真的落定
 *
 * 中间隔着一道 `.el-message-box` 确认（`handleClearSession` 先 `ElMessageBox.confirm`），少点这一颗，
 * 后面等的「验证密码」永远不出现，红灯还会伪装成「锁定没生效」。判据与写法抄 `auth-screen-layout.spec.ts`。
 *
 * 之后还要等那句「会话已清除」的成功提示：`useSessionTimer.ts:159-163` 先把验证屏翻出来，
 * 再 `await` 一次有效期读取，**然后才把 `verifyForm.password` 清空**。只等「验证密码按钮可见」就往下填值，
 * 填进去的那串会在这一步被抹掉，表现为点了「验证」却报「请输入主密码」、页面停在锁屏
 * （本用例要连着锁两次，实测约三次里撞一次）。这条提示排在清空之后，等它就是等清空落地。
 */
async function lockSession(page: Page): Promise<void> {
  await page.locator('.lock-btn').click();
  await page
    .locator('.el-message-box')
    .getByRole('button', { name: textOf('session.clearConfirmBtn') })
    .click();
  await expect(toast(page, 'session.cleared')).toBeVisible();
  await expect(page.getByRole('button', { name: textOf('auth.verifySubmit') })).toBeVisible({ timeout: 30_000 });
}

test('锁定态召唤：解锁后自动开库、门槛照旧、且只续一次', async ({ extContext, optionsPage }) => {
  const [sw] = extContext.serviceWorkers();
  if (!sw) throw new Error('Service Worker 未注册——扩展根本没被加载，这条用例无从测起');

  // 前置：库里造一条姓名为 SELF_NAME 的个人信息（走真表单，测试进程没有解密入口）
  await openVaultFromHeader(optionsPage, true);
  await addIdentity(optionsPage, SELF_NAME, SELF_PHONE);
  await closeVault(optionsPage);

  // ① 锁定态投出召唤：只该看到一句反馈，屏上不得出现库弹窗或复验弹窗
  await lockSession(optionsPage);
  const summonedAt = Date.now();
  await summonFromServiceWorker(sw, SELF_NAME);
  await expect(toast(optionsPage, 'identity.needUnlock')).toBeVisible();
  await expect(vaultDialog(optionsPage)).toBeHidden();
  await expect(verifyDialog(optionsPage)).toBeHidden();

  // ② 解锁：复验弹窗必须先出现（续接不许绕开门槛），走过去之后库才自己打开
  await onboardAndUnlock(optionsPage);
  await expect(verifyDialog(optionsPage), '解锁后没见到复验弹窗：门槛被续接绕开了').toBeVisible({ timeout: 10_000 });
  await verifyMasterPassword(optionsPage, 'identity.verifyPrompt');

  await expect(vaultDialog(optionsPage), '解锁后身份库没有自动打开').toBeVisible({ timeout: 10_000 });
  await expect(searchInput(optionsPage)).toHaveValue(SELF_NAME);
  await expect(cards(optionsPage)).toHaveCount(1);
  await closeVault(optionsPage);

  // ③ 单次消费：再锁再解，同一条记录不该重放。
  // 先等两秒再断言「没开」——复验弹窗落在一次 storage 读之后，立刻断言是恒真的空跑。
  await lockSession(optionsPage);
  await onboardAndUnlock(optionsPage);
  await optionsPage.waitForTimeout(2_000);
  await expect(verifyDialog(optionsPage), '上一次召唤在第二次解锁上重放了').toBeHidden();
  await expect(vaultDialog(optionsPage), '上一次召唤在第二次解锁上重放了').toBeHidden();

  // 判别式自己也要被量住：第二段仍需在 TTL 之内，「没重放」才只可能是单次消费而非过期。
  // 机器负载把这段拉到 60 秒以上时，本用例就失去了它声称的那个判别力，必须当场报警。
  const elapsedMs = Date.now() - summonedAt;
  expect(
    elapsedMs,
    `第二段离召唤已 ${elapsedMs}ms，超过 TTL（${IDENTITY_SUMMON_TTL_MS}ms）：这条红分不清是过期还是单次消费`,
  ).toBeLessThan(IDENTITY_SUMMON_TTL_MS);
});
