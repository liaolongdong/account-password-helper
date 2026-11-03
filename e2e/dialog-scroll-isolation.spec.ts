import type { Locator, Page } from '@playwright/test';
import { expect, expectSuccessToastFor, footerPrimary, runHeaderCommand, test, verifyMasterPassword } from './harness';
import { textOf } from './i18n';

/**
 * 管理页的滚动隔离（弹窗与候选浮层各自把滚动留在自己身上）
 *
 * 这一族行为只在真浏览器里成立，单测与 `tsc` 都摸不到。
 *
 * 先钉两条读数口径，下面六条都按它们读：
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
 *   **但「在视口内」只挡住一半**：`locator.click()` 在动作前还会经 CDP 的
 *   `DOM.scrollIntoViewIfNeeded` 预滚一次，那一步不经过页面 JS，钩子抓不到，元素已经
 *   在视口内也可能被搬到别处去（第 4 条实测：本机 14 轮里 6 轮从 300 跳到 660 或 268）。
 *   第 4 条因此改用 {@link clickInView}（坐标点击，不预滚）。第 1、2、3 条同样按绝对位置判定，
 *   理论上一样暴露，只是至今没观测到——再出现「读数各不相同」这种签名，照第 4 条改法办。
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
 *    起点取 1020：那一条保存后按默认序落到首行（文档坐标 645..708）。判据只到「高亮行整个进
 *    视口」，不钉落点 —— 默认可用平滑滚动，落点是动画终态，具体值本机探针读到过 138、行
 *    `y=195`（与 `block: 'center'` 的理论落点 ≈147.5 同量级），但那是量具不是契约。
 *    反面：若不定位而留在 1020，同一行的 `rectTop` 是 `645 − 1020 = −375`，整个移出视口上沿
 *    —— 两种结果在读数上直接对立，断言才有牙。
 * 4. **详情抽屉里再开一层弹窗，位置不掉**。三段位置（抽屉可见 / 弹窗可见 / 弹窗关闭后）都由
 *    本用例自己各采一次。Element Plus 的 `useLockscreen` 让后开的弹窗没抢到锁滚类
 *    （`withoutHiddenClass = false`），抽屉那句 200ms 延时的 cleanup 于是把锁摘在弹窗还开着
 *    的时候 —— 「弹窗开着但 body 未锁」是已删探针量的，本用例不判 body 类（那是 EP 内部实现）。
 *    这条路径本来也不归零，钉的就是这个终态。
 *    **订正**：本文件早先在这里写过「锁被提前摘掉无可观测症状，滚轮由 `.el-overlay-dialog`
 *    自己接走」，那句话只在它当时的落点成立 —— 那颗「编辑」打开的是长表单，比 420px 视口高，
 *    遮罩自己是能滚的滚动容器，于是链被它吃掉（探针：文档停在 150；同一坐标把浮层去掉、
 *    一格 `deltaY=400` 推到 550）。遮罩滚不动时（内容比视口矮）链就顺着交给文档，
 *    第 5 条量的正是这一半。
 * 5. **复验门槛弹窗开着，滚轮打在遮罩上不该推动列表**。回收站与身份信息库要先弹
 *    `ElMessageBox` 复验主密码，正式弹窗落在 MessageBox 那 200ms 延时 cleanup 的窗口里，
 *    按第 4 条说的同一处 `useLockscreen` 判定拿不到锁滚类 —— 于是这两条路径上「锁不在」
 *    是真有症状的：修复前实测同一格 `deltaY=800` 把文档推走 —— 回收站 `0 → 800`、身份信息库
 *    `87 → 887`；而无复验门槛的「导入数据」与详情抽屉在同坐标的**位移**是 0（锁滚类在场）。
 *    那两组的基线（0 与 87）都来自口径第二条的夹具滚动，所以第 5 条按位移判定、不钉绝对位置。
 *    修法是把链剪断在遮罩自己身上
 *    （`entrypoints/options/App.vue` 全局块里的 `.el-overlay-dialog { overscroll-behavior: contain }`），
 *    不动 EP 的锁 —— 补锁要改 MessageBox 的关闭时序，那是它的内部实现。
 *    这条只钉回收站：它是两扇门里形状更简单的那个（短内容、`close-on-click-modal=false`），
 *    身份信息库的读数与它同源。
 * 6. **命令面板开着，滚轮打在遮罩、面板非滚动区、以及列表滚到底之后的那一格，都不该推动列表**。
 *    面板不是 el-dialog，Element Plus 的 `useLockscreen` 根本不参与（body 全程未上锁）；而它的遮罩
 *    此前是 `overflow: visible` —— 连滚动容器都不是，`overscroll-behavior` 写在它身上也不生效，
 *    滚轮于是直接交给文档。修复前实测（起点 150、一格 `deltaY=800`）三个落点全部穿透到 950。
 *    修法是让遮罩真的成为滚动容器再剪链（`components/options/CommandPalette.vue` 的
 *    `.cp-overlay { overflow: auto; overscroll-behavior: contain }`），与第 5 条同构。
 *    只此一条：先写过「遮罩 + 列表各一条」，把列表那条摘掉重跑三段位移全部照旧绿，
 *    故按实测的承重位置收掉 —— 详见该条用例的注释。
 *    **已知引擎差异**：本机 Chrome for Testing 155 上「落点 2（底部提示条）」恒红（`150 → 950`），
 *    CI 的 Playwright Chromium 恒绿。探针实测：滚轮落点自身不可滚时，新引擎不再向祖先问
 *    `overscroll-behavior`，直接把滚动交给文档；给 `.cp-panel` 补一份 `contain` 已验证**无效**
 *    （已回退）。这不是本轮引入的回归，也不要在 CSS 上继续找解 —— 要覆盖新引擎得在 wheel 事件层兜，
 *    那属于交互改动。判红绿以 CI 为准（本机与 CI 不是同一个引擎，见 `e2e/README.md`）。
 *
 * 六条都把视口压到 420px 高：列表因此真的可滚（不然「scrollTop 没变」是空断言），
 * 30 个站点候选也才装得下面板放不下（不然滚不到底，越界滚动这一格就无从发生），
 * 命令面板那一长串命令同理要超出 `.cp-list` 的 52vh，第 6 条的第三段才量得到。
 */

/** 30 条各挂一个独立域名，给站点候选攒出一个超过面板高度的列表 */
const TOTAL = 30;
/** 合成凭据：RFC 2606 保留域，与任何真实账号无关 */
const CSV = `username,password,url
${Array.from({ length: TOTAL }, (_, i) => `e2e-si-${String(i + 1).padStart(3, '0')},Synthetic!Si${i + 1},https://e2e-si${i + 1}.e2e.test/`).join('\n')}
`;

/**
 * 四个起点各按实测几何取，共同约束是「本用例接下来要点的触发器整个在视口内」
 *
 * 文档坐标（视口 420 高、30 行、行距 63；本机 macOS / Chrome for Testing 155 一侧的读数，
 * CI 的 Playwright Chromium 整体矮约 10 像素，取值按两边都能过算）：头部 0..168，
 * 安全起步清单 192..442，站点筛选 479..513，表格 582..2535，首行 645..708，
 * 第 12 行 1338..1401，可滚范围 2568−420=2148。
 *
 * 这份账本在 `aefa606`（安全起步清单，表头下方多出 250 高一块卡片）之后整体下移过一轮，
 * 旧值 68..100 / 170..202 / 335..380 / 830..875 已不成立——`expectInView` 挡的就是这种漂移。
 */
/** 第 1、5 条：让头部的按钮（「添加密码」/「数据管理」）留在视口内的同时，文档确实滚了一段 */
const ADD_TOP = 40;
/** 第 2 条：站点筛选还在视口内，浮层按下方空间不足翻到输入框上方 */
const START_TOP = 150;
/** 第 4 条：首行（645..708）整个进视口，其「查看详情」按钮底沿两侧平台都 <420 */
const DETAIL_TOP = 300;
/** 第 3 条：深处的第 12 行整行可见（318..381），而首行已移出视口上沿（rectTop −375） */
const DEEP_TOP = 1020;

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

/**
 * 先证明触发器整个在视口内，再用真坐标点它
 *
 * 这条不是给 `expectInView` 加保险，是换掉量具：`locator.click()` 在每次动作前都会经 CDP 的
 * `DOM.scrollIntoViewIfNeeded` 预滚一次，而那一步**不经过页面 JS**——把
 * `Element.prototype.scroll/scrollTo/scrollBy/scrollIntoView`、`scrollTop` 的 setter 和
 * `window.scroll` 全钩上，一次也抓不到，`expectInView` 更挡不住。本机实测 14 轮里 6 轮被它把
 * 文档从 300 搬到 660（首行贴顶，正好是那颗按钮的文档坐标滚到视口顶部）或搬到 268，
 * 于是「抽屉弄丢位置」读到的一直是夹具自己搬的那一下。`page.mouse.click` 按坐标派发输入、
 * 不做预滚动，既把产品行为还原出来，也更接近真用户的一次点击。
 */
async function clickInView(page: Page, trigger: Locator, label: string): Promise<void> {
  await expectInView(page, trigger, label);
  const box = await trigger.boundingBox();
  expect(box, `${label} 量不到位置`).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
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
    // 实测从千像素级的深处平滑到居中要跑 ≈370ms，慢机器上更久 —— 定值等待会把动画中途读成终态
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
   * 那条「弹窗开着但 body 未锁」的窗口期在**本路径**上没有可见后果——长表单让遮罩自己就能滚，
   * 链被它接走；同一条缺失的锁在复验门槛弹窗上是有后果的，见文件头第 5 条与本文件最后一条用例。
   *
   * 读数万一成了 0：本路径上已知的唯一产生方式是文件头口径第二条那种夹具滚动，而它要求触发器
   * 落在视口外 —— 本用例里那道 `expectInView` 挡的是首行的「查看详情」，抽屉里那颗「编辑」在
   * fixed 浮层内、本就可见，正常走不到那条路。撤销还原逻辑之后这条判据在本机红过 1 次（16 次里，
   * 失败值 0），此后 15 次连续干净，原因未能复现到可以指名。
   *
   * **上面那一句已被本轮推翻，留在这里记着走过的弯**：这条间歇红的读数落在 650 / 660 / 464 /
   * 268 / 258 这类**各不相同的中间值**上，不是 0。逐帧探针量到跳变发生在一帧之内
   * （`scroll-behavior: auto`），而钩住 `Element.prototype.scroll/scrollTo/scrollBy/scrollIntoView`、
   * `scrollTop` 的 setter 与 `window.scroll` 之后**一次脚本滚动都没抓到**——唯一的赋值落在
   * `.el-overlay` / `.el-drawer` 自己身上，那是 EP 重置容器，不动文档。搬动文档的是
   * `locator.click()` 动作前的 `DOM.scrollIntoViewIfNeeded`（660 那一档正是「把那颗按钮滚到
   * 视口顶部」的落点：本机 14 轮里 6 轮命中）。所以触发点击换成 {@link clickInView}，
   * 读数仍由本用例自己采——产品若真把列表搬走，照样红。
   */
  test('抽屉里再开编辑弹窗，列表位置不掉', async ({ optionsPage: page }) => {
    await scrollDocTo(page, DETAIL_TOP, '文档滚不到起点，测量前提不成立');
    const detailBtn = page
      .locator('tr.el-table__row')
      .first()
      .getByRole('button', { name: textOf('options.detail.viewDetail') });
    await clickInView(page, detailBtn, '首行的查看详情按钮');
    const drawer = page.getByRole('dialog').filter({ hasText: textOf('options.detail.title') });
    await expect(drawer).toBeVisible();
    await expect.poll(() => docTop(page), { message: '抽屉自己就把位置弄丢了' }).toBe(DETAIL_TOP);

    await drawer.getByRole('button', { name: textOf('common.edit') }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.form.editTitle') });
    await expect(dialog).toBeVisible();
    // 定点采样证明这条路径上没有归零：弹窗刚可见时锁还在（抽屉的 cleanup 是 200ms 延时），
    // 此刻读数已是 DETAIL_TOP；等 cleanup 把锁摘掉仍是同一个值。
    await expect.poll(() => docTop(page), { timeout: 2_000, message: '弹窗开着时列表位置掉了' }).toBe(DETAIL_TOP);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => docTop(page), { timeout: 2_000, message: '关掉嵌套弹窗后没停在原位' }).toBe(DETAIL_TOP);
  });

  /**
   * 复验门槛弹窗（回收站）：遮罩上滚一格，列表不动
   *
   * 这条钉的是文件头第 5 条那个「锁没抢到」真有后果的落点。回收站要先过 `ElMessageBox` 复验，
   * 正式弹窗落在 MessageBox 200ms 延时 cleanup 的窗口里，按 `useLockscreen` 的记账规则拿不到
   * 锁滚类；遮罩（`.el-overlay-dialog`，EP 里是 `position:fixed;inset:0;overflow:auto`）此时
   * 内容比视口矮、自己滚不动，滚动链就顺着 fixed 祖先交给文档 —— 修复前实测同一格 `+800`。
   * 修法只剪链（全局块的 `overscroll-behavior: contain`），不去补锁：锁是 EP 的内部时序。
   * 红绿都验过：把那条声明改成 `auto` 重跑本文件，五条里**只有这条**红（实测 `36 → 836`，
   * 恰好一格），其余四条不动；改回 `contain` 即绿。
   *
   * 判据是**位移**而不是绝对位置：`回收站` 那一行菜单项落在文档坐标 500 上下（EP 的 popper
   * 按文档坐标绝对定位），而视口只有 420 高，Playwright 为了点中它把文档往下搬了一段。
   * 搬多少不归本用例管：起点钉死在 40，基线本机两次分别量到 87 与 36 —— 这正是文件头口径
   * 第二条说的夹具滚动，只是这里搬不进视口外的菜单项是这条路径绕不开的一步（复验门槛的入口
   * 只有这一个）。所以基线在弹窗可见之后现采，判的只是「这一格有没有把它推走」。
   *
   * 三道前提各自否掉一种假绿：`docRoom > 0` 保证文档此刻真的还能滚（不然「没动」是空断言），
   * `overlayRoom <= 0` 保证这条路径上遮罩确实滚不动（否则链被它自己吃掉，读到的「文档不动」
   * 属于第 4 条那种路径而不是本条），滚完之后那道 `contain` 保证样式真的落到这个节点上
   * （口径与第 2 条对 `.el-vl__window` 的那道检查一致，但它排在位移之后 —— 见用例里的注释）。
   */
  test('复验门槛弹窗开着，遮罩上滚一格不推动列表', async ({ optionsPage: page }) => {
    await scrollDocTo(page, ADD_TOP, '文档滚不到起点，测量前提不成立');
    const dataBtn = page.getByRole('button', { name: textOf('options.header.data') });
    await expectInView(page, dataBtn, '头部的数据管理按钮');

    await runHeaderCommand(page, 'options.header.data', 'options.header.trash');
    await verifyMasterPassword(page, 'options.trash.verifyPrompt');
    const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.trash.title') });
    await expect(dialog).toBeVisible();
    const baseline = await docTop(page);

    // 卡片 920px 居中、视口 1280 宽，左右各留 180px 遮罩区；取左侧偏中的这一格
    const POINT = { x: 90, y: 210 };
    const premises = (p: Page) =>
      p.evaluate(coords => {
        const root = document.documentElement;
        const node = document.elementFromPoint(coords.x, coords.y)?.closest('.el-overlay-dialog');
        return {
          hit: !!node,
          contain: node ? getComputedStyle(node).overscrollBehaviorY : null,
          // 遮罩自己还能滚多少：<=0 表示这一格滚轮注定要上抛
          overlayRoom: node ? Math.round(node.scrollHeight - node.getBoundingClientRect().height) : null,
          docRoom: root.scrollHeight - root.clientHeight - root.scrollTop,
        };
      }, POINT);

    const before = await premises(page);
    expect(before.hit, '滚轮落点不在弹窗遮罩上：量的不是这条路径').toBe(true);
    expect(before.overlayRoom, '遮罩自己就能滚：这条用例分不清「剪链」与「被遮罩吃掉」').toBeLessThanOrEqual(0);
    expect(before.docRoom, '文档已经滚到底：这一格本来也推不动它，判据是空的').toBeGreaterThan(0);

    await page.mouse.move(POINT.x, POINT.y);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
    // 主判据是行为：把样式的核对排在位移之后，这样「规则没落地」红的时候先红的是这一条
    // （否则末尾那道静态样式检查若排在前面，位移判据就没人证过它有牙）。
    expect(await docTop(page), '遮罩上的滚轮把底下的列表推着走了').toBe(baseline);

    const after = await premises(page);
    expect(after.contain, '遮罩上没有 contain：剪断滚动链的样式没落到这个节点').toBe('contain');
  });

  /**
   * 命令面板开着，三个落点都不把滚动交给底下的列表
   *
   * 与第 5 条同构，但成因完全不同：面板不是 `el-dialog`，Element Plus 的 `useLockscreen` 压根
   * 没参与（实测 `body` 的 `overflow` 全程是 `visible`，从未上锁），隔离全靠组件自己那一条声明。
   * 三个落点各钉一段：遮罩空白处、面板底部提示条（它的最近滚动容器同样是遮罩）、列表末行之后。
   *
   * 为什么只钉遮罩上的 `contain`、不钉列表上的：先按「遮罩一条 + 列表一条」写过，变异验证把
   * 列表那条摘掉重跑，**三段位移全部照旧绿** —— 越界那一格顺着祖先爬到遮罩，链在遮罩那里就断了，
   * 轮不到列表自己那份声明。留一条没人证的声明，不如把判据钉在实际承重的那一条上
   * （组件里的注释记着这条负结果，免得下次又「补」回去）。
   *
   * 两道前提各否掉一种假绿，口径与第 2、5 条一致：`docRoom > 0` 保证文档此刻真的还滚得动
   * （不然「没动」是空断言）；遮罩那两段的 `room <= 0` 保证这一格注定要上抛（否则「文档不动」
   * 是遮罩自己吃掉的，量不到剪链这件事）。视口 420 高、面板 319 高，遮罩装得下面板、`room` 恒为 0
   * —— 而修复前它连滚动容器都不是（`overflow: visible`），三个落点因此全部穿透。
   */
  test('命令面板开着，遮罩、页脚与列表末行的滚轮都不推动列表', async ({ optionsPage: page }) => {
    await scrollDocTo(page, START_TOP, '文档滚不到起点，测量前提不成立');
    await page.keyboard.press('Control+k');
    const overlay = page.locator('.cp-overlay');
    await expect(overlay, 'Ctrl+K 没唤起命令面板').toBeVisible();
    const baseline = await docTop(page);

    /** 把指针落到 (x,y)，先自证它落在 `selector` 上且判据不是空的，再滚一格读位置 */
    const wheelOn = async (x: number, y: number, selector: string, label: string): Promise<void> => {
      const read = await page.evaluate(
        ({ coords, sel }) => {
          const root = document.documentElement;
          const node = document.elementFromPoint(coords.x, coords.y)?.closest(sel) as HTMLElement | null;
          return {
            hit: !!node,
            contain: node ? getComputedStyle(node).overscrollBehaviorY : null,
            // 该容器自己还能滚多少：<=0 表示这一格滚轮注定要上抛
            room: node ? Math.round(node.scrollHeight - node.getBoundingClientRect().height) : null,
            docRoom: root.scrollHeight - root.clientHeight - root.scrollTop,
          };
        },
        { coords: { x, y }, sel: selector },
      );
      expect(read.hit, `${label}：滚轮落点不在 ${selector} 上，量的不是这条路径`).toBe(true);
      expect(read.docRoom, `${label}：文档已经滚到底，这一格本来也推不动它，判据是空的`).toBeGreaterThan(0);
      if (selector === '.cp-overlay') {
        expect(read.room, `${label}：遮罩自己就能滚，这条分不清「剪链」与「被遮罩吃掉」`).toBeLessThanOrEqual(0);
      }

      await page.mouse.move(x, y);
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(300);
      // 与第 5 条同口径：主判据是位移，样式的核对排在它后面 —— 若 `contain` 排在前面，
      // 「规则没落地」会先红在样式上，位移那条判据就永远没人证过它有牙。
      expect(await docTop(page), `${label}：滚轮把底下的列表推着走了`).toBe(baseline);
      expect(read.contain, `${label}：contain 没落到 ${selector} 这个节点上`).toBe('contain');
    };

    // 落点 1：面板之外的遮罩。卡片 560px 居中于 1280 宽，左右各留 360px 遮罩区
    await wheelOn(90, 210, '.cp-overlay', '面板外的遮罩');

    // 落点 2：面板内的非滚动区（底部提示条），它的最近滚动容器同样是遮罩
    const footerBox = await page.locator('.cp-footer').boundingBox();
    expect(footerBox, '面板底部提示条量不到位置').not.toBeNull();
    await wheelOn(
      footerBox!.x + footerBox!.width / 2,
      footerBox!.y + footerBox!.height / 2,
      '.cp-overlay',
      '面板底部提示条',
    );

    // 落点 3：列表滚到底之后的那一格 —— 列表自己那份 `contain` 并没有（变异验证摘掉后三段位移照旧绿，
    // 链在遮罩那一层就被拦住），这一段落在这里量的正是「越界上抛后有没有人接住」这件事。
    const list = page.locator('.cp-list');
    const listRoom = await list.evaluate(el => el.scrollHeight - el.clientHeight);
    expect(listRoom, '列表没有超出可视高度：滚不到底，越界这一格无从发生').toBeGreaterThan(0);
    const listBox = await list.boundingBox();
    expect(listBox, '列表量不到位置').not.toBeNull();
    await page.mouse.move(listBox!.x + listBox!.width / 2, listBox!.y + listBox!.height / 2);
    await page.mouse.wheel(0, 2_000);
    await expect
      .poll(() => list.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1), {
        message: '命令列表没滚到底',
      })
      .toBe(true);
    expect(await docTop(page), '列表滚到底这一段就把文档推走了').toBe(baseline);

    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
    expect(await docTop(page), '命令列表滚到底后，滚动链把底下的列表推着走了').toBe(baseline);
  });
});
