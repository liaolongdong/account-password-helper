import type { Page } from '@playwright/test';
import { expect, test } from './harness';
import { addIdentity, cards, openVaultFromHeader, searchInput, vaultDialog } from './identityVaultDom';
import { textOf } from './i18n';

/**
 * 身份库「检索首个命中滚进视野」的真机回归
 *
 * 落点判据由 `tests/utils/identitySearchReveal.test.ts` 覆盖、接线由
 * `tests/architecture/identitySearchRevealWiring.test.ts` 覆盖，但那两层都证不了这件事本身：
 * **真实浏览器里那一格到底在不在视野内**。jsdom 没有布局、`scrollIntoView` 是空函数，
 * 「55vh 的滚动容器」「卡片比可视区更高」「平滑滚动还在半路上」三条全是真机才有的量。
 *
 * 两个场景各对应一条根因，且都必须先造出「溢出」这个前提，否则断言恒真：
 * ① 滚动偏移跨次残留：列表节点常驻（弹窗未设 `destroy-on-close`），上一轮滚到底的偏移会留到
 *    这一轮；筛完仍是五张卡（列表照旧比可视区长），首个命中因此停在视野上方；
 * ② 折叠卡取不到命中节点：字段区是 `v-if`，按既定取舍不自动展开，落点退回卡片头部。
 *
 * 场景用手机号作检索词而不是姓名：姓名就是卡片标题，命中的那一格本来就在卡顶（滚不滚都看得见，
 * 断言会恒真）；手机号只出现在字段行里，落点必须是那一格，这才量得出「滚进视野」这件事。
 */

/** 五条合成身份：姓名互不为子串、手机号共享同一前缀，与任何真实数据无关 */
const NAMES = ['e2e-reveal-a', 'e2e-reveal-b', 'e2e-reveal-c', 'e2e-reveal-d', 'e2e-reveal-e'];
const PHONES = ['13800001111', '13800002222', '13800003333', '13800004444', '13800005555'];
/** 只在字段行命中的检索词（标题里没有这串数字） */
const KEYWORD = '1380000';

test.setTimeout(150_000);

const list = (page: Page) => vaultDialog(page).locator('.identity-list');

/**
 * 量出「滚动容器」与「卡内首个命中」两者的相对位置
 *
 * 走一次 `evaluate` 而不是两个 locator 各取 `boundingBox()`：平滑滚动是动画，两次读取之间
 * 视野还在推进，会量到两个时刻的盒子。
 *
 * @param which `hit` 取首卡内的强调分段，`card` 取首卡本身（折叠卡的退回落点）
 */
async function measureReveal(
  page: Page,
  which: 'hit' | 'card',
): Promise<{ scrollTop: number; inside: boolean; overflowed: boolean; listHeight: number }> {
  return list(page).evaluate((el, which) => {
    const box = el.getBoundingClientRect();
    const node =
      which === 'hit'
        ? el.querySelector<HTMLElement>('.identity-card .search-hit')
        : el.querySelector('.identity-card');
    if (!node) return { scrollTop: el.scrollTop, inside: false, overflowed: false, listHeight: el.scrollHeight };
    const nodeBox = node.getBoundingClientRect();
    return {
      scrollTop: el.scrollTop,
      // 目标整节落在容器盒子内（1px 容差吸收亚像素取整）
      inside: nodeBox.top >= box.top - 1 && nodeBox.bottom <= box.bottom + 1,
      overflowed: el.scrollHeight > el.clientHeight + 1,
      listHeight: el.scrollHeight,
    };
  }, which);
}

/** 把列表滚到底，返回滚出去的偏移（模拟「上一轮看到的不是列表头」） */
async function scrollListToBottom(page: Page, distance: number): Promise<number> {
  await list(page).hover();
  await page.mouse.wheel(0, distance);
  await expect
    .poll(() => list(page).evaluate(el => el.scrollTop), { message: '列表没有滚出偏移，场景前提不成立' })
    .toBeGreaterThan(0);
  return list(page).evaluate(el => el.scrollTop);
}

test('搜索词变化后首个命中滚进视野，折叠卡退回卡片头部', async ({ optionsPage: page }) => {
  await openVaultFromHeader(page, true);
  for (const [index, name] of NAMES.entries()) {
    await addIdentity(page, name, PHONES[index]);
  }

  // 前提：五张卡确实比滚动区长，否则「滚进视野」这句话没有反面
  await searchInput(page).fill(KEYWORD);
  await expect(cards(page)).toHaveCount(NAMES.length);
  const { overflowed, listHeight } = await measureReveal(page, 'hit');
  expect(overflowed, `列表高度 ${listHeight} 没超过滚动区，场景失真`).toBe(true);

  // 场景①：清词 → 滚到底 → 改回同一个检索词，首个命中必须被带进可视区
  await searchInput(page).fill('');
  await scrollListToBottom(page, listHeight);
  await searchInput(page).fill(KEYWORD);
  // 平滑滚动是动画，按轮询等到落点进入视野（超时即判红，不靠固定 sleep）
  await expect
    .poll(async () => (await measureReveal(page, 'hit')).inside, {
      message: '改词后首个命中的字段行没有被滚进可视区',
    })
    .toBe(true);

  // 场景②：折叠首卡（字段区不在 DOM 里）后重新检索，落点退回卡片头部而不是跳去第二张卡
  await searchInput(page).fill('');
  await cards(page)
    .first()
    .getByRole('button', { name: textOf('identity.collapseOne') })
    .click();
  await expect(cards(page).first()).toHaveClass(/is-collapsed/);
  expect(await cards(page).first().locator('.search-hit').count()).toBe(0);

  await scrollListToBottom(page, listHeight);
  await searchInput(page).fill(KEYWORD);
  await expect
    .poll(async () => (await measureReveal(page, 'card')).inside, {
      message: '折叠的首卡应停在视野内（不自动展开，也不跳去后面的卡）',
    })
    .toBe(true);

  await page.screenshot({ path: '.e2e-visual/identity-search-reveal.png' });
});
