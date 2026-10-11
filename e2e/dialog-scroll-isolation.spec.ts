import type { Locator, Page } from '@playwright/test';
import { expect, expectSuccessToastFor, footerPrimary, runHeaderCommand, test } from './harness';
import { textOf } from './i18n';

/**
 * 管理页的滚动隔离（弹窗与候选浮层各自把滚动留在自己身上）
 *
 * 这一族行为只在真浏览器里成立，单测与 `tsc` 都摸不到。
 *
 * 先钉两条读数口径，下面四条都按它们读：
 *
 * - **`expect.poll` 的「没变」只是一次成功的采样**，不是逐帧盯梢：断言一通过就返回。
 *   所以本文件说的「弹窗期间位置没动」，严格含义是「弹窗可见后第一次采样仍是起点值」。
 *   需要逐帧才能得出的结论只能靠探针，而探针是一次性的、用完即删 —— 下面点名的
 *   `…|已锁 / …|未锁` 那几组读数都来自这种已删探针，仓库里没有可复跑的副本，只当形状记录。
 * - **点开门之前先证明触发器整个在视口内**（{@link expectInView}），否则量的不是产品：
 *   Playwright 在点击瞬间会再判一次可见性，触发器在视口外就自己把文档滚过去，而往上滚的
 *   落点恰好是 0 —— 那正是「弹窗把列表归零」这条误判的来源。
 *   例外：`position: fixed` 浮层里的触发器（第 4 条抽屉内那颗「编辑」）文档滚动搬不动，
 *   那一步没有 `expectInView` 是刻意的，不是漏加。
 *
 * 1. **弹窗开着与关掉，列表都停在用户读到的那一行**。这条钉的是「什么都没动」这个终态。
 *    曾经这里断言的是「归零之后还回来」，三组对照把它撤了：起点 40（按钮可见）用自动化点击
 *    与真鼠标各开一次，弹窗可见后采到的都是 40；起点 150（按钮已在视口外，`rectTop=−82`）
 *    才读到 0，而且**归零发生在锁滚类落地之前**（逐帧 `150|未锁 → 0|未锁 → 0|已锁`）——
 *    按上面第二条口径，那是 Playwright 为把触发器滚进视口自己动的，真用户点不到视口外的按钮。
 * 2. **候选面板滚到末行之后，继续滚动不该把底下的列表推着走**。两个下拉的浮层不是模态，
 *    Element Plus 不给它们上 body 锁，滚动链顺着祖先直达文档 —— 修复前实测：滚到底后再来一格
 *    `page.mouse.wheel(0, 800)`（本用例用的就是这个值），文档 `scrollTop` 从 150 到 950，
 *    面板同时飘出视口。
 * 3. **保存后列表停在刚存的那一条**。`revealRow` 主动把那一行 `scrollIntoView`，与第 1 条
 *    「谁都别动」是两回事：这条要的是定位之后没有别的东西再把位置搬走。
 *    起点取 800：那一条保存后按默认序落到首行（文档坐标 335..380）。判据只到「高亮行整个进
 *    视口」，不钉落点 —— 默认可用平滑滚动，落点是动画终态，具体值本机探针读到过 138、行
 *    `y=195`（与 `block: 'center'` 的理论落点 ≈147.5 同量级），但那是量具不是契约。
 *    反面：若不定位而留在 800，同一行的 `rectTop` 是 `335 − 800 = −465`，整个移出视口上沿
 *    —— 两种结果在读数上直接对立，断言才有牙。
 * 4. **详情抽屉里再开一层弹窗，位置不掉**。三段位置（抽屉可见 / 弹窗可见 / 弹窗关闭后）都由
 *    本用例自己各采一次。Element Plus 的 `useLockscreen` 让后开的弹窗没抢到锁滚类
 *    （`withoutHiddenClass = false`），抽屉那句 200ms 延时的 cleanup 于是把锁摘在弹窗还开着
 *    的时候 —— 「弹窗开着但 body 未锁」是已删探针量的，本用例不判 body 类（那是 EP 内部实现）。
 *    这条路径本来也不归零，钉的就是这个终态。锁被提前摘掉带来的后果实测只到「锁不在」为止：
 *    滚轮打在遮罩上由 `.el-overlay-dialog` 自己接走（探针：文档停在 150；同一坐标把浮层去掉、
 *    一格 `deltaY=400` 推到 550），所以并不构成「遮罩下能滚列表」的用户可见症状，
 *    本轮不为它改「锁」的判定。
 *
 * 四条都把视口压到 420px 高：列表因此真的可滚（不然「scrollTop 没变」是空断言），
 * 30 个站点候选也才装得下面板放不下（不然滚不到底，越界滚动这一格就无从发生）。
 */

/** 30 条各挂一个独立域名，给站点候选攒出一个超过面板高度的列表 */
const TOTAL = 30;
/** 合成凭据：RFC 2606 保留域，与任何真实账号无关 */
const CSV = `username,password,url
${Array.from({ length: TOTAL }, (_, i) => `e2e-si-${String(i + 1).padStart(3, '0')},Synthetic!Si${i + 1},https://e2e-si${i + 1}.e2e.test/`).join('\n')}
`;

/**
 * 三个起点各按实测几何取，共同约束是「本用例接下来要点的触发器整个在视口内」
 *
 * 文档坐标（视口 420 高、30 行、行距 45）：头部「添加密码」按钮 68..100，站点筛选 170..202，
 * 表格首行 335..380，第 12 行 830..875，可滚范围 1718−420=1298。
 */
/** 第 1 条：让「添加密码」按钮留在视口内的同时，文档确实滚了一段 */
const ADD_TOP = 40;
/** 第 2、4 条：站点筛选与首行都还在视口内 */
const START_TOP = 150;
/** 第 3 条：深处的第 12 行整行可见，而首行已移出视口上沿（rectTop −465） */
const DEEP_TOP = 800;

const docTop = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollTop);

/** 程序化滚到指定偏移，并确认文档真的到了那里（可滚范围不足时「位置没变」是假绿，先否掉） */
async function scrollDocTo(page: Page, offset: number, message: string): Promise<void> {
  await page.evaluate(target => document.documentElement.scroll(0, target), offset);
  await expect.poll(() => docTop(page), { message }).toBe(offset);
}

/**
 * 证明「接下来要点的这个触发器此刻整个在视口内」
 *
 * 不可见时 Playwright 会先把文档滚过去（见文件头口径第二条），后面读到的位置就是夹具的、
 * 不是产品的。前提不成立就直接红，免得再把夹具行为当成浏览器行为去修一遍。
 */
async function expectInView(page: Page, trigger: Locator, label: string): Promise<void> {
  const box = await trigger.boundingBox();
  expect(box, `${label} 量不到位置`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport, '视口尺寸读不到').not.toBeNull();
  expect(box!.y, `${label} 已滚出视口上沿：这次点击会由 Playwright 先滚文档，读数不再属于产品`).toBeGreaterThanOrEqual(
    0,
  );
  expect(box!.y + box!.height, `${label} 超出视口下沿：同上`).toBeLessThanOrEqual(viewport!.height);
}

/** 取那一行的用户名（首格），并自证取到的确实是合成用户名，而不是序号列或空串 */
async function usernameOf(row: Locator): Promise<string> {
  // 表格行的 `innerText` 以换行起头，且各格之间用制表符分隔 —— 取第一段非空文本就是首格
  const username = (await row.innerText())
    .split(/[\t\n]/)
    .map(cell => cell.trim())
    .filter(Boolean)[0];
  expect(username, `首格读到的不像用户名：${JSON.stringify(username)}`).toMatch(/^e2e-si-\d{3}$/);
  return username;
}

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

test.describe('弹窗与浮层的滚动隔离', () => {
  test.beforeEach(async ({ optionsPage }) => {
    await optionsPage.setViewportSize({ width: 1280, height: 420 });
    await seedVault(optionsPage);
  });

  test('弹窗开着与关掉，列表都停在原来读到的那一行', async ({ optionsPage: page }) => {
    await scrollDocTo(page, ADD_TOP, '文档滚不到起点，测量前提不成立');
    const addBtn = page.getByRole('button', { name: textOf('options.header.addPassword') });
    await expectInView(page, addBtn, '头部的添加密码按钮');

    await addBtn.click();
    const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.form.addTitle') });
    await expect(dialog).toBeVisible();
    // 弹窗期间：Element Plus 只锁 body，不该动文档位置
    await expect.poll(() => docTop(page), { timeout: 2_000, message: '弹窗把列表的位置弄丢了' }).toBe(ADD_TOP);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // 解锁比弹窗退场晚 200ms（Element Plus 的 cleanup），等它跑完再读终态
    await expect.poll(() => docTop(page), { timeout: 5_000, message: '关掉弹窗后列表不在原处' }).toBe(ADD_TOP);
  });

  test('候选面板滚到底再滚，不推动底下的列表', async ({ optionsPage: page }) => {
    await scrollDocTo(page, START_TOP, '文档滚不到起点，测量前提不成立');
    const siteSelect = page.locator('.filters .site-filter .el-select__wrapper');
    await expectInView(page, siteSelect, '站点筛选');

    await siteSelect.click();
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
    await scrollDocTo(page, DEEP_TOP, '文档滚不到深处，测量前提不成立');
    const target = page.locator('tr.el-table__row').nth(11);
    const editBtn = target.getByRole('button', { name: textOf('common.edit') });
    const username = await usernameOf(target);
    await expectInView(page, editBtn, '深处那一行的编辑按钮');

    // 前提：这个深度下首行已整个移出视口上沿 —— 「定位到首行」与「留在原处」才在读数上对立
    const firstBefore = await page.locator('tr.el-table__row').first().boundingBox();
    expect(firstBefore, '首行量不到位置').not.toBeNull();
    expect(firstBefore!.y + firstBefore!.height, '深处仍看得见首行：这条用例分不清两种行为').toBeLessThan(0);

    await editBtn.click();
    const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.form.editTitle') });
    await expect(dialog).toBeVisible();
    // 原样提交即可：`updateTime` 一律重写，默认按更新时间倒序，于是这一条跳到首行，
    // 正是本用例要的「定位把行从视野外搬到眼前」。
    await expectSuccessToastFor(page, 'form.updateSuccess', () => footerPrimary(dialog).click());
    await expect(dialog).toBeHidden();

    const highlighted = page.locator('tr.el-table__row.new-item');
    await expect(highlighted, '保存后没有高亮行：定位链路自己就断了').toBeVisible();
    // 轮询到「进了视口」为止，而不是睡一个定值再读：默认可用平滑滚动（`scrollBehavior()`），
    // 实测从 800 平滑到居中要跑 ≈370ms，慢机器上更久 —— 定值等待会把动画中途读成终态
    // （真机抓到过一次 `y = −77.7`，即动画跑到一半）。不定位的话这条永远不成立，判据照旧有牙。
    await expect
      .poll(
        async () => {
          const box = await highlighted.boundingBox();
          const viewport = page.viewportSize();
          return !!box && !!viewport && box.y >= 0 && box.y + box.height <= viewport.height;
        },
        { timeout: 5_000, message: '列表留在了弹窗前的深处：刚存的那一条没进视口' },
      )
      .toBe(true);

    expect(await highlighted.innerText(), '高亮的不是刚保存的那一条').toContain(username);
  });

  /**
   * 从详情抽屉进的编辑弹窗：位置不掉
   *
   * 这条路径的账目与上面几条不同。抽屉给 body 上锁，但**不**归零 scrollTop；`onDetailEdit`
   * 在同一帧里收抽屉、开弹窗，而 Element Plus 的 `useLockscreen` 让后开的实例看见「类已在」
   * 就不记账（`withoutHiddenClass = false`），于是抽屉那句 200ms 延时的 cleanup 把锁摘了 ——
   * 弹窗开着的时候 body 是**未锁**状态（这三段 `lock` 的开关来自已删探针，本用例不判它）。
   * 净效果是位置不掉，所以本用例只钉三段位置读数，不钉 EP 的锁滚类（那是它的内部实现，改了就红）。
   * 那条「弹窗开着但 body 未锁」的窗口期实测没有用户可见后果，见文件头第 4 条。
   *
   * 读数万一成了 0：本路径上已知的唯一产生方式是文件头口径第二条那种夹具滚动，而它要求触发器
   * 落在视口外 —— 第 230 行那道 `expectInView` 挡的是首行的「查看详情」，抽屉里那颗「编辑」在
   * fixed 浮层内、本就可见，正常走不到那条路。撤销还原逻辑之后这条判据在本机红过 1 次（16 次里，
   * 失败值 0），此后 15 次连续干净，原因未能复现到可以指名。
   */
  test('抽屉里再开编辑弹窗，列表位置不掉', async ({ optionsPage: page }) => {
    await scrollDocTo(page, START_TOP, '文档滚不到起点，测量前提不成立');
    const detailBtn = page
      .locator('tr.el-table__row')
      .first()
      .getByRole('button', { name: textOf('options.detail.viewDetail') });
    await expectInView(page, detailBtn, '首行的查看详情按钮');

    await detailBtn.click();
    const drawer = page.getByRole('dialog').filter({ hasText: textOf('options.detail.title') });
    await expect(drawer).toBeVisible();
    await expect.poll(() => docTop(page), { message: '抽屉自己就把位置弄丢了' }).toBe(START_TOP);

    await drawer.getByRole('button', { name: textOf('common.edit') }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.form.editTitle') });
    await expect(dialog).toBeVisible();
    // 定点采样证明这条路径上没有归零：弹窗刚可见时锁还在（抽屉的 cleanup 是 200ms 延时），
    // 此刻读数已是 150；等 cleanup 把锁摘掉仍是 150。
    await expect.poll(() => docTop(page), { timeout: 2_000, message: '弹窗开着时列表位置掉了' }).toBe(START_TOP);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => docTop(page), { timeout: 2_000, message: '关掉嵌套弹窗后没停在原位' }).toBe(START_TOP);
  });
});
