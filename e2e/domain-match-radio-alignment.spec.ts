import { expect, test } from './harness';
import { openHeaderDialog } from './harness';
import { STORAGE_KEYS } from '../utils/storageKeys';

/**
 * 「跨子域名匹配」弹窗里单选圆点与文案的几何守卫
 *
 * 这个弹窗的每一档是「标题 + 说明」两行，而 `el-radio` 默认按单行等高排版，
 * 所以组件用 `align-items: flex-start` 让圆点贴第一行。真机量出来的问题是：
 * 圆点盒 `.el-radio__input` 只有 **14px** 高，标题行盒是 **21px**（14px 字号 × 1.5 行高），
 * 顶对齐让圆点中心比文字中心高 **3.5px** —— 用户看到的「单选框和文案没对齐」就是这 3.5px。
 *
 * 因此这里钉两件事，两条都是改坏了会立刻变红的判据：
 * 1. **圆点中心与标题行中心之差 ≤ 1px**（修复前实测 3.5px → 红）；
 * 2. **标题与说明左边缘同一条竖线**（说明换行后若被圆点盒挤偏，这里红）。
 *
 * 五档一起量（主机轴三档 + 端口轴两档共用同一 `.domain-match-option`），且中英文两态
 * 各跑一遍：字号与行高不随语言变，但说明文案长度会变，只有真机能证明长文案换行后
 * 两行仍然对齐。
 */

/** 一个选项块内：圆点可见中心、标题行中心、标题与说明的左边缘 */
const geometryOf = (node: Element) => {
  const rect = (sel: string): DOMRect => {
    const el = node.querySelector(sel);
    if (!el) throw new Error(`选项块里找不到 ${sel}`);
    return el.getBoundingClientRect();
  };
  // 量 `.el-radio__inner`（可见圆圈）而非 `.el-radio__input`——后者的盒子高度正是修复点
  const circle = rect('.el-radio__inner');
  const title = rect('.option-label');
  const desc = rect('.option-desc');
  return {
    circleCenter: (circle.top + circle.bottom) / 2,
    titleCenter: (title.top + title.bottom) / 2,
    titleLeft: title.left,
    descLeft: desc.left,
  };
};

const setLocale = (page: import('@playwright/test').Page, locale: 'zh-CN' | 'en'): Promise<void> =>
  page.evaluate(
    async (payload: { key: string; value: string }) => {
      await chrome.storage.local.set({ [payload.key]: payload.value });
    },
    { key: STORAGE_KEYS.LOCALE, value: locale },
  );

test('五档圆点垂直居中于标题行，标题与说明左边缘齐平（中英两态）', async ({ optionsPage: page }) => {
  const dialog = await openHeaderDialog(page, 'options.header.securitySettings', 'options.header.domainMatch');
  const options = dialog.locator('.domain-match-option');
  // 主机轴三档 + 端口轴两档；档位增减时这条判据要一并复核，故显式钉数量
  await expect(options, '选项块数量变了，本守卫的落点需复核').toHaveCount(5);

  for (const locale of ['zh-CN', 'en'] as const) {
    await setLocale(page, locale);
    // 等语言真的落地，否则量到的是切换前的旧排版
    await expect(options.first()).toContainText(locale === 'en' ? /Exact match/ : /仅精确匹配/);

    const count = await options.count();
    for (let i = 0; i < count; i += 1) {
      const box = await options.nth(i).evaluate(geometryOf);
      const offset = box.circleCenter - box.titleCenter;
      expect(
        Math.abs(offset),
        `第 ${i + 1} 档（${locale}）圆点与标题行中心差 ${offset.toFixed(1)}px，应 ≤ 1px`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(box.descLeft - box.titleLeft),
        `第 ${i + 1} 档（${locale}）说明与标题左边缘差 ${(box.descLeft - box.titleLeft).toFixed(1)}px`,
      ).toBeLessThanOrEqual(0.5);
    }

    await dialog
      .locator('.domain-match-group')
      .first()
      .screenshot({
        path: `.e2e-visual/domain-match-radios-${locale}.png`,
      });
  }
});
