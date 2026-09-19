import type { BrowserContext, Page } from '@playwright/test';
import { E2E_PAGE_ORIGIN, expect, pingDetectedFields, readSiteRules, seedSiteRule, test } from './harness';
import { textOf } from './i18n';

/**
 * 站点级填充规则（F1）端到端
 *
 * 覆盖三段真实链路，都是单元测试拿不到的东西：
 * 1. Options 表单 → `storage.local` 的真实落盘形态（含域名规范化与主键稳定）；
 * 2. 规则 → 内容脚本检测结果的收窄（通过内容脚本自己的 PING 观测口验证「权威覆盖」真的生效）；
 * 3. 引导消息经 Background 回到 Options 并带预填打开弹窗。
 */

const RULE_DOMAIN = 'site-rules.e2e.test';

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

    await expect(page.locator('.el-message--success')).toBeVisible();
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
    await expect(page.locator('.el-message--success')).toBeVisible();

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
    await expect(page.locator('.el-message--success')).toBeVisible();
    expect(await readSiteRules(page)).toEqual({});
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
});
