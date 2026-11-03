import type { Locator, Page } from '@playwright/test';
import { STORAGE_KEYS } from '@/utils/storageKeys';
import { expect, runHeaderCommand, storedArrayCount, test } from './harness';
import { templatedOf, textOf } from './i18n';

/**
 * 管理页筛选栏的两个候选下拉（标签 / 站点）的真机回归
 *
 * 单测钉的是算法与接线（`siteUtils` / `tagUtils` / `siteFilterWiring`），证明不了只有真浏览器才成立的五件事：
 * ① 候选下拉**真的渲染得出来**——两个下拉都是虚拟列表 `el-select-v2`，它的 `:props` 字段映射、
 *    自定义 option 插槽、`.el-select-dropdown__item` 类名都是 Element Plus 内部约定，
 *    任一条对不上，用户看到的就是一个空面板或一个点不动的控件；
 * ② 多种网址写法在真实数据上确实落进同一个桶（条目经导入落盘为密文，读出来才参与归一）；
 * ③ 选站后主表的行数与内容跟着变，而不是「筛选算了但没接到 `el-table`」；
 * ④ 候选行的**省略号与 `title` 兜底**：面板宽度由 Element Plus 按最长 label 量出（`calculateLabelMaxWidth`），
 *    不会把插槽里的计数列算进去，所以最长的那一条必然截断——省略号生效与 title 给回原文都只在真实排版下成立；
 * ⑤ 「无网址」桶的**哨兵键没有漏进界面**：候选行与闭合态选中标签都要读到本地化文案，
 *    而不是 `/no-url` 这个像路径的串（`el-select-v2` 的 `:props` 只认字段名，文案必须落在数据上）。
 *
 * 前置数据沿用 `pagination.spec.ts` 的做法：走真实的「数据管理 → 导入数据」入口灌入。
 */

/** 三个站的条目数刻意各不相等，候选排序（条目数倒序）才有可判定的读数 */
const SITES = { alpha: 6, beta: 4, gamma: 2 } as const;
const TOTAL = SITES.alpha + SITES.beta + SITES.gamma;

/** 合成凭据：RFC 2606 保留域，与任何真实账号无关 */
const domainOf = (letter: string) => `${letter}.e2e-sf.test`;

/**
 * 满长度标签：恰好 30 个字符，等于 `utils/constants` 里的 `MAX_TAG_LENGTH` 上界，
 * 也就是编辑弹窗允许的最长标签（下面有断言钉住这个长度，改一处就会红）。
 *
 * 刻意取上界而不是随手写一串：截断只在「label 宽度 > 面板宽度 − 计数列」时出现，
 * 30 个字符足够逼出省略号，同时不会造出一个用户实际存不进来的形状。
 */
const LONG_TAG = 'e2e-sf-long-tag-at-max-lengths';

/** alpha 刻意用三种写法（完整 URL / 纯域名 / 带端口），用来证明归一后同桶；前 3 条挂标签供叠加断言 */
const CSV = [
  'username,password,url,tag,remark',
  ...Array.from({ length: SITES.alpha }, (_, i) => {
    const url = [`https://${domainOf('alpha')}/login`, domainOf('alpha'), `http://${domainOf('alpha')}:8080/dashboard`][
      i % 3
    ];
    return `e2e-sf-a${i + 1},Synthetic!A${i + 1},${url},${i < 3 ? 'sfwork' : ''},`;
  }),
  // beta 前 2 条挂满长度标签：既是标签候选的第二档，也是截断断言的那一条
  ...Array.from(
    { length: SITES.beta },
    (_, i) => `e2e-sf-b${i + 1},Synthetic!B${i + 1},https://${domainOf('beta')}/x,${i < 2 ? LONG_TAG : ''},`,
  ),
  // gamma 第 1 条挂 sfhome：标签候选的第三档，且与站点候选的排序互不干扰
  ...Array.from(
    { length: SITES.gamma },
    (_, i) => `e2e-sf-g${i + 1},Synthetic!G${i + 1},${domainOf('gamma')},${i === 0 ? 'sfhome' : ''},`,
  ),
].join('\n');

/**
 * 主表格行
 *
 * 与 `pagination.spec.ts` 同理：导入弹窗的预览区本身也是一张 `el-table`，按容器收窄才不把预览行算进来。
 */
const mainRows = (page: Page): Locator => page.locator('.password-list tr.el-table__row');

/** 下拉触发器（`.tag-filter` / `.site-filter` 是组件自挂的类，宽度固定 200 / 220px） */
const siteSelect = (page: Page): Locator => page.locator('.filters .site-filter');
const tagSelect = (page: Page): Locator => page.locator('.filters .tag-filter');

/**
 * 候选面板
 *
 * 按组件自挂的 `popper-class` 收窄，而不是按 `.el-select-dropdown` 类名——页面上同时挂着页码档位下拉等
 * 多份面板残留，类名是 Element Plus 的共享命名；两个筛选下拉又共用同一份候选行结构（`.facet-option`），
 * 行内类名同样区分不了彼此。`:visible` 是因为 `persistent` 默认 true，收起的面板仍留在 DOM 里。
 */
const facetPopper = (page: Page, kind: 'tag' | 'site'): Locator =>
  page.locator(`.el-popper:visible.${kind}-filter-popper`);

/** 面板里某一候选的整行 */
const facetOption = (page: Page, kind: 'tag' | 'site', text: string): Locator =>
  facetPopper(page, kind).locator('.el-select-dropdown__item').filter({ hasText: text });

/** 面板里候选行的可见文本列（顺序即候选排序，可直接数） */
const facetTexts = (page: Page, kind: 'tag' | 'site'): Locator =>
  facetPopper(page, kind).locator('.facet-option__text');

const siteOption = (page: Page, site: string): Locator => facetOption(page, 'site', site);
const tagOption = (page: Page, tag: string): Locator => facetOption(page, 'tag', tag);

/** 展开站点下拉 */
async function openSiteDropdown(page: Page): Promise<void> {
  await siteSelect(page).locator('.el-select__wrapper').click();
  await expect(siteOption(page, domainOf('alpha'))).toBeVisible();
}

/** 展开标签下拉 */
async function openTagDropdown(page: Page): Promise<void> {
  await tagSelect(page).locator('.el-select__wrapper').click();
  await expect(tagOption(page, 'sfwork')).toBeVisible();
}

/**
 * 通用桶的用例数据：三条没填网址、两个真实站点各一条。
 *
 * 刻意让通用桶的计数**最大**：它不是一个站点，排在末位是固定规则而不是排序结果，
 * 只有让它赢过真实站点，断言才抓得住「跟着条目数跳位」这种改法。
 */
const GENERIC_CSV = [
  'username,password,url,tag,remark',
  `e2e-sg-a,Synthetic!Ga,https://${domainOf('alpha')}/x,,`,
  `e2e-sg-b,Synthetic!Gb,${domainOf('beta')},,`,
  ...Array.from({ length: 3 }, (_, i) => `e2e-sg-n${i + 1},Synthetic!Gn${i + 1},,,`),
].join('\n');

/** 走真实的「数据管理 → 导入数据」入口把一份 CSV 落库 */
async function importCsv(page: Page, fileName: string, csv: string): Promise<void> {
  await runHeaderCommand(page, 'options.header.data', 'options.header.importData');
  const dialog = page.getByRole('dialog').filter({ hasText: textOf('options.import.title') });
  await expect(dialog).toBeVisible();
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
  await expect(dialog.locator('.preview-section')).toBeVisible();
  await dialog.locator('.el-dialog__footer .el-button--success').click();
  await expect(dialog).toBeHidden();
}

/** 走真实导入入口灌入 12 条，并等主表与 storage 两边的数对上（候选下拉由各用例自己展开） */
async function seedVault(page: Page): Promise<void> {
  await importCsv(page, 'e2e-site-filter.csv', CSV);
  await expect(mainRows(page)).toHaveCount(TOTAL);
  expect(await storedArrayCount(page, STORAGE_KEYS.PASSWORDS)).toBe(TOTAL);
}

/**
 * 环回折叠的用例数据：同一台机器的三种写法与四种端口形态各一条，
 * 外加一条**同机但不同虚拟主机**（`myapp.localhost`）和一条公网站点作反证——
 * 折叠只该发生在环回字面写法之间，扩大到这两者就会把不该并的账号并成一桶。
 */
const LOOPBACK_CSV = [
  'username,password,url,tag,remark',
  'e2e-lb-1,Synthetic!Lb1,http://localhost:3000/login,,',
  'e2e-lb-2,Synthetic!Lb2,127.0.0.1:4000,,',
  'e2e-lb-3,Synthetic!Lb3,localhost:5173,,',
  'e2e-lb-4,Synthetic!Lb4,localhost:*,',
  'e2e-lb-vhost,Synthetic!Lbv,myapp.localhost:3000,,',
  'e2e-lb-public,Synthetic!Lbp,https://example.com/,,',
].join('\n');

test.describe.configure({ timeout: 120_000 });

test.describe('管理页筛选栏候选下拉（标签 / 站点）', () => {
  test('本机三种环回写法折成一档：标签写明涵盖的写法，勾选后各端口都在', async ({ optionsPage: page }) => {
    await importCsv(page, 'e2e-loopback-site-filter.csv', LOOPBACK_CSV);
    await expect(mainRows(page)).toHaveCount(6);

    await siteSelect(page).locator('.el-select__wrapper').click();
    // 折叠后 `127.0.0.1` 不再是独立候选：它必须写在标签上，否则用户既筛不到、也看不出这一桶涵盖了什么
    const bucket = templatedOf('options.filter.siteWithAliases', { site: 'localhost', hosts: '127.0.0.1' });
    await expect(facetTexts(page, 'site')).toHaveText([bucket, 'example.com', 'myapp.localhost']);

    // 端口分布只进 title：面板宽度按最长 label 量出，把端口串塞进 label 会让整列候选被最活跃的一桶挤窄
    const ports = templatedOf('options.filter.sitePorts', { ports: '3000 / 4000 / 5173 / *' });
    const localRow = facetPopper(page, 'site').locator('.el-select-dropdown__item').first();
    await expect(localRow.locator('.facet-option')).toHaveAttribute(
      'title',
      new RegExp(`(?:${bucket.source}) · (?:${ports.source})`),
    );

    await localRow.click();
    await page.keyboard.press('Escape');

    // 本机整桶四条（含 `localhost:*` 那条）；同机不同虚拟主机与公网站点一条都不带
    await expect(mainRows(page)).toHaveCount(4);
    await expect(mainRows(page).filter({ hasText: 'e2e-lb-vhost' })).toHaveCount(0);
    await expect(mainRows(page).filter({ hasText: 'e2e-lb-public' })).toHaveCount(0);
  });

  test('候选集由条目网址自动汇总：按条目数倒序并带计数', async ({ optionsPage: page }) => {
    await seedVault(page);

    await expect(siteSelect(page)).toBeVisible();
    // 未选中任何站点时显示的是占位文案（候选集不显示在闭合态里）
    await expect(siteSelect(page)).toContainText(textOf('options.filter.sitePlaceholder'));

    await openSiteDropdown(page);
    await expect(facetTexts(page, 'site')).toHaveText([domainOf('alpha'), domainOf('beta'), domainOf('gamma')]);
    await expect(facetPopper(page, 'site').locator('.facet-option__count')).toHaveText([
      String(SITES.alpha),
      String(SITES.beta),
      String(SITES.gamma),
    ]);
  });

  test('选中站点后主表只留该站条目，同一站的多种网址写法算作一站', async ({ optionsPage: page }) => {
    await seedVault(page);
    await openSiteDropdown(page);

    await siteOption(page, domainOf('alpha')).click();
    await page.keyboard.press('Escape');

    // 6 条全在（完整 URL / 纯域名 / 带端口三种写法同桶），其余两站一条不剩
    await expect(mainRows(page)).toHaveCount(SITES.alpha);
    await expect(mainRows(page).filter({ hasText: `${domainOf('alpha')}:8080` })).toHaveCount(2);
    await expect(mainRows(page).filter({ hasText: domainOf('beta') })).toHaveCount(0);
    await expect(mainRows(page).filter({ hasText: domainOf('gamma') })).toHaveCount(0);
  });

  test('多站之间是或关系，取消到空集合即恢复全量', async ({ optionsPage: page }) => {
    await seedVault(page);
    await openSiteDropdown(page);

    await siteOption(page, domainOf('alpha')).click();
    await expect(mainRows(page)).toHaveCount(SITES.alpha);

    await siteOption(page, domainOf('gamma')).click();
    await expect(mainRows(page)).toHaveCount(SITES.alpha + SITES.gamma);

    await siteOption(page, domainOf('alpha')).click();
    await expect(mainRows(page)).toHaveCount(SITES.gamma);

    // 选中集清空 = 该维度不参与筛选，而不是「筛出一个空集」
    await siteOption(page, domainOf('gamma')).click();
    await page.keyboard.press('Escape');
    await expect(mainRows(page)).toHaveCount(TOTAL);
  });

  test('站点与标签是叠加关系（AND）', async ({ optionsPage: page }) => {
    await seedVault(page);

    await openTagDropdown(page);
    await tagOption(page, 'sfwork').click();
    await expect(mainRows(page)).toHaveCount(3);

    await openSiteDropdown(page);
    await siteOption(page, domainOf('gamma')).click();
    await page.keyboard.press('Escape');

    // gamma 的两条没有 sfwork 标签：叠加后应当是空表，而不是回落到任一维度
    await expect(mainRows(page)).toHaveCount(0);
  });

  test('未填网址的条目汇成末位的「无网址」候选，单独勾选只留这批', async ({ optionsPage: page }) => {
    await importCsv(page, 'e2e-site-generic.csv', GENERIC_CSV);
    await expect(mainRows(page)).toHaveCount(5);

    await openSiteDropdown(page);
    // 通用桶的计数比任何一个真实站点都大（3 > 1）却仍排末位：它不是一个站点，
    // 跟着条目数在列表里跳位会让用户每次打开下拉都要重新找它
    await expect(facetTexts(page, 'site')).toHaveText([
      domainOf('alpha'),
      domainOf('beta'),
      textOf('options.filter.siteGenericOption'),
    ]);
    await expect(facetPopper(page, 'site').locator('.facet-option__count')).toHaveText(['1', '1', '3']);

    await facetOption(page, 'site', textOf('options.filter.siteGenericOption')).click();
    await page.keyboard.press('Escape');

    // 展示文案落在 option 数据上、不只在插槽里：闭合态的选中标签读的是同一份 label，
    // 哨兵串若漏到这里，用户看到的就是一个像路径的乱码
    await expect(siteSelect(page)).toContainText(textOf('options.filter.siteGenericOption'));
    await expect(siteSelect(page)).not.toContainText('/no-url');
    // 真实站点的键永远不等于哨兵，所以这一勾筛出的恰好就是待补网址的那三条
    await expect(mainRows(page)).toHaveCount(3);
  });

  test('标签候选与站点候选同构：条目数倒序 + 行内计数', async ({ optionsPage: page }) => {
    await seedVault(page);
    await openTagDropdown(page);

    // 3 条 sfwork / 2 条满长度标签 / 1 条 sfhome；计数是**全库条目数**，与另一维度的选中态无关
    await expect(facetTexts(page, 'tag')).toHaveText(['sfwork', LONG_TAG, 'sfhome']);
    await expect(facetPopper(page, 'tag').locator('.facet-option__count')).toHaveText(['3', '2', '1']);

    await page.keyboard.press('Escape');

    // 先选中一个标签再看候选计数：读数必须仍是全库口径。
    // 若改成「当前筛选结果数」，这一步会让 sfwork 之外的候选变成 0，面板当场读成空集。
    await openTagDropdown(page);
    await tagOption(page, 'sfwork').click();
    await expect(mainRows(page)).toHaveCount(3);

    await page.keyboard.press('Escape');
    await openTagDropdown(page);
    await expect(facetPopper(page, 'tag').locator('.facet-option__count')).toHaveText(['3', '2', '1']);
  });

  test('截断的候选行靠原生 title 给回原文', async ({ optionsPage: page }) => {
    await seedVault(page);
    // 夹具的形状前提：这一条确实是「用户能存进来的最长标签」
    expect(LONG_TAG).toHaveLength(30);
    await openTagDropdown(page);

    // 面板宽度按最长 label 量出，不把计数列算进去 → 满长度标签这一条必然显示成省略号
    const truncated = await tagOption(page, LONG_TAG)
      .locator('.facet-option')
      .evaluate(row => {
        const text = row.querySelector<HTMLElement>('.facet-option__text');
        return {
          title: row.getAttribute('title'),
          scrollWidth: text?.scrollWidth ?? 0,
          clientWidth: text?.clientWidth ?? 0,
        };
      });
    // clientWidth > 0 先把「这一行真的排版了」钉住：否则 scrollWidth > 0 = clientWidth 会由
    // 一个隐藏/零宽元素白送通过，那条断言就变成测「元素不存在」。
    expect(truncated.clientWidth, '候选行没有宽度，截断读数不可信').toBeGreaterThan(0);
    expect(truncated.scrollWidth, '这一条没有被截断，title 兜底的断言就失去了前提').toBeGreaterThan(
      truncated.clientWidth,
    );
    expect(truncated.title).toBe(LONG_TAG);

    // 没被截断的候选也带 title：口径统一，不必先判断长度
    await expect(tagOption(page, 'sfhome').locator('.facet-option')).toHaveAttribute('title', 'sfhome');
  });

  /**
   * 悬浮落点解析：给定坐标，沿 DOM 往上找第一个带 `title` 的祖先
   *
   * 原生 tooltip 的触发条件就是这条链——链断了（祖先里没有 `title`），鼠标停在那里什么也不会弹。
   * 所以「title 属性在不在」不等于「用户 hover 得到得不到」，必须按落点量。
   */
  const titledAt = (page: Page, x: number, y: number): Promise<{ cls: string; title: string | null }> =>
    page.evaluate(
      ({ x, y }) => {
        let el: Element | null = document.elementFromPoint(x, y);
        while (el && !(el as HTMLElement).title) el = el.parentElement;
        return el
          ? { cls: el.getAttribute('class') || el.tagName, title: (el as HTMLElement).title }
          : { cls: '', title: null };
      },
      { x, y },
    );

  test('候选行的 title 覆盖整行，左/右内边距不再是悬浮死区', async ({ optionsPage: page }) => {
    await seedVault(page);
    await openTagDropdown(page);

    const row = tagOption(page, LONG_TAG);
    const box = await row.boundingBox();
    expect(box, '候选行没有排版，落点判据不可信').not.toBeNull();

    /**
     * EP 给候选行 `<li>` 的是 `padding: 0 32px 0 20px`：title 挂在 padding 内侧的节点上时，
     * 行首 20px / 行尾 32px 都是悬浮死区（面板本体才 200px，52px 是整行的四分之一）。
     * 最右只探到 −16px：再往外是虚拟列表的滚动条覆层，它盖在行之上、不属于我们。
     */
    const probes = [
      { name: '行首', x: box!.x + 2 },
      { name: '左侧内边距带', x: box!.x + 16 },
      { name: '右侧内边距带', x: box!.x + box!.width - 16 },
    ];
    for (const { name, x } of probes) {
      const hit = await titledAt(page, x, box!.y + box!.height / 2);
      expect(hit.title, `${name}的落点解析不到 title：那一段仍是悬浮死区`).toBe(LONG_TAG);
    }

    // 覆盖面换到整行，代价不能是文本挪位：padding 从 `<li>` 搬进 `.facet-option`，两侧必须同值
    const insets = await row.evaluate(el => {
      const line = el.getBoundingClientRect();
      const text = el.querySelector<HTMLElement>('.facet-option__text')!.getBoundingClientRect();
      const count = el.querySelector<HTMLElement>('.facet-option__count')!.getBoundingClientRect();
      return { left: Math.round(text.x - line.x), right: Math.round(line.x + line.width - count.x - count.width) };
    });
    expect(insets, '候选行的文本落点变了：两侧内边距必须与 Element Plus 的原值 20 / 32px 一致').toEqual({
      left: 20,
      right: 32,
    });
  });

  test('闭合态选中的长标签靠原生 title 给回原文', async ({ optionsPage: page }) => {
    await seedVault(page);
    await openTagDropdown(page);
    await tagOption(page, LONG_TAG).click();
    await page.keyboard.press('Escape');

    const chip = page.locator('.filters .tag-filter .el-tag').first();
    await expect(chip).toBeVisible();
    const chipBox = await chip.boundingBox();
    expect(chipBox, '闭合态标签没有排版，落点判据不可信').not.toBeNull();

    // 前提：这一条在 200px 宽的触发器里确实是截断的，否则 title 兜底无从验证
    const truncation = await chip.evaluate(el => {
      const text = el.querySelector<HTMLElement>('.el-select__tags-text');
      return { visible: text?.clientWidth ?? 0, content: text?.scrollWidth ?? 0, text: text?.textContent ?? '' };
    });
    expect(truncation.text).toBe(LONG_TAG);
    expect(truncation.visible, '标签没有宽度，截断读数不可信').toBeGreaterThan(0);
    expect(truncation.content, '这一条没被截断，title 兜底的断言就失去了前提').toBeGreaterThan(truncation.visible);

    // 落点在标签文字正中：title 必须挂在这条链上，且给回的是原文
    const hit = await titledAt(page, chipBox!.x + chipBox!.width / 2, chipBox!.y + chipBox!.height / 2);
    expect(hit.title, '闭合态标签截断了却读不到原文').toBe(LONG_TAG);
  });

  test('标签下拉可键入过滤，且过滤文本不改主表', async ({ optionsPage: page }) => {
    await seedVault(page);
    await openTagDropdown(page);

    await tagSelect(page).locator('.el-select__wrapper input').pressSequentially('home');

    await expect(facetTexts(page, 'tag')).toHaveText(['sfhome']);
    // 键入只是面板内的定位手段，不是一次筛选：主表仍是全量
    await expect(mainRows(page)).toHaveCount(TOTAL);
  });
});
