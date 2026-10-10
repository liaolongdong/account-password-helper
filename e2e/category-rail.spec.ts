import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { expect, expectSuccessToast, runHeaderCommand, storedArrayCount, test } from './harness';
import { anchoredTextOf, textOf } from './i18n';

/**
 * 管理页左侧分类栏（标签段 + 站点段，自动归类视图的真机回归）
 *
 * 单测钉的是算法与接线（`facet` / `tagUtils` / `siteUtils` / `categoryRailWiring`），
 * 证明不了只有真浏览器才成立的五件事：
 * ① 两段候选**真的渲染在左栏里**、计数与段落顺序正确——它们现在是无框架契约的普通
 *    `<button>` 行，不再依赖 Element Plus 下拉面板的内部类名，但「派生集合有没有真的接到列表」仍需真链路；
 * ② 多种网址写法在真实数据上确实落进同一个桶（条目经导入落盘为密文，读出来才参与归一）；
 * ③ 点一行主表跟着变，段内是「或」、段间是「且」，而不是「算了但没接到 `el-table`」；
 * ④ 候选数超过可见上限时「搜索框 + 显示全部」真的出现，且搜索命中的是全集（能捞出窗口外的候选）。
 *    第 ④ 条是这一版换形的代价所在：原来靠 `el-select-v2` 的虚拟列表兜住上千候选，
 *    现在改成「截断 + 全集搜索 + 显式展开」，必须在真机上证明截断没有把候选搜丢；
 * ⑤ 某个站点最后一条被删掉后，候选行与生效中的筛选一起退出，列表不会停在一张看不见的空表上。
 *
 * 前置数据沿用 `pagination.spec.ts` 的做法：走真实的「数据管理 → 导入数据」入口灌入。
 */

/** 三个站的条目数刻意各不相等，候选排序（条目数倒序）才有可判定的读数 */
const SITES = { alpha: 6, beta: 4, gamma: 2 } as const;
const TOTAL = SITES.alpha + SITES.beta + SITES.gamma;

/** 第 5 条用例的独立夹具：刻意超过可见上限（`FACET_VISIBLE_LIMIT` = 50），让截断与搜索分支被走到 */
const OVER_LIMIT = 53;
const VISIBLE_LIMIT = 50;

/** 合成凭据：RFC 2606 保留域，与任何真实账号无关 */
const domainOf = (letter: string) => `${letter}.e2e-sf.test`;

/** 两位补零，使「同数量按值正序」与肉眼顺序一致，隐藏窗口能按下标算出来 */
const paddedDomainOf = (index: number) => `n${String(index).padStart(2, '0')}.e2e-sf.test`;

/** 正则转义：域名里的点是元字符 */
const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * alpha 刻意用三种写法（完整 URL / 纯域名 / 带端口），用来证明归一后同桶；前 3 条挂标签供叠加断言
 */
const CSV = [
  'username,password,url,tag,remark',
  ...Array.from({ length: SITES.alpha }, (_, i) => {
    const url = [`https://${domainOf('alpha')}/login`, domainOf('alpha'), `http://${domainOf('alpha')}:8080/dashboard`][
      i % 3
    ];
    return `e2e-sf-a${i + 1},Synthetic!A${i + 1},${url},${i < 3 ? 'sfwork' : ''},`;
  }),
  ...Array.from(
    { length: SITES.beta },
    (_, i) => `e2e-sf-b${i + 1},Synthetic!B${i + 1},https://${domainOf('beta')}/x,,`,
  ),
  ...Array.from({ length: SITES.gamma }, (_, i) => `e2e-sf-g${i + 1},Synthetic!G${i + 1},${domainOf('gamma')},,`),
].join('\n');

/** 每条一个不同站点、都不挂标签：站点段候选数 = 条目数，恰好越过可见上限 */
const CSV_OVER_LIMIT = [
  'username,password,url,tag,remark',
  ...Array.from({ length: OVER_LIMIT }, (_, i) => `e2e-sf-n${i + 1},Synthetic!N${i + 1},${paddedDomainOf(i + 1)},,`),
].join('\n');

/**
 * 主表格行
 *
 * 与 `pagination.spec.ts` 同理：导入弹窗的预览区本身也是一张 `el-table`，按容器收窄才不把预览行算进来。
 */
const mainRows = (page: Page): Locator => page.locator('.password-list tr.el-table__row');

/** 整条分类栏（`<aside>`，两段候选都住在里面） */
const rail = (page: Page): Locator => page.locator('.category-rail');

/** 「全部条目」复位行 */
const allRow = (page: Page): Locator => rail(page).locator('.rail-all');

/**
 * 按标题定位某一段
 *
 * 不靠 `.rail-section` 的下标写死顺序——顺序本身在第 1 条用例里断言。
 * 这里用标题（同时也是该段的无障碍分组名）定位，段落换序时其余用例仍指向正确的段。
 */
const sectionOf = (page: Page, key: 'options.rail.tags' | 'options.rail.sites'): Locator =>
  rail(page)
    .locator('.rail-section')
    .filter({ has: page.getByRole('heading', { name: textOf(key) }) });

const rowsOf = (section: Locator): Locator => section.locator('.rail-item');

/**
 * 某个候选所在的行（那颗按钮）
 *
 * 先用精确正则命中 label 节点，再取其按钮祖先，两点都试过别的路子：
 * - 把 `hasText` 直接挂到按钮上会撞拼接文本——按钮的内容是 label 与 count 两个 span
 *   的连写（`sfwork` + `3` = `sfwork3`），且 `n5` 这类子串同时命中 `n50`~`n53`；
 * - `filter({ has: … })` 里带文本条件不成立（本机 Playwright 1.63 恒 0 命中，真机表现为等 20 秒超时），
 *   只有纯结构/角色条件才走得通——`sectionOf` 用的 `has: getByRole('heading')` 就是这一类。
 */
const rowOf = (section: Locator, value: string): Locator =>
  section.locator('.rail-item__label', { hasText: new RegExp(`^${esc(value)}$`) }).locator('xpath=ancestor::button[1]');

const labelsOf = (section: Locator) => rowsOf(section).locator('.rail-item__label').allInnerTexts();
const countsOf = (section: Locator) => rowsOf(section).locator('.rail-item__count').allInnerTexts();

/** 走导入入口灌入 CSV，等到主表行数与落盘数都对上 */
async function seedVault(page: Page, csv: string, expected: number): Promise<void> {
  await runHeaderCommand(page, 'options.header.data', 'options.header.importData');
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.import.title') });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'e2e-category-rail.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
  await expect(dialog.locator('.preview-section')).toBeVisible();
  await dialog.locator('.el-dialog__footer .el-button--success').click();
  await expect(dialog).toBeHidden();

  await expect(mainRows(page)).toHaveCount(expected);
  expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(expected);
}

test.describe.configure({ timeout: 120_000 });

test.describe('管理页分类栏', () => {
  test('标签段在前、站点段在后：候选由条目自动汇总并按条目数倒序带计数', async ({ optionsPage: page }) => {
    await seedVault(page, CSV, TOTAL);

    await expect(rail(page)).toBeVisible();
    // 「全部条目」挂在库总量上，它是这一栏唯一的「不筛」读数
    await expect(allRow(page).locator('.rail-all__count')).toHaveText(String(TOTAL));
    await expect(allRow(page)).toHaveAttribute('aria-pressed', 'true');

    // 段落顺序是设计口径：标签是人写的、站点是派生的，人写在前
    const titles = rail(page).locator('.rail-section__title');
    await expect(titles).toHaveCount(2);
    await expect(titles.nth(0)).toHaveText(anchoredTextOf('options.rail.tags'));
    await expect(titles.nth(1)).toHaveText(anchoredTextOf('options.rail.sites'));

    const sites = sectionOf(page, 'options.rail.sites');
    expect(await labelsOf(sites)).toEqual([domainOf('alpha'), domainOf('beta'), domainOf('gamma')]);
    expect(await countsOf(sites)).toEqual([String(SITES.alpha), String(SITES.beta), String(SITES.gamma)]);

    const tags = sectionOf(page, 'options.rail.tags');
    expect(await labelsOf(tags)).toEqual(['sfwork']);
    expect(await countsOf(tags)).toEqual(['3']);
  });

  test('点站点行即筛选：同一站的多种网址写法算作一站，多站之间是或关系', async ({ optionsPage: page }) => {
    await seedVault(page, CSV, TOTAL);
    const sites = sectionOf(page, 'options.rail.sites');

    await rowOf(sites, domainOf('alpha')).click();
    await expect(rowOf(sites, domainOf('alpha'))).toHaveAttribute('aria-pressed', 'true');

    // 6 条全在（完整 URL / 纯域名 / 带端口三种写法同桶），其余两站一条不剩
    await expect(mainRows(page)).toHaveCount(SITES.alpha);
    await expect(mainRows(page).filter({ hasText: `${domainOf('alpha')}:8080` })).toHaveCount(2);
    await expect(mainRows(page).filter({ hasText: domainOf('beta') })).toHaveCount(0);

    await rowOf(sites, domainOf('gamma')).click();
    await expect(mainRows(page)).toHaveCount(SITES.alpha + SITES.gamma);

    await rowOf(sites, domainOf('alpha')).click();
    await expect(mainRows(page)).toHaveCount(SITES.gamma);

    // 选中集清空 = 该维度不参与筛选，而不是「筛出一个空集」；复位行重新亮起
    await rowOf(sites, domainOf('gamma')).click();
    await expect(mainRows(page)).toHaveCount(TOTAL);
    await expect(allRow(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('段与段之间是且关系，计数读全库不读结果集，「全部条目」一次复位两段', async ({ optionsPage: page }) => {
    await seedVault(page, CSV, TOTAL);
    const sites = sectionOf(page, 'options.rail.sites');
    const tags = sectionOf(page, 'options.rail.tags');

    await rowOf(sites, domainOf('gamma')).click();
    await expect(mainRows(page)).toHaveCount(SITES.gamma);

    // 计数读的是整库分布，不随另一段的选中态收敛：
    // 否则 gamma 会把 sfwork 显示成 0，而用户正需要看到「还有 3 条带这个标签」才走得出来
    await expect(rowOf(tags, 'sfwork').locator('.rail-item__count')).toHaveText('3');

    await rowOf(tags, 'sfwork').click();

    // gamma 的两条没有 sfwork 标签：叠加后应当是空表，而不是回落到任一维度
    await expect(mainRows(page)).toHaveCount(0);
    await expect(allRow(page)).toHaveAttribute('aria-pressed', 'false');

    await allRow(page).click();
    await expect(mainRows(page)).toHaveCount(TOTAL);
    await expect(rowOf(sites, domainOf('gamma'))).toHaveAttribute('aria-pressed', 'false');
    await expect(rowOf(tags, 'sfwork')).toHaveAttribute('aria-pressed', 'false');
  });

  test('候选没超过可见上限时，搜索框与「显示全部」都不出现', async ({ optionsPage: page }) => {
    await seedVault(page, CSV, TOTAL);

    await expect(sectionOf(page, 'options.rail.sites').locator('.rail-section__search')).toHaveCount(0);
    await expect(rail(page).locator('.rail-section__more')).toHaveCount(0);
  });

  test('候选超过可见上限：截断 + 全集搜索 + 显式展开，窗口外的候选可被搜到、选中，收起后仍看得见', async ({
    optionsPage: page,
  }) => {
    await seedVault(page, CSV_OVER_LIMIT, OVER_LIMIT);
    const sites = sectionOf(page, 'options.rail.sites');

    // 前 50 个可见（计数同为 1 时按值正序），第 51~53 个还没进 DOM
    await expect(rowsOf(sites)).toHaveCount(VISIBLE_LIMIT);
    await expect(rowOf(sites, paddedDomainOf(VISIBLE_LIMIT))).toBeVisible();
    await expect(rowOf(sites, paddedDomainOf(OVER_LIMIT))).toHaveCount(0);
    await expect(sites.locator('.rail-section__search')).toBeVisible();

    // 搜索走全集：'n5' 同时命中窗口内的 n50 与窗口外的 n51~n53
    await sites.locator('.rail-section__search input').fill('n5');
    expect(await labelsOf(sites)).toEqual([50, 51, 52, 53].map(paddedDomainOf));

    // 命中数已落到上限以内，此时「显示全部」这个入口应当消失
    await expect(sites.locator('.rail-section__more')).toHaveCount(0);

    await sites.locator('.rail-section__search input').fill('');
    await sites.locator('.rail-section__more').click();
    await expect(rowsOf(sites)).toHaveCount(OVER_LIMIT);

    // 展开态下选中窗口外的那条：筛选照样生效，截断不曾把候选从过滤链里丢掉
    await rowOf(sites, paddedDomainOf(OVER_LIMIT)).click();
    await expect(mainRows(page)).toHaveCount(1);
    await expect(mainRows(page).filter({ hasText: paddedDomainOf(OVER_LIMIT) })).toHaveCount(1);

    // 再收起：被选中的那条必须被钉回视图。否则筛选仍然生效、左栏却找不出哪一行是选中的，
    // 与「候选删光后不剔除失效条件」是同一类隐形过滤，只是成因换成用户自己收了窗口。
    await sites.locator('.rail-section__more').click();
    await expect(rowsOf(sites)).toHaveCount(VISIBLE_LIMIT + 1);
    await expect(rowOf(sites, paddedDomainOf(OVER_LIMIT))).toHaveAttribute('aria-pressed', 'true');
    await expect(mainRows(page)).toHaveCount(1);
  });

  test('某站点删到空：候选行连同生效中的筛选一起退出，列表不停在看不见的空过滤上', async ({ optionsPage: page }) => {
    await seedVault(page, CSV, TOTAL);
    const sites = sectionOf(page, 'options.rail.sites');

    await rowOf(sites, domainOf('gamma')).click();
    await expect(mainRows(page)).toHaveCount(SITES.gamma);

    // 逐条删掉当前结果里的 gamma 行（删除走确认弹窗，落盘在淡出动画之后）
    for (let i = 0; i < SITES.gamma; i += 1) {
      const isLast = i === SITES.gamma - 1;
      await mainRows(page)
        .nth(0)
        .getByRole('button', { name: textOf('common.delete') })
        .click();
      const box = page.locator('.el-message-box');
      await box.getByRole('button', { name: textOf('form.moveToTrash') }).click();
      await expectSuccessToast(page, 'form.movedToTrash');
      // 最后一条删除的瞬间，候选收口与表格重绘在同一次刷新里完成，中间态读不到确定值，
      // 因此只在还有剩余时核对行数，末尾统一断言终态
      if (!isLast) {
        await expect(mainRows(page)).toHaveCount(SITES.gamma - 1 - i);
      }
    }

    await expect(rowOf(sites, domainOf('gamma'))).toHaveCount(0);
    await expect(mainRows(page)).toHaveCount(TOTAL - SITES.gamma);
    await expect(allRow(page)).toHaveAttribute('aria-pressed', 'true');
  });
});
