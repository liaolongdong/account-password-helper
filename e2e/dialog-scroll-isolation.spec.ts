import type { Page } from '@playwright/test';
import { createEntry, expect, runHeaderCommand, test } from './harness';
import { textOf } from './i18n';

/**
 * 管理页的滚动隔离（弹窗与候选浮层各自把滚动留在自己身上）
 *
 * 这一族行为只在真浏览器里成立，单测与 `tsc` 都摸不到：
 *
 * 1. **模态关掉之后，列表要还在原来那条**。实测成因在浏览器侧：打开 `el-dialog` 的那一帧
 *    文档 scrollTop 被归零（逐层排除后确认不是 Element Plus 的锁滚类、也不是它那句
 *    `scrollTop = 0`，见 `composables/useModalScrollRestoration.ts` 的注释）。
 *    没有还原逻辑时这里读到的是 0；
 * 2. **候选面板滚到末行之后，继续滚动不该把底下的列表推着走**。两个下拉的浮层不是模态，
 *    Element Plus 不给它们上 body 锁，滚动链顺着祖先直达文档 —— 修复前实测一格滚轮把
 *    scrollTop 从 150 推到 950，面板同时飘出视口。
 * 3. **保存后列表停在刚存的那一条**，而不是弹窗前的位置。第 1 条的还原与这条的定位互相
 *    争夺同一个 `scrollTop`：`revealRow` 在弹窗关闭**之前**就滚动（实测锁滚期间文档确实可被
 *    程序化滚动，0→1298），解锁那一步若照着第 1 条写回，刚进视口的行会被推回深处之外。
 *    用例把起点放在深处（800），让「还原成功」与「定位成功」在读数上直接对立。
 *
 * 三条都把视口压到 420px 高：列表因此真的可滚（不然「scrollTop 没变」是空断言），
 * 30 个站点候选也才装得下面板放不下（不然滚不到底，越界滚动这一格就无从发生）。
 */

/** 30 条各挂一个独立域名，给站点候选攒出一个超过面板高度的列表 */
const TOTAL = 30;
/** 合成凭据：RFC 2606 保留域，与任何真实账号无关 */
const CSV = `username,password,url
${Array.from({ length: TOTAL }, (_, i) => `e2e-si-${String(i + 1).padStart(3, '0')},Synthetic!Si${i + 1},https://e2e-si${i + 1}.e2e.test/`).join('\n')}
`;

/** 起点偏移：足以证明文档真的在滚，又不至于滚出 30 行的范围 */
const START_TOP = 150;

/** 深偏移：30 行的可滚范围是 1718-420=1298，800 足够让表格首行整个移出视口上沿 */
const DEEP_TOP = 800;

const docTop = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollTop);

/** 经真实的导入入口灌入 30 条（条目在库里是密文，测试进程没有解密入口） */
async function seedVault(page: Page): Promise<void> {
  await runHeaderCommand(page, 'options.header.data', 'options.header.importData');
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.import.title') });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'e2e-scroll-isolation.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf-8') });
  await expect(dialog.locator('.preview-section')).toBeVisible();
  await dialog.locator('.el-dialog__footer .el-button--success').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('tr.el-table__row').first()).toBeVisible();
}

/**
 * 滚到 START_TOP 并确认文档真的可滚
 *
 * 这一步是两条用例共同的前提：可滚范围若不足（视口变高、行数变少），
 * `scroll` 会停在别处，后面的「位置没变/位置还在」就读成假绿。
 */
async function scrollToStart(page: Page): Promise<void> {
  await page.evaluate(offset => document.documentElement.scroll(0, offset), START_TOP);
  await expect.poll(() => docTop(page), { message: '文档滚不到起点，测量前提不成立' }).toBe(START_TOP);
}

test.describe('弹窗与浮层的滚动隔离', () => {
  test.beforeEach(async ({ optionsPage }) => {
    await optionsPage.setViewportSize({ width: 1280, height: 420 });
    await seedVault(optionsPage);
  });

  test('关掉弹窗后列表还停在原来读到的那一行', async ({ optionsPage: page }) => {
    await scrollToStart(page);

    await page.getByRole('button', { name: textOf('options.header.addPassword') }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.form.addTitle') });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);

    // 前提：弹窗期间文档真的被归零了。没有这一步，下面那条「位置还在」就可能只是
    // 在测「浏览器什么都没动」—— 那种情况下删掉整个 composable 也照样是绿的。
    expect(await docTop(page), '弹窗期间文档没被归零：第 3 条的定位与这条的还原都不再有对手').toBe(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Element Plus 解锁 body 走的是 200ms 延时，还原落在那之后；等浮层真正退场再读终态
    await expect.poll(() => docTop(page), { timeout: 5_000, message: '关掉弹窗后没回到原位置' }).toBe(START_TOP);
  });

  test('候选面板滚到底再滚，不推动底下的列表', async ({ optionsPage: page }) => {
    await scrollToStart(page);

    await page.locator('.filters .site-filter .el-select__wrapper').click();
    const popper = page.locator('.el-popper:visible.site-filter-popper');
    await expect(popper).toBeVisible();

    const list = popper.locator('.el-vl__window');
    await expect
      .poll(() => list.evaluate(el => el.scrollHeight - el.clientHeight), { message: '候选列表没有超出面板高度' })
      .toBeGreaterThan(0);
    // 正面钉住修复本身：作用在该元素上的声明就是 contain。
    // 只靠下面「文档没动」那条，读到的可能是「面板其实没滚到底」之类的另一种安静。
    expect(
      await list.evaluate(el => getComputedStyle(el).overscrollBehaviorY),
      '滚动容器上没有 contain：滚动链剪断的样式没落到这个节点',
    ).toBe('contain');

    // 先让指针进面板，滚到底（这一步只该动面板内部）
    const box = await list.boundingBox();
    expect(box, '候选列表量不到位置').not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 800);
    await expect
      .poll(() => list.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1), {
        message: '候选列表没滚到底',
      })
      .toBe(true);
    await expect(docTop(page)).resolves.toBe(START_TOP);

    // 已经到底的这一格，才是「越界滚动该不该上抛」的判定点
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
    expect(await docTop(page), '候选面板滚到底后，滚动链把底下的列表推着走了').toBe(START_TOP);
    const after = await popper.boundingBox();
    expect(after, '面板飘出视口').not.toBeNull();
    expect(after!.y, '面板被顶出视口上沿').toBeGreaterThanOrEqual(0);
  });

  test('保存后列表停在刚存的那一条，而不是弹窗前的深处', async ({ optionsPage: page }) => {
    await page.evaluate(offset => document.documentElement.scroll(0, offset), DEEP_TOP);
    await expect.poll(() => docTop(page), { message: '文档滚不到深处，测量前提不成立' }).toBe(DEEP_TOP);

    // 前提：这个深度下表头之后的第一行已整个移出视口上沿。新条目按默认序落在首行（探针实测），
    // 于是「还原把位置写回 800」与「定位把首行进视口」在同一帧里互斥 —— 下面那条断言才有牙。
    const firstBefore = await page.locator('tr.el-table__row').first().boundingBox();
    expect(firstBefore, '首行量不到位置').not.toBeNull();
    expect(firstBefore!.y + firstBefore!.height, '深处仍看得见首行：这条用例分不清两种行为').toBeLessThan(0);

    await createEntry(page, {
      username: 'e2e-si-fresh',
      password: 'Synthetic!Fresh1',
      url: 'https://fresh.e2e.test/',
    });

    const highlighted = page.locator('tr.el-table__row.new-item');
    await expect(highlighted, '保存后没有高亮行：定位链路自己就断了').toBeVisible();
    // 解锁（EP 的 200ms 延时）之后还原才有机会动手，等它跑完再读终态
    await page.waitForTimeout(600);

    const box = await highlighted.boundingBox();
    expect(box, '高亮行量不到位置').not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport, '视口尺寸读不到').not.toBeNull();
    expect(box!.y, '列表回去了弹窗前的深处：刚存的那一条被推出视口上沿').toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, '刚存的那一条被推出视口下沿').toBeLessThanOrEqual(viewport!.height);
  });
});
