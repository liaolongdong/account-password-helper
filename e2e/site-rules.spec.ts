import type { BrowserContext, Page } from '@playwright/test';
import {
  E2E_PAGE_ORIGIN,
  expect,
  expectSuccessToast,
  pingDetectedFields,
  readSiteRules,
  seedSiteRule,
  test,
} from './harness';
import { textOf } from './i18n';

/**
 * 站点级填充规则（F1 + C6）端到端
 *
 * 覆盖四段真实链路，都是单元测试拿不到的东西：
 * 1. Options 表单 → `storage.local` 的真实落盘形态（含域名规范化与主键稳定）；
 * 2. 规则 → 内容脚本检测结果的收窄（通过内容脚本自己的 PING 观测口验证「权威覆盖」真的生效）；
 * 3. 引导消息经 Background 回到 Options 并带预填打开弹窗；
 * 4. 按站点覆盖的填充档位（C6）：只设档位也算有效规则、三项全空拒绝入库、
 *    列表区分「已覆盖 / 跟随全局」、编辑回显与清空（存储里以「不写该字段」表达）。
 */

const RULE_DOMAIN = 'site-rules.e2e.test';

/**
 * 拾取器对 shadow DOM 内元素给出的穿透前缀
 *
 * 分隔符是 `utils/storage/siteRules.ts` 的 `SHADOW_SELECTOR_SEPARATOR`（`>>>`）；这里按字面写，
 * 是为了让本文件不把这个模块的整张依赖图拉进测试进程——它一旦改了分隔符，下面三条断言会一起红。
 */
const SHADOW_PREFIX = 'widget-login >>> ';

/** 打开「安全设置 → 站点规则」 */
async function openSiteRulesDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: textOf('options.header.securitySettings') }).click();
  await page.getByRole('menuitem', { name: textOf('options.header.siteRules') }).click();
  await expect(page.locator('.site-rules-dialog')).toBeVisible();
}

const domainInput = (page: Page) => page.getByPlaceholder(textOf('options.siteRules.formDomainPlaceholder'));
const usernameInput = (page: Page) => page.getByPlaceholder(textOf('options.siteRules.formUsernamePlaceholder'));
const passwordInput = (page: Page) => page.getByPlaceholder(textOf('options.siteRules.formPasswordPlaceholder'));
const saveButton = (page: Page) => page.getByRole('button', { name: textOf('common.save') });

test.describe('站点规则表单与存储', () => {
  test('新增规则按规范化后的域名落盘，且选择器原样保存', async ({ optionsPage: page }) => {
    await openSiteRulesDialog(page);
    await page.getByRole('button', { name: textOf('options.siteRules.addButton') }).click();

    await domainInput(page).fill('  Site-Rules.E2E.Test  ');
    await usernameInput(page).fill('#user');
    await passwordInput(page).fill('input[type="password"]');
    await saveButton(page).click();

    await expectSuccessToast(page, 'options.siteRules.saveSuccess');
    const rules = await readSiteRules(page);
    expect(Object.keys(rules)).toEqual([RULE_DOMAIN]);
    expect(rules[RULE_DOMAIN]).toMatchObject({
      domain: RULE_DOMAIN,
      customSelectors: { username: '#user', password: 'input[type="password"]' },
    });
  });

  test('URL 形态的域名被就地拒绝，不写入存储', async ({ optionsPage: page }) => {
    await openSiteRulesDialog(page);
    await page.getByRole('button', { name: textOf('options.siteRules.addButton') }).click();

    await domainInput(page).fill('https://example.com');
    await usernameInput(page).fill('#user');
    await passwordInput(page).fill('#pass');
    await domainInput(page).blur();

    await expect(page.getByText(textOf('options.siteRules.validateDomainFormat'))).toBeVisible();
    await saveButton(page).click();
    expect(await readSiteRules(page)).toEqual({});
  });

  test('已有规则再次被引导命中时直接进入编辑态，而不是重复新增', async ({ optionsPage: page }) => {
    await seedSiteRule(page, { domain: RULE_DOMAIN, username: '#old', password: '#oldpass' });

    await openSiteRulesDialog(page);
    await page
      .getByRole('button', { name: textOf('options.siteRules.edit') })
      .first()
      .click();

    await expect(page.getByRole('dialog')).toContainText(textOf('options.siteRules.editTitle'));
    await expect(domainInput(page)).toHaveValue(RULE_DOMAIN);
    // 域名是匹配主键：编辑态必须只读，否则旧 key 下的规则会被改名成两条
    await expect(domainInput(page)).toHaveAttribute('readonly');

    await usernameInput(page).fill('#new');
    await saveButton(page).click();
    await expectSuccessToast(page, 'options.siteRules.saveSuccess');

    const rules = await readSiteRules(page);
    expect(Object.keys(rules)).toEqual([RULE_DOMAIN]);
    expect(rules[RULE_DOMAIN]).toMatchObject({ customSelectors: { username: '#new' } });
  });

  test('删除需要二次确认，取消则规则保持不动', async ({ optionsPage: page }) => {
    await seedSiteRule(page, { domain: RULE_DOMAIN, username: '#u', password: '#p' });
    await openSiteRulesDialog(page);

    await page
      .getByRole('button', { name: textOf('options.siteRules.delete') })
      .first()
      .click();
    const confirmBox = page.locator('.el-message-box');
    await expect(confirmBox).toBeVisible();
    await confirmBox.getByRole('button', { name: textOf('common.cancel') }).click();
    expect(Object.keys(await readSiteRules(page))).toEqual([RULE_DOMAIN]);

    await page
      .getByRole('button', { name: textOf('options.siteRules.delete') })
      .first()
      .click();
    await page
      .locator('.el-message-box')
      .getByRole('button', { name: textOf('common.confirm') })
      .click();
    await expectSuccessToast(page, 'options.siteRules.deleteSuccess');
    expect(await readSiteRules(page)).toEqual({});
  });
});

test.describe('按站点覆盖快速填充方式（C6）', () => {
  /** 表单里的档位下拉（本弹窗只有这一个 el-select，选择器天然唯一） */
  const fillSelect = (page: Page) => page.locator('.fill-entry-select');

  /** 打开档位下拉并选中指定文案对应的选项 */
  async function pickFillEntry(page: Page, textKey: string): Promise<void> {
    await fillSelect(page).locator('.el-select__wrapper').click();
    await page
      .locator('.el-select-dropdown__item')
      .filter({ hasText: textOf(textKey) })
      .click();
  }

  test('只设档位、选择器留空也能保存，且档位按字段落盘', async ({ optionsPage: page }) => {
    await openSiteRulesDialog(page);
    await page.getByRole('button', { name: textOf('options.siteRules.addButton') }).click();

    await domainInput(page).fill(RULE_DOMAIN);
    await pickFillEntry(page, 'options.siteRules.fillManual');
    await saveButton(page).click();

    await expectSuccessToast(page, 'options.siteRules.saveSuccess');
    const rule = (await readSiteRules(page))[RULE_DOMAIN] as Record<string, unknown>;
    expect(rule).toMatchObject({ domain: RULE_DOMAIN, fillEntry: 'manual' });
    // 两侧都留空时不写这个键：半条选择器会让消费端在两种来源之间摇摆
    expect(rule.customSelectors).toBeUndefined();
  });

  test('新增态三项覆盖全为空时拒绝入库，不留下什么都不做的规则行', async ({ optionsPage: page }) => {
    await openSiteRulesDialog(page);
    await page.getByRole('button', { name: textOf('options.siteRules.addButton') }).click();

    await domainInput(page).fill(RULE_DOMAIN);
    await saveButton(page).click();

    await expect(page.getByText(textOf('options.siteRules.validateEmptyRule'))).toBeVisible();
    expect(await readSiteRules(page)).toEqual({});
  });

  test('列表用档位名列区分「本站已覆盖」与「跟随全局」', async ({ optionsPage: page }) => {
    await seedSiteRule(page, { domain: RULE_DOMAIN, fillEntry: 'manual' });
    await seedSiteRule(page, { domain: 'follow.e2e.test', username: '#u', password: '#p' });

    await openSiteRulesDialog(page);
    const tags = page.locator('.fill-entry-tag');
    await expect(tags).toHaveCount(1);
    await expect(tags.first()).toHaveText(textOf('options.siteRules.fillManual'));
    await expect(page.getByText(textOf('options.siteRules.fillFollowGlobal'))).toBeVisible();
  });

  test('编辑带选择器的规则时改回「跟随全局」，只去掉档位键而不动其它覆盖', async ({ optionsPage: page }) => {
    await seedSiteRule(page, {
      domain: RULE_DOMAIN,
      username: '#a-user',
      password: '#a-pwd',
      fillEntry: 'manual',
    });

    await openSiteRulesDialog(page);
    await page
      .getByRole('button', { name: textOf('options.siteRules.edit') })
      .first()
      .click();
    await expect(fillSelect(page)).toContainText(textOf('options.siteRules.fillManual'));

    await pickFillEntry(page, 'options.siteRules.fillFollowGlobal');
    await saveButton(page).click();
    await expectSuccessToast(page, 'options.siteRules.saveSuccess');

    const rule = (await readSiteRules(page))[RULE_DOMAIN] as Record<string, unknown>;
    expect(rule).toMatchObject({
      domain: RULE_DOMAIN,
      customSelectors: { username: '#a-user', password: '#a-pwd' },
    });
    // 「跟随全局」= 不写该字段，而不是按当下的全局档位设死
    expect('fillEntry' in rule).toBe(false);
  });

  test('新增态档位框显示「跟随全局」，不是 Element Plus 的英文占位符', async ({ optionsPage: page }) => {
    // 这一条是用户截图里那个缺陷的直接形态：本仓没有安装 Element Plus 语言包，未选中态的
    // 占位符是内置英文 "Select"，出现在中文界面里既不统一、也读不出「当前是什么档位」。
    // 实现上用哨兵值 `'follow'` 而不是 `''`——EP 把空串判成未选中，选中值因此不显示。
    await openSiteRulesDialog(page);
    await page.getByRole('button', { name: textOf('options.siteRules.addButton') }).click();
    await expect(fillSelect(page)).toContainText(textOf('options.siteRules.fillFollowGlobal'));
    await expect(fillSelect(page)).not.toContainText('Select');
  });

  test('编辑没有档位字段的存量规则时，档位框同样回显「跟随全局」', async ({ optionsPage: page }) => {
    // 与新增态是两条不同的码路径：这里走 `handleEdit` 的 `rule.fillEntry ?? FOLLOW_GLOBAL`。
    // 存量规则里「跟随全局」的表达方式正是「不写该字段」，所以这条也必须在框里看得见档位名。
    await seedSiteRule(page, { domain: RULE_DOMAIN, username: '#u', password: '#p' });

    await openSiteRulesDialog(page);
    await page
      .getByRole('button', { name: textOf('options.siteRules.edit') })
      .first()
      .click();
    await expect(fillSelect(page)).toContainText(textOf('options.siteRules.fillFollowGlobal'));
    await expect(fillSelect(page)).not.toContainText('Select');
  });

  test('把唯一一项覆盖改回「跟随全局」时整条规则移除，而不是留一条改不回去的空壳', async ({ optionsPage: page }) => {
    await seedSiteRule(page, { domain: RULE_DOMAIN, fillEntry: 'manual' });

    await openSiteRulesDialog(page);
    await page
      .getByRole('button', { name: textOf('options.siteRules.edit') })
      .first()
      .click();

    await pickFillEntry(page, 'options.siteRules.fillFollowGlobal');
    await saveButton(page).click();
    await expectSuccessToast(page, 'options.siteRules.clearSuccess');

    expect(Object.keys(await readSiteRules(page))).not.toContain(RULE_DOMAIN);
  });
});

test.describe('内容脚本消费站点规则', () => {
  /**
   * 页面上有两个常规密码框和两个常规文本框（启发式各命中 2 个），
   * 真正的登录框藏在 open shadow DOM 里；规则命中后字段集合必须收窄到这 1 组。
   */
  const PAGE_HTML = `<!doctype html><html><head><title>e2e</title></head><body>
    <form><input name="username" value="decoy-1"><input type="password" value="decoy-1"></form>
    <input name="user_name"><input type="password">
    <widget-login></widget-login>
    <script>
      customElements.define('widget-login', class extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: 'open' });
          root.innerHTML = '<input id="a-user" name="account"><input id="a-pwd" type="password">';
        }
      });
    </script>
  </body></html>`;

  /** 打开被 route 直接响应的假站点（内容脚本会在其上运行，且不出网） */
  async function openFixturePage(extContext: BrowserContext) {
    const page = await extContext.newPage();
    await page.route('**/*', route =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE_HTML }),
    );
    await page.goto(`${E2E_PAGE_ORIGIN}/login`);
    await page.waitForSelector('widget-login');
    return page;
  }

  test('无规则时按启发式识别出多个候选字段', async ({ optionsPage, extContext }) => {
    const page = await openFixturePage(extContext);
    await page.waitForTimeout(1500);

    const fields = await pingDetectedFields(optionsPage, E2E_PAGE_ORIGIN);
    expect(fields.password).toBeGreaterThan(1);
    expect(fields.username).toBeGreaterThan(1);
  });

  test('规则命中时把账号/密码字段收窄为权威的那一组', async ({ optionsPage, extContext }) => {
    await seedSiteRule(optionsPage, {
      domain: RULE_DOMAIN,
      username: '#a-user',
      password: '#a-pwd',
    });
    const page = await openFixturePage(extContext);
    await page.waitForTimeout(1500);

    const fields = await pingDetectedFields(optionsPage, E2E_PAGE_ORIGIN);
    expect(fields).toMatchObject({ username: 1, password: 1 });
  });

  test('只钉账号一侧时，密码字段仍由自动检测给出', async ({ optionsPage, extContext }) => {
    // 短信验证码登录页没有密码框，规则只能钉一侧；旧表单强制成对填写，用户为了钉账号框
    // 只能把「密码框」随手点到页面上唯一剩下的框，凭证因此写进错误的字段
    await seedSiteRule(optionsPage, {
      domain: RULE_DOMAIN,
      username: '#a-user',
    });
    const page = await openFixturePage(extContext);
    await page.waitForTimeout(1500);

    const fields = await pingDetectedFields(optionsPage, E2E_PAGE_ORIGIN);
    expect(fields.username).toBe(1);
    // 未配置的一侧不得被顺手清空：密码字段数量与无规则时同源（夹具里是 2）
    expect(fields.password).toBeGreaterThan(1);
  });

  test('在目标页拾取 Shadow DOM 输入框，回填选择器并保存', async ({ optionsPage: page, extContext }) => {
    const site = await openFixturePage(extContext);
    // 等内容脚本完成首轮注入；否则 START_SELECTOR_PICK 会得到 NO_CONTENT_SCRIPT
    await site.waitForTimeout(1500);

    await openSiteRulesDialog(page);
    await page.getByRole('button', { name: textOf('options.siteRules.addButton') }).click();
    await domainInput(page).fill(RULE_DOMAIN);

    await page.getByRole('button', { name: textOf('options.siteRules.pickUsername') }).click();
    await expect(site.locator('[data-aph-selector-picker]')).toBeVisible();
    await site.locator('#a-user').click();
    // 夹具里 `#a-user` 在 `<widget-login>` 的 open shadowRoot 内，裸 `#a-user` 在文档上根本选不中，
    // 拾取器给的是穿透形态 `host >>> inner`（`utils/storage/siteRules.ts` 的 SHADOW_SELECTOR_SEPARATOR）
    await expect(usernameInput(page)).toHaveValue(`${SHADOW_PREFIX}#a-user`);
    await expect(site.locator('[data-aph-selector-picker]')).toHaveCount(0);
    // 拾取成功后管理页应自动回到前台，而不是把用户留在目标站点
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');

    // 只填一侧是合法的：短信码登录页本就没有密码框，强制成对只会逼用户把「密码框」
    // 随手指到验证码框上（密码因此被写进短信码输入框）。这里必须不再有校验错误冒出。
    const selectorErrors = page.locator('.el-form-item__error');
    await expect(selectorErrors).toHaveCount(0);

    await page.getByRole('button', { name: textOf('options.siteRules.pickPassword') }).click();
    await expect(site.locator('[data-aph-selector-picker]')).toBeVisible();
    await site.locator('#a-pwd').click();
    await expect(passwordInput(page)).toHaveValue(`${SHADOW_PREFIX}#a-pwd`);
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
    await expect(selectorErrors).toHaveCount(0);

    await saveButton(page).click();
    await expectSuccessToast(page, 'options.siteRules.saveSuccess');
    const rules = await readSiteRules(page);
    expect(rules[RULE_DOMAIN]).toMatchObject({
      domain: RULE_DOMAIN,
      customSelectors: { username: `${SHADOW_PREFIX}#a-user`, password: `${SHADOW_PREFIX}#a-pwd` },
    });
  });
});
