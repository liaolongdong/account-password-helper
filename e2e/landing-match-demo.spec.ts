import { expect, test } from './harness';

/**
 * 落地页多环境匹配模拟器的真机行为
 *
 * 结构守卫只证明服务字节里有静态结果与字典；「改主机名 / 切档位后列表真的变」
 * 必须在浏览器里点。这里用扩展上下文开普通页面即可：演示不依赖 chrome.* API，
 * file:// 下也不会发起任何网络请求。
 */
const LANDING_ZH = new URL('../index.html', import.meta.url).href;
const LANDING_EN = new URL('../en.html', import.meta.url).href;

test.describe('落地页多环境匹配演示', () => {
  test('精确 → 通配 → 同主域兜底，列表按档位变化', async ({ extContext }) => {
    const page = await extContext.newPage();
    await page.goto(LANDING_ZH, { waitUntil: 'load' });

    const summary = page.locator('#matchSummary');
    const rows = page.locator('#matchList .match-row');
    await expect(summary).toContainText('命中 3 / 11');
    await expect(rows).toHaveCount(3);

    await page.locator('#matchHost').fill('dev-admin.example.com');
    await expect(summary).toContainText('命中 1 / 11');

    await page.locator('input[name="matchTier"][value="wildcard"]').check();
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#matchList .match-badge')).toHaveText(['精确匹配', '通配条目']);

    await page.locator('#matchHost').fill('music.qq.com');
    await page.locator('input[name="matchTier"][value="apex"]').check();
    await expect(summary).toContainText('music.qq.com · 命中 3 / 11 条');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('#matchList .match-badge')).toHaveText(['通配条目', '主域', '跨子域']);

    await page.close();
  });

  test('键盘可操作，英文页使用英文结果', async ({ extContext }) => {
    const page = await extContext.newPage();
    await page.goto(LANDING_EN, { waitUntil: 'load' });
    await expect(page.locator('#matchSummary')).toContainText('3 of 11 entries');

    // 快速示例是原生 button：聚焦后按回车等价于点击
    const music = page.locator('#matchQuick button', { hasText: 'music.qq.com' });
    await music.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#matchHost')).toHaveValue('music.qq.com');

    // 档位是原生 radio：聚焦后按空格切换
    const apex = page.locator('input[name="matchTier"][value="apex"]');
    await apex.focus();
    await page.keyboard.press('Space');
    await expect(apex).toBeChecked();
    await expect(page.locator('#matchList .match-row')).toHaveCount(3);
    await expect(page.locator('#matchList .match-badge')).toHaveText(['Wildcard', 'Apex', 'Sibling']);
    await expect(page.locator('#matchList .match-account small').first()).toContainText('Wildcard entry');

    await page.close();
  });
});
